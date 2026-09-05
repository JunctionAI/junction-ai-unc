-- Real database-role checks. Disposable rows are rolled back; no provider calls.
begin;
insert into public.accounts(id,name,automation_paused) values
 ('00000000-0000-4000-8000-00000000a601','UNC_PAUSE_CANARY',false),
 ('00000000-0000-4000-8000-00000000a602','UNC_PAUSE_CANARY_OTHER',false);
insert into public.routine_states(account_id,routine_id,enabled) values
 ('00000000-0000-4000-8000-00000000a601','D01-W01',true);
insert into public.plans(account_id,title,phases) values ('00000000-0000-4000-8000-00000000a601','','[]');
insert into public.daily_briefs(account_id,day,body) values ('00000000-0000-4000-8000-00000000a601',current_date,'original');
-- Seed before the hold: generation-aware brief guards also apply to the operator.
-- This synthetic account and its pause are visible only inside the rollback test.
update public.accounts set automation_paused=true where id='00000000-0000-4000-8000-00000000a601';
set local role service_role;
do $$
declare a uuid := '00000000-0000-4000-8000-00000000a601'; denied boolean;
begin
  assert (public.load_account_state_snapshot(a)->'account'->>'automation_paused')::boolean;
  denied:=false;
  begin
    insert into public.routine_runs(account_id,routine_id,version,mode,status) values(a,'D01-W01',1,'dry_run','running');
  exception when object_not_in_prerequisite_state then denied:=true;
  end;
  assert denied,'legacy worker could start a held account';
  denied:=false;
  begin update public.daily_briefs set body='late result' where account_id=a;
  exception when object_not_in_prerequisite_state then denied:=true; end;
  assert denied,'late brief overwrote account during pause';
  denied:=false;
  begin delete from public.daily_briefs where account_id=a;
  exception when object_not_in_prerequisite_state then denied:=true; end;
  assert denied,'held history could be deleted';
  denied:=false;
  begin update public.daily_briefs set account_id='00000000-0000-4000-8000-00000000a602' where account_id=a;
  exception when object_not_in_prerequisite_state then denied:=true; end;
  assert denied,'old-account pause escaped through reassignment';
  denied:=false;
  begin insert into public.account_profiles(account_id,founder_notes) values(a,'stale profile');
  exception when object_not_in_prerequisite_state then denied:=true; end;
  assert denied,'late profile write accepted';
  denied:=false;
  begin update public.plans set agreed_at=now() where account_id=a;
  exception when object_not_in_prerequisite_state then denied:=true; end;
  assert denied,'paused plan silently agreed';
  update public.plans set title='draft, not agreed' where account_id=a;
  update public.routine_states set enabled=false where account_id=a;
  denied:=false;
  begin update public.routine_states set enabled=true where account_id=a;
  exception when object_not_in_prerequisite_state then denied:=true; end;
  assert denied,'held routine re-enabled';
  insert into public.routine_runs(account_id,routine_id,version,mode,status)
    values('00000000-0000-4000-8000-00000000a602','D01-W01',1,'dry_run','running');
  assert (select body='original' from public.daily_briefs where account_id=a);
  assert not has_schema_privilege('authenticated','unc_private','USAGE');
  assert not has_column_privilege('authenticated','public.accounts','automation_paused','UPDATE');
  assert not has_column_privilege('anon','public.accounts','automation_paused','UPDATE');
end $$;
rollback;
select 'PASS: legacy/late writes denied, pause tenant-scoped, switch-off and draft save allowed, private archive inaccessible; rolled back' as result;
