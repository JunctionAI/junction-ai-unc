-- Load the new function in this transaction first. ALL synthetic records roll back.
select set_config('unc.agent_test_user',(select id::text from auth.users where email='halltaylor.tom@gmail.com' and email_confirmed_at is not null),true);
set local role service_role;
do $$
declare u uuid:=current_setting('unc.agent_test_user')::uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); result jsonb; previous timestamptz;
begin
  if has_function_privilege('anon','public.set_agent_switch(uuid,uuid,bigint,text,boolean,timestamptz,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.set_agent_switch(uuid,uuid,bigint,text,boolean,timestamptz,integer)','EXECUTE') then raise exception 'Public switch exposure'; end if;
  insert into public.accounts(id,name,context_generation,automation_paused) values(a,'AGENT-SWITCH-CANARY',1,false),(b,'AGENT-SWITCH-OTHER',1,false);
  insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
  result:=public.set_agent_switch(a,u,1,'D01-W01',true,null,1);
  previous:=(result->>'stateUpdatedAt')::timestamptz;
  if (result->>'enabled')::boolean is distinct from true then raise exception 'Enable not saved'; end if;
  begin perform public.set_agent_switch(a,u,1,'D01-W01',false,null,1); raise exception 'Stale timestamp accepted'; exception when serialization_failure then null; end;
  begin perform public.set_agent_switch(a,u,0,'D01-W01',false,previous,1); raise exception 'Old context accepted'; exception when serialization_failure then null; end;
  begin perform public.set_agent_switch(a,u,1,'D01-W01',false,previous,2); raise exception 'Old version accepted'; exception when serialization_failure then null; end;
  begin perform public.set_agent_switch(b,u,1,'D01-W01',true,null,1); raise exception 'Other tenant accepted'; exception when insufficient_privilege then null; end;
  begin perform public.set_agent_switch(a,gen_random_uuid(),1,'D01-W01',true,previous,1); raise exception 'Unknown actor accepted'; exception when insufficient_privilege then null; end;
  update public.account_members set role='member' where account_id=a;
  begin perform public.set_agent_switch(a,u,1,'D01-W01',false,previous,1); raise exception 'Member accepted'; exception when insufficient_privilege then null; end;
  update public.account_members set role='owner' where account_id=a;
  update public.accounts set automation_paused=true where id=a;
  begin perform public.set_agent_switch(a,u,1,'D01-W02',true,null,1); raise exception 'Paused enable accepted'; exception when serialization_failure then null; end;
  result:=public.set_agent_switch(a,u,1,'D01-W01',false,previous,1);
  if (result->>'enabled')::boolean is distinct from false then raise exception 'Paused off failed'; end if;
  if (select count(*) from public.routine_states where account_id=a)<>1 or exists(select 1 from public.routine_states where account_id=b) then raise exception 'Unrelated switch changed'; end if;
  if exists(select 1 from public.routine_runs where account_id in(a,b)) then raise exception 'Switch ran workflow'; end if;
  raise notice 'PASS owner, tenant, generation, timestamp, version, paused on/off, isolated preference and no run';
end;
$$;
rollback;
select count(*) as remaining_canary_accounts from public.accounts where name in ('AGENT-SWITCH-CANARY','AGENT-SWITCH-OTHER');
