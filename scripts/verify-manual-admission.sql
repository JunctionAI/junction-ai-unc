-- Rollback-only, synthetic database operations. No models, providers or workers.
select set_config('unc.manual_test_user',(select id::text from auth.users where email='halltaylor.tom@gmail.com' and email_confirmed_at is not null),true);
select set_config('unc.manual_test_account',gen_random_uuid()::text,true);
create function pg_temp.fail_manual_insert() returns trigger language plpgsql as $$
begin
  if new.account_id::text=current_setting('unc.manual_test_account',true) and new.request_body->>'forceFailure'='yes' then
    raise exception 'forced_admission_second_write' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger manual_canary_failure before insert on public.manual_routine_requests for each row execute function pg_temp.fail_manual_insert();
set local role service_role;
do $$
declare a uuid:=current_setting('unc.manual_test_account')::uuid; u uuid:=current_setting('unc.manual_test_user')::uuid;
 q uuid:=gen_random_uuid(); run_id uuid:=gen_random_uuid(); spec jsonb; initial jsonb; rev text; answer jsonb; p jsonb;
begin
 if u is null then raise exception 'Verified owner unavailable'; end if;
 insert into public.accounts(id,name,currency,context_generation,automation_paused) values(a,'TEMP manual admission canary','NZD',1,false);
 insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
 spec:='{"id":"D01-W01","version":1,"nodes":[{"id":"receipt","kind":"receipt"}]}';
 insert into public.routine_states(account_id,routine_id,enabled,version,live_spec) values(a,'D01-W01',true,1,spec);
 rev:=public.read_routine_editor(a,u,1,'D01-W01','content')->>'configurationRevision';
 initial:=jsonb_build_object('id',run_id,'accountId',a,'contextGeneration',1,'routineId','D01-W01','version',1,'mode','dry_run','status','running',
   'startedAt',clock_timestamp(),'specHash','sql-canary','snapshot',jsonb_build_object('spec',spec,'nextNodeIndex',0,'startProtocol','manual_claim_v1',
     'ctx',jsonb_build_object('runId',run_id,'routineId','D01-W01','version',1,'mode','dry_run','triggeredBy','manual','account',jsonb_build_object('accountId',a,'contextGeneration',1))));
 begin
   perform public.prepare_manual_routine_request(a,u,1,q,'run','{"forceFailure":"yes"}',rev,initial);
   raise exception 'Forced failure absent' using errcode='XX000';
 exception when sqlstate 'P0001' then if sqlerrm<>'forced_admission_second_write' then raise; end if; end;
 if exists(select 1 from public.routine_runs where account_id=a) then raise exception 'Half admission survived'; end if;
 p:=public.prepare_manual_routine_request(a,u,1,q,'run','{}',rev,initial);
 if p#>>'{operation,phase}'<>'prepared' or p#>>'{run,id}'<>run_id::text then raise exception 'Prepare failed'; end if;
 p:=public.prepare_manual_routine_request(a,u,1,q,'run','{}',rev,initial||jsonb_build_object('id',gen_random_uuid()));
 if p#>>'{run,id}'<>run_id::text then raise exception 'Replay changed identity'; end if;
 begin perform public.prepare_manual_routine_request(a,u,1,q,'run','{"different":true}',rev,initial);
   raise exception 'ID reuse accepted'; exception when serialization_failure then null; end;
 begin perform public.prepare_manual_routine_request(a,u,1,gen_random_uuid(),'run','{}',rev,initial||jsonb_build_object('id',gen_random_uuid()));
   raise exception 'Second unresolved run accepted'; exception when serialization_failure or invalid_parameter_value then null; end;
 update public.accounts set automation_paused=true where id=a;
 if public.read_manual_routine_request(a,u,1,q) is null then raise exception 'Paused reconciliation unavailable'; end if;
 begin perform public.claim_manual_routine_request(a,u,1,q);raise exception 'Paused claim accepted'; exception when serialization_failure then null; end;
 update public.accounts set automation_paused=false where id=a;
 update public.account_members set role='member' where account_id=a;
 if public.read_manual_routine_request(a,u,1,q) is not null then raise exception 'Non-owner request visible'; end if;
 begin perform public.claim_manual_routine_request(a,u,1,q);raise exception 'Non-owner claimed'; exception when insufficient_privilege then null; end;
 update public.account_members set role='owner' where account_id=a;
 if public.read_manual_routine_request(a,u,0,q) is not null or public.read_manual_routine_request(gen_random_uuid(),u,1,q) is not null then raise exception 'Context leak'; end if;
 if public.claim_manual_routine_request(a,u,1,q) is distinct from true then raise exception 'First claim failed'; end if;
 if public.claim_manual_routine_request(a,u,1,q) is distinct from false then raise exception 'Duplicate claim won'; end if;
 -- Input answers use the same run and one claim for an exact waiting snapshot.
 update public.routine_runs set status='waiting_input',snapshot=initial->'snapshot' where id=run_id;
 initial:=jsonb_set(initial,'{status}','"waiting_input"');q:=gen_random_uuid();
 answer:=jsonb_build_object('runId',run_id,'routineId','D01-W01','answers',jsonb_build_object('topic','synthetic'));
 perform public.prepare_manual_routine_request(a,u,1,q,'input',answer,rev,initial);
 if public.claim_manual_routine_request(a,u,1,q) is distinct from true then raise exception 'Input claim failed'; end if;
 if public.claim_manual_routine_request(a,u,1,q) is distinct from false then raise exception 'Input duplicate won'; end if;
 if (select status from public.routine_runs where id=run_id)<>'running' then raise exception 'Input not atomic'; end if;
 if (select count(*) from public.routine_runs where account_id=a)<>1 then raise exception 'Input created another run'; end if;
end;
$$;
reset role;
select 'PASS: rollback, original replay, one claim, owner/generation/pause, input CAS; zero external calls' as result;
