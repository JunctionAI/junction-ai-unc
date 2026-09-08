-- Installed as 20260908170103. Read-only provider reconciliation; no new execution tickets or retries.
create table public.review_action_reconciliations (
 proposal_id uuid primary key references public.review_action_executions(proposal_id),
 evidence jsonb not null check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=20000),
 prior_status text not null check(prior_status in ('dispatching','uncertain')),
 reconciled_at timestamptz not null default now()
);
alter table public.review_action_reconciliations enable row level security;
revoke all on public.review_action_reconciliations from public,anon,authenticated,service_role;
grant select,insert on public.review_action_reconciliations to service_role;

create function public.read_review_action_attempt(acct uuid,generation bigint,proposal uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('proposalId',p.id,'accountId',e.account_id,'contextGeneration',e.context_generation,
  'outputId',p.output_id,'revision',p.output_revision,'action',p.action,'targetId',p.target_id,
  'payload',p.action_payload,'idempotencyKey','review-action:'||p.id::text,'status',e.status,'receipt',e.receipt)
 into result from public.review_action_executions e join public.review_action_approvals p on p.id=e.proposal_id and p.account_id=e.account_id
 where e.proposal_id=proposal and e.account_id=acct and e.context_generation=generation;
 return result;
end $$;
revoke all on function public.read_review_action_attempt(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.read_review_action_attempt(uuid,bigint,uuid) to service_role;

-- Only positively verified success resolves uncertainty. A missing resource or
-- delayed read is not evidence of non-execution, and never permits another write.
create function public.reconcile_review_action_success(acct uuid,generation bigint,proposal uuid,evidence jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.review_action_executions%rowtype; old public.review_action_reconciliations%rowtype;
begin
 if evidence is null or jsonb_typeof(evidence)<>'object' or evidence='{}'::jsonb or octet_length(evidence::text)>20000 then
  raise exception 'Readback evidence required' using errcode='22023'; end if;
 select * into e from public.review_action_executions where proposal_id=proposal and account_id=acct and context_generation=generation for update;
 if not found then raise exception 'Execution unavailable' using errcode='42501'; end if;
 select * into old from public.review_action_reconciliations where proposal_id=proposal;
 if found then
  if old.evidence<>evidence then raise exception 'Conflicting reconciliation' using errcode='40001'; end if;
  return jsonb_build_object('proposalId',proposal,'status','succeeded','duplicate',true);
 end if;
 if e.status not in ('dispatching','uncertain') then raise exception 'Execution already resolved' using errcode='40001'; end if;
 insert into public.review_action_reconciliations(proposal_id,evidence,prior_status) values(proposal,evidence,e.status);
 -- Preserve the original receipt; the append-only reconciliation holds readback.
 update public.review_action_executions set status='succeeded',receipt=coalesce(receipt,'{}'::jsonb),completed_at=now() where proposal_id=proposal;
 return jsonb_build_object('proposalId',proposal,'status','succeeded','duplicate',false);
end $$;
revoke all on function public.reconcile_review_action_success(uuid,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_review_action_success(uuid,bigint,uuid,jsonb) to service_role;
