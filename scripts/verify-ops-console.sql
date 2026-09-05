-- Synthetic database records only, all rolled back. Never invokes a provider.
begin;
select set_config('unc.ops_test_user',(select id::text from auth.users where email='halltaylor.tom@gmail.com' and email_confirmed_at is not null),true);
set local role service_role;
do $$
declare u uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); oldrun uuid:=gen_random_uuid(); run uuid:=gen_random_uuid(); r jsonb;
begin
  u:=current_setting('unc.ops_test_user')::uuid;
  if has_table_privilege('anon','public.ops_account_access','SELECT') or has_table_privilege('authenticated','public.ops_account_access','INSERT')
    or has_function_privilege('anon','public.read_ops_console(uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','public.read_ops_console(uuid,uuid)','EXECUTE') then
    raise exception 'Public operator authority exposure';
  end if;
  if (select prosecdef from pg_proc where oid='public.read_ops_console(uuid,uuid)'::regprocedure) then raise exception 'Unexpected definer'; end if;
  if (select provolatile from pg_proc where oid='public.read_ops_console(uuid,uuid)'::regprocedure)<>'s' then raise exception 'Snapshot function must be stable'; end if;
  insert into public.accounts(id,name,context_generation) values (a,'OPS-CANARY-ALLOWED',0),(b,'OPS-CANARY-FORBIDDEN',0);
  insert into public.ops_account_access(user_id,account_id,granted_by,reason) values(u,a,u,'Rollback-only ops boundary canary');
  insert into public.routine_runs(id,account_id,context_generation,routine_id,version,mode,status)
    values(oldrun,a,0,'D03-W01',1,'dry_run','done');
  insert into public.artifacts(account_id,run_id,routine_id,kind,title,body)
    values(a,oldrun,'D03-W01','keyword_list','OPS-OLD-DRAFT','OPS-BODY-SECRET');
  update public.accounts set context_generation=1 where id=a;
  insert into public.routine_runs(id,account_id,context_generation,routine_id,version,mode,status,snapshot)
    values(run,a,1,'D03-W01',1,'dry_run','done',jsonb_build_object('ctx',jsonb_build_object('account',jsonb_build_object('accountId',a,'contextGeneration',1)),'secret','OPS-SNAPSHOT-SECRET'));
  insert into public.artifacts(account_id,run_id,routine_id,kind,title,body,items,meta,evidence,status)
    values(a,run,'D03-W01','keyword_list','OPS-CURRENT-DRAFT','OPS-BODY-SECRET','[]','{}','[]','draft');
  insert into public.connectors(account_id,platform,status,external_ref,last_sync_at,last_sync_result)
    values(a,'shopify','connected','canary.myshopify.com',now(),'ok');
  r:=public.read_ops_console(u,a);
  if r->'selected'->>'accountId'<>a::text or jsonb_array_length(r->'selected'->'runs')<>1 or jsonb_array_length(r->'selected'->'drafts')<>1 then raise exception 'Tenant/generation projection failed'; end if;
  if r::text like '%OPS-SNAPSHOT-SECRET%' or r::text like '%OPS-BODY-SECRET%' or r::text like '%OPS-OLD-DRAFT%' or r::text like '%OPS-CANARY-FORBIDDEN%' then raise exception 'Projection leak'; end if;
  begin perform public.read_ops_console(u,b); raise exception 'Unauthorized account accepted'; exception when insufficient_privilege then null; end;
  begin perform public.read_ops_console(gen_random_uuid(),a); raise exception 'Unknown actor accepted'; exception when insufficient_privilege then null; end;
  update public.ops_account_access set revoked_at=now() where user_id=u and account_id=a;
  begin perform public.read_ops_console(u,a); raise exception 'Revoked scope accepted'; exception when insufficient_privilege then null; end;
  update public.ops_account_access set revoked_at=null,expires_at=statement_timestamp() where user_id=u and account_id=a;
  begin perform public.read_ops_console(u,a); raise exception 'Expired scope accepted'; exception when insufficient_privilege then null; end;
  raise notice 'PASS: ACL, invoker/snapshot, exact scope, generation, redaction, unknown actor, revoked and expired grant';
end;
$$;
rollback;
select count(*) as remaining_canary_accounts from public.accounts where name in ('OPS-CANARY-ALLOWED','OPS-CANARY-FORBIDDEN');
