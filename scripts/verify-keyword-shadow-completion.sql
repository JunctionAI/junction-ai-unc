-- Rollback-only synthetic tenant. Never run without BEGIN / ROLLBACK.
set local role service_role;
do $$
declare acct uuid:=gen_random_uuid(); actor uuid; rid uuid:=gen_random_uuid(); wid uuid:=gen_random_uuid(); permit uuid;
  contract jsonb; spec jsonb; req jsonb; snap jsonb; ctx jsonb; receipt jsonb; draft jsonb; art jsonb; packet jsonb; bad jsonb; returned jsonb;
  art_id uuid:=gen_random_uuid(); first_receipt uuid:=gen_random_uuid(); gate_receipt uuid:=gen_random_uuid(); last_receipt uuid:=gen_random_uuid();
  started timestamptz; completed timestamptz:=clock_timestamp(); denied boolean;
  receiver text:='https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow';
begin
  select user_id into actor from public.account_members where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null;
  insert into public.accounts(id,name) values(acct,'UNC_KEYWORD_COMPLETION_CANARY');
  insert into public.account_members(account_id,user_id,role) values(acct,actor,'owner');
  contract:=jsonb_build_object('contract','unc.keyword-shadow.v1','accountId',acct,'routineId','D03-W01',
    'routineKey','keyword_opportunity','workflowId','synthetic-wrapper','workflowVersion','synthetic-revision');
  spec:=jsonb_build_object('id','D03-W01','version',1,'nodes',jsonb_build_array(
    jsonb_build_object('id','trigger','kind','trigger','cadence','manual'),jsonb_build_object('id','keyword','kind','n8n','shadowContract',contract),
    jsonb_build_object('id','review','kind','gate','title','Synthetic draft review'),jsonb_build_object('id','receipt','kind','receipt','summary','Synthetic draft ready')));
  insert into public.routine_states(account_id,routine_id,version,draft_spec) values(acct,'D03-W01',1,spec);
  insert into public.routine_runs(id,account_id,routine_id,version,mode,status,spec_hash)
    values(rid,acct,'D03-W01',1,'dry_run','running','synthetic-hash') returning started_at into started;
  ctx:=jsonb_build_object('runId',rid,'routineId','D03-W01','version',1,'mode','dry_run','startedAt',started,
    'account',jsonb_build_object('accountId',acct,'contextGeneration',0),'reads','{}'::jsonb,'checks','{}'::jsonb);
  snap:=jsonb_build_object('spec',spec,'ctx',ctx,'nextNodeIndex',2,'awaiting','keyword_shadow');
  update public.routine_runs set snapshot=snap where id=rid;
  insert into public.n8n_workflows(id,account_id,routine_id,webhook_url,active) values(wid,acct,'D03-W01',receiver,true);
  insert into public.n8n_shadow_permits(account_id,context_generation,run_id,registration_id,authorized_by,idempotency_key,
    spec_hash,spec,contract,receiver_url,expires_at)
    values(acct,0,rid,wid,actor,'approved-completion-canary','synthetic-hash',spec,contract,receiver,clock_timestamp()+interval '5 minutes') returning id into permit;
  req:=jsonb_build_object('accountId',acct,'contextGeneration',0,'runId',rid,'registrationId',wid,'contract',contract,
    'receiverUrl',receiver,'requestDigest',repeat('a',64),'tokenDigest',repeat('b',64),'specHash','synthetic-hash');
  assert public.claim_keyword_shadow_dispatch(req)=permit;
  assert public.consume_keyword_shadow_authority(req);
  assert public.note_keyword_shadow_execution(permit,'12345');
  receipt:=contract||jsonb_build_object('runId',rid,'executionId','12345','revisionEvidence','verified_execution_record','mode','dry_run','executedAction','none',
    'revisionVerification',jsonb_build_object('source','n8n_execution_record','requestDigest',repeat('a',64)));
  draft:=jsonb_build_object('kind','keyword_list','title','Synthetic keywords','body','Synthetic only.','items',jsonb_build_array(jsonb_build_object('title','test keyword','body','Synthetic only.')),
    'evidence','[]'::jsonb,'meta',jsonb_build_object('executionReceipt',receipt,'approval_status','pending_approval','executed_action','none'));
  art:=draft||jsonb_build_object('id',art_id,'accountId',acct,'runId',rid,'routineId','D03-W01','status','draft','createdAt',completed,
    'meta',(draft->'meta')||jsonb_build_object('via','n8n','node','keyword','mode','dry_run'));
  packet:=jsonb_build_object('snapshot',snap,'result',jsonb_build_object('runId',rid,'routineId','D03-W01','version',1,'mode','dry_run','status','done','summary','Synthetic draft ready','artifact',art,
    'receipts',jsonb_build_array(
      jsonb_build_object('id',first_receipt,'accountId',acct,'runId',rid,'kind','draft','description','Synthetic draft stored','createdAt',completed,'payload',jsonb_build_object('node','keyword','artifactId',art_id,'externalExecution',receipt)),
      jsonb_build_object('id',gate_receipt,'accountId',acct,'runId',rid,'kind','draft','description','Would ask owner to review','createdAt',completed,'payload',jsonb_build_object('node','review','approvalPreview',jsonb_build_object('title','Synthetic draft review'))),
      jsonb_build_object('id',last_receipt,'accountId',acct,'runId',rid,'kind','draft','description','Synthetic draft ready','createdAt',completed,'payload',jsonb_build_object('node','receipt','artifactId',art_id,'executed',false))
    )));
  assert public.commit_keyword_shadow_completion(acct,0,rid,null) is null;
  denied:=false; begin perform public.commit_keyword_shadow_completion(acct,0,rid,packet); exception when check_violation then denied:=true; end;
  assert denied,'unverified result projected';
  assert public.finish_keyword_shadow_dispatch(permit,'verified','12345',jsonb_build_object('kind','artifact','artifact',draft));
  for bad in select * from (values
    (jsonb_set(packet,'{result,artifact,accountId}',to_jsonb(gen_random_uuid()))),
    (jsonb_set(packet,'{result,artifact,body}','"replaced result"'::jsonb)),
    (jsonb_set(packet,'{snapshot,ctx,runId}',to_jsonb(gen_random_uuid()))),
    (jsonb_set(packet,'{result,receipts,1,kind}','"mutation"'::jsonb)),
    (jsonb_set(packet,'{result,receipts,2,payload,executed}','true'::jsonb)),
    (jsonb_set(packet,'{result,receipts,1,runId}',to_jsonb(gen_random_uuid()))),
    (jsonb_set(packet,'{result,artifact,createdAt}',to_jsonb(completed-interval '1 hour')))
  ) invalid(value) loop
    denied:=false; begin perform public.commit_keyword_shadow_completion(acct,0,rid,bad); exception when check_violation then denied:=true; end;
    assert denied,'invalid completion admitted';
    assert (select count(*)=0 from public.artifacts where account_id=acct),'invalid completion wrote artifact';
  end loop;
  -- Fail AFTER the artifact and first receipt insert: the whole transaction must roll back.
  bad:=jsonb_set(packet,'{result,receipts,1,id}',to_jsonb(first_receipt));
  denied:=false; begin perform public.commit_keyword_shadow_completion(acct,0,rid,bad); exception when unique_violation then denied:=true; end;
  assert denied,'duplicate receipt did not fail';
  assert (select count(*)=0 from public.artifacts where account_id=acct),'partial artifact survived failure';
  assert (select count(*)=0 from public.receipts where account_id=acct),'partial receipt survived failure';
  assert (select status='running' and snapshot=snap from public.routine_runs where id=rid),'continuation lost after failed transaction';
  assert (select count(*)=0 from public.n8n_shadow_completions where run_id=rid),'failed completion key survived';
  update public.accounts set automation_paused=true where id=acct;
  denied:=false; begin perform public.commit_keyword_shadow_completion(acct,0,rid,packet); exception when object_not_in_prerequisite_state then denied:=true; end;
  assert denied,'paused account accepted customer projection';
  update public.accounts set automation_paused=false where id=acct;
  update public.account_members set role='member' where account_id=acct and user_id=actor;
  denied:=false; begin perform public.commit_keyword_shadow_completion(acct,0,rid,packet); exception when insufficient_privilege then denied:=true; end;
  assert denied,'demoted owner accepted projection';
  update public.account_members set role='owner' where account_id=acct and user_id=actor;
  returned:=public.commit_keyword_shadow_completion(acct,0,rid,packet);
  assert returned=packet->'result';
  assert public.commit_keyword_shadow_completion(acct,0,rid,null)=returned,'readback changed result';
  assert public.commit_keyword_shadow_completion(acct,0,rid,jsonb_set(packet,'{result,artifact,id}',to_jsonb(gen_random_uuid())))=returned,'retry replaced original artifact';
  assert (select count(*)=1 from public.artifacts where account_id=acct);
  assert (select count(*)=3 from public.receipts where account_id=acct);
  assert (select count(*)=1 from public.n8n_shadow_completions where run_id=rid);
  assert (select status='done' and snapshot is null from public.routine_runs where id=rid);
  assert (select count(*)=0 from public.approvals where account_id=acct),'dry review created live approval';
  update public.accounts set context_generation=1 where id=acct;
  denied:=false; begin perform public.commit_keyword_shadow_completion(acct,0,rid,null); exception when serialization_failure then denied:=true; end;
  assert denied,'old result escaped into replacement account';
  assert (select context_generation=0 from public.n8n_shadow_completions where run_id=rid);
  assert not has_table_privilege('authenticated','public.n8n_shadow_completions','SELECT');
  assert not has_table_privilege('service_role','public.n8n_shadow_completions','UPDATE');
  assert not has_function_privilege('anon','public.commit_keyword_shadow_completion(uuid,bigint,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.commit_keyword_shadow_completion(uuid,bigint,uuid,jsonb)','EXECUTE');
end $$;
reset role;
select 'PASS: keyword artifact/review/receipt/run atomic completion, rollback after partial write, private grants, identity/pause/owner checks and idempotent readback' as canary;
