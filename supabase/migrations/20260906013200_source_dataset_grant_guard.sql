-- A context reset leaves prior grants inert; a new generation can receive a
-- separately evidenced grant. Guard every write against cross-account/source
-- bindings and keep the original authority immutable.
drop index public.account_source_dataset_grants_active;
create unique index account_source_dataset_grants_active
  on public.account_source_dataset_grants(account_id,context_generation,platform,dataset)
  where revoked_at is null;

create function public.guard_source_dataset_grant() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.accounts a where a.id=new.account_id
    and a.context_generation=new.context_generation) then
    raise exception 'source_grant_context_mismatch' using errcode='23514';
  end if;
  if not exists(select 1 from public.account_source_bindings b where b.id=new.binding_id
    and b.account_id=new.account_id and b.status='verified'
    and b.source_system='mission_control' and b.source_project='ebcatvidixdjjwmmades') then
    raise exception 'source_grant_binding_mismatch' using errcode='23514';
  end if;
  if tg_op='UPDATE' and row(new.id,new.account_id,new.context_generation,new.binding_id,
    new.platform,new.dataset,new.source_contract,new.max_source_age_minutes,
    new.granted_at,new.granted_by,new.reason)
    is distinct from row(old.id,old.account_id,old.context_generation,old.binding_id,
    old.platform,old.dataset,old.source_contract,old.max_source_age_minutes,
    old.granted_at,old.granted_by,old.reason) then
    raise exception 'source_grant_identity_immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_source_dataset_grant() from public,anon,authenticated;
grant execute on function public.guard_source_dataset_grant() to service_role;
create trigger source_dataset_grant_guard before insert or update
  on public.account_source_dataset_grants for each row
  execute function public.guard_source_dataset_grant();
