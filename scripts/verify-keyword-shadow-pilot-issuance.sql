-- ROLLBACK-ONLY, no provider/network work. The fixture comes from the compiled
-- canonical spec via transaction-local unc.test_keyword_packet. Unlike synthetic
-- tenant tests, this proves the exact hard-pinned AVGAR function: the account row is
-- locked and its temporary unpause is never visible outside this transaction.
-- Requires the current paused/empty pilot. Never run without an outer rollback.
set local role service_role;
do $$
declare acct constant uuid:='aa5cfc84-2569-4c99-9b40-67003ae55eda'; actor uuid; a public.accounts%rowtype;
  input jsonb:=current_setting('unc.test_keyword_packet')::jsonb; bad jsonb; out jsonb; repeated jsonb;
  stamp text; expires text; rid uuid; other uuid:=gen_random_uuid(); denied boolean; scenario text; market text;
begin
  select * into a from public.accounts where id=acct for update;
  assert a.automation_paused and a.context_generation=1,'Canary only supports the currently paused repaired pilot';
  assert (select count(*)=0 from public.routine_runs where account_id=acct),'Existing pilot runs must not be mixed with this canary';
  assert (select count(*)=0 from public.n8n_workflows where account_id=acct),'Existing registration must not be modified by this canary';
  select user_id into actor from public.account_members where account_id=acct and role='owner' limit 1;
  assert actor is not null;
  stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  expires:=to_char((clock_timestamp()+interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  input:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(input,'{approval,authorizedBy}',to_jsonb(actor)),
    '{approval,expiresAt}',to_jsonb(expires)),'{run,startedAt}',to_jsonb(stamp)),'{run,snapshot,ctx,startedAt}',to_jsonb(stamp));
  input:=jsonb_set(input,'{run,snapshot,ctx,vars,website}',to_jsonb((select website from public.resource_profiles where account_id=acct)));
  rid:=(input #>> '{run,id}')::uuid;
  denied:=false; begin perform public.issue_keyword_shadow_pilot(input); exception when serialization_failure then denied:=true; end;
  assert denied,'Paused pilot admitted';
  update public.accounts set automation_paused=false where id=acct;

  foreach scenario in array array['wrong_owner','wrong_account','wrong_generation','wrong_seed','wrong_revision','wrong_currency',
    'unknown_market','too_many_calls','extra_approval_fields','empty_key','expired','late_expiry','bad_snapshot','dangerous_tail'] loop
    bad:=input;
    case scenario
      when 'wrong_owner' then bad:=jsonb_set(bad,'{approval,authorizedBy}',to_jsonb(other));
      when 'wrong_account' then bad:=jsonb_set(bad,'{run,accountId}',to_jsonb(other));
      when 'wrong_generation' then bad:=jsonb_set(bad,'{run,contextGeneration}','2');
      when 'wrong_seed' then bad:=jsonb_set(bad,'{contract,client,seedKeyword}','"unapproved"');
      when 'wrong_revision' then bad:=jsonb_set(bad,'{contract,workflowVersion}','"unfrozen"');
      when 'wrong_currency' then bad:=jsonb_set(bad,'{run,snapshot,ctx,account,currency}','"USD"');
      when 'unknown_market' then bad:=jsonb_set(bad,'{approval,market}','"UK"');
      when 'too_many_calls' then bad:=jsonb_set(bad,'{approval,maxProviderCalls}','2');
      when 'extra_approval_fields' then bad:=jsonb_set(bad,'{approval,unrelated}','"not part of approval"');
      when 'empty_key' then bad:=jsonb_set(bad,'{approval,idempotencyKey}','""');
      when 'expired' then bad:=jsonb_set(bad,'{approval,expiresAt}',to_jsonb((clock_timestamp()-interval '1 minute')::text));
      when 'late_expiry' then bad:=jsonb_set(bad,'{approval,expiresAt}',to_jsonb((clock_timestamp()+interval '11 minutes')::text));
      when 'bad_snapshot' then bad:=jsonb_set(bad,'{run,snapshot,ctx,runId}',to_jsonb(other));
      when 'dangerous_tail' then bad:=jsonb_set(bad,'{run,snapshot,spec,nodes,4,kind}','"execute"');
    end case;
    denied:=false; begin perform public.issue_keyword_shadow_pilot(bad); exception when check_violation or serialization_failure then denied:=true; end;
    assert denied,'Invalid pilot admitted: '||scenario;
    assert (select count(*)=0 from public.routine_runs where account_id=acct),'Partial run after refusal';
    assert (select count(*)=0 from public.n8n_workflows where account_id=acct),'Partial registration after refusal';
  end loop;

  -- A fault AFTER registration insertion must roll back that registration too.
  insert into public.routine_runs(id,account_id,context_generation,routine_id,version,mode,status)
    values(rid,acct,1,'D03-W01',2,'dry_run','running');
  denied:=false; begin perform public.issue_keyword_shadow_pilot(input); exception when unique_violation then denied:=true; end;
  assert denied and (select count(*)=0 from public.n8n_workflows where account_id=acct),'Partial registration survived failed run insertion';
  delete from public.routine_runs where id=rid;

  out:=public.issue_keyword_shadow_pilot(input);
  assert out->>'created'='true' and out->>'runId'=rid::text;
  assert (select count(*)=1 from public.n8n_shadow_permits where account_id=acct and status='reserved' and issuance=input->'approval');
  bad:=jsonb_set(jsonb_set(input,'{run,id}',to_jsonb(other)),'{run,snapshot,ctx,runId}',to_jsonb(other));
  repeated:=public.issue_keyword_shadow_pilot(bad);
  assert repeated=out||'{"created":false}'::jsonb,'Retry issued a new allowance';
  assert (select count(*)=1 from public.routine_runs where account_id=acct);
  denied:=false; begin
    update public.n8n_shadow_permits set issuance='{}'::jsonb where run_id=rid;
  exception when check_violation then denied:=true; end;
  assert denied,'Approval evidence was mutable';

  update public.n8n_workflows set active=false where id=(out->>'registrationId')::uuid;
  bad:=jsonb_set(bad,'{approval,idempotencyKey}','"SYNTHETIC-SECOND-ALLOWANCE"');
  denied:=false; begin perform public.issue_keyword_shadow_pilot(bad); exception when check_violation then denied:=true; end;
  assert denied and (select active=false from public.n8n_workflows where id=(out->>'registrationId')::uuid),'Revoked registration was reactivated';
  update public.n8n_workflows set active=true where id=(out->>'registrationId')::uuid;

  foreach market in array array['NZ','AU'] loop
    other:=gen_random_uuid();
    bad:=jsonb_set(jsonb_set(input,'{run,id}',to_jsonb(other)),'{run,snapshot,ctx,runId}',to_jsonb(other));
    bad:=jsonb_set(jsonb_set(bad,'{approval,market}',to_jsonb(market)),
      '{contract,client,locationCode}',to_jsonb(case market when 'NZ' then 2554 else 2036 end));
    bad:=jsonb_set(bad,'{run,snapshot,spec,nodes,3,shadowContract}',bad->'contract');
    denied:=false; begin perform public.issue_keyword_shadow_pilot(bad); exception when check_violation then denied:=true; end;
    assert denied,'Same approval key rebound to another country';
    bad:=jsonb_set(bad,'{approval,idempotencyKey}',to_jsonb('SYNTHETIC-ROLLBACK-ONLY-'||market));
    repeated:=public.issue_keyword_shadow_pilot(bad);
    assert repeated->>'created'='true' and repeated->>'registrationId'=out->>'registrationId';
  end loop;
  assert (select count(*)=3 from public.routine_runs where account_id=acct);
  assert (select count(*)=3 from public.n8n_shadow_permits where account_id=acct and status='reserved' and request_digest is null);
  assert (select count(*)=1 from public.n8n_workflows where account_id=acct);
  assert (select count(*)=0 from public.routine_states where account_id=acct and enabled),'Pilot enabled a routine';
  assert (select count(*)=0 from public.artifacts where account_id=acct),'Pilot fabricated a result';
  assert not has_function_privilege('anon','public.issue_keyword_shadow_pilot(jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.issue_keyword_shadow_pilot(jsonb)','EXECUTE');
end $$;
reset role;
select 'PASS: exact pinned pilot issuance atomicity, US/NZ/AU separation, immutable approval/key, no reactivation or switch enablement, pause/owner/context denials and private RPC' as canary;
