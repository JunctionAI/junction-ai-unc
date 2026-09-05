-- Real PostgreSQL controls, synthetic rows only. Always rollback; no worker/provider calls.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
set local role service_role;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); owner_id uuid;
  old_id uuid:=gen_random_uuid(); fresh_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  test_id uuid; denied boolean;
begin
  select user_id into owner_id from public.account_members order by account_id limit 1;
  assert owner_id is not null,'requires an existing referenced auth user; no user is created or changed';
  insert into public.accounts(id,name) values(a,'UNC_COMMAND_CONTEXT_CANARY'),(b,'UNC_COMMAND_CONTEXT_CANARY_OTHER');
  insert into public.routine_commands(id,account_id,user_id,channel,request_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply)
    values(old_id,a,owner_id,'app','old','h','D01-W01','s','w',1,'synthetic old request','queued','queued');
  assert (select context_generation=0 from public.routine_commands where id=old_id),'legacy generation wrong';
  update public.routine_commands set status='running',run_id=id where id=old_id and status='queued';
  assert found,'initial claim failed';
  update public.routine_commands set status='running',run_id=id where id=old_id and status='queued';
  assert not found,'second claim succeeded';
  update public.accounts set context_generation=1 where id=a;
  denied:=false;
  begin update public.routine_commands set reply='late result' where id=old_id;
  exception when serialization_failure then denied:=true; end;
  assert denied,'old command wrote a late result';
  denied:=false;
  begin update public.routine_commands set context_generation=1 where id=old_id;
  exception when check_violation then denied:=true; end;
  assert denied,'old command rebased';
  denied:=false;
  begin insert into public.routine_runs(id,account_id,routine_id,version,mode,status,context_generation)
    values(old_id,a,'D01-W01',1,'dry_run','running',1);
  exception when check_violation then denied:=true; end;
  assert denied,'legacy worker rebased an old command into a fresh run';
  denied:=false;
  begin insert into public.routine_commands(id,account_id,user_id,channel,request_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply)
    values(gen_random_uuid(),a,owner_id,'app','legacy','h','D01-W01','s','w',1,'unbound request','queued','queued');
  exception when serialization_failure then denied:=true; end;
  assert denied,'missing captured generation accepted after reset';
  insert into public.routine_commands(id,account_id,context_generation,user_id,channel,request_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply)
    values(fresh_id,a,1,owner_id,'apple','fresh','h','D01-W01','s','w',1,'fresh request','queued','queued'),
      (other_id,b,0,owner_id,'app','other','h','D01-W01','s','w',1,'other request','queued','queued');
  denied:=false;
  begin update public.routine_commands set request='different' where id=fresh_id;
  exception when check_violation then denied:=true; end;
  assert denied,'request content rewritten';
  denied:=false;
  begin update public.routine_commands set account_id=b where id=fresh_id;
  exception when check_violation then denied:=true; end;
  assert denied,'command moved across tenants';
  denied:=false;
  begin update public.routine_commands set run_id=gen_random_uuid() where id=fresh_id;
  exception when check_violation then denied:=true; end;
  assert denied,'arbitrary run attached';
  denied:=false;
  begin insert into public.routine_runs(id,account_id,routine_id,version,mode,status,context_generation)
    values(fresh_id,a,'D01-W01',1,'dry_run','running',1);
  exception when check_violation then denied:=true; end;
  assert denied,'unclaimed command created a run';
  update public.routine_commands set status='running',run_id=id where id=fresh_id;
  denied:=false;
  begin insert into public.routine_runs(id,account_id,routine_id,version,mode,status,context_generation)
    values(fresh_id,b,'D01-W01',1,'dry_run','running',0);
  exception when check_violation then denied:=true; end;
  assert denied,'cross-tenant run attached';
  denied:=false;
  begin insert into public.routine_runs(id,account_id,routine_id,version,mode,status,context_generation)
    values(fresh_id,a,'D01-W02',1,'dry_run','running',1);
  exception when check_violation then denied:=true; end;
  assert denied,'wrong routine run attached';
  insert into public.routine_runs(id,account_id,routine_id,version,mode,status,context_generation)
    values(fresh_id,a,'D01-W01',1,'dry_run','running',1);
  update public.routine_commands set status='done',reply='synthetic completion' where id=fresh_id;
  assert (select count(*)=1 from public.list_current_routine_commands(null,100,true) where account_id=a),'Apple pending notification omitted';
  assert not exists(select 1 from public.list_current_routine_commands('running',100,false) where id=old_id),'stale command returned to worker';
  update public.accounts set automation_paused=true where id=a;
  denied:=false;
  begin update public.routine_commands set notification_status='claimed' where id=fresh_id;
  exception when object_not_in_prerequisite_state then denied:=true; end;
  assert denied,'paused notification claimed';
  assert not exists(select 1 from public.list_current_routine_commands(null,100,true) where account_id=a),'paused command returned to notifier';
  assert exists(select 1 from public.list_current_routine_commands('queued',100,false) where id=other_id),'unrelated active account starved';
  update public.accounts set automation_paused=false where id=a;
  denied:=false;
  begin update public.routine_commands set notification_status='claimed' where id=old_id;
  exception when serialization_failure then denied:=true; end;
  assert denied,'unpause revived old command';

  -- Existing unrelated run cannot be adopted by a later command insertion.
  test_id:=gen_random_uuid();
  insert into public.routine_runs(id,account_id,routine_id,version) values(test_id,b,'D01-W01',1);
  denied:=false;
  begin insert into public.routine_commands(id,account_id,context_generation,user_id,channel,request_id,request_hash,routine_id,spec_hash,workflow_hash,version,request,status,reply)
    values(test_id,a,1,owner_id,'app','adopt','h','D01-W01','s','w',1,'adopt run','queued','queued');
  exception when check_violation then denied:=true; end;
  assert denied,'preexisting run adopted across context';
  assert (select reply='queued' and context_generation=0 from public.routine_commands where id=old_id),'old history changed';
  assert not has_function_privilege('anon','public.list_current_routine_commands(text,integer,boolean)','EXECUTE');
  assert not has_function_privilege('authenticated','public.list_current_routine_commands(text,integer,boolean)','EXECUTE');
  assert has_function_privilege('service_role','public.list_current_routine_commands(text,integer,boolean)','EXECUTE');
  assert not has_table_privilege('authenticated','public.routine_commands','SELECT');
  assert not has_table_privilege('anon','public.routine_commands','INSERT');
  assert not has_column_privilege('authenticated','public.routine_commands','context_generation','UPDATE');
  assert not (select bool_or(p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='unc_private' and p.proname in ('guard_command_context','guard_run_command_context')) or
      (n.nspname='public' and p.proname='list_current_routine_commands')),'unnecessary definer privilege';
end $$;
rollback;
select 'PASS: command context, immutable claim/run identity, current-only worker/notification polling and server-only privileges; all synthetic rows rolled back' as result;
