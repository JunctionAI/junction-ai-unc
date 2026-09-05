-- Rehearse the staged chat migration in the SAME transaction before this script.
-- Entirely synthetic, rollback-only. No credentials, providers, model calls or sends.
set local role service_role;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); actor uuid;
  old_id uuid; body jsonb; result jsonb; snapshot jsonb; rev bigint; denied boolean;
begin
  select user_id into actor from public.account_members
    where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null,'requires existing referenced owner; no auth user is changed';
  insert into public.accounts(id,name) values(a,'UNC_CHAT_CONTEXT_CANARY'),(b,'UNC_CHAT_CONTEXT_CANARY_OTHER');
  insert into public.account_members(account_id,user_id,role) values(a,actor,'owner');
  insert into public.chat_messages(account_id,context_generation,thread,position,lane,sender,body,channel)
    values(a,0,'corner',0,'ai','user','old business history','app') returning id into old_id;
  insert into public.chat_messages(account_id,context_generation,thread,position,lane,sender,body,channel,external_scope,external_msg_id)
    values(a,0,'corner',100000000,'ai','user','old sms','sms','link-a','same-provider-id');

  update public.accounts set context_generation=1,automation_paused=true where id=a;
  insert into public.chat_messages(account_id,context_generation,thread,position,lane,sender,body,channel)
    values(a,1,'corner',0,'ai','user','current business history','app');
  insert into public.chat_messages(account_id,context_generation,thread,position,lane,sender,body,channel,external_scope,external_msg_id)
    values(a,1,'corner',100000000,'ai','user','current sms','sms','link-a','same-provider-id'),
      (a,1,'corner',100000001,'ai','user','another scoped sender','sms','link-b','same-provider-id'),
      (b,0,'corner',100000000,'ai','user','another tenant','sms','link-a','same-provider-id');
  denied:=false;
  begin
    insert into public.chat_messages(account_id,context_generation,thread,position,lane,sender,body,channel,external_scope,external_msg_id)
      values(a,1,'corner',100000002,'ai','user','duplicate','sms','link-a','same-provider-id');
  exception when unique_violation then denied:=true; end;
  assert denied,'same captured sender delivery was duplicated';

  denied:=false;
  begin update public.chat_messages set body='late stale replacement' where id=old_id;
  exception when serialization_failure then denied:=true; end;
  assert denied,'stale history overwritten';
  denied:=false;
  begin update public.chat_messages set context_generation=1 where id=old_id;
  exception when check_violation then denied:=true; end;
  assert denied,'old history promoted to current context';
  denied:=false;
  begin update public.chat_messages set account_id=b where id=old_id;
  exception when check_violation then denied:=true; end;
  assert denied,'history transferred between tenants';
  denied:=false;
  begin insert into public.chat_messages(account_id,context_generation,thread,position,lane,sender,body)
    values(a,0,'corner',2,'ai','user','stale append');
  exception when serialization_failure then denied:=true; end;
  assert denied,'old generation appended after reset';

  snapshot:=public.load_account_state_snapshot(a);
  assert snapshot->'account'->>'context_generation'='1';
  assert jsonb_array_length(snapshot->'chatMessages')=1,'archived or channel rows entered autosave';
  assert snapshot->'chatMessages'->0->>'body'='current business history';
  assert (select m.body='old business history' from public.chat_messages m where id=old_id),'archive changed';

  body:=jsonb_build_object(
    'account',jsonb_build_object('id',a,'currency','NZD'), 'goals','[]'::jsonb,
    'resourceProfile',jsonb_build_object('budget_monthly',0,'hours_weekly',0,'reinvestment','balanced','gross_margin_pct',null,'website','canary.invalid','socials','[]'::jsonb,'skills','[]'::jsonb,'known_platforms','[]'::jsonb,'postures','[]'::jsonb,'breadth','focused'),
    'teamMembers','[]'::jsonb,'plan',jsonb_build_object('title','Canary draft','phases','[]'::jsonb,'narrative',null),
    'businessProfile',jsonb_build_object('scan_status','done','profile',jsonb_build_object('name','Canary'),'scanned_at',null),
    'chatMessages',jsonb_build_array(jsonb_build_object('context_generation',1,'thread','corner','position',0,'lane','ai','sender','user','body','current saved','meta','{}'::jsonb)),
    'stateMeta',jsonb_build_object('schema_version',1,'client_state','{}'::jsonb));
  select coalesce((select revision from public.account_state_meta where account_id=a),0) into rev;
  result:=public.save_account_state_atomic(a,actor,rev,gen_random_uuid(),body);
  assert result->>'ok'='true','current paused app save rejected';
  snapshot:=public.load_account_state_snapshot(a);
  rev:=(snapshot->'stateMeta'->>'revision')::bigint;
  denied:=false;
  begin perform public.save_account_state_atomic(a,actor,rev,gen_random_uuid(),jsonb_set(body,'{chatMessages,0,context_generation}','0'));
  exception when serialization_failure then denied:=true; end;
  assert denied,'old payload rebased merely because it knew the latest autosave revision';
  assert public.load_account_state_snapshot(a)=snapshot,'rejected save partially changed account';
  assert (select count(*)=2 from public.chat_messages where account_id=a and context_generation=0),'archive was deleted';
  assert (select count(*)=2 from public.chat_messages where account_id=a and context_generation=1 and channel='sms'),'channel history overwritten';
  assert not has_function_privilege('anon','public.save_account_state_atomic(uuid,uuid,bigint,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.save_account_state_atomic(uuid,uuid,bigint,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.load_account_state_snapshot(uuid)','EXECUTE');
  -- Do not grant service_role schema USAGE merely for a regprocedure cast in a test.
  assert exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='unc_private' and p.proname='guard_chat_context_generation' and not p.prosecdef);
end $$;
reset role;
select 'PASS: current paused chat; archive preservation; cross-account/generation/sender dedupe; stale update/append/reassignment/save denial; atomic snapshot and private RPCs' as chat_context_canary;
