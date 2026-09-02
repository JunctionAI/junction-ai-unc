-- Unc — Phase 2 accounts + persistence (2026-09-02). Additive only; 0001/0002 untouched.
--
-- 1. account_state_meta — schema-versioned envelope for the client-state fields that have
--    no natural column in 0001 (goal texts per category, plan edits, the structured Unc
--    narrative, the demo workflow version counter …). src/lib/db/mapping.ts is the only
--    writer; CLIENT_STATE_SCHEMA_VERSION there must match `schema_version` here.
-- 2. Stable positions + upsert keys so the client can persist ordered lists idempotently
--    (no delete-and-reinsert on every autosave): team_members.position, chat_messages
--    (thread, position, meta), goals (account_id, category), approvals.client_key for the
--    three demo approvals the Phase-2 Home view still renders.
-- 3. create_account(): security-definer RPC so a freshly signed-in user can create their own
--    account + owner membership under RLS (0001 grants no insert on accounts/account_members).

create table if not exists account_state_meta (
  account_id uuid primary key references accounts(id) on delete cascade,
  schema_version int not null default 1,
  client_state jsonb not null default '{}',
  saved_at timestamptz not null default now()
);
alter table account_state_meta enable row level security;
create policy member_all on account_state_meta
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- ordered lists
alter table team_members add column if not exists position int not null default 0;
create unique index if not exists team_members_position_idx on team_members (account_id, position);

alter table chat_messages
  add column if not exists thread text not null default 'corner'
    check (thread in ('corner','onboarding','human')),
  add column if not exists position int not null default 0,
  add column if not exists meta jsonb not null default '{}';   -- {link, linkLabel}
create unique index if not exists chat_messages_thread_position_idx on chat_messages (account_id, thread, position);

-- one goal row per category per account (governing = obCats[0], the rest are checkpoints)
create unique index if not exists goals_account_category_idx on goals (account_id, category);

-- demo approvals rendered by the Phase-2 Home view are keyed so decisions upsert in place;
-- runtime-created approvals (SupabaseStore.createApproval) leave client_key null.
alter table approvals add column if not exists client_key text;
create unique index if not exists approvals_client_key_idx on approvals (account_id, client_key) where client_key is not null;

-- account bootstrap for the signed-in user
create or replace function create_account(p_name text default '', p_currency text default 'NZD')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  acct uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into accounts (name, currency) values (coalesce(p_name, ''), coalesce(nullif(p_currency, ''), 'NZD'))
    returning id into acct;
  insert into account_members (account_id, user_id, role) values (acct, auth.uid(), 'owner');
  return acct;
end;
$$;
revoke all on function create_account(text, text) from public;
grant execute on function create_account(text, text) to authenticated;
