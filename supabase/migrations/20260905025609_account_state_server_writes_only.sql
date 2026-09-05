-- Applied version 20260905025609, after the replacement app passed a signed-in atomic save.
-- Keep SELECT/RLS unchanged; authenticated session-bound server APIs own context writes.
-- Old app versions are not a compatible rollback after this enforcement migration.
begin;
revoke insert,update,delete,truncate,references,trigger on table
  public.accounts,public.goals,public.resource_profiles,public.team_members,
  public.plans,public.business_profiles,public.account_state_meta,public.chat_messages
  from public,anon,authenticated;
-- Revoking table privileges does not revoke an existing column-specific grant.
revoke update(name,currency) on public.accounts from public,anon,authenticated;

do $$
declare role_name text; table_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach table_name in array array['accounts','goals','resource_profiles','team_members','plans','business_profiles','account_state_meta','chat_messages'] loop
      assert not has_table_privilege(role_name,'public.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'unexpected client table write privilege';
      assert not has_any_column_privilege(role_name,'public.'||table_name,'INSERT,UPDATE,REFERENCES'),'unexpected client column write privilege';
    end loop;
  end loop;
  assert has_function_privilege('service_role','public.save_account_state_atomic(uuid,uuid,bigint,uuid,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.save_account_state_atomic(uuid,uuid,bigint,uuid,jsonb)','EXECUTE');
end $$;
commit;
