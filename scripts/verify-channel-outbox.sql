-- Apply all four staged channel/chat migrations in the SAME rollback transaction first.
-- Synthetic records only. No auth writes, provider calls, consumer, or real messages.
set local role service_role;
do $$
declare
  a uuid:=gen_random_uuid(); other_a uuid:=gen_random_uuid(); actor uuid; link_id uuid:=gen_random_uuid();
  wa uuid:=gen_random_uuid(); op jsonb; b jsonb; saved jsonb; first_claim jsonb; second_claim jsonb;
  oid uuid; attempt uuid:=gen_random_uuid(); denied boolean; chat_id uuid; stale_id uuid; sent_id uuid; interrupted uuid; maintenance jsonb;
begin
  select user_id into actor from public.account_members where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null, 'requires an existing referenced user; no auth user is modified';
  insert into public.accounts(id,name) values(a,'UNC_OUTBOX_CANARY'),(other_a,'UNC_OUTBOX_CANARY_OTHER');
  insert into public.account_members(account_id,user_id,role) values(a,actor,'owner');
  insert into public.channel_links(id,account_id,user_id,channel,external_id,verified_at)
    values(link_id,a,actor,'telegram','outbox-canary-'||a,clock_timestamp());
  b:=jsonb_build_object('version',1,'kind','linked','accountId',a,'contextGeneration',0,'linkId',link_id,
    'bindingVersion',0,'userId',actor,'channel','telegram','externalId','outbox-canary-'||a);
  op:=jsonb_build_object('binding',b,'kind','reply','ref','original-operation',
    'payload',jsonb_build_object('text','synthetic reply','buttons',jsonb_build_array(jsonb_build_object('id','btn','label','Review'))),
    'replyContext',jsonb_build_object('live',false,'inReplyTo','provider-inbound-1'),'appendThread',true,'allowTemplate',false,'allowPaused',false);
  saved:=public.enqueue_channel_outbound(op);
  oid:=(saved->>'id')::uuid;
  assert saved->>'status'='queued' and saved->>'attempt_id' is null,'intent not durable before claim';
  assert (public.enqueue_channel_outbound(op)->>'id')::uuid=oid,'enqueue was not idempotent';
  denied:=false;
  begin perform public.enqueue_channel_outbound(jsonb_set(op,'{payload,text}','"replacement"'));
  exception when check_violation then denied:=true; end;
  assert denied,'different payload reused operation';
  denied:=false;
  begin perform public.enqueue_channel_outbound(op||jsonb_build_object('allowTemplate',true));
  exception when check_violation then denied:=true; end;
  assert denied,'delivery options changed';
  denied:=false;
  begin perform public.enqueue_channel_outbound(jsonb_set(op,'{binding,accountId}',to_jsonb(other_a)));
  exception when serialization_failure then denied:=true; end;
  assert denied,'other tenant accepted';
  denied:=false;
  begin insert into public.outbound_messages(account_id,channel,kind,body,status) values(a,'sms','reply','unbound','queued');
  exception when check_violation then denied:=true; end;
  assert denied,'new unbound send was accepted';
  denied:=false;
  begin update public.outbound_messages set body='modified' where id=oid;
  exception when check_violation then denied:=true; end;
  assert denied,'stored content was mutable';

  first_claim:=public.claim_channel_outbound(oid,attempt);
  assert first_claim->>'claimed'='true' and first_claim->'row'->>'attempt_id'=attempt::text,'first claim missing';
  assert first_claim->'row'->'payload'->'buttons'=op->'payload'->'buttons','buttons lost';
  second_claim:=public.claim_channel_outbound(oid,gen_random_uuid());
  assert second_claim->>'claimed'='false' and second_claim->'row'->>'attempt_id'=attempt::text,'second claim stole attempt';
  denied:=false;
  begin perform public.finish_channel_outbound(oid,gen_random_uuid(),'sent','fake');
  exception when serialization_failure then denied:=true; end;
  assert denied,'wrong attempt finalized';
  perform public.finish_channel_outbound(oid,attempt,'uncertain',null);
  assert public.claim_channel_outbound(oid,gen_random_uuid())->>'claimed'='false','uncertain attempt retried';
  assert public.project_channel_outbound(oid) is null,'uncertainty projected as sent';
  perform public.finish_channel_outbound(oid,attempt,'sent','readback-original');
  maintenance:=public.maintain_channel_outbound(50);
  assert maintenance->>'projected'='1','missed conversation projection not recovered';
  chat_id:=public.project_channel_outbound(oid);
  assert chat_id is not null and public.project_channel_outbound(oid)=chat_id,'confirmed projection not idempotent';
  assert (select delivery->>'live'='false' and delivery->>'in_reply_to'='provider-inbound-1'
    and delivery->>'provider_message_id'='readback-original' from public.chat_messages where id=chat_id),'reply/receipt metadata lost';
  perform public.finish_channel_outbound(oid,attempt,'sent','readback-original');
  denied:=false;
  begin perform public.finish_channel_outbound(oid,attempt,'sent','conflicting');
  exception when check_violation then denied:=true; end;
  assert denied,'confirmed receipt rewritten';
  denied:=false;
  begin update public.outbound_messages set status='queued',attempt_id=null where id=oid;
  exception when check_violation then denied:=true; end;
  assert denied,'terminal operation reset';

  saved:=public.enqueue_channel_outbound(op||jsonb_build_object('ref','interrupted-claim'));
  interrupted:=(saved->>'id')::uuid;
  -- Synthetic initial claim at an earlier instant. Never rewrite an existing attempt.
  update public.outbound_messages set status='sending',attempt_id=gen_random_uuid(),send_started_at=clock_timestamp()-interval '3 minutes' where id=interrupted;
  insert into public.outbound_messages(account_id,context_generation,link_id,captured_link_id,binding_version,binding,channel,kind,ref,body,payload,status,created_at)
    select o.account_id,o.context_generation,o.link_id,o.captured_link_id,o.binding_version,o.binding,o.channel,o.kind,
      'expired-queue',o.body,o.payload,'queued',clock_timestamp()-interval '49 hours' from public.outbound_messages o where o.id=oid;
  maintenance:=public.maintain_channel_outbound(50);
  assert maintenance->>'uncertain'='1' and maintenance->>'expired'='1','bounded interrupted/expiry maintenance failed';
  assert (select status='uncertain' from public.outbound_messages where id=interrupted),'crashed attempt still sending';
  assert public.claim_channel_outbound(interrupted,gen_random_uuid())->>'claimed'='false','maintenance retried uncertain call';

  -- Queue only holds the captured operation. Opening the window preserves the payload.
  insert into public.channel_links(id,account_id,user_id,channel,external_id,verified_at)
    values(wa,a,actor,'whatsapp','wa-canary-'||a,clock_timestamp());
  b:=b||jsonb_build_object('linkId',wa,'channel','whatsapp','externalId','wa-canary-'||a);
  saved:=public.enqueue_channel_outbound(op||jsonb_build_object('binding',b));
  oid:=(saved->>'id')::uuid;
  assert public.claim_channel_outbound(oid,gen_random_uuid())->'row'->>'status'='queued','closed WhatsApp window sent';
  update public.channel_links set last_inbound_at=clock_timestamp() where id=wa;
  attempt:=gen_random_uuid();
  first_claim:=public.claim_channel_outbound(oid,attempt);
  assert first_claim->>'claimed'='true' and first_claim->>'template'='false','opened window failed';
  perform public.finish_channel_outbound(oid,attempt,'sent','wa-accepted');
  assert public.project_channel_outbound(oid)=chat_id,'cross-channel copies duplicated conversation';

  saved:=public.enqueue_channel_outbound(op||jsonb_build_object('ref','stale-rebind'));
  stale_id:=(saved->>'id')::uuid;
  update public.channel_links set external_id='replacement-'||a where id=link_id;
  first_claim:=public.claim_channel_outbound(stale_id,gen_random_uuid());
  assert first_claim->>'claimed'='false' and first_claim->'row'->>'status'='cancelled','reassigned destination claimed';
  update public.channel_links set external_id='outbox-canary-'||a where id=link_id;
  -- ABA reassignment retains a higher binding version, never the original one.
  denied:=false;
  begin perform public.enqueue_channel_outbound(op||jsonb_build_object('ref','after-aba'));
  exception when serialization_failure then denied:=true; end;
  assert denied,'ABA reassignment bypassed binding version';
  op:=jsonb_set(op,'{binding,bindingVersion}',to_jsonb((select binding_version from public.channel_links where id=link_id)));

  saved:=public.enqueue_channel_outbound(op||jsonb_build_object('ref','send-before-reset'));
  sent_id:=(saved->>'id')::uuid;
  attempt:=gen_random_uuid();
  perform public.claim_channel_outbound(sent_id,attempt);
  saved:=public.enqueue_channel_outbound(op||jsonb_build_object('ref','queued-before-reset'));
  stale_id:=(saved->>'id')::uuid;
  update public.accounts set context_generation=1,automation_paused=true where id=a;
  perform public.finish_channel_outbound(sent_id,attempt,'sent','accepted-during-reset');
  assert (select status='sent' and context_generation=0 and external_msg_id='accepted-during-reset' from public.outbound_messages where id=sent_id),'reset erased original delivery fact';
  assert public.project_channel_outbound(sent_id) is null,'old send entered current conversation';
  assert public.claim_channel_outbound(stale_id,gen_random_uuid())->'row'->>'status'='cancelled','old queue escaped reset';
  assert not exists(select 1 from public.chat_messages where account_id=a and context_generation=1),'new context contaminated';
  denied:=false;
  begin perform public.enqueue_channel_outbound(jsonb_set(op,'{binding,contextGeneration}','1')||jsonb_build_object('ref','current-but-paused'));
  exception when raise_exception then
    assert sqlerrm='automation_paused','unexpected pause denial'; denied:=true;
  end;
  assert denied,'fresh generation bypassed account pause';
  delete from public.channel_links where id=link_id;
  assert (select o.link_id is null and o.captured_link_id is not null and o.binding is not null and o.external_msg_id='accepted-during-reset'
    from public.outbound_messages o where o.id=sent_id),'connection deletion erased captured evidence';

  assert not has_function_privilege('anon','public.enqueue_channel_outbound(jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.claim_channel_outbound(uuid,uuid)','EXECUTE');
  assert not has_function_privilege('authenticated','public.finish_channel_outbound(uuid,uuid,text,text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.project_channel_outbound(uuid)','EXECUTE');
  assert not has_function_privilege('authenticated','public.maintain_channel_outbound(integer)','EXECUTE');
  assert not has_table_privilege('authenticated','public.outbound_messages','INSERT');
  assert not has_table_privilege('authenticated','public.outbound_messages','UPDATE');
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.proname in ('guard_channel_outbound','enqueue_channel_outbound','claim_channel_outbound','finish_channel_outbound','project_channel_outbound') and p.prosecdef),'unexpected definer';
end $$;
reset role;
set local role anon;
do $$ declare denied boolean:=false; begin
  begin perform public.enqueue_channel_outbound('{}'); exception when insufficient_privilege then denied:=true; end;
  assert denied,'anonymous execution was allowed';
end $$;
reset role;
set local role authenticated;
do $$ declare denied boolean:=false; begin
  begin perform public.claim_channel_outbound(gen_random_uuid(),gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
  assert denied,'client claim was allowed';
end $$;
reset role;
select 'PASS: durable immutable intent; single claim; uncertain non-replay; original attempt evidence; confirmed-only deduped chat; reset/rebind/tenant/client denial; retained receipt after link deletion' as channel_outbox_canary;
