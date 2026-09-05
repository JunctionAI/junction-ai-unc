-- Owner-selected configuration from previously verified same-context pilot results.
-- Does not enable, dispatch, register, grant provider authority, or alter a receipt.
create function public.keyword_customer_configuration(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  acct uuid:=(input->>'accountId')::uuid; actor uuid:=(input->>'actorId')::uuid;
  generation bigint:=(input->>'contextGeneration')::bigint;
  a public.accounts%rowtype; s public.routine_states%rowtype;
  w public.n8n_workflows%rowtype; owner_role text; candidates jsonb; chosen jsonb;
begin
  if jsonb_typeof(input) is distinct from 'object' or
    input-array['accountId','actorId','contextGeneration','operation','market','expectedUpdatedAt','expectedVersion','spec']<>'{}'::jsonb or
    acct is distinct from 'aa5cfc84-2569-4c99-9b40-67003ae55eda'::uuid or actor is null or generation is null or
    input->>'operation' is null or input->>'operation' not in ('read','save') then
    raise exception 'Invalid keyword configuration request' using errcode='23514'; end if;
  -- Account-first serialization agrees with switch, reset and command admission.
  select * into a from public.accounts where id=acct for update;
  select role into owner_role from public.account_members where account_id=acct and user_id=actor for share;
  if a.id is null or owner_role is distinct from 'owner' then
    raise exception 'Account owner required' using errcode='42501'; end if;
  if a.context_generation is distinct from generation then
    raise exception 'Business context changed' using errcode='40001'; end if;
  select * into s from public.routine_states where account_id=acct and routine_id='D03-W01' for update;
  select * into w from public.n8n_workflows where account_id=acct and routine_id='D03-W01' for share;
  select coalesce(jsonb_agg(candidate order by candidate->>'market'),'[]'::jsonb) into candidates from (
    select distinct on (p.contract #>> '{client,locationCode}') jsonb_build_object(
      'market',case p.contract #>> '{client,locationCode}' when '2840' then 'US' when '2554' then 'NZ' when '2036' then 'AU' end,
      'spec',p.spec,'sourceRunId',p.run_id) candidate
    from public.n8n_shadow_permits p
    join public.routine_runs r on r.id=p.run_id and r.account_id=p.account_id and r.context_generation=p.context_generation
    join public.artifacts ar on ar.run_id=r.id and ar.account_id=r.account_id and ar.routine_id=r.routine_id
    where p.account_id=acct and p.context_generation=generation and p.status='verified' and r.status='done' and r.mode='dry_run'
      and r.routine_id='D03-W01' and r.version=2 and p.spec->>'version'='2' and p.spec->>'id'='D03-W01'
      -- Completed runs clear the resumable snapshot; the immutable permit keeps the recipe.
      and (r.snapshot is null or r.snapshot->'spec'=p.spec) and r.spec_hash=p.spec_hash
      and p.spec #> '{nodes,3,shadowContract}'=p.contract
      and w.active and p.registration_id=w.id and p.receiver_url=w.webhook_url
      and w.webhook_url='https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow'
      and p.contract=jsonb_build_object('contract','unc.keyword-shadow.v1','accountId',acct,'routineId','D03-W01',
        'routineKey','keyword_opportunity','workflowId','XiXJKuph1fAeH9pe','workflowVersion','92135add-3c35-43e4-9649-5bb3d4557814',
        'client',jsonb_build_object('id','avgar','primaryDomain','avgarsport.com','seedKeyword','golf travel bag',
          'languageCode','en','locationCode',(p.contract #>> '{client,locationCode}')::int))
      and p.contract #>> '{client,locationCode}' in ('2840','2554','2036')
      and ar.meta->'executionReceipt' @> (p.contract || jsonb_build_object('runId',r.id,'status','succeeded','mode','dry_run',
        'executedAction','none','revisionEvidence','verified_execution_record','executionId',p.execution_id))
      and ar.meta #>> '{executionReceipt,revisionVerification,source}'='n8n_execution_record'
    order by p.contract #>> '{client,locationCode}',p.finished_at desc,p.id
  ) proven;
  if input->>'operation'='save' then
    if input->>'market' is null or input->>'market' not in ('US','NZ','AU') or
      not input ? 'expectedUpdatedAt' or not input ? 'expectedVersion' or
      (input->>'expectedVersion')::int is distinct from coalesce(s.version,1) or
      (input->>'expectedUpdatedAt')::timestamptz is distinct from s.updated_at or
      coalesce(s.version,1)>2 or s.enabled or s.draft_spec is not null then
      raise exception 'Refresh settings; turn the routine off and resolve any draft before changing market' using errcode='40001'; end if;
    if exists(select 1 from public.routine_commands c where c.account_id=acct and c.context_generation=generation
        and c.routine_id='D03-W01' and c.status in ('queued','running','waiting','uncertain')) or
      exists(select 1 from public.n8n_shadow_permits p where p.account_id=acct and p.context_generation=generation
        and p.status not in ('verified','refused')) then
      raise exception 'Resolve the outstanding keyword request before changing market' using errcode='40001'; end if;
    select c->'spec' into chosen from jsonb_array_elements(candidates) c where c->>'market'=input->>'market';
    if chosen is null or chosen is distinct from input->'spec' then
      raise exception 'No matching verified configuration for this market' using errcode='40001'; end if;
    insert into public.routine_states(account_id,routine_id,version,enabled,live_spec,updated_at)
      values(acct,'D03-W01',2,false,chosen,clock_timestamp())
      on conflict(account_id,routine_id) do update set version=2,live_spec=excluded.live_spec,updated_at=excluded.updated_at
      returning * into s;
  end if;
  return jsonb_build_object('accountId',acct,'actorId',actor,'contextGeneration',generation,'routineId','D03-W01',
    'version',coalesce(s.version,1),'stateUpdatedAt',s.updated_at,'enabled',coalesce(s.enabled,false),
    'hasDraft',s.draft_spec is not null,'paused',a.automation_paused,'spec',s.live_spec,'candidates',candidates,
    'workflow',case when w.id is null then null else jsonb_build_object('id',w.id,'accountId',acct,'routineId','D03-W01',
      'webhookUrl',w.webhook_url,'active',w.active) end);
end $$;
revoke all on function public.keyword_customer_configuration(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.keyword_customer_configuration(jsonb) to service_role;
