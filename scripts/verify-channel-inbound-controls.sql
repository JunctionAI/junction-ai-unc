-- Apply both staged channel migrations within the SAME rollback-only rehearsal first.
-- Synthetic DB controls only: no providers, messages, models, workers or n8n calls.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
-- Transaction-local delay probe: simulates a slow prior-destination delete inside transfer.
-- It is not simultaneous-session contention proof. The entire function/trigger rolls back.
create function unc_private.channel_control_canary_delay()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.external_id='control-expire-transfer' then perform pg_sleep(0.4); end if;
  return old;
end;
$$;
revoke all on function unc_private.channel_control_canary_delay() from public,anon,authenticated;
create trigger channel_control_canary_delay before delete on public.channel_links
  for each row execute function unc_private.channel_control_canary_delay();
set local role service_role;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); owner_id uuid;
  previous_id uuid:=gen_random_uuid(); pending_id uuid:=gen_random_uuid(); apple_id uuid:=gen_random_uuid();
  saved jsonb; result jsonb; initial_binding jsonb; again jsonb; denied boolean;
begin
  assert not exists(select 1 from public.channel_inbox), 'inbox is not empty: use an isolated rehearsal database';
  select user_id into owner_id from public.account_members order by account_id limit 1;
  assert owner_id is not null, 'requires a referenced existing auth user; none is created or changed';
  insert into public.accounts(id,name) values(a,'UNC_INBOUND_CONTROL_CANARY'),(b,'UNC_INBOUND_CONTROL_CANARY_OTHER');
  insert into public.account_members(account_id,user_id,role) values(a,owner_id,'owner'),(b,owner_id,'owner');
  insert into public.channel_links(id,account_id,user_id,channel,external_id,verified_at)
    values(previous_id,b,owner_id,'sms','control-device',clock_timestamp());
  saved:=public.accept_channel_inbound(repeat('1',64),jsonb_build_object('channel','sms','externalId','control-device','externalMsgId','old-stop','text','STOP'));
  assert saved->'binding'->>'linkId'=previous_id::text,'old STOP not captured';
  result:=public.verify_channel_inbound_binding(saved->'binding',saved->'event',false);
  assert result->>'id'=previous_id::text,'current verified connection failed preflight';
  update public.channel_inbox set status='running' where id=repeat('1',64);

  insert into public.channel_links(id,account_id,user_id,channel,link_code,link_code_generation,link_code_expires_at)
    values(pending_id,a,owner_id,'sms','UNC-ABC234',0,clock_timestamp()+interval '10 minutes');
  saved:=public.accept_channel_inbound(repeat('2',64),jsonb_build_object('channel','sms','externalId','control-device','externalMsgId','new-code','text','UNC-ABC234'));
  initial_binding:=saved->'binding';
  result:=public.verify_channel_inbound_binding(initial_binding,saved->'event',true);
  assert result->>'id'=pending_id::text,'current code failed preflight';
  denied:=false;
  begin perform public.apply_channel_inbound_control(repeat('2',64));
  exception when serialization_failure then denied:=true; end;
  assert denied,'unclaimed code was consumed';
  update public.channel_inbox set status='running' where id=repeat('2',64);
  result:=public.apply_channel_inbound_control(repeat('2',64));
  assert result->>'kind'='linked' and result->'link'->>'id'=pending_id::text
    and result->'link'->>'account_id'=a::text and result->'link'->>'binding_version'='1','captured transfer failed';
  assert not exists(select 1 from public.channel_links where id=previous_id),'old destination was not transferred';
  assert (select binding=initial_binding from public.channel_inbox where id=repeat('2',64)),'original arrival was rewritten';
  again:=public.apply_channel_inbound_control(repeat('2',64));
  assert again=result,'control retry did not return its immutable receipt';
  assert (select binding_version=1 from public.channel_links where id=pending_id),'idempotent control changed link twice';
  denied:=false;
  begin perform public.verify_channel_inbound_binding(initial_binding,saved->'event',true);
  exception when serialization_failure then denied:=true; end;
  assert denied,'preflight accepted a code binding after its connection changed';
  denied:=false;
  begin update public.channel_inbox set control_result='{}' where id=repeat('2',64);
  exception when check_violation then denied:=true; end;
  assert denied,'control receipt rewritten';

  denied:=false;
  begin perform public.apply_channel_inbound_control(repeat('1',64));
  exception when serialization_failure then denied:=true; end;
  assert denied,'old STOP acted on a replacement connection';
  assert exists(select 1 from public.channel_links where id=pending_id),'replacement connection deleted';

  saved:=public.accept_channel_inbound(repeat('3',64),jsonb_build_object('channel','sms','externalId','control-device','externalMsgId','before-reset','text','hello'));
  update public.channel_inbox set status='running' where id=repeat('3',64);
  update public.accounts set context_generation=1,automation_paused=true where id=a;
  denied:=false;
  begin perform public.verify_channel_inbound_binding(saved->'binding',saved->'event',true);
  exception when serialization_failure then denied:=true; end;
  assert denied,'preflight accepted a pre-reset generation';
  denied:=false;
  begin perform public.apply_channel_inbound_control(repeat('3',64));
  exception when serialization_failure then denied:=true; end;
  assert denied,'delayed message crossed account reset';
  saved:=public.accept_channel_inbound(repeat('4',64),jsonb_build_object('channel','sms','externalId','control-device','externalMsgId','paused-stop','text','STOP'));
  result:=public.verify_channel_inbound_binding(saved->'binding',saved->'event',true);
  assert result->>'id'=pending_id::text,'paused opt-out identity was unavailable';
  denied:=false;
  begin perform public.verify_channel_inbound_binding(saved->'binding',saved->'event',false);
  exception when raise_exception then denied:=SQLERRM='automation_paused'; end;
  assert denied,'normal automated work passed preflight while paused';
  denied:=false;
  begin perform public.verify_channel_inbound_binding(saved->'binding',saved->'event'||jsonb_build_object('accountScope',b),true);
  exception when serialization_failure then denied:=true; end;
  assert denied,'preflight crossed the pilot account scope';
  update public.channel_inbox set status='running' where id=repeat('4',64);
  result:=public.apply_channel_inbound_control(repeat('4',64));
  assert result->>'kind'='unsubscribed' and result->>'contextGeneration'='1','current STOP failed while paused';
  assert not exists(select 1 from public.channel_links where id=pending_id),'current opt-out left destination linked';

  insert into public.channel_links(id,account_id,user_id,channel,external_id,verified_at)
    values(apple_id,b,owner_id,'apple','control-apple',clock_timestamp());
  saved:=public.accept_channel_inbound(repeat('5',64),jsonb_build_object('channel','apple','externalId','control-apple','externalMsgId','handoff','text','human'));
  update public.channel_inbox set status='running' where id=repeat('5',64);
  result:=public.apply_channel_inbound_control(repeat('5',64));
  assert result->>'kind'='handoff' and result->'link'->'meta'->>'human_support_requested'='true'
    and result->'link'->>'binding_version'='1','handoff not atomically versioned';
  saved:=public.accept_channel_inbound(repeat('6',64),jsonb_build_object('channel','apple','externalId','control-apple','externalMsgId','revoked','text','hello'));
  update public.channel_inbox set status='running' where id=repeat('6',64);
  delete from public.account_members where account_id=b;
  denied:=false;
  begin perform public.verify_channel_inbound_binding(saved->'binding',saved->'event',true);
  exception when serialization_failure then denied:=true; end;
  assert denied,'preflight accepted revoked membership';
  denied:=false;
  begin perform public.apply_channel_inbound_control(repeat('6',64));
  exception when serialization_failure then denied:=true; end;
  assert denied,'revoked membership retained control authority';
  insert into public.account_members(account_id,user_id,role) values(b,owner_id,'owner');

  -- A code can expire while its already accepted message waits in the queue.
  insert into public.channel_links(account_id,user_id,channel,link_code,link_code_generation,link_code_expires_at)
    values(b,owner_id,'sms','UNC-EXP234',0,clock_timestamp()+interval '300 milliseconds');
  saved:=public.accept_channel_inbound(repeat('7',64),jsonb_build_object('channel','sms','externalId','expired-device','externalMsgId','expired','text','UNC-EXP234'));
  assert saved->'binding'->>'kind'='link_code','expiry fixture failed to capture before expiry';
  update public.channel_inbox set status='running' where id=repeat('7',64);
  perform pg_sleep(0.4);
  denied:=false;
  begin perform public.verify_channel_inbound_binding(saved->'binding',saved->'event',true);
  exception when serialization_failure then denied:=true; end;
  assert denied,'preflight accepted an expired queued code';
  denied:=false;
  begin perform public.apply_channel_inbound_control(repeat('7',64));
  exception when serialization_failure then denied:=true; end;
  assert denied,'code that expired in the queue was consumed';
  assert not exists(select 1 from public.channel_links where external_id='expired-device'),'expired device was verified';

  insert into public.channel_links(account_id,user_id,channel,external_id,verified_at)
    values(b,owner_id,'sms','control-expire-transfer',clock_timestamp());
  insert into public.channel_links(account_id,user_id,channel,link_code,link_code_generation,link_code_expires_at)
    values(a,owner_id,'sms','UNC-DLY234',1,clock_timestamp()+interval '300 milliseconds');
  saved:=public.accept_channel_inbound(repeat('8',64),jsonb_build_object('channel','sms','externalId','control-expire-transfer','externalMsgId','slow-transfer','text','UNC-DLY234'));
  assert saved->'binding'->>'kind'='link_code','slow-transfer code was not captured';
  update public.channel_inbox set status='running' where id=repeat('8',64);
  denied:=false;
  begin perform public.apply_channel_inbound_control(repeat('8',64));
  exception when serialization_failure then denied:=SQLERRM='Original verification code expired during transfer'; end;
  assert denied,'code expired during prior-destination deletion but was still consumed';
  assert exists(select 1 from public.channel_links where external_id='control-expire-transfer' and account_id=b),'failed transfer deleted the prior connection';
  assert exists(select 1 from public.channel_links where link_code='UNC-DLY234' and verified_at is null),'failed transfer verified the new connection';

  assert not has_function_privilege('anon','public.apply_channel_inbound_control(text)','EXECUTE'),'anonymous control access';
  assert not has_function_privilege('authenticated','public.apply_channel_inbound_control(text)','EXECUTE'),'client control access';
  assert not (select prosecdef from pg_proc where oid='public.apply_channel_inbound_control(text)'::regprocedure),'unexpected definer control';
  assert not has_function_privilege('anon','public.verify_channel_inbound_binding(jsonb,jsonb,boolean)','EXECUTE'),'anonymous verifier access';
  assert not has_function_privilege('authenticated','public.verify_channel_inbound_binding(jsonb,jsonb,boolean)','EXECUTE'),'client verifier access';
  assert has_function_privilege('service_role','public.verify_channel_inbound_binding(jsonb,jsonb,boolean)','EXECUTE'),'missing service verifier access';
  assert not (select prosecdef from pg_proc where oid='public.verify_channel_inbound_binding(jsonb,jsonb,boolean)'::regprocedure),'unexpected definer verifier';
end;
$$;
select 'PASS: atomic binding preflight; captured code transfer; immutable control receipt; stale STOP/reset/member/scope/expiry denial; paused opt-out and handoff' as channel_control_canary;
rollback;
