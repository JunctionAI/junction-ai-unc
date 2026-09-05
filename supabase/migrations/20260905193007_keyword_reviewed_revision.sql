-- Independently reviewed handoff: docs/integration/NGUYEN-FINAL-REVIEW-2026-09-06.md.
-- Canonical published definition da1bfb8235a056dfcc3745281970ecf9cf33bc3e4b1b2c117675a5c58686ba5c.
-- Future admission only: never relabel historical permits/receipts or the saved
-- customer recipe. New-revision customer choices require their own live proof.
do $repin$
declare target record; f record; after_definition text; expected_body text;
  acct constant uuid := 'aa5cfc84-2569-4c99-9b40-67003ae55eda';
  old_revision constant text := '92135add-3c35-43e4-9649-5bb3d4557814';
  new_revision constant text := 'ac771cd3-8899-4401-915c-40d4477e48e2';
begin
  perform 1 from public.accounts where id=acct and context_generation=1 and automation_paused for update;
  if not found then raise exception 'Paused original AVGAR context required for repin'; end if;
  perform 1 from public.account_members where account_id=acct
    and user_id='74802c60-149a-4405-b719-dc058d174072' and role='owner' for share;
  if not found then raise exception 'Original AVGAR owner required for repin'; end if;
  perform 1 from public.n8n_workflows where account_id=acct for update;
  perform 1 from public.routine_states where account_id=acct for update;
  if exists(select 1 from public.routine_states where account_id=acct and (enabled or draft_spec is not null))
    or exists(select 1 from public.n8n_shadow_permits where account_id=acct and status not in ('verified','refused'))
    or exists(select 1 from public.routine_commands where account_id=acct and status in ('queued','running','waiting','uncertain'))
    or exists(select 1 from public.routine_runs where account_id=acct and status in ('running','waiting')) then
    raise exception 'Resolve original work before changing the keyword pin';
  end if;
  for target in select * from (values
    ('public.issue_keyword_shadow_pilot(jsonb)','9d32cc8c26d4668a16503682a5fa765c',1),
    ('public.claim_keyword_shadow_start(jsonb)','498f5632c9c12a1937755e0b0503c438',1),
    ('public.keyword_customer_configuration(jsonb)','739c5f8f18a3868a276e6304136696ef',1),
    ('public.assert_keyword_command_binding(jsonb)','3f528347e8dd546ec665eb31cf72e692',0),
    ('unc_private.guard_keyword_command_permit()','5f9d6e6555825a82e7c94efadf5806cb',0),
    ('unc_private.guard_keyword_shadow_permit()','1484b4976e756c3d4a8a77fdcbee34e4',0),
    ('public.checkpoint_keyword_shadow_result(uuid,text,jsonb)','1f7a8bfc50db16e89cca52190b7af448',0),
    ('public.commit_keyword_shadow_completion(uuid,bigint,uuid,jsonb)','9198a5e43f0a1b0266012fa403f10598',0)
  ) as reviewed(signature,body_hash,revision_count) loop
    select p.*,pg_get_functiondef(p.oid) definition into strict f from pg_proc p where p.oid=target.signature::regprocedure;
    if md5(f.prosrc)<>target.body_hash or f.prosecdef
      or (length(f.prosrc)-length(replace(f.prosrc,old_revision,'')))/36<>target.revision_count
      or has_function_privilege('anon',f.oid,'execute') or has_function_privilege('authenticated',f.oid,'execute') then
      raise exception 'Reviewed keyword dependency changed: %',target.signature;
    end if;
    -- All literal 40001 raises in these exact bodies are permanent business
    -- conflicts, not genuine serialization errors; preserve every condition.
    expected_body:=replace(replace(f.prosrc,old_revision,new_revision),'errcode=''40001''','errcode=''PT409''');
    after_definition:=replace(replace(f.definition,old_revision,new_revision),'errcode=''40001''','errcode=''PT409''');
    execute after_definition;
    if not exists(select 1 from pg_proc p where p.oid=f.oid and p.prosrc=expected_body and not p.prosecdef
      and p.proacl is not distinct from f.proacl and p.proconfig is not distinct from f.proconfig and p.proowner=f.proowner) then
      raise exception 'Keyword repin changed more than reviewed literals: %',target.signature;
    end if;
  end loop;
end $repin$;
