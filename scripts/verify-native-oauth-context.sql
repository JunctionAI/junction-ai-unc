-- Synthetic, rollback-only service-role exercise. No OAuth exchange/provider call.
begin;
set local lock_timeout='5s';
set local statement_timeout='25s';
set local role service_role;
do $$
declare a uuid:=gen_random_uuid(); actor uuid; ctx jsonb; next_ctx jsonb; attempt jsonb; c uuid; g uuid;
  replacements jsonb; before_binding jsonb; rejected boolean; first_read jsonb; metric jsonb;
begin
  select user_id into actor from public.account_members where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' and role='owner' limit 1;
  assert actor is not null,'Existing fixture owner required';
  insert into public.accounts(id,name,context_generation) values(a,'UNC_NATIVE_OAUTH_CANARY',7);
  insert into public.account_members(account_id,user_id,role) values(a,actor,'owner');
  attempt:=jsonb_build_object('state','synthetic_native_oauth_state_01','account_id',a,'initiated_by',actor,'platform','klaviyo',
    'code_verifier','synthetic-verifier','shop',null,'expires_at',clock_timestamp()+interval '10 minutes');
  ctx:=public.begin_native_connector_oauth(attempt);
  c:=(ctx->'targets'->0->>'id')::uuid;
  assert ctx->>'contextGeneration'='7' and ctx->>'initiatedBy'=actor::text;
  assert (select pending_oauth_digest<>attempt->>'state' and length(pending_oauth_digest)=64 from public.connectors where id=c);
  assert public.check_native_connector_oauth(attempt->>'state',ctx,actor,false),'Fresh captured binding not current';
  assert not public.check_native_connector_oauth(attempt->>'state',ctx,gen_random_uuid(),false),'Wrong owner accepted';
  update public.accounts set context_generation=8 where id=a;
  assert not public.check_native_connector_oauth(attempt->>'state',ctx,actor,false),'Old account generation accepted';
  attempt:=attempt||jsonb_build_object('state','synthetic_native_oauth_state_02');
  ctx:=public.begin_native_connector_oauth(attempt);
  update public.connectors set status='disconnected' where id=c;
  assert not public.check_native_connector_oauth(attempt->>'state',ctx,actor,false),'Disconnected binding accepted';
  update public.connectors set status='connecting' where id=c;
  insert into public.connector_secrets(connector_id,ciphertext,iv,tag,key_version) values(c,'synthetic-old-cipher','synthetic-iv','synthetic-tag',1);
  assert not public.check_native_connector_oauth(attempt->>'state',ctx,actor,false),'Replaced secret accepted';
  attempt:=attempt||jsonb_build_object('state','synthetic_native_oauth_state_03');
  ctx:=public.begin_native_connector_oauth(attempt);
  next_ctx:=public.begin_native_connector_oauth(attempt||jsonb_build_object('state','synthetic_native_oauth_state_04'));
  assert not public.fail_native_connector_oauth(attempt->>'state',ctx,actor),'Old attempt cleared a newer marker';
  assert public.check_native_connector_oauth('synthetic_native_oauth_state_04',next_ctx,actor,false),'New attempt was damaged';
  replacements:=jsonb_build_array(jsonb_build_object('connectorId',c,'externalRef','synthetic-external','sealed',
    jsonb_build_object('ciphertext','synthetic-new-cipher','iv','synthetic-iv','tag','synthetic-tag','keyVersion',1)));
  assert public.finish_native_connector_oauth('synthetic_native_oauth_state_04',next_ctx,actor,replacements),'Current finish refused';
  assert not public.finish_native_connector_oauth('synthetic_native_oauth_state_04',next_ctx,actor,replacements),'Duplicate finish accepted';
  update public.connectors set last_sync_result='ok',sync_ref='{"dataset":"kept","auth_provider":"nango","provider_connection_id":"old"}' where id=c;
  before_binding:=public.native_oauth_binding(c);
  attempt:=attempt||jsonb_build_object('state','synthetic_native_oauth_state_05');
  ctx:=public.begin_native_connector_oauth(attempt);
  assert public.native_oauth_binding(c)=before_binding,'Reconnect interrupted working grant';
  assert public.fail_native_connector_oauth(attempt->>'state',ctx,actor),'Current denial refused';
  assert public.native_oauth_binding(c)=before_binding,'Denial changed working grant';
  attempt:=attempt||jsonb_build_object('state','synthetic_native_oauth_state_06');
  ctx:=public.begin_native_connector_oauth(attempt);
  assert public.finish_native_connector_oauth(attempt->>'state',ctx,actor,replacements);
  assert (select sync_ref='{"dataset":"kept"}'::jsonb from public.connectors where id=c),'Hosted pointer survived native grant';

  attempt:=attempt||jsonb_build_object('state','synthetic_native_oauth_google_01','platform','google');
  ctx:=public.begin_native_connector_oauth(attempt);
  assert jsonb_array_length(ctx->'targets')=3;
  select jsonb_agg(jsonb_build_object('connectorId',x->>'id','externalRef','synthetic-google','sealed',
    jsonb_build_object('ciphertext','synthetic-google-cipher','iv','synthetic-iv','tag',case when x->>'platform'='search_console' then '' else 'synthetic-tag' end,'keyVersion',1)) order by x->>'platform')
    into replacements from jsonb_array_elements(ctx->'targets') x;
  rejected:=false;
  begin perform public.finish_native_connector_oauth(attempt->>'state',ctx,actor,replacements);
  exception when check_violation then rejected:=true; end;
  assert rejected,'Invalid third sealed bundle accepted';
  assert not exists(select 1 from public.connector_secrets s join public.connectors t on t.id=s.connector_id where t.account_id=a and t.platform in ('ga4','google_ads','search_console')),'Partial Google tokens survived rollback';
  assert not exists(select 1 from public.connectors where account_id=a and platform in ('ga4','google_ads','search_console') and status='connected');
  replacements:=jsonb_set(replacements,'{2,sealed,tag}','"synthetic-tag"');
  assert public.finish_native_connector_oauth(attempt->>'state',ctx,actor,replacements);
  assert (select count(*)=3 from public.connector_secrets s join public.connectors t on t.id=s.connector_id where t.account_id=a and t.platform in ('ga4','google_ads','search_console'));

  select id into g from public.connectors where account_id=a and platform='ga4';
  metric:=jsonb_build_object('account_id',a,'context_generation',8,'metric_key','sessions_7d','value',7,'currency',null,
    'window_start',current_date-7,'window_end',current_date,'platform','ga4','provenance','fixture','captured_at',clock_timestamp());
  first_read:=jsonb_build_object('binding',public.native_oauth_binding(g)-array['status','secretDigest'],
    'contextGeneration',8,'actor',actor,'result','ok','description','Synthetic certified read','payload','{}'::jsonb,'metrics',jsonb_build_array(metric));
  update public.connectors set external_ref='different-google' where id=g;
  assert not public.record_connector_first_read(first_read),'Wrong selected account accepted';
  update public.connectors set external_ref='synthetic-google' where id=g;
  update public.accounts set automation_paused=true where id=a;
  assert not public.record_connector_first_read(first_read),'Paused first read accepted';
  update public.accounts set automation_paused=false where id=a;
  update public.account_members set role='member' where account_id=a and user_id=actor;
  assert not public.record_connector_first_read(first_read),'Removed owner accepted';
  update public.account_members set role='owner' where account_id=a and user_id=actor;
  rejected:=false;
  begin perform public.record_connector_first_read(first_read||jsonb_build_object('metrics',jsonb_build_array(metric,metric||'{"metric_key":"bad_second","value":"not-a-number"}'::jsonb)));
  exception when invalid_text_representation then rejected:=true; end;
  assert rejected,'Invalid second metric accepted';
  assert not exists(select 1 from public.kpi_snapshots where account_id=a),'Partial KPI insert survived rollback';
  assert (select last_sync_result is null from public.connectors where id=g),'Partial success flag survived rollback';
  assert not exists(select 1 from public.receipts where account_id=a),'Partial receipt survived rollback';
  assert public.record_connector_first_read(first_read),'Current first read refused';
  assert (select count(*)=1 from public.kpi_snapshots where account_id=a and context_generation=8);
  assert (select last_sync_result='ok' and last_read_metrics=1 from public.connectors where id=g);
  assert (select count(*)=1 from public.receipts where account_id=a and context_generation=8);
  update public.accounts set context_generation=9 where id=a;
  assert not public.record_connector_first_read(first_read),'Old read crossed reset';

  assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('native_oauth_binding','begin_native_connector_oauth','check_native_connector_oauth','finish_native_connector_oauth','fail_native_connector_oauth','record_connector_first_read')
    and (p.prosecdef or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),'Unsafe function privilege';
end $$;
rollback;
select 'PASS: service-role native OAuth ownership/context/newer-attempt/secret and Google rollback gates; first-read metrics/status/receipt atomicity; all synthetic data rolled back' as result;
