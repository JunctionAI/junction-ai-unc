-- Run only inside a rollback transaction. Real SQL ordering/role/isolation tests.
set local role service_role;
do $$
declare acct uuid:=gen_random_uuid(); foreign_acct uuid:=gen_random_uuid(); actor uuid;
  rid uuid; stamp timestamptz:='2026-09-04T01:02:03.123456Z'; item record; seen text[]:='{}';
  before_time timestamptz; before_kind text; before_id uuid; count_page integer; denied boolean;
begin
  select user_id into actor from public.account_members where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null;
  insert into public.accounts(id,name) values(acct,'UNC_HISTORY_ROLLBACK_CANARY'),(foreign_acct,'UNC_HISTORY_FOREIGN_CANARY');
  insert into public.account_members(account_id,user_id,role) values(acct,actor,'owner');
  for i in 1..121 loop
    insert into public.routine_runs(account_id,routine_id,version,mode,status,started_at,context_generation)
      values(acct,'D03-W01',1,'dry_run','done',stamp,0) returning id into rid;
  end loop;
  insert into public.routine_runs(account_id,routine_id,version,mode,status,started_at,context_generation)
    values(foreign_acct,'D03-W01',1,'dry_run','done',stamp,0);
  insert into public.artifacts(account_id,run_id,routine_id,kind,title,body,created_at)
    values(acct,rid,'D03-W01','keyword_list','Synthetic history only','No provider result',stamp);
  insert into public.approvals(account_id,run_id,routine_id,title,status,expires_at,created_at,context_generation)
    values(acct,rid,'D03-W01','Synthetic approval','pending',clock_timestamp()+interval '1 day',stamp,0);
  insert into public.receipts(account_id,run_id,kind,description,payload,created_at,context_generation)
    values(acct,rid,'draft','Synthetic receipt','{"secret":"must-not-project"}',stamp,0);
  loop
    count_page:=0;
    for item in select * from public.read_workspace_history(acct,actor,0,clock_timestamp(),before_time,before_kind,before_id) limit 50 loop
      assert not (item.kind||':'||item.id::text=any(seen)),'duplicate page item';
      assert item.record->>'account_id'=acct::text,'tenant leak';
      assert not(item.record ? 'snapshot') and not(item.record ? 'payload'),'internal inputs exposed';
      seen:=array_append(seen,item.kind||':'||item.id::text);count_page:=count_page+1;
      before_time:=item.occurred_at;before_kind:=item.kind;before_id:=item.id;
    end loop;
    exit when count_page=0;
  end loop;
  assert cardinality(seen)=124,'tied timestamps skipped records';
  assert (select count(*) from public.read_workspace_history(acct,actor,0,stamp-interval '1 microsecond'))=0,'upper bound ignored';
  update public.accounts set automation_paused=true where id=acct;
  update public.account_members set role='member' where account_id=acct and user_id=actor;
  assert (select count(*) from public.read_workspace_history(acct,actor,0,clock_timestamp()))=51,'paused member cannot inspect history';
  denied:=false; begin perform public.read_workspace_history(acct,gen_random_uuid(),0,clock_timestamp()); exception when insufficient_privilege then denied:=true; end;
  assert denied,'foreign actor accepted';
  denied:=false; begin perform public.read_workspace_history(acct,actor,1,clock_timestamp()); exception when insufficient_privilege then denied:=true; end;
  assert denied,'stale generation accepted';
  denied:=false; begin perform public.read_workspace_history(acct,actor,0,clock_timestamp(),stamp,null,null); exception when invalid_parameter_value then denied:=true; end;
  assert denied,'partial cursor accepted';
end $$;
reset role;
select 'PASS: 124 tied records across pages, tenant/actor/generation/cursor denials, paused member reads, private inputs omitted' as history_canary;
