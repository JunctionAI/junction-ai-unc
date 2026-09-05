-- Nguyen's 6 September handoff: only keyword webhook Ignore Bots changed to false.
-- Independently observed definition SHA256:
-- 85c5010892e9d6c8d467a69e480ef57307192b23ddf6250f9c0f4561867f58b5
-- Forward-only repin of two exact reviewed bodies. No row, grant or flag changes.
-- Retain historical migrations and historical execution provenance unchanged.
do $repin$
declare target record; f record; before_acl aclitem[]; before_config text[]; before_owner oid;
  old_revision constant text := '1bce8c54-637e-4770-af90-2da36f38369a';
  new_revision constant text := '92135add-3c35-43e4-9649-5bb3d4557814';
begin
  -- Fail closed if a prior pilot already exists; never strand an issued allowance.
  perform 1 from public.accounts where id='aa5cfc84-2569-4c99-9b40-67003ae55eda' for update;
  if exists(select 1 from public.n8n_shadow_permits where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda') or
    exists(select 1 from public.n8n_workflows where account_id='aa5cfc84-2569-4c99-9b40-67003ae55eda') then
    raise exception 'Existing pilot requires explicit reconciliation before repinning';
  end if;
  for target in select * from (values
    ('public.issue_keyword_shadow_pilot(jsonb)', '013d3035a094025d12c9d2a98a1b155d'),
    ('public.claim_keyword_shadow_start(jsonb)', '15efbd2d0ff247b2c38616c502e8e349')
  ) as reviewed(signature,body_hash) loop
    select p.*,pg_get_functiondef(p.oid) definition into strict f from pg_proc p
      where p.oid=target.signature::regprocedure;
    if md5(f.prosrc)<>target.body_hash or f.prosecdef or
      length(f.prosrc)-length(replace(f.prosrc,old_revision,''))<>36 or
      has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or
      not has_function_privilege('service_role',f.oid,'EXECUTE') then
      raise exception 'Reviewed pilot function or permission boundary changed: %',target.signature;
    end if;
    before_acl:=f.proacl; before_config:=f.proconfig; before_owner:=f.proowner;
    execute replace(f.definition,old_revision,new_revision);
    if not exists(select 1 from pg_proc p where p.oid=target.signature::regprocedure and
      p.prosrc=replace(f.prosrc,old_revision,new_revision) and not p.prosecdef and
      p.proacl is not distinct from before_acl and p.proconfig is not distinct from before_config and p.proowner=before_owner) then
      raise exception 'Pilot repin changed more than its revision: %',target.signature;
    end if;
  end loop;
end $repin$;
