-- Operator-only, single-account repair. Rehearse with COMMIT replaced by ROLLBACK.
-- Never automatically rerun after an uncertain response: inspect context_repairs first.
-- All displaced rows are retained in the private archive. No credential/provider writes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
declare
  a uuid := 'aa5cfc84-2569-4c99-9b40-67003ae55eda';
  repair_id uuid := gen_random_uuid();
  target text; captured jsonb; backup jsonb := '{}'; others jsonb := '{}'; digest text;
  connector_digest text; secret_digest text;
  stamp timestamptz := clock_timestamp();
begin
  assert current_user='postgres','database administrator required';
  perform 1 from public.accounts where id=a for update;
  assert found,'pilot account missing';
  assert (select context_generation=0 from public.accounts where id=a),'already repaired; reconcile instead of retrying';
  assert (select profile->>'name'='Junction AI' from public.business_profiles where account_id=a),'unexpected business context';
  assert (select revision=5 from public.account_state_meta where account_id=a),'new account edits require review';
  assert exists(select 1 from public.account_members m join auth.users u on u.id=m.user_id where m.account_id=a and m.role='owner' and u.email='halltaylor.tom@gmail.com'),'unexpected owner';
  assert exists(select 1 from public.connectors where account_id=a and platform='meta_ads' and external_ref='act_3235248400060604' and status='connected'),'Meta binding changed';
  assert exists(select 1 from public.connectors where account_id=a and platform='shopify' and external_ref='avgar-sport.myshopify.com' and status='connected'),'Shopify binding changed';
  assert not exists(select 1 from public.routine_runs where account_id=a and status='running'),'drain current runs first';
  assert not exists(select 1 from public.routine_commands where account_id=a),'reconcile command queue first';
  assert not exists(select 1 from public.intake_keys where account_id=a),'reconcile intake writers first';
  assert not exists(select 1 from public.channel_links where account_id=a),'reconcile channel writers first';
  assert not exists(select 1 from public.approvals where account_id=a),'reconcile approvals first';
  assert not exists(select 1 from public.action_ledger where account_id=a),'reconcile action ledger first';
  assert not exists(select 1 from public.receipts where account_id=a and kind='mutation'),'review outward-action evidence first';
  select md5(jsonb_agg(to_jsonb(c) order by id)::text) into connector_digest from public.connectors c where account_id=a;
  select md5(jsonb_agg(to_jsonb(s) order by connector_id)::text) into secret_digest from public.connector_secrets s where connector_id in(select id from public.connectors where account_id=a);
  backup := jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(t)) from public.accounts t where id=a));
  update public.accounts set automation_paused=true where id=a;

  foreach target in array array['business_profiles','resource_profiles','team_members','goals','plans','account_state_meta','account_profiles','memories','chat_messages','artifacts','daily_briefs','routine_runs','receipts','routine_outcomes','self_reviews','taste_events','routine_states','account_presets','routine_params'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t where account_id=$1',target) into captured using a;
    assert jsonb_array_length(captured)<1000,'unexpected repair size';
    backup:=backup || jsonb_build_object(target,captured);
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text) from public.%I t where account_id<>$1',target) into digest using a;
    others:=others || jsonb_build_object(target,digest);
  end loop;
  insert into unc_private.context_repairs(id,account_id,reason,before_generation,after_generation,original_rows,evidence)
  values(repair_id,a,'AVGAR connections had Junction business context; preserve displaced context and reset unverified commercial settings',0,1,backup,
    jsonb_build_object('public_source','https://avgarsport.com/','verified_at',stamp,'markets',jsonb_build_array('US','NZ','AU'),'cpa_ceiling_product_price_ratio',0.5,'keyword_seed',null,'connector_hash',connector_digest,'secret_rows_hash',secret_digest,'unrelated_context_hashes',others,'automation_remains_paused',true));

  -- History and provider receipts are archived, not relabelled as AVGAR outcomes.
  -- Remove derived output from active context; keep certified provider datasets/KPIs,
  -- connectors, encrypted credentials, memberships and LLM cost audit untouched.
  delete from public.artifacts where account_id=a;
  delete from public.daily_briefs where account_id=a;
  delete from public.routine_outcomes where account_id=a;
  delete from public.self_reviews where account_id=a;
  delete from public.taste_events where account_id=a;
  delete from public.receipts where account_id=a;
  delete from public.routine_runs where account_id=a;
  delete from public.chat_messages where account_id=a;
  delete from public.goals where account_id=a;
  delete from public.team_members where account_id=a;
  delete from public.account_presets where account_id=a;
  delete from public.routine_params where account_id=a;
  update public.routine_states set enabled=false, draft_spec=null, live_spec=null, updated_at=stamp where account_id=a;
  update public.plans set title='',phases='[]',narrative=null,agreed_at=null where account_id=a;
  update public.account_profiles set tone='{"formality":"casual","length":"short","directness":"direct"}',decision_style='{}',founder_notes=null,updated_at=stamp where account_id=a;
  update public.resource_profiles set website='https://avgarsport.com/',socials='[]',skills='{}',known_platforms=array['Shopify','Facebook'],postures='{}',
    budget_monthly=null,hours_weekly=null,gross_margin_pct=null,reinvestment='balanced',breadth='focused',updated_at=stamp where account_id=a;
  update public.business_profiles set scan_status='done',scanned_at=stamp,updated_at=stamp,profile='{
    "name":"AVGAR Sport","oneLiner":"Premium golf bags, travel cases and accessories.","category":"Golf bags and travel accessories",
    "products":["LINKS Golf Bag","UFORIA Travel Case"],"audience":null,"voice":{"tone":null,"phrases":[]},
    "market":{"region":"US, NZ and AU: founder-selected pilot markets","competitorsMentioned":[]},"signals":[],"confidence":"high",
    "sources":["https://avgarsport.com/"],"businessType":"ecommerce","sells":"products","storefront":"shopify","businessTypeSource":"scan",
    "typeEvidence":["Verified public AVGAR storefront and existing avgar-sport.myshopify.com connection"],"platformsSpotted":[],
    "note":"Operator-verified identity correction, not a new automated market scan. Search seed, budget, hours, margin and commercial growth target are unconfirmed."
  }' where account_id=a;
  update public.account_state_meta set client_state='{
    "onboarded":true,"obStep":6,"obCats":[],"posture":"brand","goalTexts":{},"baselineText":"","targetNum":0,"obPace":"",
    "profile":{"budget":"Not set","time":"Not set","strength":"Not set","belief":"Not set","team":"Not set"},"routineEdits":{},
    "narrative":{"status":"idle","key":null,"baseKey":null,"value":null},"scanKey":null,"wfState":"clean","wfVer":1,
    "setupFlow":"home","setupConnectLater":false,"setupCardDismissed":false,"obAnswered":{"target":false,"budget":false,"hours":false}
  }',saved_at=stamp where account_id=a;
  -- Close old memories while their generation is still current; never relabel them.
  update public.memories set valid_to=stamp where account_id=a and valid_to is null;
  update public.accounts set name='AVGAR Sport',context_generation=1 where id=a;
  insert into public.memories(account_id,context_generation,kind,text,source,source_ref,confidence,importance,tags) values
    (a,1,'fact','This account is AVGAR Sport. Website: https://avgarsport.com/. Products include LINKS Golf Bag and UFORIA Travel Case.','founder','context-repair:'||repair_id,1,5,array['business','verified_identity']),
    (a,1,'constraint','Pilot markets confirmed by Tom: United States, New Zealand and Australia. No search seed has been approved.','founder','context-repair:'||repair_id,1,5,array['markets']),
    (a,1,'constraint','Maximum CPA is 50% of the relevant product price. Verify product or variant, current market price and matching currency before computing it. This is not a scaling target, ROAS target, budget or permission to change ads.','founder','context-repair:'||repair_id,1,5,array['paid_policy']),
    (a,1,'constraint','In-app testing only. Do not publish, message customers, mutate ads or activate spending. Automated routines remain paused until the backend and callable workflows are verified.','founder','context-repair:'||repair_id,1,5,array['safety']),
    (a,1,'fact','AVGAR budget, founder hours, gross margin, growth target and strategy have not been confirmed. Do not reuse the previous Junction business targets, team, content or assumptions.','founder','context-repair:'||repair_id,1,5,array['unknown_settings']);

  -- Existing row-invalidation triggers may also advance this revision for each
  -- changed profile/plan/goal. It must advance, not equal one assumed increment.
  assert (select revision>5 and last_save_id is null and last_save_hash is null from public.account_state_meta where account_id=a),'repair revision not invalidated';
  assert (select name='AVGAR Sport' and context_generation=1 and automation_paused from public.accounts where id=a);
  assert not exists(select 1 from public.memories where account_id=a and valid_to is null and context_generation<>1);
  assert (select md5(jsonb_agg(to_jsonb(c) order by id)::text)=connector_digest from public.connectors c where account_id=a),'connections changed';
  assert (select md5(jsonb_agg(to_jsonb(s) order by connector_id)::text)=secret_digest from public.connector_secrets s where connector_id in(select id from public.connectors where account_id=a)),'credentials changed';
  for target in select jsonb_object_keys(others) loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text) from public.%I t where account_id<>$1',target) into digest using a;
    assert digest=others->>target,'unrelated account context changed';
  end loop;
end $$;
commit;
select id,account_id,created_at,before_generation,after_generation,
  (select jsonb_object_agg(key,jsonb_array_length(value)) from jsonb_each(original_rows)) as archived_counts
from unc_private.context_repairs where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda' order by created_at desc limit 1;
