-- Tom's direct 5 September approval. One bounded update, never a context repair/rebase.
-- Reconcile source_ref/readback after an uncertain response; do not blindly replay.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
set local role service_role;
do $$
declare
 acct constant uuid := 'aa5cfc84-2569-4c99-9b40-67003ae55eda';
 old_memory constant uuid := 'b8837a35-4e1d-4fd5-b76d-326b96d3040a';
 source_key constant text := 'founder-keyword-seed:2026-09-05:golf-travel-bag';
 new_memory uuid;
 stamp timestamptz := clock_timestamp();
begin
 perform 1 from public.accounts where id=acct and context_generation=1 and automation_paused for update;
 assert found,'pilot identity/pause changed; inspect before proceeding';
 perform 1 from public.account_state_meta where account_id=acct and revision=14 for update;
 assert found,'account revision changed; inspect before proceeding';
 assert not exists(select 1 from public.routine_runs where account_id=acct),'unexpected pilot runs';
 assert not exists(select 1 from public.memories where account_id=acct and source_ref=source_key),'seed already recorded; read back, do not replay';
 perform 1 from public.memories where id=old_memory and account_id=acct and context_generation=1 and valid_to is null
   and text='Pilot markets confirmed by Tom: United States, New Zealand and Australia. No search seed has been approved.';
 assert found,'old unknown-seed memory changed';

 insert into public.memories(account_id,context_generation,kind,text,source,source_ref,importance,confidence,tags,valid_from)
 values(acct,1,'decision',
   'Tom approved "golf travel bag" as AVGAR''s first keyword-discovery seed, tested separately in the United States (US), New Zealand (NZ) and Australia (AU). It is relevant to the UFORIA Travel Case, but is not a proven keyword winner. Measure country-specific demand, competition and SERP fit before page optimisation. This does not authorize publishing, ad changes, customer messaging or unpausing routines.',
   'founder',source_key,5,1,array['keyword_seed','markets','pilot','founder_approved'],stamp)
 returning id into new_memory;
 update public.memories set valid_to=stamp,superseded_by=new_memory where id=old_memory and account_id=acct;
 update public.business_profiles set profile=jsonb_set(profile,'{note}',to_jsonb(
   'Operator-verified identity correction, not an automated market scan. Founder-approved discovery seed: golf travel bag, separately in US/NZ/AU; not a proven keyword winner. Budget, hours, margin and commercial growth target remain unconfirmed.'::text)),updated_at=stamp
 where account_id=acct and profile->>'note'=
   'Operator-verified identity correction, not a new automated market scan. Search seed, budget, hours, margin and commercial growth target are unconfirmed.';
 assert found,'profile note changed; whole transaction refused';
 -- The existing business-profile trigger already invalidates revision 14 and
 -- clears replay markers. Assert that boundary; do not increment it a second time.
 update public.account_state_meta set saved_at=stamp where account_id=acct and revision=15 and last_save_id is null and last_save_hash is null;
 assert found,'profile revision invalidation failed';
 assert (select context_generation=1 and automation_paused from public.accounts where id=acct),'account controls changed';
 assert (select count(*)=1 from public.memories where account_id=acct and source_ref=source_key and valid_to is null),'seed memory missing or duplicated';
end $$;
commit;
