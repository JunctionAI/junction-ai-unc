-- Real PostgreSQL protocol/role checks; all synthetic records roll back.
-- This is not a simultaneous multi-session stress test or a live OAuth exchange.
begin;
set local role service_role;
do $$
declare
  acct uuid := gen_random_uuid();
  other_acct uuid := gen_random_uuid();
  conn uuid := gen_random_uuid();
  oauth_state text := 'ROLLBACK-oauth-lifecycle-' || gen_random_uuid()::text;
  consumed public.oauth_states%rowtype;
  before_row jsonb;
  affected integer;
begin
  assert not has_table_privilege('anon','public.oauth_states','SELECT');
  assert not has_table_privilege('authenticated','public.oauth_states','DELETE');
  assert not has_table_privilege('authenticated','public.connector_secrets','SELECT');
  insert into public.accounts(id,name) values(acct,'ROLLBACK OAuth lifecycle canary'),(other_acct,'ROLLBACK OAuth isolation canary');
  insert into public.connectors(id,account_id,platform,status,external_ref,last_sync_result)
    values(conn,acct,'klaviyo','connected','synthetic-original','ok');
  insert into public.connector_secrets(connector_id,ciphertext,iv,tag)
    values(conn,'synthetic-preserved','synthetic-iv','synthetic-tag');
  insert into public.connectors(account_id,platform,status) values(other_acct,'klaviyo','connecting');
  select to_jsonb(c) into before_row from public.connectors c where id=conn;

  -- The native-start sequence must neither overwrite nor temporarily disable the grant.
  insert into public.connectors(account_id,platform,status) values(acct,'klaviyo','connecting')
    on conflict(account_id,platform) do nothing;
  update public.connectors set status='connecting' where account_id=acct and platform='klaviyo'
    and status in ('disconnected','needs_reconnect','error');
  get diagnostics affected=row_count;
  assert affected=0;
  assert (select to_jsonb(c)=before_row from public.connectors c where id=conn);

  -- Failed callbacks cannot overwrite connected/disconnected rows or another tenant.
  update public.connectors set status='error',last_sync_result='error:oauth'
    where account_id=acct and platform='klaviyo' and status='connecting';
  get diagnostics affected=row_count;
  assert affected=0;
  assert (select to_jsonb(c)=before_row from public.connectors c where id=conn);
  assert (select status='connecting' from public.connectors where account_id=other_acct and platform='klaviyo');
  assert (select ciphertext='synthetic-preserved' from public.connector_secrets where connector_id=conn);

  update public.connectors set status='disconnected' where id=conn;
  update public.connectors set status='error',last_sync_result='error:oauth'
    where account_id=acct and platform='klaviyo' and status='connecting';
  assert (select status='disconnected' from public.connectors where id=conn);

  -- A pending first connection still records an honest failure.
  update public.connectors set status='connecting' where id=conn;
  update public.connectors set status='error',last_sync_result='error:oauth'
    where account_id=acct and platform='klaviyo' and status='connecting';
  assert (select status='error' and last_sync_result='error:oauth' from public.connectors where id=conn);
  -- The update-only failure path cannot recreate a missing connector.
  update public.connectors set status='error',last_sync_result='error:oauth'
    where account_id=acct and platform='hubspot' and status='connecting';
  assert not exists(select 1 from public.connectors where account_id=acct and platform='hubspot');

  insert into public.oauth_states(state,account_id,platform,expires_at)
    values(oauth_state,acct,'klaviyo',clock_timestamp()+interval '10 minutes');
  delete from public.oauth_states where state=oauth_state returning * into consumed;
  assert consumed.state=oauth_state and consumed.account_id=acct and consumed.platform='klaviyo';
  delete from public.oauth_states where state=oauth_state returning * into consumed;
  assert consumed.state is null, 'a consumed state was returned twice';
end $$;
rollback;
select 'PASS: OAuth DELETE RETURNING, healthy-grant preservation, guarded failure transitions, tenant predicates and client-role restrictions; all synthetic records rolled back' as result;
