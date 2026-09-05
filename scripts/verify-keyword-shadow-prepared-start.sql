-- ROLLBACK ONLY. Supply the compiled canonical issuance packet through transaction-
-- local unc.test_keyword_packet. Temporary AVGAR fixture edits remain row-locked and
-- invisible outside this transaction. No engine, workflow or provider is called.
set local role service_role;
do $$
declare acct constant uuid:='aa5cfc84-2569-4c99-9b40-67003ae55eda'; actor uuid;
  packet jsonb:=current_setting('unc.test_keyword_packet')::jsonb; request jsonb; bad jsonb; issued jsonb;
  rid uuid; stamp text; expiry text; scenario text; cases integer:=0;
begin
  perform 1 from public.accounts where id=acct for update;
  assert (select automation_paused and context_generation=1 from public.accounts where id=acct), 'Paused original pilot required';
  assert not exists(select 1 from public.routine_runs where account_id=acct), 'Canary requires an empty pilot';
  assert not exists(select 1 from public.n8n_workflows where account_id=acct), 'Canary must not modify an existing registration';
  select user_id into actor from public.account_members where account_id=acct and role='owner' limit 1;
  stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  expiry:=to_char((clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  packet:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(packet,'{approval,authorizedBy}',to_jsonb(actor)),
    '{approval,expiresAt}',to_jsonb(expiry)),'{run,startedAt}',to_jsonb(stamp)),'{run,snapshot,ctx,startedAt}',to_jsonb(stamp));
  packet:=jsonb_set(packet,'{run,snapshot,ctx,vars,website}',to_jsonb((select website from public.resource_profiles where account_id=acct)));
  packet:=jsonb_set(packet,'{run,snapshot,startProtocol}','"keyword_claim_v1"');
  rid:=(packet #>> '{run,id}')::uuid;
  update public.accounts set automation_paused=false where id=acct;
  issued:=public.issue_keyword_shadow_pilot(packet);
  request:=jsonb_build_object('run',packet->'run');

  foreach scenario in array array['paused','owner_removed','registration_disabled','registration_repointed','wrong_account',
    'wrong_run','wrong_generation','changed_snapshot','legacy','partial_reads','started','dispatched','expired'] loop
    begin
      bad:=request;
      case scenario
        when 'paused' then update public.accounts set automation_paused=true where id=acct;
        when 'owner_removed' then delete from public.account_members where account_id=acct and user_id=actor;
        when 'registration_disabled' then update public.n8n_workflows set active=false where id=(issued->>'registrationId')::uuid;
        when 'registration_repointed' then update public.n8n_workflows set webhook_url='https://invalid.example/refuse' where id=(issued->>'registrationId')::uuid;
        when 'wrong_account' then bad:=jsonb_set(bad,'{run,accountId}',to_jsonb(gen_random_uuid()));
        when 'wrong_run' then bad:=jsonb_set(bad,'{run,id}',to_jsonb(gen_random_uuid()));
        when 'wrong_generation' then bad:=jsonb_set(bad,'{run,contextGeneration}','2');
        when 'changed_snapshot' then bad:=jsonb_set(bad,'{run,snapshot,ctx,vars,website}','"https://unapproved.example/"');
        when 'legacy' then
          bad:=bad #- '{run,snapshot,startProtocol}';
          update public.routine_runs set snapshot=bad #> '{run,snapshot}' where id=rid;
        when 'partial_reads' then
          bad:=jsonb_set(bad,'{run,snapshot,ctx,reads}','{"prior":{"rows":[],"metrics":{}}}');
          update public.routine_runs set snapshot=bad #> '{run,snapshot}' where id=rid;
        when 'started' then
          update public.routine_runs set snapshot=jsonb_set(snapshot,'{awaiting}','"keyword_started"') where id=rid;
        when 'dispatched' then
          update public.n8n_shadow_permits set status='dispatching',request_digest=repeat('a',64),token_digest=repeat('b',64) where run_id=rid;
        when 'expired' then
          -- A separate tiny-lived allowance, never a mutation of immutable approval.
          packet:=jsonb_set(packet,'{run,id}',to_jsonb(gen_random_uuid()));
          packet:=jsonb_set(packet,'{run,snapshot,ctx,runId}',packet #> '{run,id}');
          packet:=jsonb_set(packet,'{approval,idempotencyKey}','"SYNTHETIC-EXPIRED-START"');
          packet:=jsonb_set(packet,'{approval,expiresAt}',to_jsonb((clock_timestamp()+interval '40 milliseconds')::text));
          perform public.issue_keyword_shadow_pilot(packet);
          perform pg_sleep(0.06);
          bad:=jsonb_build_object('run',packet->'run');
      end case;
      assert public.claim_keyword_shadow_start(bad)=false, 'Unsafe start admitted: '||scenario;
      -- Roll back each scenario's fixture edits without swallowing failed assertions.
      raise exception using errcode='ZX001',message='successful refusal; roll back fixture edits';
    exception when sqlstate 'ZX001' then cases:=cases+1;
    end;
  end loop;

  assert public.claim_keyword_shadow_start(request)=true, 'Original reserved run did not start';
  assert public.claim_keyword_shadow_start(request)=false, 'Same prepared run claimed twice';
  assert (select snapshot->>'awaiting'='keyword_started' from public.routine_runs where id=rid);
  assert (select count(*)=1 from public.n8n_shadow_permits where account_id=acct and status='reserved'
    and request_digest is null and dispatched_at is null), 'Start issued or consumed paid authority';
  assert (select count(*)=1 from public.routine_runs where account_id=acct), 'Recovery made another run';
  assert not exists(select 1 from public.receipts where run_id=rid), 'Start fabricated a receipt';
  assert not exists(select 1 from public.artifacts where run_id=rid), 'Start fabricated an artifact';
  assert not exists(select 1 from public.routine_states where account_id=acct and enabled), 'Start enabled routines';
  assert not has_function_privilege('anon','public.claim_keyword_shadow_start(jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.claim_keyword_shadow_start(jsonb)','EXECUTE');
  assert has_function_privilege('service_role','public.claim_keyword_shadow_start(jsonb)','EXECUTE');
  assert cases=13;
end $$;
reset role;
select 'PASS: one-use prepared start, 13 refusal scenarios, unchanged paid allowance, original run, no public RPC access' as canary;
