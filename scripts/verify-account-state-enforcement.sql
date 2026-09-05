-- Run after the server-writes-only migration. This does not issue a provider request.
-- Each attempted write targets zero rows and still must be denied at the grant layer.
begin;
set local role authenticated;
do $$
declare t text; denied boolean;
begin
  foreach t in array array['accounts','goals','resource_profiles','team_members','plans','business_profiles','account_state_meta','chat_messages'] loop
    denied:=false;
    begin
      execute format('delete from public.%I where false',t);
    exception when insufficient_privilege then denied:=true;
    end;
    assert denied,'legacy client delete was not denied';
    assert not has_any_column_privilege(current_user,'public.'||t,'INSERT,UPDATE,REFERENCES');
    assert not has_table_privilege(current_user,'public.'||t,'TRUNCATE,TRIGGER');
    assert has_table_privilege(current_user,'public.'||t,'SELECT'),'existing authenticated read revoked';
  end loop;
  denied:=false;
  begin
    update public.accounts set currency='NZD' where false;
  exception when insufficient_privilege then denied:=true;
  end;
  assert denied,'legacy column update was not denied';
  denied:=false;
  begin
    perform public.load_account_state_snapshot('00000000-0000-4000-8000-000000000000');
  exception when insufficient_privilege then denied:=true;
  end;
  assert denied,'client invoked service-only snapshot';
end $$;
set local role anon;
do $$
declare t text;
begin
  foreach t in array array['accounts','goals','resource_profiles','team_members','plans','business_profiles','account_state_meta','chat_messages'] loop
    assert not has_table_privilege(current_user,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    assert not has_any_column_privilege(current_user,'public.'||t,'INSERT,UPDATE,REFERENCES');
  end loop;
end $$;
rollback;
select 'PASS: legacy context writes denied; existing authenticated reads retained; service RPC denied to clients; no rows changed' as result;
