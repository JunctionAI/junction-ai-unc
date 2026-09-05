-- Run only inside BEGIN / migration rehearsal / ROLLBACK. No provider calls.
set local role service_role;
do $$
declare acct uuid:=gen_random_uuid(); actor uuid; rid uuid:=gen_random_uuid(); wid uuid:=gen_random_uuid(); permit uuid;
  contract jsonb; spec jsonb; req jsonb; receipt jsonb; checkpoint jsonb; saved jsonb; denied boolean; original_start timestamptz;
  receiver text:='https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow';
begin
  select user_id into actor from public.account_members where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null;
  insert into public.accounts(id,name) values(acct,'UNC_KEYWORD_RECOVERY_CANARY');
  insert into public.account_members(account_id,user_id,role) values(acct,actor,'owner');
  contract:=jsonb_build_object('contract','unc.keyword-shadow.v1','accountId',acct,'routineId','D03-W01',
    'routineKey','keyword_opportunity','workflowId','synthetic-wrapper','workflowVersion','synthetic-revision',
    'client',jsonb_build_object('id','avgar','primaryDomain','example.com','seedKeyword','test keyword','locationCode',2840,'languageCode','en'));
  spec:=jsonb_build_object('id','D03-W01','version',1,'nodes',jsonb_build_array(
    jsonb_build_object('kind','trigger','cadence','manual'),jsonb_build_object('kind','n8n','shadowContract',contract)));
  insert into public.routine_states(account_id,routine_id,version,draft_spec) values(acct,'D03-W01',1,spec);
  insert into public.routine_runs(id,account_id,routine_id,version,mode,status,spec_hash)
    values(rid,acct,'D03-W01',1,'dry_run','running','synthetic-hash') returning started_at into original_start;
  insert into public.n8n_workflows(id,account_id,routine_id,webhook_url,active) values(wid,acct,'D03-W01',receiver,true);
  insert into public.n8n_shadow_permits(account_id,context_generation,run_id,registration_id,authorized_by,idempotency_key,
    spec_hash,spec,contract,receiver_url,expires_at)
    values(acct,0,rid,wid,actor,'approved-recovery-canary','synthetic-hash',spec,contract,receiver,clock_timestamp()+interval '5 minutes') returning id into permit;
  req:=jsonb_build_object('accountId',acct,'contextGeneration',0,'runId',rid,'registrationId',wid,'contract',contract,
    'receiverUrl',receiver,'requestDigest',repeat('a',64),'tokenDigest',repeat('b',64),'specHash','synthetic-hash');
  receipt:=contract||jsonb_build_object('runId',rid,'executionId','12345','workflowVersion',null,'revisionEvidence','pending_unc_verification',
    'mode','dry_run','status','succeeded','executedAction','none','startedAt',original_start,'finishedAt',clock_timestamp(),
    'provider',jsonb_build_object('name','dataforseo','statusCode',20000,'taskStatusCode',20000,'taskId','synthetic-task','itemsCount',1,'fetchedAt',clock_timestamp()));
  checkpoint:=jsonb_build_object('executionReceipt',receipt,'artifact',jsonb_build_object('kind','keyword_list','title','Synthetic keywords',
    'body','Only a synthetic rollback test.','items',jsonb_build_array(jsonb_build_object('title','test keyword','body','Synthetic only.')),'meta','{}'::jsonb));
  assert not public.checkpoint_keyword_shadow_result(permit,'12345',checkpoint),'checkpoint admitted before dispatch';
  assert public.claim_keyword_shadow_dispatch(req)=permit;
  assert not public.checkpoint_keyword_shadow_result(permit,'12345',checkpoint),'checkpoint admitted before authority';
  assert public.consume_keyword_shadow_authority(req);
  for saved in select * from (values
    (jsonb_set(checkpoint,'{executionReceipt,accountId}',to_jsonb(gen_random_uuid()))),
    (jsonb_set(checkpoint,'{executionReceipt,runId}',to_jsonb(gen_random_uuid()))),
    (jsonb_set(checkpoint,'{executionReceipt,workflowVersion}','"echoed-revision"'::jsonb)),
    (jsonb_set(checkpoint,'{executionReceipt,executionId}','"999"'::jsonb)),
    (checkpoint||'{"headers":{"authorization":"synthetic-must-not-persist"}}'::jsonb),
    (jsonb_set(checkpoint,'{artifact,body}',to_jsonb(repeat('x',256000))))
  ) bad(value) loop
    denied:=false; begin perform public.checkpoint_keyword_shadow_result(permit,'12345',saved); exception when check_violation then denied:=true; end;
    assert denied,'invalid checkpoint accepted';
    assert (select status='provider_authorized' and execution_id is null from public.n8n_shadow_permits where id=permit),'partial permit checkpoint';
    assert (select count(*)=0 from public.n8n_shadow_candidates where permit_id=permit),'partial response checkpoint';
  end loop;
  -- A response already in flight may be retained after a reset, never projected.
  update public.accounts set context_generation=1,automation_paused=true where id=acct;
  assert public.checkpoint_keyword_shadow_result(permit,'12345',checkpoint);
  assert (select account_id=acct and context_generation=0 and run_id=rid and run_started_at=original_start and execution_id='12345'
    and c.candidate=checkpoint from public.n8n_shadow_candidates c where permit_id=permit),'checkpoint lost original identity';
  assert not public.checkpoint_keyword_shadow_result(permit,'12345',checkpoint),'duplicate checkpoint accepted';
  assert not public.checkpoint_keyword_shadow_result(permit,'999',checkpoint),'replacement execution accepted';
  denied:=false; begin update public.n8n_shadow_candidates set execution_id='999' where permit_id=permit; exception when insufficient_privilege then denied:=true; end;
  assert denied,'service role rewrote immutable response';
  assert public.finish_keyword_shadow_dispatch(permit,'uncertain','12345',null);
  assert (select c.candidate=checkpoint from public.n8n_shadow_candidates c where permit_id=permit),'uncertainty erased checkpoint';
  saved:=jsonb_build_object('kind','artifact','artifact',(checkpoint->'artifact')||jsonb_build_object('meta',jsonb_build_object('executionReceipt',
    receipt||jsonb_build_object('workflowVersion','synthetic-revision','revisionEvidence','verified_execution_record',
      'revisionVerification',jsonb_build_object('source','n8n_execution_record','method','historical_reconciliation','requestDigest',repeat('a',64))))));
  assert public.finish_keyword_shadow_dispatch(permit,'verified','12345',saved);
  assert not public.finish_keyword_shadow_dispatch(permit,'verified','12345',saved),'verified outcome replaced';
  assert (select status='verified' and context_generation=0 from public.n8n_shadow_permits where id=permit);
  assert (select count(*)=0 from public.artifacts where account_id=acct),'recovery projected customer artifact';
  assert (select count(*)=0 from public.receipts where account_id=acct),'recovery projected customer receipt';
  assert (select status='running' from public.routine_runs where id=rid),'recovery completed the engine without its continuation';
  assert not has_table_privilege('anon','public.n8n_shadow_candidates','SELECT');
  assert not has_table_privilege('authenticated','public.n8n_shadow_candidates','SELECT');
  assert not has_table_privilege('service_role','public.n8n_shadow_candidates','DELETE');
  assert not has_function_privilege('authenticated','public.checkpoint_keyword_shadow_result(uuid,text,jsonb)','EXECUTE');
end $$;
reset role;
select 'PASS: atomic original response checkpoint, no premature/invalid/repeated admission, archived recovery after reset, original identity and private grants' as canary;
