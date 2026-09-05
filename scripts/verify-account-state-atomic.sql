-- Real SQL tests. No provider calls. All disposable rows roll back.
begin;
set local role service_role;
do $$
declare
  acct uuid:=gen_random_uuid(); other_acct uuid:=gen_random_uuid(); actor uuid;
  save_id uuid:=gen_random_uuid(); body jsonb; result jsonb; snapshot jsonb; rejected boolean:=false;
begin
  select user_id into actor from public.account_members where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null,'pilot owner required for rollback-only membership canary';
  assert not has_function_privilege('anon','public.save_account_state_atomic(uuid,uuid,bigint,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.save_account_state_atomic(uuid,uuid,bigint,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.load_account_state_snapshot(uuid)','EXECUTE');
  insert into public.accounts(id,name,currency) values(acct,'ROLLBACK atomic save canary','NZD'),(other_acct,'ROLLBACK atomic other tenant','USD');
  insert into public.account_members(account_id,user_id,role) values(acct,actor,'owner');
  body:=jsonb_build_object(
    'account',jsonb_build_object('id',acct,'currency','AUD'),
    'goals',jsonb_build_array(jsonb_build_object('account_id',other_acct,'category','revenue','tier','governing','title','A$10000 revenue','baseline',0,'deadline','2026-12-31')),
    'resourceProfile',jsonb_build_object('account_id',other_acct,'budget_monthly',0,'hours_weekly',0,'reinvestment','balanced','gross_margin_pct',null,'website','canary.invalid','socials','[]'::jsonb,'skills','[]'::jsonb,'known_platforms','[]'::jsonb,'postures','["brand_led"]'::jsonb,'breadth','focused'),
    'teamMembers','[]'::jsonb,
    'plan',jsonb_build_object('title','Canary draft','phases','[]'::jsonb,'narrative',null),
    'businessProfile',jsonb_build_object('scan_status','done','profile',jsonb_build_object('name','Canary only'),'scanned_at',null),
    'chatMessages',jsonb_build_array(jsonb_build_object('thread','corner','position',0,'lane','ai','sender','user','body','hello','meta','{}'::jsonb)),
    'stateMeta',jsonb_build_object('schema_version',1,'client_state','{}'::jsonb)
  );
  result:=public.save_account_state_atomic(acct,actor,0,save_id,body);
  assert result @> '{"ok":true,"revision":1,"replayed":false}';
  assert (select baseline=0 from public.goals where account_id=acct);
  assert not exists(select 1 from public.resource_profiles where account_id=other_acct),'nested tenant injection';
  assert not exists(select 1 from public.goals where account_id=other_acct),'nested goal tenant injection';
  snapshot:=public.load_account_state_snapshot(acct);
  assert snapshot->'stateMeta'->>'revision'='1';
  assert not(snapshot->'stateMeta' ? 'last_save_hash');
  assert snapshot->'account'->>'currency'='AUD';
  assert public.save_account_state_atomic(acct,actor,0,save_id,body) @> '{"ok":true,"revision":1,"replayed":true}';
  assert public.save_account_state_atomic(acct,actor,1,save_id,jsonb_set(body,'{account,currency}','"USD"')) @> '{"ok":false,"code":"save_id_conflict"}';
  assert public.save_account_state_atomic(acct,actor,0,gen_random_uuid(),body) @> '{"ok":false,"code":"state_conflict"}';
  assert public.load_account_state_snapshot(acct)=snapshot,'rejected or replayed save changed state';

  -- A late invalid business profile comes AFTER account/goal/resource writes.
  -- The exception must roll back all of those writes, not leave a partial save.
  begin
    perform public.save_account_state_atomic(acct,actor,1,gen_random_uuid(),jsonb_set(jsonb_set(body,'{account,currency}','"USD"'),'{businessProfile,scan_status}','"invalid"'));
  exception when check_violation then rejected:=true;
  end;
  assert rejected,'late invalid section was accepted';
  assert public.load_account_state_snapshot(acct)=snapshot,'partial save survived failure';

  assert public.save_account_state_atomic(other_acct,actor,0,gen_random_uuid(),jsonb_set(body,'{account,id}',to_jsonb(other_acct))) @> '{"ok":false,"code":"owner_only"}';
  update public.account_members set role='member' where account_id=acct and user_id=actor;
  assert public.save_account_state_atomic(acct,actor,1,gen_random_uuid(),body) @> '{"ok":false,"code":"owner_only"}';
  update public.account_members set role='owner' where account_id=acct and user_id=actor;

  insert into public.chat_messages(account_id,thread,position,lane,sender,body,meta,channel)
    values(acct,'corner',100000001,'ai','user','channel message','{}','sms');
  result:=public.save_account_state_atomic(acct,actor,1,gen_random_uuid(),body);
  assert result @> '{"ok":true,"revision":2}';
  assert (select count(*)=1 from public.chat_messages where account_id=acct and channel='sms');
  assert jsonb_array_length(public.load_account_state_snapshot(acct)->'chatMessages')=1,'channel messages entered browser autosave';
  assert not exists(select 1 from public.connectors where account_id=acct),'unexpected connector write';
  assert not exists(select 1 from public.routine_states where account_id=acct),'unexpected routine write';
  assert not exists(select 1 from public.approvals where account_id=acct),'unexpected approval write';
  -- A non-autosave server writer (intake/context repair) invalidates a stale tab too.
  update public.business_profiles set profile='{"name":"Server-corrected business"}' where account_id=acct;
  assert public.load_account_state_snapshot(acct)->'stateMeta'->>'revision'='3';
  assert public.save_account_state_atomic(acct,actor,2,gen_random_uuid(),body) @> '{"ok":false,"code":"state_conflict"}';
  assert (select profile->>'name'='Server-corrected business' from public.business_profiles where account_id=acct);
end $$;
rollback;
select 'PASS: atomic save, revision conflict, replay, owner/cross-account denial, late-error rollback, channel preservation; canary rows rolled back' as result;
