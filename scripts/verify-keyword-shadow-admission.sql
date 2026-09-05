-- Synthetic owned account in a rollback-only transaction. No provider/network work.
set local role service_role;
do $$
declare acct uuid:=gen_random_uuid(); actor uuid; rid uuid:=gen_random_uuid(); wid uuid:=gen_random_uuid();
  permit uuid; claimed uuid; denied boolean; contract jsonb; spec jsonb; req jsonb; authority jsonb; saved jsonb;
  receiver text:='https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow';
begin
  select user_id into actor from public.account_members where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null;
  insert into public.accounts(id,name) values(acct,'UNC_KEYWORD_ADMISSION_CANARY');
  insert into public.account_members(account_id,user_id,role) values(acct,actor,'owner');
  contract:=jsonb_build_object('contract','unc.keyword-shadow.v1','accountId',acct,'routineId','D03-W01',
    'routineKey','keyword_opportunity','workflowId','synthetic-wrapper','workflowVersion','synthetic-revision');
  spec:=jsonb_build_object('id','D03-W01','version',1,'nodes',jsonb_build_array(
    jsonb_build_object('kind','trigger','cadence','manual'),jsonb_build_object('kind','n8n','shadowContract',contract)));
  insert into public.routine_states(account_id,routine_id,version,draft_spec) values(acct,'D03-W01',1,spec);
  insert into public.routine_runs(id,account_id,routine_id,version,mode,status,spec_hash) values(rid,acct,'D03-W01',1,'dry_run','running','synthetic-hash');
  insert into public.n8n_workflows(id,account_id,routine_id,webhook_url,active) values(wid,acct,'D03-W01',receiver,true);
  insert into public.n8n_shadow_permits(account_id,context_generation,run_id,registration_id,authorized_by,idempotency_key,
    spec_hash,spec,contract,receiver_url,expires_at)
    values(acct,0,rid,wid,actor,'approved-batch-market','synthetic-hash',spec,contract,receiver,clock_timestamp()+interval '5 minutes') returning id into permit;
  req:=jsonb_build_object('accountId',acct,'contextGeneration',0,'runId',rid,'registrationId',wid,'contract',contract,
    'receiverUrl',receiver,'requestDigest',repeat('a',64),'tokenDigest',repeat('b',64));
  authority:=req||jsonb_build_object('specHash','synthetic-hash');
  assert not public.consume_keyword_shadow_authority(authority),'authority issued before dispatch';
  assert public.claim_keyword_shadow_dispatch(req||jsonb_build_object('accountId',gen_random_uuid())) is null,'cross-tenant claim accepted';
  update public.accounts set automation_paused=true where id=acct;
  denied:=false; begin perform public.claim_keyword_shadow_dispatch(req); exception when serialization_failure then denied:=true; end;
  assert denied,'paused account dispatched';
  update public.accounts set automation_paused=false where id=acct;
  update public.routine_states set draft_spec=spec||'{"changed":true}'::jsonb where account_id=acct;
  denied:=false; begin perform public.claim_keyword_shadow_dispatch(req); exception when serialization_failure then denied:=true; end;
  assert denied,'same-version spec change dispatched';
  update public.routine_states set draft_spec=spec where account_id=acct;
  update public.n8n_workflows set active=false where id=wid;
  denied:=false; begin perform public.claim_keyword_shadow_dispatch(req); exception when check_violation then denied:=true; end;
  assert denied,'revoked registration dispatched';
  update public.n8n_workflows set active=true where id=wid;
  claimed:=public.claim_keyword_shadow_dispatch(req); assert claimed=permit;
  assert public.claim_keyword_shadow_dispatch(req) is null,'second dispatch claimed';
  assert not public.consume_keyword_shadow_authority(authority||jsonb_build_object('tokenDigest',repeat('c',64))),'other bearer consumed permit';
  update public.account_members set role='member' where account_id=acct and user_id=actor;
  denied:=false; begin perform public.consume_keyword_shadow_authority(authority); exception when serialization_failure then denied:=true; end;
  assert denied,'demoted owner authorized provider';
  update public.account_members set role='owner' where account_id=acct and user_id=actor;
  assert public.consume_keyword_shadow_authority(authority),'original permit denied';
  assert not public.consume_keyword_shadow_authority(authority),'duplicate provider allowance issued';
  assert public.note_keyword_shadow_execution(permit,'12345'),'execution checkpoint failed';
  assert (select status='verifying' and execution_id='12345' from public.n8n_shadow_permits where id=permit);
  assert not public.note_keyword_shadow_execution(permit,'23456'),'execution checkpoint replaced';
  assert public.finish_keyword_shadow_dispatch(permit,'uncertain','12345',null);
  assert public.claim_keyword_shadow_dispatch(req) is null,'uncertain dispatch refunded';
  assert not public.consume_keyword_shadow_authority(authority),'uncertain authority replayed';
  denied:=false; begin update public.n8n_shadow_permits set status='reserved' where id=permit; exception when check_violation then denied:=true; end;
  assert denied,'permit was rearmed';
  denied:=false; begin update public.n8n_shadow_permits p set status='verified',contract=p.contract||'{"workflowVersion":"other"}'::jsonb where id=permit; exception when check_violation then denied:=true; end;
  assert denied,'permit revision rebound';
  denied:=false; begin perform public.finish_keyword_shadow_dispatch(permit,'verified','12345','{}'); exception when check_violation then denied:=true; end;
  assert denied,'unverified result accepted';
  declare rid2 uuid:=gen_random_uuid(); begin
    insert into public.routine_runs(id,account_id,routine_id,version,mode,status,spec_hash) values(rid2,acct,'D03-W01',1,'dry_run','running','synthetic-hash');
    denied:=false;
    begin
      insert into public.n8n_shadow_permits(account_id,context_generation,run_id,registration_id,authorized_by,idempotency_key,spec_hash,spec,contract,receiver_url,expires_at)
      values(acct,0,rid2,wid,actor,'approved-batch-market','synthetic-hash',spec,contract,receiver,clock_timestamp()+interval '5 minutes');
    exception when unique_violation then denied:=true; end;
    assert denied,'another run reused the same approved market allowance';
    insert into public.n8n_shadow_permits(account_id,context_generation,run_id,registration_id,authorized_by,idempotency_key,spec_hash,spec,contract,receiver_url,expires_at)
      values(acct,0,rid2,wid,actor,'expiry-check','synthetic-hash',spec,contract,receiver,clock_timestamp()+interval '100 milliseconds');
    perform pg_sleep(0.15);
    denied:=false; begin perform public.claim_keyword_shadow_dispatch(req||jsonb_build_object('runId',rid2)); exception when serialization_failure then denied:=true; end;
    assert denied,'expired permit dispatched';
  end;
  update public.accounts set context_generation=1,automation_paused=true where id=acct;
  saved:=jsonb_build_object('kind','artifact','artifact',jsonb_build_object('meta',jsonb_build_object('executionReceipt',
    jsonb_build_object('revisionEvidence','verified_execution_record','executionId','12345','workflowVersion','synthetic-revision','accountId',acct,'runId',rid))));
  assert public.finish_keyword_shadow_dispatch(permit,'verified','12345',saved),'late observation not retained';
  assert (select context_generation=0 and status='verified' and result=saved from public.n8n_shadow_permits where id=permit),'evidence rebased after reset';
  assert not public.finish_keyword_shadow_dispatch(permit,'uncertain',null,null),'verified evidence overwritten';
  assert (select count(*)=0 from public.artifacts where account_id=acct),'canary projected business result';
  assert not has_table_privilege('authenticated','public.n8n_shadow_permits','SELECT');
  assert not has_table_privilege('service_role','public.n8n_shadow_permits','DELETE');
  assert not has_function_privilege('anon','public.claim_keyword_shadow_dispatch(jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.consume_keyword_shadow_authority(jsonb)','EXECUTE');
end $$;
reset role;
select 'PASS: keyword permit identity, pause, spec/registration/owner revocation, one-use dispatch/authority, uncertainty, archived receipt and grants' as canary;
