-- Synthetic rollback-only service-role exercise. No provider calls or real token reads.
begin;
set local lock_timeout='5s';
set local statement_timeout='25s';
set local role service_role;
do $$
declare a uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); actor uuid; ctx jsonb; next_ctx jsonb;
  holder uuid:=gen_random_uuid(); other_holder uuid:=gen_random_uuid(); outcome jsonb; health jsonb; rejected boolean;
begin
  select user_id into actor from public.account_members where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null,'Fixture owner required';
  insert into public.accounts(id,name,context_generation) values(a,'UNC_TOKEN_CONTEXT_CANARY',7);
  insert into public.account_members(account_id,user_id,role) values(a,actor,'owner');
  insert into public.connectors(id,account_id,platform,status,external_ref,sync_ref) values(c,a,'ga4','connected','asset-a','{}');
  insert into public.connector_secrets(connector_id,ciphertext,iv,tag,key_version) values(c,'synthetic-old','iv','tag',1);
  ctx:=public.capture_connector_token(c,a,'ga4',7,actor)->'context';
  assert ctx is not null and public.check_connector_token_context(ctx),'Current capture rejected';
  assert public.capture_connector_token(c,gen_random_uuid(),'ga4',7,actor) is null,'Cross-account capture allowed';
  assert public.capture_connector_token(c,a,'shopify',7,actor) is null,'Wrong provider allowed';
  assert public.capture_connector_token(c,a,'ga4',6,actor) is null,'Old generation allowed';
  assert public.capture_connector_token(c,a,'ga4',7,gen_random_uuid()) is null,'Wrong owner allowed';
  outcome:=jsonb_build_object('context',ctx,'kind','reconnect','code','invalid_grant');
  update public.accounts set context_generation=8 where id=a;
  assert public.settle_connector_token(outcome) is null,'Stale generation changed status';
  ctx:=public.capture_connector_token(c,a,'ga4',8,actor)->'context';
  outcome:=jsonb_build_object('context',ctx,'kind','reconnect','code','invalid_grant');
  update public.accounts set automation_paused=true where id=a;
  assert public.settle_connector_token(outcome) is null,'Pause ignored';
  assert public.capture_connector_token(c,a,'ga4',8,actor) is null,'Paused run capture allowed';
  update public.accounts set automation_paused=false where id=a;
  update public.account_members set role='member' where account_id=a;
  assert public.settle_connector_token(outcome) is null,'Owner removal ignored';
  update public.account_members set role='owner' where account_id=a;
  update public.connectors set status='disconnected' where id=c;
  assert public.settle_connector_token(outcome) is null,'Disconnected grant changed';
  update public.connectors set status='connected',sync_ref='{"auth_provider":"nango","provider_connection_id":"new"}' where id=c;
  assert public.settle_connector_token(outcome) is null,'New provider pointer changed';
  update public.connectors set sync_ref='{}' where id=c;
  update public.connector_secrets set ciphertext='synthetic-new-login' where connector_id=c;
  assert public.settle_connector_token(outcome) is null,'New login downgraded';
  update public.connector_secrets set ciphertext='synthetic-old' where connector_id=c;
  assert (select status='connected' from public.connectors where id=c),'Late invalid_grant changed status';

  assert public.claim_backend_lease('connector:'||c::text,holder,30),'Lease refused';
  assert not public.claim_backend_lease('connector:'||c::text,other_holder,30),'Second holder admitted';
  assert public.begin_connector_refresh(jsonb_build_object('context',ctx,'holder',holder)),'Refresh claim refused';
  assert not public.begin_connector_refresh(jsonb_build_object('context',ctx,'holder',holder)),'Duplicate refresh admitted';
  health:=public.connector_recovery_state(a,actor);
  assert health->0->>'status'='pending','In-flight status missing';
  assert not (health->0 ?| array['secret_digest','ciphertext','holder']),'Private recovery fields exposed';
  assert public.connector_recovery_state(a,gen_random_uuid()) is null,'Non-member health exposed';
  update public.backend_leases set expires_at=clock_timestamp()-interval '1 second' where lease_key='connector:'||c::text;
  assert public.connector_recovery_state(a,actor)->0->>'status'='uncertain','Expired pending refresh not held';
  assert public.claim_backend_lease('connector:'||c::text,other_holder,30),'Expired lease unavailable';
  assert not public.begin_connector_refresh(jsonb_build_object('context',ctx,'holder',other_holder)),'Restart replay admitted';
  assert public.settle_connector_token(outcome||jsonb_build_object('holder',holder,'refreshAttempt',true)) is null,'Expired holder settled';

  -- Reset only this synthetic attempt to exercise bounded, classified failures.
  update public.connector_refresh_attempts set holder=other_holder where connector_id=c;
  outcome:=jsonb_build_object('context',ctx,'holder',other_holder,'refreshAttempt',true,'kind','temporary','retryable',true);
  assert public.settle_connector_token(outcome) is not null,'Classified failure refused';
  assert not public.begin_connector_refresh(jsonb_build_object('context',ctx,'holder',other_holder)),'Cooldown ignored';
  update public.connector_refresh_attempts set retry_at=clock_timestamp()-interval '1 second' where connector_id=c;
  assert public.begin_connector_refresh(jsonb_build_object('context',ctx,'holder',other_holder)),'Second retry refused';
  assert public.settle_connector_token(outcome) is not null;
  update public.connector_refresh_attempts set retry_at=clock_timestamp()-interval '1 second' where connector_id=c;
  assert public.begin_connector_refresh(jsonb_build_object('context',ctx,'holder',other_holder)),'Third retry refused';
  assert public.settle_connector_token(outcome) is not null;
  update public.connector_refresh_attempts set retry_at=clock_timestamp()-interval '1 second' where connector_id=c;
  assert not public.begin_connector_refresh(jsonb_build_object('context',ctx,'holder',other_holder)),'Retry budget exceeded';
  assert public.connector_recovery_state(a,actor)->0->>'status'='exhausted';
  assert (select status='connected' from public.connectors where id=c),'Transient error required customer login';

  -- A newly sealed grant has independent evidence; old attempts cannot shadow it.
  update public.connector_secrets set ciphertext='synthetic-fresh' where connector_id=c;
  assert public.connector_recovery_state(a,actor)='[]'::jsonb,'Old grant recovery leaked into new login';
  ctx:=public.capture_connector_token(c,a,'ga4',8,actor)->'context';
  assert public.begin_connector_refresh(jsonb_build_object('context',ctx,'holder',other_holder));
  outcome:=jsonb_build_object('context',ctx,'holder',other_holder,'refreshAttempt',true,'kind','success','sealed',
    jsonb_build_object('ciphertext','synthetic-rotated','iv','iv','tag','','keyVersion',1));
  rejected:=false;
  begin perform public.settle_connector_token(outcome); exception when check_violation then rejected:=true; end;
  assert rejected,'Invalid sealed token accepted';
  assert (select ciphertext='synthetic-fresh' from public.connector_secrets where connector_id=c),'Partial secret committed';
  assert (select status='pending' from public.connector_refresh_attempts where connector_id=c and secret_digest=ctx->'binding'->>'secretDigest'),'Partial outcome committed';
  update public.connectors set external_ref='asset-b' where id=c;
  assert not public.check_connector_token_context(ctx),'Reader rebased to new asset';
  assert public.check_connector_token_context(ctx,true),'Same grant blocked by asset selection';
  next_ctx:=public.settle_connector_token(jsonb_set(outcome,'{sealed,tag}','"tag"'));
  assert next_ctx is not null and next_ctx->'binding'->>'externalRef'='asset-b';
  assert public.check_connector_token_context(next_ctx),'Settled context invalid';
  assert not public.check_connector_token_context(ctx),'Old grant still current';
  assert (select ciphertext='synthetic-rotated' from public.connector_secrets where connector_id=c);
  assert (select status='succeeded' from public.connector_refresh_attempts where connector_id=c and secret_digest=ctx->'binding'->>'secretDigest');
  assert public.connector_recovery_state(a,actor)='[]'::jsonb;

  assert not has_table_privilege('anon','public.connector_refresh_attempts','SELECT');
  assert not has_table_privilege('authenticated','public.connector_refresh_attempts','SELECT');
  assert (select relrowsecurity from pg_class where oid='public.connector_refresh_attempts'::regclass);
  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('capture_connector_token','check_connector_token_context','begin_connector_refresh','settle_connector_token','connector_recovery_state')
    and (p.prosecdef or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),'Unsafe function privilege';
end $$;
rollback;
select 'PASS: token context, lease, durable uncertainty, bounded retries, atomic grant settlement, redacted health and service-only permissions; synthetic rows rolled back' as result;
