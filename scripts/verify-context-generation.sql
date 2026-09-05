-- Run after both context-generation migrations. Real SQL/roles, synthetic rows,
-- all rolled back. No provider calls, existing account changes or credentials.
begin;
set local role service_role;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); m uuid; n uuid;
  denied boolean; rev bigint; snapshot jsonb;
begin
  insert into public.accounts(id,name) values(a,'UNC_CONTEXT_CANARY'),(b,'UNC_CONTEXT_CANARY_OTHER');
  insert into public.account_state_meta(account_id,schema_version,client_state,revision,last_save_id,last_save_hash)
    values(a,1,'{}',7,gen_random_uuid(),'canary-hash');
  -- Legacy service writer remains compatible BEFORE a context repair.
  insert into public.memories(account_id,kind,text,source) values(a,'fact','old context','chat') returning id into m;
  assert (select context_generation=0 from public.memories where id=m);
  update public.memories set valid_to=now() where id=m;
  update public.accounts set context_generation=1 where id=a;
  select revision into rev from public.account_state_meta where account_id=a;
  assert rev=8,'context change did not invalidate autosave';
  assert (select last_save_id is null and last_save_hash is null from public.account_state_meta where account_id=a),'replay markers survived repair';
  snapshot:=public.load_account_state_snapshot(a);
  assert (snapshot->'account'->>'context_generation')::int=1;
  assert (snapshot->'stateMeta'->>'revision')::int=8;

  denied:=false;
  begin
    insert into public.memories(account_id,kind,text,source) values(a,'fact','late legacy result','chat');
  exception when serialization_failure then denied:=true;
  end;
  assert denied,'legacy default-zero writer accepted after repair';
  denied:=false;
  begin
    insert into public.memories(account_id,kind,text,source,context_generation) values(a,'fact','captured old result','chat',0);
  exception when serialization_failure then denied:=true;
  end;
  assert denied,'old captured generation accepted after repair';
  denied:=false;
  begin
    update public.memories set text='delayed old edit' where id=m;
  exception when serialization_failure then denied:=true;
  end;
  assert denied,'stale update accepted after repair';
  denied:=false;
  begin
    update public.memories set context_generation=1 where id=m;
  exception when invalid_parameter_value then denied:=true;
  end;
  assert denied,'old memory could be relabelled into new context';

  insert into public.memories(account_id,kind,text,source,context_generation) values(a,'fact','new context','founder',1) returning id into n;
  update public.memories set text='corrected new context' where id=n;
  assert (select text='corrected new context' from public.memories where id=n);
  denied:=false;
  begin
    update public.memories set account_id=b,context_generation=0 where id=n;
  exception when invalid_parameter_value then denied:=true;
  end;
  assert denied,'memory could move between tenants';
  denied:=false;
  begin
    update public.accounts set context_generation=0 where id=a;
  exception when invalid_parameter_value then denied:=true;
  end;
  assert denied,'context generation could go backwards';
  assert (select count(*)=2 from public.memories where account_id=a),'rejected writes left rows';
  assert (select text='old context' and valid_to is not null from public.memories where id=m),'history was not preserved';
  update public.accounts set context_generation=1 where id=b;
  assert (select revision=1 from public.account_state_meta where account_id=b),'first repair did not invalidate a previously empty snapshot';
end $$;

set local role authenticated;
do $$
declare denied boolean:=false;
begin
  assert has_table_privilege(current_user,'public.memories','SELECT');
  assert not has_table_privilege(current_user,'public.memories','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  assert not has_any_column_privilege(current_user,'public.memories','INSERT,UPDATE,REFERENCES');
  assert not has_column_privilege(current_user,'public.accounts','context_generation','UPDATE');
  begin
    update public.memories set text='legacy browser write' where false;
  exception when insufficient_privilege then denied:=true;
  end;
  assert denied,'legacy browser memory write not denied';
end $$;
set local role anon;
do $$
begin
  assert not has_table_privilege(current_user,'public.memories','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  assert not has_any_column_privilege(current_user,'public.memories','INSERT,UPDATE,REFERENCES');
  assert not has_column_privilege(current_user,'public.accounts','context_generation','UPDATE');
end $$;
rollback;
select 'PASS: stale memory writes denied, identity immutable, revision invalidated, current service writes accepted, legacy client writes denied; synthetic changes rolled back' as result;
