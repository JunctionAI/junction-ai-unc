-- Manual UI requests are durable identities, not leases. A claimed request is
-- never reclaimed on timeout. Reads/replays reconcile its original run only.
alter table public.routine_runs add column input_revision bigint not null default 0 check (input_revision >= 0);
create table public.manual_routine_requests (
  account_id uuid not null references public.accounts(id) on delete cascade,
  context_generation bigint not null check (context_generation >= 0),
  actor_id uuid not null,
  request_id uuid not null,
  routine_id text not null,
  purpose text not null check (purpose in ('run','validate','input')),
  request_body jsonb not null,
  configuration_revision text not null,
  initial_record jsonb not null,
  run_id uuid not null references public.routine_runs(id) on delete cascade,
  phase text not null default 'prepared' check (phase in ('prepared','claimed')),
  created_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  primary key (account_id,context_generation,actor_id,request_id)
);
create index manual_routine_requests_run_idx on public.manual_routine_requests(run_id);
alter table public.manual_routine_requests enable row level security;
revoke all on public.manual_routine_requests from public,anon,authenticated;
grant select,insert,update,delete on public.manual_routine_requests to service_role;

create function public.read_manual_routine_request(p_account uuid,p_actor uuid,p_generation bigint,p_request uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('operation',to_jsonb(o),'run',to_jsonb(r))
 from public.manual_routine_requests o join public.routine_runs r on r.id=o.run_id
 join public.accounts a on a.id=o.account_id and a.context_generation=o.context_generation
 join public.account_members m on m.account_id=a.id and m.user_id=o.actor_id and m.role='owner'
 where o.account_id=p_account and o.actor_id=p_actor and o.context_generation=p_generation and o.request_id=p_request
   and r.account_id=o.account_id and r.context_generation=o.context_generation and r.routine_id=o.routine_id;
$$;

create function public.prepare_manual_routine_request(p_account uuid,p_actor uuid,p_generation bigint,p_request uuid,
 p_purpose text,p_body jsonb,p_revision text,p_initial jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; owner_role text; o public.manual_routine_requests%rowtype;
 s public.routine_states%rowtype; r public.routine_runs%rowtype; rid text; domain_name text; snapshot jsonb; spec jsonb; ctx jsonb;
begin
 select * into a from public.accounts where id=p_account for update;
 select role into owner_role from public.account_members where account_id=p_account and user_id=p_actor for share;
 if a.id is null or owner_role is distinct from 'owner' then raise exception 'owner_required' using errcode='42501'; end if;
 if a.context_generation is distinct from p_generation then raise exception 'context_changed' using errcode='40001'; end if;
 if p_request is null or p_purpose is null or p_purpose not in ('run','validate','input') or jsonb_typeof(p_body) is distinct from 'object'
   or octet_length(p_body::text)>16384 then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into o from public.manual_routine_requests where account_id=p_account and context_generation=p_generation and actor_id=p_actor and request_id=p_request;
 if found then
   if o.purpose is distinct from p_purpose or o.request_body is distinct from p_body then raise exception 'request_id_reused' using errcode='40001'; end if;
   return public.read_manual_routine_request(p_account,p_actor,p_generation,p_request);
 end if;
 rid:=p_initial->>'routineId'; spec:=p_initial#>'{snapshot,spec}'; ctx:=p_initial#>'{snapshot,ctx}';
 domain_name:=case substring(rid,1,3) when 'D01' then 'content' when 'D02' then 'paid' when 'D03' then 'seo' when 'D04' then 'sales' when 'D05' then 'email' end;
 if a.automation_paused or rid is null or rid !~ '^D0[1-5]-W0[1-8]$' or rid='D03-W01'
   then raise exception 'routine_unavailable_or_paused' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account::text||':'||rid,0));
 select * into s from public.routine_states where account_id=p_account and routine_id=rid for update;
 snapshot:=public.read_routine_editor(p_account,p_actor,p_generation,rid,domain_name);
 if s.enabled is distinct from true or p_revision is null or snapshot->>'configurationRevision' is distinct from p_revision
   then raise exception 'configuration_changed' using errcode='40001'; end if;
 if jsonb_typeof(p_initial) is distinct from 'object' or octet_length(p_initial::text)>524288
   or p_initial->>'accountId' is distinct from p_account::text or p_initial->>'contextGeneration' is distinct from p_generation::text
   or p_initial->>'mode' is distinct from 'dry_run' or spec->>'id' is distinct from rid
   or spec->>'version' is distinct from p_initial->>'version' or jsonb_typeof(spec->'nodes') is distinct from 'array'
   or ctx->>'runId' is distinct from p_initial->>'id' or ctx->>'routineId' is distinct from rid
   or ctx->>'version' is distinct from p_initial->>'version' or ctx->>'mode' is distinct from 'dry_run'
   or ctx#>>'{account,accountId}' is distinct from p_account::text or ctx#>>'{account,contextGeneration}' is distinct from p_generation::text
   or p_initial->>'specHash' is null then raise exception 'invalid_run_identity' using errcode='22023'; end if;
 if p_purpose='input' then
   select * into r from public.routine_runs where id=(p_initial->>'id')::uuid for update;
   if r.id is null or r.account_id<>p_account or r.context_generation<>p_generation or r.routine_id<>rid or r.mode<>'dry_run'
     or r.status<>'waiting_input' or r.snapshot is distinct from p_initial->'snapshot' or r.spec_hash is distinct from p_initial->>'specHash'
     or r.version::text is distinct from p_initial->>'version' or r.input_revision<>coalesce((p_initial->>'inputRevision')::bigint,0)
     or (spec is distinct from s.live_spec and spec is distinct from s.draft_spec and s.live_spec is not null)
     then raise exception 'waiting_run_changed' using errcode='40001'; end if;
 else
   if p_initial->>'status' is distinct from 'running' or ctx->>'triggeredBy' is distinct from 'manual'
     or p_initial#>>'{snapshot,nextNodeIndex}' is distinct from '0' or p_initial#>>'{snapshot,startProtocol}' is distinct from 'manual_claim_v1'
     or (p_purpose='validate' and (s.draft_spec is null or spec is distinct from s.draft_spec))
     or (p_purpose='run' and (spec->>'version' is distinct from s.version::text or (s.live_spec is not null and spec is distinct from s.live_spec)))
     then raise exception 'specification_changed' using errcode='40001'; end if;
   if exists(select 1 from public.routine_runs where account_id=p_account and context_generation=p_generation and routine_id=rid
     and status in ('running','waiting_input','waiting_approval')) then raise exception 'original_run_unresolved' using errcode='40001'; end if;
   insert into public.routine_runs(id,account_id,context_generation,routine_id,version,mode,status,started_at,spec_hash,snapshot,summary)
     values((p_initial->>'id')::uuid,p_account,p_generation,rid,(p_initial->>'version')::int,'dry_run','running',
       (p_initial->>'startedAt')::timestamptz,p_initial->>'specHash',p_initial->'snapshot','Prepared; not started.');
 end if;
 insert into public.manual_routine_requests(account_id,context_generation,actor_id,request_id,routine_id,purpose,request_body,configuration_revision,initial_record,run_id)
 values(p_account,p_generation,p_actor,p_request,rid,p_purpose,p_body,p_revision,p_initial,(p_initial->>'id')::uuid);
 return public.read_manual_routine_request(p_account,p_actor,p_generation,p_request);
end;
$$;

create function public.claim_manual_routine_request(p_account uuid,p_actor uuid,p_generation bigint,p_request uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; owner_role text; o public.manual_routine_requests%rowtype; r public.routine_runs%rowtype; snapshot jsonb; domain_name text;
begin
 select * into a from public.accounts where id=p_account for update;
 select role into owner_role from public.account_members where account_id=p_account and user_id=p_actor for share;
 if a.id is null or owner_role is distinct from 'owner' then raise exception 'owner_required' using errcode='42501'; end if;
 if a.context_generation is distinct from p_generation or a.automation_paused then raise exception 'context_changed_or_paused' using errcode='40001'; end if;
 select * into o from public.manual_routine_requests where account_id=p_account and context_generation=p_generation and actor_id=p_actor and request_id=p_request for update;
 if o.run_id is null then raise exception 'request_unavailable' using errcode='40001'; end if;
 if o.phase='claimed' then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account::text||':'||o.routine_id,0));
 perform 1 from public.routine_states where account_id=p_account and routine_id=o.routine_id for share;
 domain_name:=case substring(o.routine_id,1,3) when 'D01' then 'content' when 'D02' then 'paid' when 'D03' then 'seo' when 'D04' then 'sales' when 'D05' then 'email' end;
 snapshot:=public.read_routine_editor(p_account,p_actor,p_generation,o.routine_id,domain_name);
 if snapshot->>'configurationRevision' is distinct from o.configuration_revision or snapshot#>>'{state,enabled}' is distinct from 'true'
   then raise exception 'configuration_changed' using errcode='40001'; end if;
 select * into r from public.routine_runs where id=o.run_id for update;
 if r.id is null or r.account_id<>p_account or r.context_generation<>p_generation or r.mode<>'dry_run'
   or r.snapshot is distinct from o.initial_record->'snapshot' or r.routine_id<>o.routine_id
   or (o.purpose='input' and r.input_revision<>coalesce((o.initial_record->>'inputRevision')::bigint,0))
   or r.status is distinct from (case when o.purpose='input' then 'waiting_input' else 'running' end)
   then raise exception 'original_run_changed' using errcode='40001'; end if;
 -- The transaction is the one start winner. Never turn claimed back into prepared.
 update public.manual_routine_requests set phase='claimed',claimed_at=clock_timestamp()
   where account_id=p_account and context_generation=p_generation and actor_id=p_actor and request_id=p_request;
 update public.routine_runs set status='running',summary='Start claimed; inspect saved outcome before retrying.',finished_at=null,
   input_revision=input_revision+(case when o.purpose='input' then 1 else 0 end) where id=o.run_id;
 return true;
end;
$$;
revoke all on function public.read_manual_routine_request(uuid,uuid,bigint,uuid) from public,anon,authenticated;
revoke all on function public.prepare_manual_routine_request(uuid,uuid,bigint,uuid,text,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.claim_manual_routine_request(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.read_manual_routine_request(uuid,uuid,bigint,uuid) to service_role;
grant execute on function public.prepare_manual_routine_request(uuid,uuid,bigint,uuid,text,jsonb,text,jsonb) to service_role;
grant execute on function public.claim_manual_routine_request(uuid,uuid,bigint,uuid) to service_role;
