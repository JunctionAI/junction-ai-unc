-- Private immutable response checkpoints. No public callback, provider retry or
-- customer artifact projection is authorized by this ledger.
create table public.n8n_shadow_candidates (
  permit_id uuid primary key references public.n8n_shadow_permits(id) on delete cascade,
  account_id uuid not null,
  context_generation bigint not null,
  run_id uuid not null,
  run_started_at timestamptz not null,
  execution_id text not null,
  candidate jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.n8n_shadow_candidates enable row level security;
revoke all on public.n8n_shadow_candidates from public,anon,authenticated,service_role;
grant select,insert on public.n8n_shadow_candidates to service_role;

create function unc_private.guard_keyword_shadow_candidate() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p public.n8n_shadow_permits%rowtype; r public.routine_runs%rowtype; receipt jsonb;
begin
  if tg_op<>'INSERT' then raise exception 'Shadow response checkpoint is immutable' using errcode='23514'; end if;
  select * into p from public.n8n_shadow_permits where id=new.permit_id for share;
  select * into r from public.routine_runs where id=p.run_id for share;
  receipt:=new.candidate->'executionReceipt';
  if p.id is null or p.status<>'provider_authorized' or p.authorized_at is null or r.id is null
    or r.account_id is distinct from p.account_id or r.context_generation is distinct from p.context_generation
    or r.routine_id is distinct from 'D03-W01' or r.mode is distinct from 'dry_run'
    or r.spec_hash is distinct from p.spec_hash or r.version::text is distinct from p.spec->>'version'
    or new.execution_id!~'^[1-9][0-9]{0,29}$' or octet_length(new.candidate::text)>256000
    or jsonb_typeof(new.candidate) is distinct from 'object'
    or new.candidate-array['artifact','executionReceipt']<>'{}'::jsonb
    or jsonb_typeof(new.candidate->'artifact') is distinct from 'object'
    or new.candidate #>> '{artifact,kind}' is distinct from 'keyword_list'
    or receipt->>'contract' is distinct from 'unc.keyword-shadow.v1'
    or receipt->>'accountId' is distinct from p.account_id::text or receipt->>'runId' is distinct from p.run_id::text
    or receipt->>'routineId' is distinct from 'D03-W01' or receipt->>'routineKey' is distinct from 'keyword_opportunity'
    or receipt->>'workflowId' is distinct from p.contract->>'workflowId'
    or receipt->>'executionId' is distinct from new.execution_id
    or receipt->'workflowVersion' is distinct from 'null'::jsonb
    or receipt->>'revisionEvidence' is distinct from 'pending_unc_verification'
    or receipt->>'mode' is distinct from 'dry_run' or receipt->>'status' is distinct from 'succeeded'
    or receipt->>'executedAction' is distinct from 'none'
    or receipt->'client' is distinct from p.contract->'client' then
    raise exception 'Shadow checkpoint does not bind the authorized dispatch' using errcode='23514'; end if;
  -- Original identity is database-derived even after pause/reset. This observation
  -- cannot rebase itself onto the replacement business or create a new run.
  new.account_id:=p.account_id; new.context_generation:=p.context_generation;
  new.run_id:=p.run_id; new.run_started_at:=r.started_at; new.recorded_at:=clock_timestamp();
  return new;
end $$;
revoke all on function unc_private.guard_keyword_shadow_candidate() from public,anon,authenticated,service_role;
create trigger keyword_shadow_candidate before insert or update on public.n8n_shadow_candidates
  for each row execute function unc_private.guard_keyword_shadow_candidate();

create function public.checkpoint_keyword_shadow_result(permit_id uuid,observed_execution text,reported_result jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p public.n8n_shadow_permits%rowtype;
begin
  select * into p from public.n8n_shadow_permits where id=permit_id for update;
  if p.id is null or p.status<>'provider_authorized' then return false; end if;
  insert into public.n8n_shadow_candidates(permit_id,execution_id,candidate)
    values(permit_id,observed_execution,reported_result);
  if not public.note_keyword_shadow_execution(permit_id,observed_execution) then
    raise exception 'Shadow execution checkpoint failed' using errcode='40001'; end if;
  return true;
end $$;
revoke all on function public.checkpoint_keyword_shadow_result(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint_keyword_shadow_result(uuid,text,jsonb) to service_role;
