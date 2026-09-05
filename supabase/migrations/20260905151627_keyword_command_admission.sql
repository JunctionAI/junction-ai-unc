-- Additive customer binding around the reviewed operator admission/start protocol.
-- No old permit, revision, function body, switch, credential or registration is changed.
do $$
declare target record; p record;
begin
  for target in select * from (values
    ('public.issue_keyword_shadow_pilot(jsonb)','9d32cc8c26d4668a16503682a5fa765c'),
    ('public.claim_keyword_shadow_start(jsonb)','498f5632c9c12a1937755e0b0503c438')
  ) as reviewed(signature,body_hash) loop
    select * into strict p from pg_proc where oid=target.signature::regprocedure;
    if md5(p.prosrc)<>target.body_hash or p.prosecdef or
      has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or
      not has_function_privilege('service_role',p.oid,'execute') then
      raise exception 'Reviewed keyword admission dependency changed: %',target.signature;
    end if;
  end loop;
end $$;
create function public.assert_keyword_command_binding(input jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.routine_commands%rowtype; a public.accounts%rowtype;
  s public.routine_states%rowtype; w public.n8n_workflows%rowtype;
  r jsonb:=input->'run'; spec jsonb:=r #> '{snapshot,spec}'; approval jsonb:=input->'approval';
  acct uuid:=(r->>'accountId')::uuid; rid uuid:=(input->>'commandId')::uuid;
  spec_json text:=input->>'commandSpecJson'; workflow_json text:=input->>'commandWorkflowJson';
  market text; owner_role text;
begin
  if acct is distinct from 'aa5cfc84-2569-4c99-9b40-67003ae55eda'::uuid or rid is null or r->>'id' is distinct from rid::text or
    jsonb_typeof(input->'commandSpecJson') is distinct from 'string' or length(spec_json)>100000 or
    jsonb_typeof(input->'commandWorkflowJson') is distinct from 'string' or length(workflow_json)>4096 then
    raise exception 'Original keyword command identity required' using errcode='23514'; end if;
  -- Same account-first lock order as operator issuance; no provider work in this transaction.
  select * into a from public.accounts where id=acct for update;
  select * into c from public.routine_commands where id=rid and account_id=acct for update;
  select role into owner_role from public.account_members where account_id=acct and user_id=c.user_id for share;
  select * into s from public.routine_states where account_id=acct and routine_id='D03-W01' for share;
  select * into w from public.n8n_workflows where account_id=acct and routine_id='D03-W01' for share;
  if a.id is null or c.id is null or owner_role is distinct from 'owner' or a.automation_paused or
    a.context_generation is distinct from c.context_generation or r->>'contextGeneration' is distinct from c.context_generation::text or
    c.channel<>'app' or c.link_id is not null or c.channel_binding is not null or
    c.status<>'running' or c.run_id is distinct from c.id or c.routine_id<>'D03-W01' or c.version<>2 or
    c.created_at>clock_timestamp() or c.created_at+interval '10 minutes'<=clock_timestamp() or
    s.enabled is distinct from true or s.version<>c.version or s.live_spec is distinct from spec or
    spec_json::jsonb is distinct from spec or
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(spec_json,'UTF8')),'hex') is distinct from c.spec_hash or
    w.id is null or w.active is distinct from true or
    w.webhook_url is distinct from 'https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow' or
    workflow_json::jsonb is distinct from jsonb_build_object('id',w.id,'accountId',acct,'routineId','D03-W01','webhookUrl',w.webhook_url,'active',true) or
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(workflow_json,'UTF8')),'hex') is distinct from c.workflow_hash then
    raise exception 'Current owner, selected specification and original claimed command required' using errcode='40001'; end if;
  market:=case spec #>> '{nodes,3,shadowContract,client,locationCode}' when '2840' then 'US' when '2554' then 'NZ' when '2036' then 'AU' end;
  if market is null or approval-'expiresAt' is distinct from jsonb_build_object('authorizedBy',c.user_id,
      'approvalReference','keyword-command:'||c.id::text,'idempotencyKey','keyword-command:'||c.id::text,
      'market',market,'contextGeneration',c.context_generation,'maxProviderCalls',1) or
    (approval->>'expiresAt')::timestamptz is distinct from c.created_at+interval '10 minutes' then
    raise exception 'Command allowance cannot be renewed or rebound' using errcode='23514'; end if;
end $$;
revoke all on function public.assert_keyword_command_binding(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.assert_keyword_command_binding(jsonb) to service_role;

create function public.issue_keyword_shadow_command(input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(input) is distinct from 'object' or
    input-array['run','contract','receiverUrl','approval','commandId','commandSpecJson','commandWorkflowJson']<>'{}'::jsonb then
    raise exception 'Invalid keyword command envelope' using errcode='23514'; end if;
  perform public.assert_keyword_command_binding(input);
  return public.issue_keyword_shadow_pilot(input-array['commandId','commandSpecJson','commandWorkflowJson']);
end $$;
revoke all on function public.issue_keyword_shadow_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.issue_keyword_shadow_command(jsonb) to service_role;

create function public.claim_keyword_shadow_command_start(input jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare approval jsonb;
begin
  if jsonb_typeof(input) is distinct from 'object' or input-array['run','commandId','commandSpecJson','commandWorkflowJson']<>'{}'::jsonb then
    raise exception 'Invalid keyword command start envelope' using errcode='23514'; end if;
  select p.issuance into approval from public.n8n_shadow_permits p
    where p.account_id=(input #>> '{run,accountId}')::uuid and p.run_id=(input->>'commandId')::uuid;
  if approval is null then return false; end if;
  perform public.assert_keyword_command_binding(input||jsonb_build_object('approval',approval));
  return public.claim_keyword_shadow_start(jsonb_build_object('run',input->'run'));
end $$;
revoke all on function public.claim_keyword_shadow_command_start(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.claim_keyword_shadow_command_start(jsonb) to service_role;

-- Customer switch/command authority remains current at BOTH dispatch and the
-- wrapper's one-use authority callback. Old operator permits retain their rules.
create function unc_private.guard_keyword_command_permit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c public.routine_commands%rowtype; s public.routine_states%rowtype;
begin
  if new.idempotency_key not like 'keyword-command:%' or
    (tg_op='UPDATE' and new.status not in ('dispatching','provider_authorized')) then return new; end if;
  select * into c from public.routine_commands where id=new.run_id and account_id=new.account_id for share;
  select * into s from public.routine_states where account_id=new.account_id and routine_id='D03-W01' for share;
  if c.id is null or c.status<>'running' or c.run_id is distinct from new.run_id or c.routine_id<>'D03-W01' or
    c.context_generation is distinct from new.context_generation or c.user_id is distinct from new.authorized_by or
    c.channel<>'app' or c.channel_binding is not null or c.link_id is not null or
    new.idempotency_key is distinct from 'keyword-command:'||c.id::text or
    new.expires_at is distinct from c.created_at+interval '10 minutes' or
    s.enabled is distinct from true or s.version<>c.version or s.live_spec is distinct from new.spec then
    raise exception 'Customer keyword selection was withdrawn or changed' using errcode='40001'; end if;
  return new;
end $$;
revoke all on function unc_private.guard_keyword_command_permit() from public,anon,authenticated,service_role;
create trigger keyword_command_permit before insert or update on public.n8n_shadow_permits
  for each row execute function unc_private.guard_keyword_command_permit();
