-- Unc — beta invites (2026-09-02). Additive only; 0001–0008 untouched.
--
-- Why: scripts/seed-beta.ts creates the six beta founders' accounts BEFORE they sign up, so
-- there is no auth.users row to put in account_members. beta_invites holds the pending
-- "this email owns that account" claim; accept_beta_invites() attaches it on first login
-- (src/lib/db/accountState.ts ensureAccount calls it before falling through to create_account,
-- and src/lib/db/session.ts requireAccountSession does the same for the server routes).
--
-- Conventions: service-role-only table (restrictive deny policy + revoke, like 0005's
-- connector_secrets — never a member policy), one security-definer RPC for the one thing a
-- signed-in user may do (like 0003's create_account), email stored lower-cased so the unique
-- index needs no expression (the test fake's schema parser reads plain indexes).

create table if not exists beta_invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'owner' check (role in ('owner','member')),
  invited_by text,                        -- 'tom' for the beta; free text
  note text,                              -- e.g. the beta slug from scripts/seed-beta.ts
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id) on delete set null
);
create unique index if not exists beta_invites_email_account_idx on beta_invites (email, account_id);
create index if not exists beta_invites_open_email_idx on beta_invites (email) where accepted_at is null;

-- ---------- RLS: service role only ----------

alter table beta_invites enable row level security;
-- No permissive policy exists, so RLS already denies every client role; the restrictive one
-- makes that explicit and survives a future "member_all" copy-paste.
create policy deny_clients_bi on beta_invites as restrictive for all using (false) with check (false);
revoke all on beta_invites from anon, authenticated;

-- ---------- the attach ----------

-- Called once per sign-in by the app BEFORE ensureAccount() falls through to create_account():
-- otherwise the founder gets a fresh empty account and the seeded one is orphaned.
--
-- Safety: the address is read from auth.users (the row Supabase Auth confirmed), not the JWT
-- claim alone, and only once email_confirmed_at is set — magic-link sign-in confirms it; an
-- unconfirmed session attaches nothing (returns no rows, raises nothing). Invite rows are
-- locked (for update) so two concurrent first requests can't both claim; account_members is
-- an upsert so a retry is harmless. Returns the account ids attached in this call.
create or replace function accept_beta_invites()
returns setof uuid
language plpgsql security definer set search_path = public as $$
declare
  who uuid := auth.uid();
  addr text;
  inv record;
begin
  if who is null then
    raise exception 'not signed in';
  end if;
  select lower(u.email) into addr from auth.users u where u.id = who and u.email_confirmed_at is not null;
  if addr is null then
    return;
  end if;
  for inv in
    select id, account_id, role from beta_invites
    where email = addr and accepted_at is null
    order by created_at asc
    for update skip locked
  loop
    insert into account_members (account_id, user_id, role)
      values (inv.account_id, who, inv.role)
      on conflict (account_id, user_id) do nothing;
    update beta_invites set accepted_at = now(), accepted_user_id = who where id = inv.id;
    return next inv.account_id;
  end loop;
  return;
end;
$$;
revoke all on function accept_beta_invites() from public;
grant execute on function accept_beta_invites() to authenticated;

-- ---------- seeding the claims (service role, after scripts/seed-beta.ts) ----------
-- scripts/beta/seed-beta.sql carries one commented-out insert per founder with an
-- '[EMAIL: …]' placeholder; Tom fills the address in before applying. Shape:
--
--   insert into beta_invites (account_id, email, role, invited_by, note)
--   select id, lower('<founder email>'), 'owner', 'tom', '<slug>' from accounts where name = '<exact accounts.name>'
--   on conflict (email, account_id) do nothing;
