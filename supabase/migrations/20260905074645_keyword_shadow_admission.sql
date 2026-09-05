-- Server-issued, one-use keyword pilot permits. Issuance is a separate operator step;
-- neither the bridge nor the public authority route may create its own allowance.
create table public.n8n_shadow_permits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  context_generation bigint not null check (context_generation >= 0),
  run_id uuid not null unique references public.routine_runs(id) on delete cascade,
  registration_id uuid not null,
  authorized_by uuid not null references auth.users(id),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  spec_hash text not null,
  spec jsonb not null,
  contract jsonb not null,
  receiver_url text not null,
  status text not null default 'reserved' check (status in ('reserved','dispatching','provider_authorized','verifying','verified','refused','uncertain')),
  request_digest text,
  token_digest text,
  execution_id text,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  dispatched_at timestamptz,
  authorized_at timestamptz,
  finished_at timestamptz,
  unique (account_id,context_generation,idempotency_key)
);
alter table public.n8n_shadow_permits enable row level security;
revoke all on public.n8n_shadow_permits from public,anon,authenticated,service_role;
grant select,insert,update on public.n8n_shadow_permits to service_role;

create function unc_private.guard_keyword_shadow_permit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; r public.routine_runs%rowtype; s public.routine_states%rowtype;
  w public.n8n_workflows%rowtype; current_spec jsonb; owner_role text; producer jsonb;
begin
  if tg_op='INSERT' then
    if new.status<>'reserved' or new.request_digest is not null or new.token_digest is not null
      or new.execution_id is not null or new.result is not null or new.dispatched_at is not null
      or new.authorized_at is not null or new.finished_at is not null then
      raise exception 'Only a fresh reserved permit may be issued' using errcode='23514'; end if;
    new.created_at:=clock_timestamp();
    if new.expires_at>clock_timestamp()+interval '10 minutes' then
      raise exception 'Permit expiry exceeds ten minutes' using errcode='23514'; end if;
  else
    if to_jsonb(new)-array['status','request_digest','token_digest','execution_id','result','dispatched_at','authorized_at','finished_at']
      is distinct from to_jsonb(old)-array['status','request_digest','token_digest','execution_id','result','dispatched_at','authorized_at','finished_at'] then
      raise exception 'Permit identity is immutable' using errcode='23514'; end if;
    if not ((old.status='reserved' and new.status='dispatching') or
      (old.status='dispatching' and new.status in ('provider_authorized','refused','uncertain')) or
      (old.status='provider_authorized' and new.status in ('verifying','refused','uncertain')) or
      (old.status='verifying' and new.status in ('verified','refused','uncertain')) or
      (old.status='uncertain' and new.status in ('verified','refused'))) then
      raise exception 'Permit cannot be replayed' using errcode='23514'; end if;
    if old.status<>'reserved' and (new.request_digest is distinct from old.request_digest or new.token_digest is distinct from old.token_digest) then
      raise exception 'Dispatch fingerprints are immutable' using errcode='23514'; end if;
    if new.status='dispatching' then
      if coalesce(new.request_digest,'')!~'^[a-f0-9]{64}$' or coalesce(new.token_digest,'')!~'^[a-f0-9]{64}$' then
        raise exception 'Dispatch fingerprints required' using errcode='23514'; end if;
      new.dispatched_at:=clock_timestamp();
    else new.dispatched_at:=old.dispatched_at; end if;
    new.authorized_at:=case when new.status='provider_authorized' then clock_timestamp() else old.authorized_at end;
    if new.status in ('verified','refused','uncertain') then new.finished_at:=clock_timestamp(); end if;
    if old.execution_id is not null and new.execution_id is distinct from old.execution_id then
      raise exception 'Observed execution identity is immutable' using errcode='23514'; end if;
  end if;
  if new.execution_id is not null and new.execution_id!~'^[1-9][0-9]{0,29}$' then
    raise exception 'Invalid execution identity' using errcode='23514'; end if;
  if new.status='verifying' and new.execution_id is null then raise exception 'Execution identity required' using errcode='23514'; end if;
  if new.status='verified' and (new.authorized_at is null or new.execution_id is null or
      new.result #>> '{artifact,meta,executionReceipt,revisionEvidence}' is distinct from 'verified_execution_record' or
      new.result #>> '{artifact,meta,executionReceipt,executionId}' is distinct from new.execution_id or
      new.result #>> '{artifact,meta,executionReceipt,workflowVersion}' is distinct from new.contract->>'workflowVersion' or
      new.result #>> '{artifact,meta,executionReceipt,accountId}' is distinct from new.account_id::text or
      new.result #>> '{artifact,meta,executionReceipt,runId}' is distinct from new.run_id::text) then
    raise exception 'Verified result must bind the original permit' using errcode='23514'; end if;

  -- Terminal observations survive a later pause/reset as archived evidence. They never
  -- authorize another provider request or project a result into a replacement business.
  if tg_op='UPDATE' and new.status in ('verifying','verified','refused','uncertain') then return new; end if;
  select * into a from public.accounts where id=new.account_id for share;
  select role into owner_role from public.account_members where account_id=new.account_id and user_id=new.authorized_by for share;
  select * into r from public.routine_runs where id=new.run_id for share;
  select * into s from public.routine_states where account_id=new.account_id and routine_id='D03-W01' for share;
  select * into w from public.n8n_workflows where id=new.registration_id for share;
  if a.id is null or a.automation_paused or a.context_generation<>new.context_generation or owner_role is distinct from 'owner'
    or r.account_id is distinct from new.account_id or r.context_generation is distinct from new.context_generation
    or r.routine_id is distinct from 'D03-W01' or r.mode is distinct from 'dry_run' or r.status is distinct from 'running'
    or r.spec_hash is distinct from new.spec_hash or r.started_at<clock_timestamp()-interval '15 minutes'
    or r.started_at>clock_timestamp()+interval '30 seconds' then
    raise exception 'Current owned shadow run required' using errcode='40001'; end if;
  current_spec:=coalesce(r.snapshot->'spec',case when s.draft_spec->>'version'=r.version::text then s.draft_spec
    when s.version=r.version then s.live_spec else null end);
  if current_spec is null or current_spec<>new.spec or new.spec->>'id' is distinct from 'D03-W01' or new.spec->>'version' is distinct from r.version::text
    or jsonb_typeof(new.spec->'nodes') is distinct from 'array' then
    raise exception 'Shadow specification changed' using errcode='40001'; end if;
  if (select count(*) from jsonb_array_elements(new.spec->'nodes') n where n->>'kind' in ('produce','n8n'))<>1
    or exists(select 1 from jsonb_array_elements(new.spec->'nodes') n where n->>'kind'='execute')
    or not exists(select 1 from jsonb_array_elements(new.spec->'nodes') n where n->>'kind'='trigger' and n->>'cadence'='manual') then
    raise exception 'Only the explicit manual shadow routine is permitted' using errcode='23514'; end if;
  select n into producer from jsonb_array_elements(new.spec->'nodes') n where n->>'kind'='n8n';
  if producer->'shadowContract' is distinct from new.contract or new.contract->>'accountId' is distinct from new.account_id::text
    or new.contract->>'contract' is distinct from 'unc.keyword-shadow.v1' or new.contract->>'routineId' is distinct from 'D03-W01'
    or w.account_id is distinct from new.account_id or w.routine_id is distinct from 'D03-W01' or w.active is distinct from true
    or w.webhook_url is distinct from new.receiver_url or new.receiver_url<>'https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow' then
    raise exception 'Shadow contract or registration mismatch' using errcode='23514'; end if;
  if new.expires_at<=clock_timestamp() then raise exception 'Shadow permit expired' using errcode='40001'; end if;
  return new;
end $$;
revoke all on function unc_private.guard_keyword_shadow_permit() from public,anon,authenticated,service_role;
create trigger keyword_shadow_permit before insert or update on public.n8n_shadow_permits
  for each row execute function unc_private.guard_keyword_shadow_permit();

create function public.claim_keyword_shadow_dispatch(input jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare claimed uuid;
begin
  update public.n8n_shadow_permits set status='dispatching',request_digest=input->>'requestDigest',token_digest=input->>'tokenDigest'
  where run_id=(input->>'runId')::uuid and account_id=(input->>'accountId')::uuid
    and context_generation=(input->>'contextGeneration')::bigint and registration_id=(input->>'registrationId')::uuid
    and contract=input->'contract' and receiver_url=input->>'receiverUrl' and status='reserved'
  returning id into claimed;
  return claimed;
end $$;
revoke all on function public.claim_keyword_shadow_dispatch(jsonb) from public,anon,authenticated;
grant execute on function public.claim_keyword_shadow_dispatch(jsonb) to service_role;

-- Compatibility with the frozen wrapper: the existing authenticated GET now consumes
-- its already-issued permit. Retrying that GET fails closed, never grants a second call.
create function public.consume_keyword_shadow_authority(input jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare claimed uuid;
begin
  update public.n8n_shadow_permits set status='provider_authorized'
  where run_id=(input->>'runId')::uuid and account_id=(input->>'accountId')::uuid
    and context_generation=(input->>'contextGeneration')::bigint and registration_id=(input->>'registrationId')::uuid
    and contract=input->'contract' and spec_hash=input->>'specHash' and token_digest=input->>'tokenDigest'
    and status='dispatching'
  returning id into claimed;
  return claimed is not null;
end $$;
revoke all on function public.consume_keyword_shadow_authority(jsonb) from public,anon,authenticated;
grant execute on function public.consume_keyword_shadow_authority(jsonb) to service_role;

create function public.finish_keyword_shadow_dispatch(permit_id uuid,outcome text,observed_execution text,saved_result jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare saved uuid;
begin
  if outcome is null or outcome not in ('verified','refused','uncertain') then raise exception 'Invalid shadow outcome' using errcode='23514'; end if;
  update public.n8n_shadow_permits set status=outcome,execution_id=coalesce(observed_execution,execution_id),result=saved_result
    where id=permit_id and status in ('dispatching','provider_authorized','verifying','uncertain')
    and not (status='uncertain' and outcome='uncertain') returning id into saved;
  return saved is not null;
end $$;
revoke all on function public.finish_keyword_shadow_dispatch(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_keyword_shadow_dispatch(uuid,text,text,jsonb) to service_role;

create function public.note_keyword_shadow_execution(permit_id uuid,observed_execution text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare saved uuid;
begin
  update public.n8n_shadow_permits set status='verifying',execution_id=observed_execution
    where id=permit_id and status='provider_authorized' returning id into saved;
  return saved is not null;
end $$;
revoke all on function public.note_keyword_shadow_execution(uuid,text) from public,anon,authenticated;
grant execute on function public.note_keyword_shadow_execution(uuid,text) to service_role;
