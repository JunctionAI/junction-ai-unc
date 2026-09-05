-- Calendar admission is not keyword admission. No bindings, registrations, owner
-- allowances, switches or customer runs are seeded by this migration.
create schema unc_calendar_private;
revoke all on schema unc_calendar_private from public,anon,authenticated;
grant usage on schema unc_calendar_private to service_role;
create table public.n8n_calendar_bindings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  context_generation bigint not null check(context_generation>=0),
  registration_id uuid not null references public.n8n_workflows(id) on delete restrict,
  accepted_by uuid not null references auth.users(id) on delete restrict,
  acceptance_ref text not null check(length(acceptance_ref) between 1 and 200),
  credential_ref text not null check(credential_ref ~ '^[A-Za-z0-9_-]{1,128}$'),
  asset_evidence_ref text not null check(length(asset_evidence_ref) between 1 and 400),
  workflow_definition_digest text not null check(workflow_definition_digest ~ '^[a-f0-9]{64}$'),
  spec_template jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz
);
create index n8n_calendar_binding_account on public.n8n_calendar_bindings(account_id,context_generation);
create table public.n8n_calendar_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  context_generation bigint not null check(context_generation>=0),
  run_id uuid not null unique references public.routine_runs(id) on delete restrict,
  binding_id uuid not null references public.n8n_calendar_bindings(id) on delete restrict,
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
  completion jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(account_id,context_generation,idempotency_key)
);
create index n8n_calendar_run_recovery on public.n8n_calendar_runs(state,updated_at) where state in ('dispatching','authorized','verifying','uncertain','verified');
alter table public.n8n_calendar_bindings enable row level security;
alter table public.n8n_calendar_runs enable row level security;
revoke all on public.n8n_calendar_bindings,public.n8n_calendar_runs from public,anon,authenticated,service_role;
grant select,insert,update on public.n8n_calendar_bindings,public.n8n_calendar_runs to service_role;

create function unc_calendar_private.calendar_spec_valid(s jsonb,acct uuid,binding uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare c jsonb:=s #> '{nodes,1,shadowContract}'; client jsonb:=c->'client';
begin
  if jsonb_typeof(s->'nodes') is distinct from 'array' then return false; end if;
  return coalesce(s->>'id'='D05-W07' and (s->>'version')::integer>0 and s->>'mutates'='false'
    and jsonb_array_length(s->'nodes')=4 and s #>> '{nodes,0,kind}'='trigger' and s #>> '{nodes,0,cadence}'='manual'
    and s #>> '{nodes,1,kind}'='n8n' and s #>> '{nodes,2,kind}'='gate' and s #>> '{nodes,3,kind}'='receipt'
    and not (s #> '{nodes,1}') ?| array['webhookUrl','webhookUrlEnv']
    and c->>'contract'='unc.campaign-calendar-shadow.v1' and c->>'accountId'=acct::text
    and c->>'routineId'='D05-W07' and c->>'routineKey'='campaign_calendar'
    and c->>'workflowId' ~ '^[A-Za-z0-9_-]{1,128}$' and (c->>'workflowVersion')::uuid is not null
    and c-array['contract','accountId','workflowId','workflowVersion','routineId','routineKey','client','data']='{}'::jsonb
    and client->>'bindingId'=binding::text and client->>'klaviyoAccountId' ~ '^[A-Za-z0-9_-]{1,128}$'
    and client->>'primaryDomain' ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'
    and client->>'currency' ~ '^[A-Z]{3}$'
    and exists(select 1 from pg_catalog.pg_timezone_names where name=client->>'timezone')
    and client-array['primaryDomain','timezone','currency','bindingId','klaviyoAccountId']='{}'::jsonb
    and c #>> '{data,mode}' in ('provider','stored') and c #>> '{data,queryHash}' ~ '^[a-f0-9]{64}$',false);
end $$;

create function unc_calendar_private.guard_calendar_binding() returns trigger
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; w public.n8n_workflows%rowtype; owner_role text;
begin
  if tg_op='UPDATE' then
    if to_jsonb(new)-'revoked_at' is distinct from to_jsonb(old)-'revoked_at' or old.revoked_at is not null or new.revoked_at is null then
      raise exception 'Calendar binding is immutable except one-way revocation' using errcode='23514'; end if;
    new.revoked_at:=clock_timestamp(); return new;
  end if;
  select * into a from public.accounts where id=new.account_id for share;
  select role into owner_role from public.account_members where account_id=new.account_id and user_id=new.accepted_by for share;
  select * into w from public.n8n_workflows where id=new.registration_id for share;
  if a.id is null or a.context_generation<>new.context_generation or owner_role is distinct from 'owner'
    or w.account_id is distinct from new.account_id or w.routine_id is distinct from 'D05-W07'
    or w.webhook_url is distinct from 'https://junctionai8.app.n8n.cloud/webhook/unc/d05-w07/calendar-shadow'
    or not unc_calendar_private.calendar_spec_valid(new.spec_template,new.account_id,new.id)
    or new.spec_template #>> '{nodes,1,shadowContract,client,currency}' is distinct from a.currency
    or new.spec_template #> '{nodes,1,shadowContract,data}' is distinct from jsonb_build_object('mode','provider','queryHash',new.spec_template #>> '{nodes,1,shadowContract,data,queryHash}')
    or new.revoked_at is not null then raise exception 'Accepted owner, asset and reviewed calendar specification required' using errcode='23514'; end if;
  new.created_at:=clock_timestamp(); return new;
end $$;
create trigger calendar_binding_guard before insert or update on public.n8n_calendar_bindings for each row execute function unc_calendar_private.guard_calendar_binding();

-- Recheck mutable authority under locks before EACH start, dispatch and provider allowance.
create function unc_calendar_private.calendar_current(p public.n8n_calendar_runs) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype; b public.n8n_calendar_bindings%rowtype; w public.n8n_workflows%rowtype;
  st public.routine_states%rowtype; r public.routine_runs%rowtype; owner_role text;
  c jsonb:=p.initial_run #> '{snapshot,spec,nodes,1,shadowContract}'; d public.account_dataset_snapshots%rowtype;
begin
  select * into a from public.accounts where id=p.account_id for share;
  select role into owner_role from public.account_members where account_id=p.account_id and user_id=p.authorized_by for share;
  select * into b from public.n8n_calendar_bindings where id=p.binding_id for share;
  select * into st from public.routine_states where account_id=p.account_id and routine_id='D05-W07' for share;
  select * into w from public.n8n_workflows where id=b.registration_id for share;
  select * into r from public.routine_runs where id=p.run_id for share;
  if a.id is null or a.automation_paused or a.context_generation is distinct from p.context_generation or owner_role is distinct from 'owner'
    or b.account_id is distinct from p.account_id or b.context_generation is distinct from p.context_generation or b.revoked_at is not null
    or st.enabled is distinct from true or st.version::text is distinct from p.initial_run->>'version'
    or coalesce(st.live_spec,st.draft_spec) is distinct from b.spec_template
    or w.account_id is distinct from p.account_id or w.active is distinct from true or w.routine_id is distinct from 'D05-W07'
    or w.webhook_url is distinct from 'https://junctionai8.app.n8n.cloud/webhook/unc/d05-w07/calendar-shadow'
    or r.account_id is distinct from p.account_id or r.context_generation is distinct from p.context_generation
    or r.routine_id is distinct from 'D05-W07' or r.mode is distinct from 'dry_run' or r.status is distinct from 'running'
    or r.spec_hash is distinct from p.initial_run->>'specHash' or r.version::text is distinct from p.initial_run->>'version'
    or r.started_at is distinct from (p.initial_run->>'startedAt')::timestamptz
    or r.snapshot->'spec' is distinct from p.initial_run #> '{snapshot,spec}'
    or r.snapshot->'ctx' is distinct from p.initial_run #> '{snapshot,ctx}'
    or c->'client' is distinct from b.spec_template #> '{nodes,1,shadowContract,client}'
    or c #>> '{client,currency}' is distinct from a.currency then
    raise exception 'Current enabled owner, context, binding and registration required' using errcode='40001'; end if;
  if c #>> '{data,mode}'='stored' then
    select * into d from public.account_dataset_snapshots where id=(c #>> '{data,snapshotId}')::uuid for share;
    if d.account_id is distinct from p.account_id or d.platform is distinct from 'klaviyo'
      or d.external_ref is distinct from c #>> '{client,klaviyoAccountId}' or d.query_hash is distinct from c #>> '{data,queryHash}'
      or d.source_fetched_at is distinct from (c #>> '{data,fetchedAt}')::timestamptz
      or d.query->>'resource' is distinct from 'campaigns'
      or coalesce(d.result->>'provenance','') not in ('ok','empty')
      or d.result #>> '{metrics,campaign_history_contract}' is distinct from 'unc.klaviyo-campaign-history.v1' then
      raise exception 'Pinned current calendar snapshot unavailable' using errcode='40001'; end if;
    perform 1 from public.connectors where id=d.connector_id and account_id=p.account_id and platform='klaviyo'
      and external_ref=d.external_ref and status='connected' for share;
    if not found then raise exception 'Calendar snapshot connection changed' using errcode='40001'; end if;
    -- Connector lock acquisition can outlast the snapshot's remaining freshness.
    if d.source_fetched_at>clock_timestamp()+interval '30 seconds'
      or d.source_fetched_at<clock_timestamp()-make_interval(secs=>(c #>> '{data,maxAgeSeconds}')::integer) then
      raise exception 'Pinned calendar snapshot expired while waiting' using errcode='40001'; end if;
  end if;
  if p.expires_at<=clock_timestamp() then raise exception 'Calendar allowance expired' using errcode='40001'; end if;
end $$;

create function unc_calendar_private.guard_calendar_run() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r jsonb:=new.initial_run; snap jsonb:=r->'snapshot'; c jsonb:=snap #> '{spec,nodes,1,shadowContract}';
  reported jsonb; result_receipt jsonb; b public.n8n_calendar_bindings%rowtype;
begin
  if tg_op='INSERT' then
    select * into b from public.n8n_calendar_bindings where id=new.binding_id for share;
    if new.state<>'reserved' or new.request_digest is not null or new.token_digest is not null or new.execution_id is not null
      or new.candidate is not null or new.verified_result is not null or new.completion is not null or new.dispatched_at is not null or new.authorized_at is not null
      or r->>'id' is distinct from new.run_id::text or r->>'accountId' is distinct from new.account_id::text
      or r->>'contextGeneration' is distinct from new.context_generation::text or r->>'mode' is distinct from 'dry_run'
      or r->>'routineId' is distinct from 'D05-W07' or r->>'status' is distinct from 'running'
      or r ?| array['finishedAt','approvalId','snapshotSecret'] or coalesce(r->>'specHash','')=''
      or snap->>'awaiting' is distinct from 'calendar_start' or snap->>'startProtocol' is distinct from 'calendar_claim_v1'
      or snap->>'nextNodeIndex' is distinct from '0' or not unc_calendar_private.calendar_spec_valid(snap->'spec',new.account_id,new.binding_id)
      or snap->'spec' is distinct from jsonb_set(b.spec_template,'{nodes,1,shadowContract,data}',c->'data')
      or snap #>> '{ctx,runId}' is distinct from new.run_id::text or snap #>> '{ctx,routineId}' is distinct from 'D05-W07'
      or snap #>> '{ctx,account,accountId}' is distinct from new.account_id::text
      or snap #>> '{ctx,account,contextGeneration}' is distinct from new.context_generation::text
      or snap #>> '{ctx,account,currency}' is distinct from c #>> '{client,currency}'
      or snap #>> '{ctx,startedAt}' is distinct from r->>'startedAt' or snap #>> '{ctx,version}' is distinct from r->>'version'
      or snap #>> '{ctx,mode}' is distinct from 'dry_run' or snap #>> '{ctx,triggeredBy}' is distinct from 'manual'
      or snap #> '{ctx,reads}' is distinct from '{}'::jsonb or snap #> '{ctx,checks}' is distinct from '{}'::jsonb
      or snap #> '{ctx,inputs}' is distinct from '{}'::jsonb or snap #> '{ctx,vars}' is distinct from '{}'::jsonb
      or (snap->'ctx') ?| array['artifact','execution','approval','decision']
      or new.approval->>'authorizedBy' is distinct from new.authorized_by::text
      or new.approval->>'idempotencyKey' is distinct from new.idempotency_key
      or new.approval->>'contextGeneration' is distinct from new.context_generation::text
      or new.approval->>'maxDispatches' is distinct from '1' or coalesce(new.approval->>'approvalReference','')!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
      or new.approval-array['authorizedBy','idempotencyKey','contextGeneration','maxDispatches','approvalReference','expiresAt'] is distinct from '{}'::jsonb
      or (new.approval->>'expiresAt')::timestamptz is distinct from new.expires_at
      or new.expires_at>clock_timestamp()+interval '10 minutes'
      or r->>'startedAt' is null
      or (r->>'startedAt')::timestamptz not between clock_timestamp()-interval '30 seconds' and clock_timestamp()+interval '30 seconds'
      or octet_length(r::text)>100000 then raise exception 'Original scoped calendar issuance required' using errcode='23514'; end if;
    if c #>> '{data,mode}'='provider' then
      if c->'data' is distinct from b.spec_template #> '{nodes,1,shadowContract,data}' then raise exception 'Provider source mismatch' using errcode='23514'; end if;
    elsif c #>> '{data,maxAgeSeconds}' is null or c #>> '{data,snapshotId}' is null or c #>> '{data,fetchedAt}' is null
      or (c #>> '{data,maxAgeSeconds}')::integer not between 1 and 86400 or (c->'data')-array['mode','queryHash','snapshotId','fetchedAt','maxAgeSeconds']<>'{}'::jsonb
      or c #>> '{data,queryHash}' is distinct from b.spec_template #>> '{nodes,1,shadowContract,data,queryHash}' then
      raise exception 'Stored source mismatch' using errcode='23514'; end if;
    perform unc_calendar_private.calendar_current(new);
    new.created_at:=clock_timestamp(); new.updated_at:=new.created_at; return new;
  end if;
  if (to_jsonb(new)-array['state','request_digest','token_digest','execution_id','dispatched_at','authorized_at','candidate','verified_result','completion','updated_at'])
      is distinct from (to_jsonb(old)-array['state','request_digest','token_digest','execution_id','dispatched_at','authorized_at','candidate','verified_result','completion','updated_at'])
    or (old.request_digest is not null and new.request_digest is distinct from old.request_digest)
    or (old.token_digest is not null and new.token_digest is distinct from old.token_digest)
    or (old.execution_id is not null and new.execution_id is distinct from old.execution_id)
    or (old.dispatched_at is not null and new.dispatched_at is distinct from old.dispatched_at)
    or (old.authorized_at is not null and new.authorized_at is distinct from old.authorized_at)
    or (old.candidate is not null and new.candidate is distinct from old.candidate)
    or (old.verified_result is not null and new.verified_result is distinct from old.verified_result)
    or old.completion is not null then raise exception 'Calendar ledger identity and evidence are immutable' using errcode='23514'; end if;
  if not ((old.state='reserved' and new.state='started') or (old.state='started' and new.state='dispatching')
    or (old.state='dispatching' and new.state='authorized') or (old.state in ('authorized','uncertain') and new.state='verifying')
    or (old.state in ('dispatching','authorized','verifying') and new.state in ('uncertain','refused'))
    or (old.state in ('verifying','uncertain') and new.state='verified') or (old.state='verified' and new.state='completed')) then
    raise exception 'Calendar allowance cannot be replayed or renewed' using errcode='23514'; end if;
  if new.state in ('started','dispatching','authorized') then
    perform unc_calendar_private.calendar_current(new);
    if new.execution_id is not null or new.candidate is not null or new.verified_result is not null or new.completion is not null then
      raise exception 'Unexecuted calendar claim required' using errcode='23514'; end if;
  end if;
  if new.state='started' and (new.request_digest is not null or new.token_digest is not null or new.dispatched_at is not null or new.authorized_at is not null) then
    raise exception 'Start claim cannot imply dispatch' using errcode='23514'; end if;
  if new.state='dispatching' then
    if new.request_digest is null or new.token_digest is null or new.authorized_at is not null then raise exception 'Dispatch fingerprints required' using errcode='23514'; end if;
    new.dispatched_at:=clock_timestamp();
  end if;
  if new.state='authorized' then new.authorized_at:=clock_timestamp(); end if;
  if new.state in ('uncertain','refused') and (new.candidate is distinct from old.candidate or new.verified_result is not null or new.completion is not null
      or new.request_digest is distinct from old.request_digest or new.token_digest is distinct from old.token_digest
      or new.authorized_at is distinct from old.authorized_at) then raise exception 'Uncertain work cannot acquire evidence or authority' using errcode='23514'; end if;
  if new.state='verifying' then
    reported:=new.candidate->'executionReceipt';
    if old.authorized_at is null or new.authorized_at is distinct from old.authorized_at or new.execution_id is null or new.verified_result is not null or new.completion is not null
      or new.candidate #>> '{artifact,kind}' is distinct from 'calendar' or jsonb_typeof(new.candidate #> '{artifact,items}') is distinct from 'array'
      or jsonb_array_length(new.candidate #> '{artifact,items}') is distinct from 6
      or new.candidate #> '{artifact,meta}' is distinct from '{}'::jsonb or coalesce(new.candidate->>'resultDigest','')!~'^[a-f0-9]{64}$'
      or octet_length(new.candidate::text)>256000 or reported->>'executionId' is distinct from new.execution_id
      or reported->>'accountId' is distinct from new.account_id::text or reported->>'runId' is distinct from new.run_id::text
      or reported->>'contract' is distinct from 'unc.campaign-calendar-shadow.v1' or reported->>'routineId' is distinct from 'D05-W07'
      or reported->>'routineKey' is distinct from 'campaign_calendar' or reported->>'mode' is distinct from 'dry_run'
      or reported->>'status' is distinct from 'succeeded' or reported->>'executedAction' is distinct from 'none'
      or reported->>'workflowId' is distinct from c->>'workflowId' or reported->'client' is distinct from c->'client'
      or reported->'workflowVersion' is distinct from 'null'::jsonb or reported->>'revisionEvidence' is distinct from 'pending_unc_verification' then
      raise exception 'Original calendar result checkpoint required' using errcode='23514'; end if;
  end if;
  if new.state='verified' then
    result_receipt:=new.verified_result #> '{artifact,meta,executionReceipt}'; reported:=new.candidate->'executionReceipt';
    if old.candidate is null or old.authorized_at is null or new.authorized_at is distinct from old.authorized_at or new.execution_id is null or new.completion is not null
      or new.verified_result->>'kind' is distinct from 'artifact'
      or (new.verified_result->'artifact')-array['meta','evidence'] is distinct from (new.candidate->'artifact')-array['meta','evidence']
      or result_receipt-array['workflowVersion','revisionEvidence','revisionVerification'] is distinct from reported-array['workflowVersion','revisionEvidence','revisionVerification']
      or result_receipt->>'workflowVersion' is distinct from c->>'workflowVersion' or result_receipt->>'revisionEvidence' is distinct from 'verified_execution_record'
      or result_receipt #>> '{revisionVerification,source}' is distinct from 'n8n_execution_record'
      or result_receipt #>> '{revisionVerification,requestDigest}' is distinct from new.request_digest
      or result_receipt #>> '{revisionVerification,resultDigest}' is distinct from new.candidate->>'resultDigest'
      or new.verified_result #>> '{artifact,meta,executed_action}' is distinct from 'none'
      or new.verified_result #>> '{artifact,meta,approval_status}' is distinct from 'pending_approval'
      or (new.verified_result #> '{artifact,meta}')-array['executionReceipt','approval_status','executed_action'] is distinct from '{}'::jsonb
      or new.verified_result #> '{artifact,evidence}' is distinct from (
        coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(new.candidate #> '{artifact,evidence}') with ordinality where ordinality<=39),'[]'::jsonb)
        ||jsonb_build_array(jsonb_build_object('source','n8n_execution','ref','https://junctionai8.app.n8n.cloud/workflow/'||(c->>'workflowId')||'/executions/'||new.execution_id))) then
      raise exception 'Independently verified original calendar result required' using errcode='23514'; end if;
  end if;
  if new.state='completed' and (new.completion->>'runId' is distinct from new.run_id::text or new.completion->>'status' is distinct from 'done'
      or new.completion->>'routineId' is distinct from 'D05-W07' or new.completion->>'mode' is distinct from 'dry_run'
      or new.completion->>'version' is distinct from r->>'version'
      or ((new.completion->'artifact')-array['id','accountId','runId','routineId','status','createdAt']
          ||jsonb_build_object('meta',(new.completion #> '{artifact,meta}')-array['via','node','mode'])) is distinct from new.verified_result->'artifact'
      or jsonb_array_length(new.completion->'receipts') is distinct from 3
      or not exists(select 1 from public.routine_runs where id=new.run_id and account_id=new.account_id and context_generation=new.context_generation
        and status='done' and snapshot is null and summary=new.completion->>'summary')
      or not exists(select 1 from public.artifacts ar where ar.id=(new.completion #>> '{artifact,id}')::uuid and ar.run_id=new.run_id and ar.account_id=new.account_id
        and jsonb_build_object('id',ar.id,'accountId',ar.account_id,'runId',ar.run_id,'routineId',ar.routine_id,'kind',ar.kind,'title',ar.title,'body',ar.body,
          'items',ar.items,'meta',ar.meta,'evidence',ar.evidence,'status',ar.status) = (new.completion->'artifact')-'createdAt'
        and ar.created_at=(new.completion #>> '{artifact,createdAt}')::timestamptz)
      or exists(select 1 from jsonb_array_elements(new.completion->'receipts') e where not exists(
        select 1 from public.receipts rr where rr.id=(e->>'id')::uuid and rr.account_id=new.account_id and rr.run_id=new.run_id and rr.context_generation=new.context_generation
          and jsonb_build_object('id',rr.id,'accountId',rr.account_id,'runId',rr.run_id,'kind',rr.kind,'description',rr.description,'payload',rr.payload)=e-'createdAt'
          and rr.created_at=(e->>'createdAt')::timestamptz))) then
    raise exception 'Atomic calendar projection required' using errcode='23514'; end if;
  new.updated_at:=clock_timestamp(); return new;
end $$;
create trigger calendar_run_guard before insert or update on public.n8n_calendar_runs for each row execute function unc_calendar_private.guard_calendar_run();

create function public.issue_calendar_shadow_run(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb:=input->'run'; approved jsonb:=input->'approval'; p public.n8n_calendar_runs%rowtype;
  acct uuid:=(r->>'accountId')::uuid; generation bigint:=(r->>'contextGeneration')::bigint; bid uuid:=(r #>> '{snapshot,spec,nodes,1,shadowContract,client,bindingId}')::uuid;
begin
  perform 1 from public.accounts where id=acct for update;
  select * into p from public.n8n_calendar_runs where account_id=acct and context_generation=generation and idempotency_key=approved->>'idempotencyKey' for update;
  if found then
    if p.approval is distinct from approved or p.binding_id is distinct from bid or p.initial_run #> '{snapshot,spec}' is distinct from r #> '{snapshot,spec}' then
      raise exception 'Original calendar allowance cannot be rebound' using errcode='23514'; end if;
    return jsonb_build_object('created',false,'runId',p.run_id,'permitId',p.id);
  end if;
  insert into public.routine_runs(id,account_id,context_generation,routine_id,version,mode,status,started_at,spec_hash,snapshot)
    values((r->>'id')::uuid,acct,generation,'D05-W07',(r->>'version')::integer,'dry_run','running',(r->>'startedAt')::timestamptz,r->>'specHash',r->'snapshot');
  insert into public.n8n_calendar_runs(account_id,context_generation,run_id,binding_id,authorized_by,idempotency_key,approval,initial_run,expires_at)
    values(acct,generation,(r->>'id')::uuid,bid,(approved->>'authorizedBy')::uuid,approved->>'idempotencyKey',approved,r,(approved->>'expiresAt')::timestamptz) returning * into p;
  return jsonb_build_object('created',true,'runId',p.run_id,'permitId',p.id);
end $$;

-- One transition RPC keeps the locking order common across server handlers.
create function public.transition_calendar_shadow(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.n8n_calendar_runs%rowtype; op text:=input->>'operation'; r public.routine_runs%rowtype;
  b public.n8n_calendar_bindings%rowtype; c jsonb; snap jsonb;
begin
  perform 1 from public.accounts where id=(input->>'accountId')::uuid for share;
  select * into p from public.n8n_calendar_runs where account_id=(input->>'accountId')::uuid
    and context_generation=(input->>'contextGeneration')::bigint and run_id=(input->>'runId')::uuid
    and (input->>'permitId' is null or id=(input->>'permitId')::uuid) for update;
  if not found then raise exception 'Original scoped calendar allowance unavailable' using errcode='P0002'; end if;
  select * into b from public.n8n_calendar_bindings where id=p.binding_id;
  c:=p.initial_run #> '{snapshot,spec,nodes,1,shadowContract}';
  if op in ('start','dispatch','authorize') then perform unc_calendar_private.calendar_current(p); end if;
  select * into r from public.routine_runs where id=p.run_id for update;
  if op='start' then
    if p.state<>'reserved' then return 'false'::jsonb; end if;
    if input->'run' is distinct from p.initial_run or r.snapshot is distinct from p.initial_run->'snapshot' then raise exception 'Original calendar start changed' using errcode='23514'; end if;
    update public.n8n_calendar_runs set state='started' where id=p.id;
    update public.routine_runs set snapshot=jsonb_set(snapshot,'{awaiting}','"calendar_started"') where id=p.run_id;
    return 'true'::jsonb;
  elsif op in ('dispatch','authorize') then
    if input->'contract' is distinct from c or input->>'registrationId' is distinct from b.registration_id::text
      or r.snapshot->>'awaiting' is distinct from 'calendar_shadow' or r.snapshot->>'nextNodeIndex' is distinct from '2' then
      raise exception 'Calendar dispatch identity changed' using errcode='23514'; end if;
    if op='dispatch' then
      if p.state<>'started' then return 'null'::jsonb; end if;
      if input->>'receiverUrl' is distinct from 'https://junctionai8.app.n8n.cloud/webhook/unc/d05-w07/calendar-shadow' then raise exception 'Calendar receiver mismatch' using errcode='23514'; end if;
      update public.n8n_calendar_runs set state='dispatching',request_digest=input->>'requestDigest',token_digest=input->>'tokenDigest' where id=p.id;
      return to_jsonb(p.id);
    end if;
    if p.state<>'dispatching' or input->>'tokenDigest' is distinct from p.token_digest or input->>'specHash' is distinct from r.spec_hash then return 'false'::jsonb; end if;
    update public.n8n_calendar_runs set state='authorized' where id=p.id; return 'true'::jsonb;
  elsif op='checkpoint' then
    if p.candidate is not null then return to_jsonb(p.candidate=input->'candidate' and p.execution_id=input->>'executionId'); end if;
    update public.n8n_calendar_runs set state='verifying',execution_id=input->>'executionId',candidate=input->'candidate' where id=p.id; return 'true'::jsonb;
  elsif op='finish' then
    if p.state in ('verified','completed') then return to_jsonb(input->>'outcome'='verified' and p.verified_result=input->'result' and p.execution_id=input->>'executionId'); end if;
    if p.state in ('uncertain','refused') and input->>'outcome'=p.state then return to_jsonb(p.execution_id is not distinct from input->>'executionId'); end if;
    if coalesce(input->>'outcome','') not in ('verified','uncertain','refused') then raise exception 'Invalid calendar outcome'; end if;
    update public.n8n_calendar_runs set state=input->>'outcome',execution_id=coalesce(input->>'executionId',execution_id),
      verified_result=case when input->>'outcome'='verified' then input->'result' else null end where id=p.id; return 'true'::jsonb;
  end if;
  raise exception 'Unsupported calendar transition' using errcode='22023';
end $$;

revoke all on function unc_calendar_private.calendar_spec_valid(jsonb,uuid,uuid),unc_calendar_private.guard_calendar_binding(),unc_calendar_private.calendar_current(public.n8n_calendar_runs),unc_calendar_private.guard_calendar_run() from public,anon,authenticated;
grant execute on function unc_calendar_private.calendar_spec_valid(jsonb,uuid,uuid),unc_calendar_private.calendar_current(public.n8n_calendar_runs) to service_role;
revoke all on function public.issue_calendar_shadow_run(jsonb),public.transition_calendar_shadow(jsonb) from public,anon,authenticated;
grant execute on function public.issue_calendar_shadow_run(jsonb),public.transition_calendar_shadow(jsonb) to service_role;

-- Normal completion and recovery use the same transaction/idempotency key. There
-- is no provider dispatch, external action or schedule anywhere in this function.
create function public.commit_calendar_shadow_completion(acct uuid,generation bigint,requested_run uuid,packet jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.n8n_calendar_runs%rowtype; r public.routine_runs%rowtype; a public.accounts%rowtype;
  owner_role text; snap jsonb; spec jsonb; ctx jsonb; bundle jsonb; art jsonb; item jsonb; pos integer;
  completed_at timestamptz; external_receipt jsonb; expected_node text;
begin
  select * into a from public.accounts where id=acct for share;
  if a.id is null or a.context_generation is distinct from generation or a.automation_paused then raise exception 'Current unpaused context required' using errcode='40001'; end if;
  select * into p from public.n8n_calendar_runs where account_id=acct and context_generation=generation and run_id=requested_run for update;
  if not found then raise exception 'Original calendar allowance unavailable' using errcode='P0002'; end if;
  select role into owner_role from public.account_members where account_id=acct and user_id=p.authorized_by for share;
  if owner_role is distinct from 'owner' then raise exception 'Calendar owner authority changed' using errcode='42501'; end if;
  select * into r from public.routine_runs where id=requested_run and account_id=acct and context_generation=generation for update;
  if not found then raise exception 'Original calendar run unavailable' using errcode='P0002'; end if;
  if p.completion is not null then
    if p.state<>'completed' or r.status<>'done'
      or not exists(select 1 from public.artifacts where id=(p.completion #>> '{artifact,id}')::uuid and account_id=acct and run_id=r.id)
      or exists(select 1 from jsonb_array_elements(p.completion->'receipts') e where not exists(
        select 1 from public.receipts where id=(e->>'id')::uuid and account_id=acct and context_generation=generation and run_id=r.id)) then
      raise exception 'Original completed records unavailable; never recreate them' using errcode='P0002'; end if;
    return p.completion;
  end if;
  if packet is null then return null; end if;
  snap:=packet->'snapshot'; spec:=snap->'spec'; ctx:=snap->'ctx'; bundle:=packet->'result'; art:=bundle->'artifact';
  external_receipt:=p.verified_result #> '{artifact,meta,executionReceipt}';
  if p.state<>'verified' or r.status not in ('running','failed') or r.mode<>'dry_run' or r.routine_id<>'D05-W07'
    or r.spec_hash is distinct from p.initial_run->>'specHash' or r.snapshot is distinct from snap
    or snap->>'awaiting' is distinct from 'calendar_shadow' or snap->>'nextNodeIndex' is distinct from '2'
    or spec is distinct from p.initial_run #> '{snapshot,spec}' or spec->>'version' is distinct from r.version::text
    or ctx->>'runId' is distinct from r.id::text or ctx->>'routineId' is distinct from r.routine_id
    or ctx->>'version' is distinct from r.version::text or ctx->>'mode' is distinct from 'dry_run'
    or ctx->>'triggeredBy' is distinct from 'manual' or (ctx->>'startedAt')::timestamptz is distinct from r.started_at
    or ctx #>> '{account,accountId}' is distinct from acct::text or ctx #>> '{account,contextGeneration}' is distinct from generation::text
    or ctx ?| array['artifact','execution','approval','decision']
    or bundle->>'runId' is distinct from r.id::text or bundle->>'routineId' is distinct from 'D05-W07'
    or bundle->>'version' is distinct from r.version::text or bundle->>'mode' is distinct from 'dry_run' or bundle->>'status' is distinct from 'done'
    or bundle ?| array['approval','needs','error'] or length(coalesce(bundle->>'summary','')) not between 1 and 4000
    or octet_length(packet::text)>1000000
    or external_receipt->>'revisionEvidence' is distinct from 'verified_execution_record'
    or external_receipt #>> '{revisionVerification,requestDigest}' is distinct from p.request_digest
    or external_receipt #>> '{revisionVerification,resultDigest}' is distinct from p.candidate->>'resultDigest' then
    raise exception 'Original verified calendar continuation required' using errcode='23514'; end if;
  if art->>'accountId' is distinct from acct::text or art->>'runId' is distinct from r.id::text or art->>'routineId' is distinct from 'D05-W07'
    or art->>'kind' is distinct from 'calendar' or art->>'status' is distinct from 'draft'
    or art #>> '{meta,via}' is distinct from 'n8n' or art #>> '{meta,node}' is distinct from spec #>> '{nodes,1,id}'
    or art #>> '{meta,mode}' is distinct from 'dry_run'
    or ((art-array['id','accountId','runId','routineId','status','createdAt'])||jsonb_build_object('meta',(art->'meta')-array['via','node','mode'])) is distinct from p.verified_result->'artifact'
    or jsonb_typeof(bundle->'receipts') is distinct from 'array' or jsonb_array_length(bundle->'receipts')<>3 then
    raise exception 'Calendar projection differs from verified business result' using errcode='23514'; end if;
  completed_at:=(art->>'createdAt')::timestamptz;
  if completed_at is null or completed_at<clock_timestamp()-interval '10 minutes' or completed_at>clock_timestamp()+interval '30 seconds' then
    raise exception 'Calendar completion plan expired' using errcode='23514'; end if;
  for item,pos in select value,ordinality::integer from jsonb_array_elements(bundle->'receipts') with ordinality loop
    expected_node:=spec->'nodes'->pos->>'id';
    if item->>'accountId' is distinct from acct::text or item->>'runId' is distinct from r.id::text or item->>'kind' is distinct from 'draft'
      or item ?| array['spend','approvalId','platform'] or (item->>'createdAt')::timestamptz is distinct from completed_at
      or length(coalesce(item->>'description','')) not between 1 and 8000 or item #>> '{payload,node}' is distinct from expected_node
      or (pos=1 and (item #>> '{payload,artifactId}' is distinct from art->>'id' or item #> '{payload,externalExecution}' is distinct from external_receipt))
      or (pos=3 and (item #>> '{payload,artifactId}' is distinct from art->>'id' or item #>> '{payload,executed}' is distinct from 'false')) then
      raise exception 'Invalid calendar completion receipt' using errcode='23514'; end if;
  end loop;
  if exists(select 1 from public.artifacts where run_id=r.id) then raise exception 'Calendar already has an artifact; reconcile without duplication' using errcode='23514'; end if;
  insert into public.artifacts(id,account_id,run_id,routine_id,kind,title,body,items,meta,evidence,status,created_at)
    values((art->>'id')::uuid,acct,r.id,'D05-W07','calendar',art->>'title',art->>'body',art->'items',art->'meta',art->'evidence','draft',completed_at);
  for item in select value from jsonb_array_elements(bundle->'receipts') loop
    insert into public.receipts(id,account_id,context_generation,run_id,kind,description,payload,created_at)
      values((item->>'id')::uuid,acct,generation,r.id,'draft',item->>'description',item->'payload',completed_at);
  end loop;
  update public.routine_runs set status='done',summary=bundle->>'summary',finished_at=completed_at,snapshot=null where id=r.id;
  update public.n8n_calendar_runs set state='completed',completion=bundle where id=p.id;
  return bundle;
end $$;
revoke all on function public.commit_calendar_shadow_completion(uuid,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commit_calendar_shadow_completion(uuid,bigint,uuid,jsonb) to service_role;
