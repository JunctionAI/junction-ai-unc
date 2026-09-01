-- Unc — Phase 2 schema v0 (2026-09-01)
-- Multi-tenant with RLS on every table. Apply to the NEW product Supabase project
-- (never the agency warehouse). auth.users comes from Supabase Auth (magic link).

create extension if not exists pgcrypto;

-- ---------- tenancy ----------

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  currency text not null default 'NZD',
  created_at timestamptz not null default now()
);

create table account_members (
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

-- helper used by every RLS policy
create function is_account_member(acct uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from account_members
    where account_id = acct and user_id = auth.uid()
  );
$$;

-- ---------- onboarding state ----------

create table goals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  category text not null,               -- revenue | profit | brand | leads | retention | product
  tier text not null default 'governing' check (tier in ('governing','checkpoint')),
  title text not null,                  -- editable goal line, target parsed from first number
  baseline numeric,
  baseline_date date,
  deadline date,
  current_value numeric,                -- latest certified reading
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table resource_profiles (
  account_id uuid primary key references accounts(id) on delete cascade,
  budget_monthly numeric not null default 0,      -- hard spend guardrail source
  hours_weekly numeric not null default 0,
  reinvestment text not null default 'balanced' check (reinvestment in ('steady','balanced','all_in')),
  gross_margin_pct numeric,
  website text,
  socials jsonb not null default '[]',
  skills text[] not null default '{}',
  known_platforms text[] not null default '{}',
  postures text[] not null default '{}',           -- brand_led | sales_led | paid_led
  breadth text not null default 'focused' check (breadth in ('focused','broad')),
  updated_at timestamptz not null default now()
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  role text not null,
  approves text,
  created_at timestamptz not null default now()
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  title text not null,
  phases jsonb not null,                -- [{weeks:[a,b], title, focus, from_you, channel}]
  narrative text,                       -- agent-written; deterministic core in phases
  agreed_at timestamptz,
  created_at timestamptz not null default now()
);

create table business_profiles (
  account_id uuid primary key references accounts(id) on delete cascade,
  scan_status text not null default 'pending' check (scan_status in ('pending','running','done','failed')),
  profile jsonb not null default '{}',  -- voice, market, products — from site/socials scan
  scanned_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- connectors ----------

create table connectors (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  platform text not null,               -- shopify | ga4 | meta_ads | google_ads | klaviyo | ...
  status text not null default 'disconnected'
    check (status in ('disconnected','connecting','connected','needs_reconnect','error')),
  -- tokens live in the secret store, never here; this row holds only state
  external_ref text,                    -- e.g. shop domain / property id (non-secret)
  last_sync_at timestamptz,
  last_sync_result text,                -- ok | empty | error:<code>  (sync provenance: "couldn't ask" vs "nothing happened")
  created_at timestamptz not null default now(),
  unique (account_id, platform)
);

-- ---------- routines ----------

create table routine_states (
  account_id uuid not null references accounts(id) on delete cascade,
  routine_id text not null,             -- e.g. D01-W01, from the catalog constant in code
  enabled boolean not null default false,
  version int not null default 1,
  draft_spec jsonb,                     -- edited node-chain awaiting dry-run/promote
  live_spec jsonb,                      -- promoted spec; null = catalog default
  updated_at timestamptz not null default now(),
  primary key (account_id, routine_id)
);

create table routine_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  routine_id text not null,
  version int not null,
  mode text not null default 'live' check (mode in ('live','dry_run')),
  status text not null default 'running'
    check (status in ('running','waiting_approval','done','failed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary text
);

-- ---------- approvals + receipts (the trust spine) ----------

create table approvals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  run_id uuid references routine_runs(id) on delete set null,
  routine_id text,
  title text not null,
  detail text,
  before_state text,
  after_state text,
  reasoning text,                       -- the "Why?" bubble content
  status text not null default 'pending' check (status in ('pending','approved','held','expired')),
  expires_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  run_id uuid references routine_runs(id) on delete set null,
  approval_id uuid references approvals(id) on delete set null,
  kind text not null check (kind in ('read','draft','mutation','notification')),
  platform text,
  description text not null,
  payload jsonb not null default '{}',  -- what was read/changed, never credentials
  created_at timestamptz not null default now()
);

create table taste_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  approval_id uuid references approvals(id) on delete set null,
  routine_id text,
  action text not null check (action in ('approved','held','why_opened','edited')),
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- chat ----------

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  lane text not null default 'ai' check (lane in ('ai','human')),
  sender text not null check (sender in ('user','unc','staff')),
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------

alter table accounts enable row level security;
alter table account_members enable row level security;
alter table goals enable row level security;
alter table resource_profiles enable row level security;
alter table team_members enable row level security;
alter table plans enable row level security;
alter table business_profiles enable row level security;
alter table connectors enable row level security;
alter table routine_states enable row level security;
alter table routine_runs enable row level security;
alter table approvals enable row level security;
alter table receipts enable row level security;
alter table chat_messages enable row level security;
alter table taste_events enable row level security;

create policy member_read on accounts for select using (is_account_member(id));
create policy member_update on accounts for update using (is_account_member(id));

create policy self_rows on account_members for select using (user_id = auth.uid() or is_account_member(account_id));

-- uniform member policies for account-scoped tables
do $$
declare t text;
begin
  foreach t in array array['goals','resource_profiles','team_members','plans','business_profiles',
                           'connectors','routine_states','routine_runs','approvals','receipts',
                           'chat_messages','taste_events']
  loop
    execute format('create policy member_all on %I for all using (is_account_member(account_id)) with check (is_account_member(account_id));', t);
  end loop;
end $$;

-- receipts and taste_events are append-only from the client's perspective
create policy no_client_update on receipts as restrictive for update using (false);
create policy no_client_delete on receipts as restrictive for delete using (false);
create policy no_client_update_te on taste_events as restrictive for update using (false);
create policy no_client_delete_te on taste_events as restrictive for delete using (false);

-- indexes for the hot paths
create index on approvals (account_id, status);
create index on receipts (account_id, created_at desc);
create index on routine_runs (account_id, routine_id, started_at desc);
create index on chat_messages (account_id, lane, created_at);
create index on goals (account_id, tier);
