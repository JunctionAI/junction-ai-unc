-- One winner BEFORE any engine/provider I/O. No lease expiry, allowance renewal,
-- workflow changes or replay. Older snapshots lacking the protocol marker refuse.
create function public.claim_keyword_shadow_start(input jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare requested jsonb:=input->'run'; snap jsonb:=requested->'snapshot'; ctx jsonb:=snap->'ctx';
  a public.accounts%rowtype; p public.n8n_shadow_permits%rowtype; r public.routine_runs%rowtype;
  w public.n8n_workflows%rowtype; owner_role text; website text; budget numeric; location integer;
  acct uuid:=(requested->>'accountId')::uuid; rid uuid:=(requested->>'id')::uuid;
begin
  if acct is distinct from 'aa5cfc84-2569-4c99-9b40-67003ae55eda'::uuid or rid is null or
      snap->>'awaiting' is distinct from 'keyword_start' or snap->>'startProtocol' is distinct from 'keyword_claim_v1' or
      snap->>'nextNodeIndex' is distinct from '0' then return false; end if;
  select * into a from public.accounts where id=acct for share;
  select * into p from public.n8n_shadow_permits where account_id=acct and run_id=rid for update;
  if a.id is null or p.id is null or a.automation_paused or a.context_generation is distinct from p.context_generation or
      requested->>'contextGeneration' is distinct from p.context_generation::text or
      p.issuance is null or p.status<>'reserved' or p.expires_at<=clock_timestamp() or
      p.request_digest is not null or p.token_digest is not null or p.execution_id is not null or p.result is not null or
      p.dispatched_at is not null or p.authorized_at is not null or p.finished_at is not null then return false; end if;
  select role into owner_role from public.account_members where account_id=acct and user_id=p.authorized_by for share;
  select rp.website,coalesce(rp.budget_monthly,0) into website,budget
    from public.resource_profiles rp where rp.account_id=acct for share;
  select * into w from public.n8n_workflows where id=p.registration_id for share;
  select * into r from public.routine_runs where id=rid for update;
  if owner_role is distinct from 'owner' or w.account_id is distinct from acct or w.routine_id is distinct from 'D03-W01' or
      w.active is distinct from true or w.webhook_url is distinct from p.receiver_url or
      p.receiver_url is distinct from 'https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow' or
      r.account_id is distinct from acct or r.context_generation is distinct from p.context_generation or
      r.status is distinct from 'running' or requested->>'status' is distinct from 'running' or
      r.mode is distinct from 'dry_run' or requested->>'mode' is distinct from 'dry_run' or
      r.routine_id is distinct from 'D03-W01' or requested->>'routineId' is distinct from 'D03-W01' or
      r.version::text is distinct from requested->>'version' or r.version<>2 or
      r.spec_hash is distinct from requested->>'specHash' or r.spec_hash is distinct from p.spec_hash or
      r.snapshot is distinct from snap or snap->'spec' is distinct from p.spec or
      r.started_at is distinct from (requested->>'startedAt')::timestamptz or
      r.started_at<clock_timestamp()-interval '15 minutes' or r.started_at>clock_timestamp()+interval '30 seconds' or
      r.finished_at is not null or r.approval_id is not null or
      ctx->>'runId' is distinct from rid::text or ctx->>'routineId' is distinct from 'D03-W01' or
      ctx->>'version' is distinct from r.version::text or ctx->>'mode' is distinct from 'dry_run' or
      ctx->>'startedAt' is distinct from requested->>'startedAt' or ctx->>'triggeredBy' is distinct from 'manual' or
      ctx #>> '{account,accountId}' is distinct from acct::text or
      ctx #>> '{account,contextGeneration}' is distinct from p.context_generation::text or
      ctx #>> '{account,currency}' is distinct from a.currency or
      (ctx #>> '{account,budgetMonthly}')::numeric is distinct from budget or
      ctx->'vars' is distinct from jsonb_build_object('website',website) or
      ctx->'reads' is distinct from '{}'::jsonb or ctx->'checks' is distinct from '{}'::jsonb or
      ctx->'inputs' is distinct from '{}'::jsonb or ctx ?| array['artifact','execution','approval','decision'] or
      coalesce(website,'') not in ('avgarsport.com','https://avgarsport.com','https://avgarsport.com/') or
      exists(select 1 from public.receipts where run_id=rid) or
      exists(select 1 from public.artifacts where run_id=rid) then return false; end if;
  location:=case p.issuance->>'market' when 'US' then 2840 when 'NZ' then 2554 when 'AU' then 2036 end;
  if location is null or p.issuance->>'maxProviderCalls' is distinct from '1' or
      p.issuance->>'authorizedBy' is distinct from p.authorized_by::text or
      p.issuance->>'contextGeneration' is distinct from p.context_generation::text or
      p.issuance->>'idempotencyKey' is distinct from p.idempotency_key or
      (p.issuance->>'expiresAt')::timestamptz is distinct from p.expires_at or
      p.contract is distinct from jsonb_build_object('contract','unc.keyword-shadow.v1','accountId',acct,
        'routineId','D03-W01','routineKey','keyword_opportunity','workflowId','XiXJKuph1fAeH9pe',
        'workflowVersion','1bce8c54-637e-4770-af90-2da36f38369a',
        'client',jsonb_build_object('id','avgar','primaryDomain','avgarsport.com','seedKeyword','golf travel bag',
          'locationCode',location,'languageCode','en')) then return false; end if;

  update public.routine_runs set snapshot=jsonb_set(snapshot,'{awaiting}','"keyword_started"'::jsonb)
    where id=rid;
  return true;
end $$;
revoke all on function public.claim_keyword_shadow_start(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.claim_keyword_shadow_start(jsonb) to service_role;
