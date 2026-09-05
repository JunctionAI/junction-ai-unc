-- Operator-only issuance. No client route, approval inference, automatic allowance
-- renewal, switch activation, spec promotion, provider work or account unpause.
alter table public.n8n_shadow_permits add column issuance jsonb;
create unique index n8n_workflows_account_routine_once
  on public.n8n_workflows(account_id,routine_id) where account_id is not null;

create function public.issue_keyword_shadow_pilot(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb:=input->'run'; snap jsonb:=r->'snapshot'; spec jsonb:=snap->'spec'; ctx jsonb:=snap->'ctx';
  c jsonb:=input->'contract'; approval jsonb:=input->'approval'; a public.accounts%rowtype;
  prior public.n8n_shadow_permits%rowtype; w public.n8n_workflows%rowtype;
  owner_role text; acct uuid:=(r->>'accountId')::uuid; rid uuid:=(r->>'id')::uuid;
  actor uuid:=(approval->>'authorizedBy')::uuid; generation bigint:=(r->>'contextGeneration')::bigint;
  expiry timestamptz:=(approval->>'expiresAt')::timestamptz; started timestamptz:=(r->>'startedAt')::timestamptz;
  permit uuid; website text; budget numeric; expected_location integer; producer jsonb;
begin
  if acct is distinct from 'aa5cfc84-2569-4c99-9b40-67003ae55eda'::uuid or
      jsonb_typeof(input) is distinct from 'object' or jsonb_typeof(approval) is distinct from 'object' or
      approval-array['authorizedBy','approvalReference','idempotencyKey','market','contextGeneration','maxProviderCalls','expiresAt']<>'{}'::jsonb or
      input->>'receiverUrl' is distinct from 'https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow' or
      approval->>'maxProviderCalls' is distinct from '1' or
      coalesce(approval->>'approvalReference','')!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' or
      coalesce(approval->>'idempotencyKey','')!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' or
      approval->>'contextGeneration' is distinct from generation::text then
    raise exception 'Explicit scoped keyword pilot approval required' using errcode='23514'; end if;
  select * into a from public.accounts where id=acct for update;
  select role into owner_role from public.account_members where account_id=acct and user_id=actor for share;
  if a.id is null or a.automation_paused or a.context_generation is distinct from generation or owner_role is distinct from 'owner' then
    raise exception 'Current unpaused owner context required' using errcode='40001'; end if;
  select rp.website,coalesce(rp.budget_monthly,0) into website,budget
    from public.resource_profiles rp where rp.account_id=acct for share;
  expected_location:=case approval->>'market' when 'US' then 2840 when 'NZ' then 2554 when 'AU' then 2036 end;
  if expected_location is null or coalesce(website,'') not in ('avgarsport.com','https://avgarsport.com','https://avgarsport.com/') or
      c is distinct from jsonb_build_object('contract','unc.keyword-shadow.v1','accountId',acct,
        'routineId','D03-W01','routineKey','keyword_opportunity','workflowId','XiXJKuph1fAeH9pe',
        'workflowVersion','1bce8c54-637e-4770-af90-2da36f38369a',
        'client',jsonb_build_object('id','avgar','primaryDomain','avgarsport.com','seedKeyword','golf travel bag',
          'locationCode',expected_location,'languageCode','en')) then
    raise exception 'Approved keyword client or frozen revision mismatch' using errcode='23514'; end if;
  if r->>'routineId' is distinct from 'D03-W01' or r->>'mode' is distinct from 'dry_run' or r->>'status' is distinct from 'running' or
      r->>'version' is distinct from spec->>'version' or spec->>'id' is distinct from 'D03-W01' or
      spec->>'mutates' is distinct from 'false' or coalesce(r->>'specHash','')='' or
      snap->>'awaiting' is distinct from 'keyword_start' or snap->>'nextNodeIndex' is distinct from '0' or
      ctx->>'runId' is distinct from rid::text or ctx->>'routineId' is distinct from 'D03-W01' or
      ctx->>'version' is distinct from r->>'version' or ctx->>'mode' is distinct from 'dry_run' or
      ctx->>'startedAt' is distinct from r->>'startedAt' or ctx->>'triggeredBy' is distinct from 'manual' or
      ctx #>> '{account,accountId}' is distinct from acct::text or ctx #>> '{account,contextGeneration}' is distinct from generation::text or
      ctx #>> '{account,currency}' is distinct from a.currency or (ctx #>> '{account,budgetMonthly}')::numeric is distinct from budget or
      ctx->'vars' is distinct from jsonb_build_object('website',website) or ctx->'reads' is distinct from '{}'::jsonb or
      ctx->'checks' is distinct from '{}'::jsonb or ctx->'inputs' is distinct from '{}'::jsonb or
      ctx ?| array['artifact','execution','approval','decision'] or jsonb_typeof(spec->'nodes') is distinct from 'array' then
    raise exception 'Captured original keyword start snapshot required' using errcode='23514'; end if;
  if jsonb_array_length(spec->'nodes')<>6 or spec #>> '{nodes,0,kind}' is distinct from 'trigger' or
      spec #>> '{nodes,0,cadence}' is distinct from 'manual' or
      spec #>> '{nodes,1,kind}' is distinct from 'read' or spec #>> '{nodes,1,source}' is distinct from 'search_console' or
      spec #>> '{nodes,1,query,resource}' is distinct from 'search_analytics' or spec #>> '{nodes,1,optional}' is distinct from 'true' or
      spec #>> '{nodes,2,kind}' is distinct from 'read' or spec #>> '{nodes,2,source}' is distinct from 'shopify' or
      spec #>> '{nodes,2,query,resource}' is distinct from 'pages' or spec #>> '{nodes,2,optional}' is distinct from 'true' or
      spec #>> '{nodes,3,kind}' is distinct from 'n8n' or spec #>> '{nodes,4,kind}' is distinct from 'gate' or
      spec #>> '{nodes,5,kind}' is distinct from 'receipt' then
    raise exception 'Only the original read/draft keyword pipeline is supported' using errcode='23514'; end if;
  producer:=spec #> '{nodes,3}';
  if producer->'shadowContract' is distinct from c or producer ?| array['webhookUrl','webhookUrlEnv'] then
    raise exception 'Only the account registered frozen receiver may be used' using errcode='23514'; end if;

  -- Serialize same-account issuance. The original approved key wins permanently,
  -- even if the caller generated a new run ID after losing its first response.
  select * into prior from public.n8n_shadow_permits p
    where p.account_id=acct and p.context_generation=generation and p.idempotency_key=approval->>'idempotencyKey' for update;
  if found then
    if prior.issuance is distinct from approval or prior.spec is distinct from spec or prior.contract is distinct from c or
        prior.authorized_by is distinct from actor then
      raise exception 'Approved allowance cannot be rebound' using errcode='23514'; end if;
    return jsonb_build_object('created',false,'runId',prior.run_id,'permitId',prior.id,'registrationId',prior.registration_id);
  end if;
  if rid is null or expiry is null or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '10 minutes' or
      started is null or started<clock_timestamp()-interval '30 seconds' or started>clock_timestamp()+interval '30 seconds' then
    raise exception 'Fresh bounded pilot allowance required' using errcode='40001'; end if;
  select * into w from public.n8n_workflows where account_id=acct and routine_id='D03-W01' for update;
  if found then
    if w.active is distinct from true or w.webhook_url is distinct from input->>'receiverUrl' then
      raise exception 'Existing registration was disabled or changed; explicit reconciliation required' using errcode='23514'; end if;
  else
    insert into public.n8n_workflows(account_id,routine_id,webhook_url,active)
      values(acct,'D03-W01',input->>'receiverUrl',true) returning * into w;
  end if;
  insert into public.routine_runs(id,account_id,context_generation,routine_id,version,mode,status,started_at,spec_hash,snapshot)
    values(rid,acct,generation,'D03-W01',(r->>'version')::integer,'dry_run','running',started,r->>'specHash',snap);
  insert into public.n8n_shadow_permits(account_id,context_generation,run_id,registration_id,authorized_by,idempotency_key,
    spec_hash,spec,contract,receiver_url,expires_at,issuance)
    values(acct,generation,rid,w.id,actor,approval->>'idempotencyKey',r->>'specHash',spec,c,input->>'receiverUrl',expiry,approval)
    returning id into permit;
  return jsonb_build_object('created',true,'runId',rid,'permitId',permit,'registrationId',w.id);
end $$;
revoke all on function public.issue_keyword_shadow_pilot(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.issue_keyword_shadow_pilot(jsonb) to service_role;
