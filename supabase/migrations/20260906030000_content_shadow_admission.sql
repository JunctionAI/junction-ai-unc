-- Content admission is not keyword or calendar admission. No live workflows,
-- credentials, schedules or customer runs are seeded by this migration.
create schema if not exists unc_content_private;
revoke all on schema unc_content_private from public,anon,authenticated;
grant usage on schema unc_content_private to service_role;

create table public.n8n_content_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  context_generation bigint not null check(context_generation>=0),
  run_id uuid not null unique references public.routine_runs(id) on delete restrict,
  routine_id text not null check(routine_id in ('D01-W02','D01-W03')),
  registration_id uuid not null references public.n8n_workflows(id) on delete restrict,
  authorized_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  approval jsonb not null,
  initial_run jsonb not null,
  state text not null default 'reserved' check(state in ('reserved','started','dispatching','authorized','verifying','uncertain','refused','verified','completed')),
  expires_at timestamptz not null,
  request_digest text check(request_digest ~ '^[a-f0-9]{64}$'),
  token_digest text check(token_digest ~ '^[a-f0-9]{64}$'),
  execution_id text check(execution_id ~ '^[1-9][0-9]{0,29}$'),
  dispatched_at timestamptz,
  authorized_at timestamptz,
  candidate jsonb,
  verified_result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(account_id,context_generation,idempotency_key)
);
create unique index n8n_content_run_inflight on public.n8n_content_runs(account_id,context_generation,routine_id)
  where state in ('reserved','started','dispatching','authorized','verifying');
create index n8n_content_run_recovery on public.n8n_content_runs(state,updated_at)
  where state in ('dispatching','authorized','verifying','uncertain');
alter table public.n8n_content_runs enable row level security;
revoke all on public.n8n_content_runs from public,anon,authenticated,service_role;
grant select,insert,update on public.n8n_content_runs to service_role;

create function unc_content_private.receiver_url(routine text) returns text
language sql immutable security invoker set search_path='' as $$
  select case routine
    when 'D01-W02' then 'https://junctionai8.app.n8n.cloud/webhook/unc/d01-w02/hooks-shadow'
    when 'D01-W03' then 'https://junctionai8.app.n8n.cloud/webhook/unc/d01-w03/questions-shadow'
  end;
$$;

create function unc_content_private.content_spec_valid(s jsonb, acct uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare c jsonb:=s #> '{nodes,1,shadowContract}'; client jsonb:=c->'client';
  routine text:=s->>'id'; key text; loc int;
begin
  if jsonb_typeof(s->'nodes') is distinct from 'array' or jsonb_array_length(s->'nodes') is distinct from 4 then return false; end if;
  key:=case routine when 'D01-W02' then 'viral_hooks' when 'D01-W03' then 'customer_questions' end;
  loc:=(client->>'locationCode')::int;
  return coalesce(routine in ('D01-W02','D01-W03') and (s->>'version')::integer>0 and s->>'mutates'='false'
    and s #>> '{nodes,0,kind}'='trigger' and s #>> '{nodes,0,cadence}'='manual'
    and s #>> '{nodes,1,kind}'='n8n' and s #>> '{nodes,2,kind}'='gate' and s #>> '{nodes,3,kind}'='receipt'
    and not (s #> '{nodes,1}') ?| array['webhookUrl','webhookUrlEnv']
    and c->>'contract'='unc.content-search-shadow.v1' and c->>'accountId'=acct::text
    and acct='aa5cfc84-2569-4c99-9b40-67003ae55eda' and c->>'routineId'=routine and c->>'routineKey'=key
    and c->>'workflowId' ~ '^[A-Za-z0-9_-]{1,128}$' and (c->>'workflowVersion')::uuid is not null
    and c-array['contract','accountId','workflowId','workflowVersion','routineId','routineKey','client']='{}'::jsonb
    and client->>'id'='avgar' and client->>'primaryDomain'='avgarsport.com'
    and client->>'seedKeyword'='golf travel bag' and client->>'languageCode'='en'
    and loc in (2840,2554,2036)
    and client-array['id','primaryDomain','seedKeyword','locationCode','languageCode']='{}'::jsonb, false);
end $$;

create function unc_content_private.content_current(p public.n8n_content_runs) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; w public.n8n_workflows%rowtype; st public.routine_states%rowtype;
  r public.routine_runs%rowtype; owner_role text; c jsonb:=p.initial_run #> '{snapshot,spec,nodes,1,shadowContract}';
begin
  select * into a from public.accounts where id=p.account_id for share;
  select role into owner_role from public.account_members where account_id=p.account_id and user_id=p.authorized_by for share;
  select * into st from public.routine_states where account_id=p.account_id and routine_id=p.routine_id for share;
  select * into w from public.n8n_workflows where id=p.registration_id for share;
  select * into r from public.routine_runs where id=p.run_id for share;
  if a.id is null or a.automation_paused or a.context_generation is distinct from p.context_generation
    or a.id is distinct from 'aa5cfc84-2569-4c99-9b40-67003ae55eda' or owner_role is distinct from 'owner'
    or st.enabled is distinct from true or st.version::text is distinct from p.initial_run->>'version'
    or coalesce(st.live_spec,st.draft_spec) is distinct from p.initial_run #> '{snapshot,spec}'
    or w.account_id is distinct from p.account_id or w.active is distinct from true or w.routine_id is distinct from p.routine_id
    or w.webhook_url is distinct from unc_content_private.receiver_url(p.routine_id)
    or r.account_id is distinct from p.account_id or r.context_generation is distinct from p.context_generation
    or r.routine_id is distinct from p.routine_id or r.mode is distinct from 'dry_run' or r.status is distinct from 'running'
    or r.spec_hash is distinct from p.initial_run->>'specHash' or r.version::text is distinct from p.initial_run->>'version'
    or r.started_at is distinct from (p.initial_run->>'startedAt')::timestamptz
    or r.snapshot->'spec' is distinct from p.initial_run #> '{snapshot,spec}'
    or r.snapshot->'ctx' is distinct from p.initial_run #> '{snapshot,ctx}'
    or c->>'accountId' is distinct from p.account_id::text or c->>'routineId' is distinct from p.routine_id then
    raise exception 'Current enabled owner, context, switch and registration required' using errcode='40001'; end if;
  if p.expires_at<=clock_timestamp() then raise exception 'Content allowance expired' using errcode='40001'; end if;
end $$;

create function unc_content_private.guard_content_run() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r jsonb:=new.initial_run; snap jsonb:=r->'snapshot'; c jsonb:=snap #> '{spec,nodes,1,shadowContract}';
  loc int; market text; receiver text; w public.n8n_workflows%rowtype;
begin
  if tg_op='INSERT' then
    select * into w from public.n8n_workflows where id=new.registration_id for share;
    receiver:=unc_content_private.receiver_url(new.routine_id);
    loc:=(c #>> '{client,locationCode}')::int;
    market:=case loc when 2840 then 'US' when 2554 then 'NZ' when 2036 then 'AU' end;
    if new.state<>'reserved' or new.request_digest is not null or new.token_digest is not null or new.execution_id is not null
      or new.candidate is not null or new.verified_result is not null or new.dispatched_at is not null or new.authorized_at is not null
      or r->>'id' is distinct from new.run_id::text or r->>'accountId' is distinct from new.account_id::text
      or r->>'contextGeneration' is distinct from new.context_generation::text or r->>'mode' is distinct from 'dry_run'
      or r->>'routineId' is distinct from new.routine_id or r->>'status' is distinct from 'running'
      or r ?| array['finishedAt','approvalId','snapshotSecret'] or coalesce(r->>'specHash','')=''
      or snap->>'awaiting' is distinct from 'content_start' or snap->>'startProtocol' is distinct from 'content_claim_v1'
      or snap->>'nextNodeIndex' is distinct from '0' or not unc_content_private.content_spec_valid(snap->'spec',new.account_id)
      or snap #>> '{spec,id}' is distinct from new.routine_id
      or snap #>> '{ctx,runId}' is distinct from new.run_id::text or snap #>> '{ctx,routineId}' is distinct from new.routine_id
      or snap #>> '{ctx,account,accountId}' is distinct from new.account_id::text
      or snap #>> '{ctx,account,contextGeneration}' is distinct from new.context_generation::text
      or snap #>> '{ctx,startedAt}' is distinct from r->>'startedAt' or snap #>> '{ctx,version}' is distinct from r->>'version'
      or snap #>> '{ctx,mode}' is distinct from 'dry_run' or snap #>> '{ctx,triggeredBy}' is distinct from 'manual'
      or snap #> '{ctx,reads}' is distinct from '{}'::jsonb or snap #> '{ctx,checks}' is distinct from '{}'::jsonb
      or snap #> '{ctx,inputs}' is distinct from '{}'::jsonb or snap #> '{ctx,vars}' is distinct from '{}'::jsonb
      or (snap->'ctx') ?| array['artifact','execution','approval','decision']
      or new.approval->>'authorizedBy' is distinct from new.authorized_by::text
      or new.approval->>'idempotencyKey' is distinct from new.idempotency_key
      or new.approval->>'contextGeneration' is distinct from new.context_generation::text
      or new.approval->>'maxProviderCalls' is distinct from '1' or new.approval->>'routineId' is distinct from new.routine_id
      or new.approval->>'market' is distinct from market
      or coalesce(new.approval->>'approvalReference','')!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      or new.approval-array['authorizedBy','idempotencyKey','contextGeneration','maxProviderCalls','approvalReference','expiresAt','market','routineId'] is distinct from '{}'::jsonb
      or (new.approval->>'expiresAt')::timestamptz is distinct from new.expires_at
      or new.expires_at>clock_timestamp()+interval '10 minutes'
      or r->>'startedAt' is null
      or (r->>'startedAt')::timestamptz not between clock_timestamp()-interval '30 seconds' and clock_timestamp()+interval '30 seconds'
      or octet_length(r::text)>100000
      or w.id is null or w.account_id is distinct from new.account_id or w.routine_id is distinct from new.routine_id
      or w.webhook_url is distinct from receiver or w.active is distinct from true
      then raise exception 'Original scoped content issuance required' using errcode='23514'; end if;
    perform unc_content_private.content_current(new);
    new.created_at:=clock_timestamp(); new.updated_at:=new.created_at; return new;
  end if;
  if (to_jsonb(new)-array['state','request_digest','token_digest','execution_id','dispatched_at','authorized_at','candidate','verified_result','updated_at'])
      is distinct from (to_jsonb(old)-array['state','request_digest','token_digest','execution_id','dispatched_at','authorized_at','candidate','verified_result','updated_at'])
    or (old.request_digest is not null and new.request_digest is distinct from old.request_digest)
    or (old.token_digest is not null and new.token_digest is distinct from old.token_digest)
    or (old.execution_id is not null and new.execution_id is distinct from old.execution_id)
    or (old.dispatched_at is not null and new.dispatched_at is distinct from old.dispatched_at)
    or (old.authorized_at is not null and new.authorized_at is distinct from old.authorized_at)
    or (old.candidate is not null and new.candidate is distinct from old.candidate)
    or (old.verified_result is not null and new.verified_result is distinct from old.verified_result) then
    raise exception 'Content ledger identity and evidence are immutable' using errcode='23514'; end if;
  if not ((old.state='reserved' and new.state='started') or (old.state='started' and new.state='dispatching')
    or (old.state='dispatching' and new.state='authorized') or (old.state in ('authorized','uncertain') and new.state='verifying')
    or (old.state in ('dispatching','authorized','verifying') and new.state in ('uncertain','refused'))
    or (old.state in ('verifying','uncertain') and new.state='verified') or (old.state='verified' and new.state='completed')) then
    raise exception 'Content allowance cannot be replayed or renewed' using errcode='23514'; end if;
  if new.state in ('started','dispatching','authorized') then
    perform unc_content_private.content_current(new);
    if new.execution_id is not null or new.candidate is not null or new.verified_result is not null then
      raise exception 'Unexecuted content claim required' using errcode='23514'; end if;
  end if;
  if new.state='started' and (new.request_digest is not null or new.token_digest is not null or new.dispatched_at is not null or new.authorized_at is not null) then
    raise exception 'Start claim cannot imply dispatch' using errcode='23514'; end if;
  if new.state='dispatching' then
    if new.request_digest is null or new.token_digest is null or new.authorized_at is not null then raise exception 'Dispatch fingerprints required' using errcode='23514'; end if;
    new.dispatched_at:=clock_timestamp();
  end if;
  if new.state='authorized' then new.authorized_at:=clock_timestamp(); end if;
  if new.state in ('uncertain','refused') and (new.candidate is distinct from old.candidate or new.verified_result is not null
      or new.request_digest is distinct from old.request_digest or new.token_digest is distinct from old.token_digest
      or new.authorized_at is distinct from old.authorized_at) then raise exception 'Uncertain work cannot acquire evidence or authority' using errcode='23514'; end if;
  if new.state='verifying' then
    if old.authorized_at is null or new.execution_id is null or new.candidate is null or new.verified_result is not null
      or new.candidate #>> '{artifact,kind}' not in ('hook_list','question_list')
      or coalesce(new.candidate->>'resultDigest','')!~'^[a-f0-9]{64}$' then
      raise exception 'Original content result checkpoint required' using errcode='23514'; end if;
  end if;
  new.updated_at:=clock_timestamp(); return new;
end $$;
create trigger content_run_guard before insert or update on public.n8n_content_runs
  for each row execute function unc_content_private.guard_content_run();

create function public.issue_content_shadow_run(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb:=input->'run'; approved jsonb:=input->'approval'; p public.n8n_content_runs%rowtype;
  acct uuid:=(r->>'accountId')::uuid; generation bigint:=(r->>'contextGeneration')::bigint;
  routine text:=r->>'routineId'; wid uuid; cmd text:=input->>'commandId';
begin
  perform 1 from public.accounts where id=acct for update;
  if cmd is not null and cmd is distinct from r->>'id' then raise exception 'Content command must use its original run' using errcode='23514'; end if;
  select * into p from public.n8n_content_runs where account_id=acct and context_generation=generation and idempotency_key=approved->>'idempotencyKey' for update;
  if found then
    if p.approval is distinct from approved or p.initial_run #> '{snapshot,spec}' is distinct from r #> '{snapshot,spec}'
      or p.routine_id is distinct from routine then
      raise exception 'Original content allowance cannot be rebound' using errcode='23514'; end if;
    return jsonb_build_object('created',false,'runId',p.run_id,'permitId',p.id);
  end if;
  select id into wid from public.n8n_workflows where account_id=acct and routine_id=routine and active=true for share;
  if wid is null then raise exception 'Active account-specific content registration required' using errcode='23514'; end if;
  insert into public.routine_runs(id,account_id,context_generation,routine_id,version,mode,status,started_at,spec_hash,snapshot)
    values((r->>'id')::uuid,acct,generation,routine,(r->>'version')::integer,'dry_run','running',(r->>'startedAt')::timestamptz,r->>'specHash',r->'snapshot');
  insert into public.n8n_content_runs(account_id,context_generation,run_id,routine_id,registration_id,authorized_by,idempotency_key,approval,initial_run,expires_at)
    values(acct,generation,(r->>'id')::uuid,routine,wid,(approved->>'authorizedBy')::uuid,approved->>'idempotencyKey',approved,r,(approved->>'expiresAt')::timestamptz)
    returning * into p;
  return jsonb_build_object('created',true,'runId',p.run_id,'permitId',p.id);
end $$;

create function public.transition_content_shadow(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.n8n_content_runs%rowtype; op text:=input->>'operation'; r public.routine_runs%rowtype; c jsonb;
begin
  perform 1 from public.accounts where id=(input->>'accountId')::uuid for share;
  select * into p from public.n8n_content_runs where account_id=(input->>'accountId')::uuid
    and context_generation=(input->>'contextGeneration')::bigint and run_id=(input->>'runId')::uuid
    and (input->>'permitId' is null or id=(input->>'permitId')::uuid) for update;
  if not found then raise exception 'Original scoped content allowance unavailable' using errcode='P0002'; end if;
  c:=p.initial_run #> '{snapshot,spec,nodes,1,shadowContract}';
  if op in ('start','dispatch','authorize') then perform unc_content_private.content_current(p); end if;
  select * into r from public.routine_runs where id=p.run_id for update;
  if op='start' then
    if p.state<>'reserved' then return 'false'::jsonb; end if;
    if input->'run' is distinct from p.initial_run or r.snapshot is distinct from p.initial_run->'snapshot' then
      raise exception 'Original content start changed' using errcode='23514'; end if;
    update public.n8n_content_runs set state='started' where id=p.id;
    update public.routine_runs set snapshot=jsonb_set(snapshot,'{awaiting}','"content_started"') where id=p.run_id;
    return 'true'::jsonb;
  elsif op in ('dispatch','authorize') then
    if input->'contract' is distinct from c or input->>'registrationId' is distinct from p.registration_id::text
      or r.snapshot->>'awaiting' is distinct from 'content_shadow' or r.snapshot->>'nextNodeIndex' is distinct from '2' then
      raise exception 'Content dispatch identity changed' using errcode='23514'; end if;
    if op='dispatch' then
      if p.state<>'started' then return 'null'::jsonb; end if;
      if input->>'receiverUrl' is distinct from unc_content_private.receiver_url(p.routine_id) then
        raise exception 'Content receiver mismatch' using errcode='23514'; end if;
      update public.n8n_content_runs set state='dispatching',request_digest=input->>'requestDigest',token_digest=input->>'tokenDigest' where id=p.id;
      return to_jsonb(p.id);
    end if;
    if p.state<>'dispatching' or input->>'tokenDigest' is distinct from p.token_digest or input->>'specHash' is distinct from r.spec_hash then
      return 'false'::jsonb; end if;
    update public.n8n_content_runs set state='authorized' where id=p.id; return 'true'::jsonb;
  elsif op='checkpoint' then
    if p.candidate is not null then return to_jsonb(p.candidate=input->'candidate' and p.execution_id=input->>'executionId'); end if;
    update public.n8n_content_runs set state='verifying',execution_id=input->>'executionId',candidate=input->'candidate' where id=p.id;
    return 'true'::jsonb;
  elsif op='finish' then
    if p.state in ('verified','completed') then
      return to_jsonb(input->>'outcome'='verified' and p.verified_result=input->'result' and p.execution_id=input->>'executionId'); end if;
    if p.state in ('uncertain','refused') and input->>'outcome'=p.state then
      return to_jsonb(p.execution_id is not distinct from input->>'executionId'); end if;
    if coalesce(input->>'outcome','') not in ('verified','uncertain','refused') then raise exception 'Invalid content outcome'; end if;
    update public.n8n_content_runs set state=input->>'outcome',execution_id=coalesce(input->>'executionId',execution_id),
      verified_result=case when input->>'outcome'='verified' then input->'result' else null end where id=p.id;
    return 'true'::jsonb;
  end if;
  raise exception 'Unsupported content transition' using errcode='22023';
end $$;

revoke all on function unc_content_private.receiver_url(text),unc_content_private.content_spec_valid(jsonb,uuid),
  unc_content_private.content_current(public.n8n_content_runs),unc_content_private.guard_content_run() from public,anon,authenticated;
grant execute on function unc_content_private.receiver_url(text),unc_content_private.content_spec_valid(jsonb,uuid),
  unc_content_private.content_current(public.n8n_content_runs) to service_role;
revoke all on function public.issue_content_shadow_run(jsonb),public.transition_content_shadow(jsonb) from public,anon,authenticated;
grant execute on function public.issue_content_shadow_run(jsonb),public.transition_content_shadow(jsonb) to service_role;
