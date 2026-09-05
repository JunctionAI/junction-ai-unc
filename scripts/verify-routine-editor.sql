-- Begin a transaction and load the staged migration before this rollback-only canary.
select set_config('unc.editor_test_user',(select id::text from auth.users where email='halltaylor.tom@gmail.com' and email_confirmed_at is not null),true);
select set_config('unc.editor_test_account',gen_random_uuid()::text,true);
create function pg_temp.fail_editor_second_write() returns trigger language plpgsql as $$
begin
  if new.account_id::text=current_setting('unc.editor_test_account',true) and new.routine_id='D01-W02' then
    raise exception 'forced_second_write_failure' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger editor_canary_late_failure before insert or update on public.routine_states for each row execute function pg_temp.fail_editor_second_write();
set local role service_role;
do $$
declare u uuid:=current_setting('unc.editor_test_user')::uuid; a uuid:=current_setting('unc.editor_test_account')::uuid;
  other_account uuid:=gen_random_uuid(); first_read jsonb; saved jsonb; current_read jsonb; draft jsonb:='{"id":"D01-W01","version":2,"nodes":[]}';
  run_id uuid:=gen_random_uuid(); failed_id uuid:=gen_random_uuid();
begin
  if has_function_privilege('anon','public.commit_routine_editor(uuid,uuid,bigint,text,text,text,text,jsonb,text[],jsonb,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.read_routine_editor(uuid,uuid,bigint,text,text)','EXECUTE') then raise exception 'Public editor exposure'; end if;
  insert into public.accounts(id,name,context_generation,automation_paused) values(a,'ROUTINE-EDITOR-CANARY',1,false),(other_account,'ROUTINE-EDITOR-OTHER',1,false);
  insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
  first_read:=public.read_routine_editor(a,u,1,'D01-W01','content');
  if first_read->>'configurationRevision' !~ '^[a-f0-9]{64}$' or first_read->'state'<>'null'::jsonb
    or exists(select 1 from public.routine_states where account_id=a) then raise exception 'Read initialized state'; end if;
  if public.read_routine_editor(other_account,u,1,'D01-W01','content') is not null then raise exception 'Other tenant read'; end if;
  saved:=public.commit_routine_editor(a,u,1,'D01-W01','content',first_read->>'configurationRevision','save','{"postsPerWeek":4}',array['read_posts'],draft);
  if saved#>>'{own,params,postsPerWeek}'<>'4' or saved#>>'{state,draft_spec,version}'<>'2' or (saved#>>'{state,enabled}')::boolean then raise exception 'Save mismatch'; end if;
  begin perform public.commit_routine_editor(a,u,1,'D01-W01','content',first_read->>'configurationRevision','save','{"postsPerWeek":5}',array[]::text[],draft);
    raise exception 'Stale tab accepted'; exception when serialization_failure then null; end;
  begin perform public.commit_routine_editor(a,u,0,'D01-W01','content',saved->>'configurationRevision','discard');
    raise exception 'Old generation accepted'; exception when serialization_failure then null; end;
  begin perform public.commit_routine_editor(other_account,u,1,'D01-W01','content',saved->>'configurationRevision','discard');
    raise exception 'Other tenant write'; exception when insufficient_privilege then null; end;
  update public.account_members set role='member' where account_id=a;
  if public.read_routine_editor(a,u,1,'D01-W01','content')->>'role'<>'member' then raise exception 'Member read failed'; end if;
  begin perform public.commit_routine_editor(a,u,1,'D01-W01','content',saved->>'configurationRevision','discard');
    raise exception 'Member wrote'; exception when insufficient_privilege then null; end;
  update public.account_members set role='owner' where account_id=a;
  update public.accounts set automation_paused=true where id=a;
  begin perform public.commit_routine_editor(a,u,1,'D01-W01','content',saved->>'configurationRevision','discard');
    raise exception 'Paused write'; exception when serialization_failure then null; end;
  update public.accounts set automation_paused=false where id=a;
  insert into public.account_presets(account_id,domain,params) values(a,'content','{"postsPerWeek":3}');
  begin perform public.commit_routine_editor(a,u,1,'D01-W01','content',saved->>'configurationRevision','discard');
    raise exception 'Changed preset accepted'; exception when serialization_failure then null; end;
  current_read:=public.read_routine_editor(a,u,1,'D01-W02','content');
  begin
    perform public.commit_routine_editor(a,u,1,'D01-W02','content',current_read->>'configurationRevision','save','{"postsPerWeek":4}',array[]::text[],null);
    raise exception 'Forced failure did not fire' using errcode='XX000';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'forced_second_write_failure' then raise; end if;
  end;
  if exists(select 1 from public.routine_params where account_id=a and routine_id='D01-W02') then raise exception 'Half-save survived'; end if;
  current_read:=public.read_routine_editor(a,u,1,'D01-W01','content');
  begin perform public.commit_routine_editor(a,u,1,'D01-W01','content',current_read->>'configurationRevision','promote',null,null,draft,run_id,'canary');
    raise exception 'Missing run promoted'; exception when serialization_failure then null; end;
  insert into public.routine_runs(id,account_id,context_generation,routine_id,version,mode,status,spec_hash,finished_at)
    values(run_id,a,1,'D01-W01',2,'dry_run','done','canary',clock_timestamp());
  insert into public.routine_runs(id,account_id,context_generation,routine_id,version,mode,status,spec_hash,started_at,finished_at)
    values(failed_id,a,1,'D01-W01',2,'dry_run','failed','canary',clock_timestamp()+interval '1 second',clock_timestamp());
  begin perform public.commit_routine_editor(a,u,1,'D01-W01','content',current_read->>'configurationRevision','promote',null,null,draft,run_id,'canary');
    raise exception 'Older pass beat newer failure'; exception when serialization_failure then null; end;
  delete from public.routine_runs where id=failed_id;
  saved:=public.commit_routine_editor(a,u,1,'D01-W01','content',current_read->>'configurationRevision','promote',null,null,draft,run_id,'canary');
  if saved#>>'{state,version}'<>'2' or saved#>'{state,draft_spec}'<>'null'::jsonb or (saved#>>'{state,enabled}')::boolean then raise exception 'Promotion mismatch'; end if;
  if exists(select 1 from public.routine_params where account_id=other_account) then raise exception 'Other account mutated'; end if;
  if (select count(*) from public.routine_runs where account_id=a)<>1 then raise exception 'Editor created a run'; end if;
  raise notice 'PASS read-only snapshot, atomic save/rollback, stale tab/preset, actor, tenant, pause/generation and matching latest validation promotion';
end;
$$;
rollback;
select count(*) as remaining_canary_accounts from public.accounts where name in ('ROUTINE-EDITOR-CANARY','ROUTINE-EDITOR-OTHER');
