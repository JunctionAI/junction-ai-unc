-- Read-only provider boundary; temporary grant changes and access audits roll back.
-- Exact verified owner + pilot identity; no user-supplied actor and no artifact edits.
begin;
select set_config('unc.ops_work_user',(select u.id::text from auth.users u join public.account_members m on m.user_id=u.id
  where u.email='halltaylor.tom@gmail.com' and u.email_confirmed_at is not null and m.role='owner'
    and m.account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda'),true);
set local role service_role;
do $$
declare u uuid:=current_setting('unc.ops_work_user')::uuid;
  a uuid:='aa5cfc84-2569-4c99-9b40-67003ae55eda'; r jsonb; item record; count_runs int:=0;
begin
  if u is null then raise exception 'Verified pilot owner missing'; end if;
  if has_function_privilege('anon','public.read_ops_run_work(uuid,uuid,uuid,uuid,uuid,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.read_ops_run_work(uuid,uuid,uuid,uuid,uuid,bigint)','EXECUTE')
    or has_table_privilege('authenticated','public.ops_work_reads','SELECT')
    or has_table_privilege('service_role','public.ops_work_reads','DELETE') then raise exception 'Work ACL violation'; end if;
  update public.ops_account_access set work_read_granted_at=null,work_read_granted_by=null,work_read_reason=null where user_id=u and account_id=a;
  begin perform public.read_ops_run_work(u,a,'aeb10060-f0c5-508e-a99a-d70e919eea27'); raise exception 'Metadata-only grant exposed work'; exception when insufficient_privilege then null; end;
  update public.ops_account_access set work_read_granted_at=clock_timestamp(),work_read_granted_by=u,work_read_reason='Rollback-only verification of authorized owner output review' where user_id=u and account_id=a;
  for item in select rr.id from public.routine_runs rr join public.accounts ac on ac.id=rr.account_id and ac.context_generation=rr.context_generation where rr.account_id=a loop
    r:=public.read_ops_run_work(u,a,item.id);
    if r is null or r->>'accountId'<>a::text or r->'run'->>'id'<>item.id::text or jsonb_array_length(r->'artifacts')=0 then raise exception 'Missing run work'; end if;
    if not exists(select 1 from public.ops_work_reads w where w.id=(r->>'auditId')::uuid and w.user_id=u and w.account_id=a and w.run_id=item.id
      and cardinality(w.artifact_ids)=jsonb_array_length(r->'artifacts') and cardinality(w.receipt_ids)=jsonb_array_length(r->'receipts')) then raise exception 'Missing correlated audit'; end if;
    if exists(select 1 from jsonb_array_elements(r->'artifacts') v where v ? 'meta' or v ? 'snapshot')
      or exists(select 1 from jsonb_array_elements(r->'receipts') v where v ? 'payload') then raise exception 'Raw projection exposed'; end if;
    count_runs:=count_runs+1;
  end loop;
  if count_runs<>4 then raise exception 'Expected four existing pilot runs, found %',count_runs; end if;
  begin perform public.read_ops_run_work(gen_random_uuid(),a,'aeb10060-f0c5-508e-a99a-d70e919eea27'); raise exception 'Unknown actor exposed work'; exception when insufficient_privilege then null; end;
  if public.read_ops_run_work(u,a,gen_random_uuid()) is not null then raise exception 'Unknown run returned data'; end if;
  update public.ops_account_access set work_read_granted_at=null,work_read_granted_by=null,work_read_reason=null where user_id=u and account_id=a;
  begin perform public.read_ops_run_work(u,a,'aeb10060-f0c5-508e-a99a-d70e919eea27'); raise exception 'Removed work grant exposed data'; exception when insufficient_privilege then null; end;
end;
$$;
rollback;
select 'PASS: actual schema, four pilot runs, exact audits, private ACLs and work-grant denial; transaction rolled back' as result;
