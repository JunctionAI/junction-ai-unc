-- Run after the FIVE staged channel/chat/outbox/command migrations in ONE transaction.
-- Synthetic accounts only; rollback. No provider calls or auth-user writes.
set local role service_role;
do $$
declare a uuid:=gen_random_uuid(); actor uuid; lid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid();
  b jsonb; prepared jsonb; old_oid uuid; fresh_oid uuid; owner_oid uuid; result jsonb; attempt uuid:=gen_random_uuid(); denied boolean;
begin
  select user_id into actor from public.account_members where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null,'requires referenced owner, never writes auth.users';
  insert into public.accounts(id,name) values(a,'UNC_COMMAND_DELIVERY_CANARY');
  insert into public.account_members(account_id,user_id,role) values(a,actor,'owner');
  insert into public.channel_links(id,account_id,user_id,channel,external_id,verified_at,meta)
    values(lid,a,actor,'slack','delivery-canary-'||a,clock_timestamp(),'{"team_id":"canary-workspace"}');
  b:=jsonb_build_object('version',1,'kind','linked','accountId',a,'contextGeneration',0,'linkId',lid,'bindingVersion',0,
    'userId',actor,'channel','slack','externalId','delivery-canary-'||a,'scopeId','canary-workspace');
  denied:=false;
  begin
    insert into public.routine_commands(id,account_id,user_id,channel,link_id,request_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply)
      values(gen_random_uuid(),a,actor,'slack',lid,'unbound','h','D01-W01','s','w',1,'unbound','queued','queued');
  exception when check_violation then denied:=true; end;
  assert denied,'new command missing original binding accepted';
  insert into public.routine_commands(id,account_id,user_id,channel,link_id,channel_binding,request_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply)
    values(cid,a,actor,'slack',lid,b,'original','h','D01-W01','s','w',1,'original request','queued','queued');
  assert public.prepare_command_notification(cid,0) is null,'queued command notified before result';
  update public.routine_commands set status='waiting',reply='Needs input' where id=cid;
  assert (select notification_revision=1 from public.routine_commands where id=cid),'result revision not advanced';
  update public.routine_commands set updated_at=clock_timestamp(),reply='Needs input' where id=cid;
  assert (select notification_revision=1 from public.routine_commands where id=cid),'unchanged result invented revision';
  prepared:=public.prepare_command_notification(cid,1);
  old_oid:=(prepared->'operation'->>'id')::uuid;
  assert old_oid is not null and prepared->'operation'->>'body'='Needs input Request '||left(cid::text,8)||'.','wrong notification payload';
  assert (public.prepare_command_notification(cid,1)->'operation'->>'id')::uuid=old_oid,'duplicate preparation created second intent';
  assert (select notification_status<>'sent' from public.routine_commands where id=cid),'queue claimed sent';
  assert exists(select 1 from public.list_current_routine_commands(null,100,true) where id=cid),'unsent queue not resumable';
  update public.routine_commands set status='done',reply='Draft ready' where id=cid;
  assert (select notification_revision=2 from public.routine_commands where id=cid);
  assert public.prepare_command_notification(cid,1) is null,'stale polling snapshot prepared new content';
  result:=public.claim_channel_outbound(old_oid,gen_random_uuid());
  assert result->>'claimed'='false' and result->'row'->>'status'='cancelled'
    and result->'row'->>'attempt_id' is null,'superseded notification could send';
  prepared:=public.prepare_command_notification(cid,2);
  fresh_oid:=(prepared->'operation'->>'id')::uuid;
  assert fresh_oid is not null and fresh_oid<>old_oid,'new result collided with old notification';
  result:=public.claim_channel_outbound(fresh_oid,attempt);
  assert result->>'claimed'='true','current result not claimable';
  assert public.claim_channel_outbound(fresh_oid,gen_random_uuid())->>'claimed'='false','second worker got same attempt';
  assert not exists(select 1 from public.list_current_routine_commands(null,100,true) where id=cid),'sending notification was re-polled';
  perform public.finish_channel_outbound(fresh_oid,attempt,'uncertain');
  assert not exists(select 1 from public.list_current_routine_commands(null,100,true) where id=cid),'uncertain message auto-retried';
  perform public.finish_channel_outbound(fresh_oid,attempt,'sent','real-id-fixture');
  perform public.project_channel_outbound(fresh_oid);
  assert (select count(*)=1 from public.chat_messages where account_id=a),'confirmed message not projected once';

  denied:=false;
  begin update public.routine_commands set channel_binding=b||'{"bindingVersion":99}' where id=cid;
  exception when check_violation then denied:=true; end;
  assert denied,'accepted command rebound';
  denied:=false;
  begin update public.routine_commands set notification_revision=999 where id=cid;
  exception when check_violation then denied:=true; end;
  assert denied,'caller minted a notification revision';
  update public.routine_commands set reply='A revised result' where id=cid;
  prepared:=public.prepare_command_notification(cid,3);
  owner_oid:=(prepared->'operation'->>'id')::uuid;
  update public.account_members set role='member' where account_id=a and user_id=actor;
  result:=public.claim_channel_outbound(owner_oid,gen_random_uuid());
  assert result->>'claimed'='false' and result->'row'->>'status'='cancelled','owner demotion allowed command notification';
  assert not exists(select 1 from public.list_current_routine_commands(null,100,true) where id=cid),'demoted owner remained notification candidate';
  update public.account_members set role='owner' where account_id=a and user_id=actor;

  update public.routine_commands set reply='Last original result' where id=cid;
  prepared:=public.prepare_command_notification(cid,4);
  fresh_oid:=(prepared->'operation'->>'id')::uuid; attempt:=gen_random_uuid();
  perform public.claim_channel_outbound(fresh_oid,attempt);
  update public.accounts set context_generation=1,automation_paused=true where id=a;
  perform public.finish_channel_outbound(fresh_oid,attempt,'sent','accepted-across-reset');
  assert public.project_channel_outbound(fresh_oid) is null,'new context received an old notification';
  delete from public.channel_links where id=lid;
  assert (select link_id is null and channel_binding=b and notification_revision=4 from public.routine_commands where id=cid),'unlink erased original command identity';
  assert (select captured_link_id=lid and link_id is null and external_msg_id='accepted-across-reset' from public.outbound_messages where id=fresh_oid),'unlink erased delivery evidence';
  assert not exists(select 1 from public.list_current_routine_commands(null,100,true) where id=cid),'old command re-notified';
  assert not has_function_privilege('anon','public.prepare_command_notification(uuid,bigint)','EXECUTE');
  assert not has_function_privilege('authenticated','public.prepare_command_notification(uuid,bigint)','EXECUTE');
  assert not has_table_privilege('authenticated','public.routine_commands','UPDATE');
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.proname in ('guard_command_delivery_identity','guard_command_outbound_source','prepare_command_notification','list_current_routine_commands') and p.prosecdef);
end $$;
reset role;
set local role authenticated;
do $$ declare denied boolean:=false; begin
  begin perform public.prepare_command_notification(gen_random_uuid(),1); exception when insufficient_privilege then denied:=true; end;
  assert denied,'client notification RPC allowed';
end $$;
reset role;
select 'PASS: original command binding; database-owned result revisions; idempotent intent; current source/owner at claim; no queued/uncertain false success; reset/unlink receipt preservation; private RPCs' as command_delivery_canary;
