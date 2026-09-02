-- PROPOSED — NOT APPLIED. Lives under scripts/beta/ until the next code pass moves it to
-- supabase/migrations/0009_beta_invites.sql (0004–0008 are already taken).
--
-- Why: scripts/seed-beta.ts creates the six beta founders' accounts BEFORE they sign up, so
-- there is no auth.users row to put in account_members. This table holds the pending
-- "this email owns that account" claim; accept_beta_invites() attaches it on first login.
--
-- Fits the existing conventions: service-role-only table (restrictive deny policies like
-- 0005's connector_secrets — never a member policy), a security-definer RPC for the one
-- thing a signed-in user may do (like 0003's create_account), email stored lower-cased so
-- the unique index needs no expression (the test fake's schema parser reads plain indexes).

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
create index if not exists beta_invites_email_idx on beta_invites (email) where accepted_at is null;

alter table beta_invites enable row level security;
-- no permissive policies: only the service role reads/writes rows directly
create policy deny_clients_select on beta_invites as restrictive for select using (false);
create policy deny_clients_insert on beta_invites as restrictive for insert with check (false);
create policy deny_clients_update on beta_invites as restrictive for update using (false);
create policy deny_clients_delete on beta_invites as restrictive for delete using (false);

-- The attach. Called once per sign-in by the app BEFORE ensureAccount() would fall through to
-- create_account() — otherwise the founder gets a fresh empty account and the seeded one is
-- orphaned. Matches on the signed-in user's verified email (auth.email() = auth.users.email;
-- magic-link sign-in verifies it), so a claim can only be accepted by that mailbox's owner.
create or replace function accept_beta_invites()
returns setof uuid
language plpgsql security definer set search_path = public as $$
declare
  inv record;
begin
  if auth.uid() is null or auth.email() is null then
    raise exception 'not signed in';
  end if;
  for inv in
    select id, account_id, role from beta_invites
    where email = lower(auth.email()) and accepted_at is null
    order by created_at asc
  loop
    insert into account_members (account_id, user_id, role)
      values (inv.account_id, auth.uid(), inv.role)
      on conflict (account_id, user_id) do nothing;
    update beta_invites set accepted_at = now(), accepted_user_id = auth.uid() where id = inv.id;
    return next inv.account_id;
  end loop;
  return;
end;
$$;
revoke all on function accept_beta_invites() from public;
grant execute on function accept_beta_invites() to authenticated;

-- Seeding the claims (service role, after scripts/seed-beta.ts has created the accounts).
-- Tom fills the emails in — none are stored in the repo.
--
--   insert into beta_invites (account_id, email, invited_by, note)
--   select id, lower('<founder email>'), 'tom', '<slug>' from accounts where name = '<exact accounts.name>'
--   on conflict (email, account_id) do nothing;
--
-- e.g.  … where name = 'AVGAR Sport'   (slugs/names: scripts/seed-beta.ts BETA_ACCOUNTS)
