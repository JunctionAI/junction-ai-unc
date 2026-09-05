-- Run against the Unc project after the migration. Every test row rolls back.
begin;
set local role service_role;
do $$
declare
  acct uuid := gen_random_uuid(); conn uuid := gen_random_uuid();
  holder uuid := gen_random_uuid(); other uuid := gen_random_uuid();
  rejected boolean := false;
begin
  assert not has_table_privilege('anon','public.account_dataset_snapshots','SELECT');
  assert not has_table_privilege('authenticated','public.account_dataset_snapshots','SELECT');
  assert not has_table_privilege('authenticated','public.backend_leases','UPDATE');
  assert not has_function_privilege('anon','public.claim_backend_lease(text,uuid,integer)','EXECUTE');
  assert not has_function_privilege('authenticated','public.commit_connector_token(uuid,uuid,text,text,text,text,integer)','EXECUTE');
  insert into public.accounts(id,name) values(acct,'ROLLBACK foundation canary');
  insert into public.connectors(id,account_id,platform,status,external_ref) values(conn,acct,'meta_ads','connected','act_canary');
  insert into public.connector_secrets(connector_id,ciphertext,iv,tag) values(conn,'old_canary','iv_canary','tag_canary');
  assert public.claim_backend_lease('connector:'||conn::text,holder,30);
  assert not public.claim_backend_lease('connector:'||conn::text,other,30);
  assert not public.commit_connector_token(conn,other,'old_canary','bad','iv','tag',1);
  assert not public.commit_connector_token(conn,holder,'wrong_canary','bad','iv','tag',1);
  assert public.commit_connector_token(conn,holder,'old_canary','new_canary','iv','tag',2);
  assert not public.commit_connector_token(conn,holder,'old_canary','stale_canary','iv','tag',1);
  update public.backend_leases set expires_at=clock_timestamp()-interval '1 second' where lease_key='connector:'||conn::text;
  assert not public.commit_connector_token(conn,holder,'new_canary','expired_canary','iv','tag',1);
  assert public.claim_backend_lease('connector:'||conn::text,other,30);
  update public.connectors set status='disconnected' where id=conn;
  assert not public.commit_connector_token(conn,other,'new_canary','disconnected_canary','iv','tag',1);
  update public.connectors set status='connected' where id=conn;
  insert into public.account_dataset_snapshots(account_id,connector_id,external_ref,platform,query_hash,query,result,source_fetched_at)
    values(acct,conn,'act_canary','meta_ads',repeat('a',64),'{}','{"provenance":"ok"}',clock_timestamp());
  begin
    insert into public.account_dataset_snapshots(account_id,connector_id,external_ref,platform,query_hash,query,result,source_fetched_at)
      values(other,conn,'act_canary','meta_ads',repeat('a',64),'{}','{}',clock_timestamp());
  exception when raise_exception then rejected := true;
  end;
  assert rejected, 'cross-account dataset was accepted';
  assert (select ciphertext='new_canary' from public.connector_secrets where connector_id=conn);
end $$;
rollback;
select 'PASS: lease ownership, expiry, token compare-and-swap, disconnect guard, dataset isolation and client-role restrictions; canary rows rolled back' as result;
