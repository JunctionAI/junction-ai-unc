-- Direct server intake/plan changes must invalidate an already-hydrated browser.
-- Applied database migration version: 20260905024727.
-- Atomic saves hold the account/meta locks and finish at their old revision + 1;
-- intermediate trigger bumps are invisible outside that transaction.
begin;
create function public.invalidate_account_state_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_account uuid;
begin
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return new; end if;
  if tg_table_name='accounts' then
    if tg_op='UPDATE' and new.currency is not distinct from old.currency then return new; end if;
    v_account:=new.id;
  else
    if tg_op='DELETE' then v_account:=old.account_id; else v_account:=new.account_id; end if;
  end if;
  update public.account_state_meta set revision=revision+1,last_save_id=null,last_save_hash=null
    where account_id=v_account;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.invalidate_account_state_revision() from public,anon,authenticated;
grant execute on function public.invalidate_account_state_revision() to service_role;
create trigger invalidate_state_currency after update of currency on public.accounts
  for each row execute function public.invalidate_account_state_revision();
do $$
declare t text;
begin
  foreach t in array array['goals','resource_profiles','team_members','plans','business_profiles'] loop
    execute format('create trigger invalidate_state_revision after insert or update or delete on public.%I for each row execute function public.invalidate_account_state_revision()',t);
  end loop;
end $$;
commit;
