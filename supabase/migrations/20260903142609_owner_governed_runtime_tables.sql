-- Unc private-beta governance boundary.
--
-- Runtime/authority rows are visible to account members but written only through trusted server
-- routes / the worker with the service role. Account configuration remains browser-editable by
-- an owner, but ordinary members become read-only. This removes the original blanket member_all
-- policies, which let a browser forge connector state, runtime history, model/routine controls,
-- artifact decisions, approval decisions, receipts, taste events, strategy, or the account cap.

begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'connectors',
    'routine_states',
    'routine_runs',
    'approvals',
    'receipts',
    'taste_events',
    'artifacts',
    'account_model_prefs',
    'account_presets',
    'routine_params'
  ]
  loop
    execute format('drop policy if exists member_all on public.%I', table_name);
    execute format('drop policy if exists member_read on public.%I', table_name);
    execute format('drop policy if exists member_update on public.%I', table_name);
    execute format(
      'create policy member_read on public.%I for select to authenticated using (public.is_account_member(account_id))',
      table_name
    );
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end
$$;

-- Configuration edited by the app may still use the signed-in Supabase client, but only an
-- owner membership can write it. Members retain tenant-scoped read access.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'goals',
    'resource_profiles',
    'team_members',
    'plans',
    'business_profiles',
    'account_state_meta',
    'account_profiles'
  ]
  loop
    execute format('drop policy if exists member_all on public.%I', table_name);
    execute format('drop policy if exists member_read on public.%I', table_name);
    execute format('drop policy if exists owner_write on public.%I', table_name);
    execute format(
      'create policy member_read on public.%I for select to authenticated using (public.is_account_member(account_id))',
      table_name
    );
    execute format(
      'create policy owner_write on public.%I for all to authenticated using (exists (select 1 from public.account_members m where m.account_id = %I.account_id and m.user_id = auth.uid() and m.role = ''owner'')) with check (exists (select 1 from public.account_members m where m.account_id = %I.account_id and m.user_id = auth.uid() and m.role = ''owner''))',
      table_name,
      table_name,
      table_name
    );
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
  end loop;
end
$$;

-- The browser may update only the ordinary account identity fields, and only as the owner.
-- monthly_llm_cap_usd stays service-role/admin controlled so a member cannot raise the rail.
drop policy if exists member_update on public.accounts;
drop policy if exists owner_update on public.accounts;
create policy owner_update on public.accounts
  for update to authenticated
  using (
    exists (
      select 1 from public.account_members m
       where m.account_id = accounts.id
         and m.user_id = auth.uid()
         and m.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.account_members m
       where m.account_id = accounts.id
         and m.user_id = auth.uid()
         and m.role = 'owner'
    )
  );
revoke insert, update, delete on table public.accounts from anon, authenticated;
grant update (name, currency) on table public.accounts to authenticated;

commit;
