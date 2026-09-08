-- Installed as 20260908165411. No scheduler, HTTP executor, credentials or provider writes enabled.
create table public.review_action_executions (
 proposal_id uuid primary key references public.review_action_approvals(id),
 account_id uuid not null references public.accounts(id),
 context_generation bigint not null,
 claim_token uuid not null unique,
 status text not null check(status in ('dispatching','succeeded','failed','uncertain')),
 receipt jsonb,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 check(receipt is null or (jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=20000)),
 check((status='dispatching' and receipt is null and completed_at is null) or
       (status<>'dispatching' and receipt is not null and completed_at is not null))
);
alter table public.review_action_executions enable row level security;
revoke all on public.review_action_executions from public,anon,authenticated,service_role;
grant select,insert on public.review_action_executions to service_role;
grant update(status,receipt,completed_at) on public.review_action_executions to service_role;

-- Claim is the irreversible dispatch boundary, not proof that the provider acted.
-- An adapter must first verify release policy, connector identity and payload support.
create function public.claim_review_action(acct uuid,generation bigint,proposal uuid,token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.review_action_approvals%rowtype; o public.review_outputs%rowtype;
begin
 if token is null then raise exception 'Token required' using errcode='22023'; end if;
 perform 1 from public.accounts where id=acct and context_generation=generation and not automation_paused for share;
 if not found then raise exception 'Account paused or changed' using errcode='40001'; end if;
 -- Match existing decision lock order: account, member, output, proposal.
 select * into p from public.review_action_approvals where id=proposal and account_id=acct;
 if not found then raise exception 'Proposal unavailable' using errcode='42501'; end if;
 perform 1 from public.account_members where account_id=acct and user_id=p.decided_by and role='owner' for share;
 if not found then raise exception 'Approval owner unavailable' using errcode='42501'; end if;
 select ro.* into o from public.review_outputs ro
 join public.artifacts a on a.id=ro.artifact_id and a.account_id=ro.account_id
 join public.routine_runs r on r.id=a.run_id and r.account_id=a.account_id
 where ro.id=p.output_id and ro.account_id=acct and ro.context_generation=generation and r.context_generation=generation for update of ro;
 if not found then raise exception 'Output unavailable' using errcode='42501'; end if;
 select * into p from public.review_action_approvals where id=proposal and account_id=acct for update;
 if p.status<>'approved' or p.expires_at<=now() or p.output_revision<>o.revision then
  raise exception 'Approval not executable' using errcode='40001'; end if;
 -- Never return a second dispatch ticket, including same-token retries.
 if exists(select 1 from public.review_action_executions where proposal_id=proposal) then return null; end if;
 insert into public.review_action_executions(proposal_id,account_id,context_generation,claim_token,status)
 values(proposal,acct,generation,token,'dispatching');
 return jsonb_build_object('proposalId',proposal,'token',token,'accountId',acct,'contextGeneration',generation,
  'outputId',o.id,'revision',o.revision,'action',p.action,'targetId',p.target_id,'payload',p.action_payload,
  'idempotencyKey','review-action:'||proposal::text,'expiresAt',p.expires_at);
end $$;
revoke all on function public.claim_review_action(uuid,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_review_action(uuid,bigint,uuid,uuid) to service_role;

create function public.guard_review_action_dispatch() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status is distinct from old.status and exists(select 1 from public.review_action_executions where proposal_id=old.id) then
  raise exception 'Dispatch already claimed; reconcile outcome' using errcode='40001'; end if;
 return new;
end $$;
revoke all on function public.guard_review_action_dispatch() from public,anon,authenticated;
grant execute on function public.guard_review_action_dispatch() to service_role;
create trigger review_action_dispatch_guard before update on public.review_action_approvals
for each row execute function public.guard_review_action_dispatch();

-- Can record after pause/context change: this records an already-started operation,
-- never grants new authority. Uncertain outcomes are terminal here; reconciliation
-- needs a separate verified readback path, not another dispatch.
create function public.record_review_action_result(acct uuid,generation bigint,proposal uuid,token uuid,outcome text,evidence jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.review_action_executions%rowtype;
begin
 if outcome is null or outcome not in ('succeeded','failed','uncertain') or evidence is null or
  jsonb_typeof(evidence)<>'object' or octet_length(evidence::text)>20000 then
  raise exception 'Invalid execution result' using errcode='22023'; end if;
 select * into e from public.review_action_executions where proposal_id=proposal and account_id=acct
  and context_generation=generation and claim_token=token for update;
 if not found then raise exception 'Claim unavailable' using errcode='42501'; end if;
 if e.status<>'dispatching' then
  if e.status=outcome and e.receipt=evidence then return jsonb_build_object('proposalId',proposal,'status',outcome,'duplicate',true); end if;
  raise exception 'Result conflict' using errcode='40001'; end if;
 update public.review_action_executions set status=outcome,receipt=evidence,completed_at=now() where proposal_id=proposal;
 return jsonb_build_object('proposalId',proposal,'status',outcome,'duplicate',false);
end $$;
revoke all on function public.record_review_action_result(uuid,bigint,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_review_action_result(uuid,bigint,uuid,uuid,text,jsonb) to service_role;

create or replace function public.read_review_actions(acct uuid,generation bigint,actor uuid,output uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_review jsonb; actions jsonb; can_decide boolean;
begin
 current_review:=public.read_review_output(acct,generation,actor,output);
 if current_review is null then return null; end if;
 select role='owner' into can_decide from public.account_members where account_id=acct and user_id=actor;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'revision',p.output_revision,'action',p.action,
   'targetId',p.target_id,'description',p.description,'expiresAt',p.expires_at,'status',p.status,
   'effectiveStatus',case when p.output_revision<>(current_review->'output'->>'revision')::bigint then 'superseded'
     when p.expires_at<=now() then 'expired' else p.status end,
   'execution',case when e.proposal_id is null then null else jsonb_build_object('status',e.status,'startedAt',e.created_at,'completedAt',e.completed_at) end
   ) order by p.created_at desc,p.id),'[]'::jsonb)
 into actions from (select * from public.review_action_approvals where account_id=acct and output_id=output order by created_at desc,id limit 50) p
 left join public.review_action_executions e on e.proposal_id=p.id and e.account_id=acct and e.context_generation=generation;
 return jsonb_build_object('output',current_review->'output','canDecide',can_decide,'actions',actions);
end $$;
revoke all on function public.read_review_actions(uuid,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_review_actions(uuid,bigint,uuid,uuid) to service_role;
