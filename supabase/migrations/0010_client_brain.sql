-- Client Brain: durable per-customer memory, KPI snapshots, personalisation profile,
-- daily briefs, intake keys (n8n), playbooks (Junction expertise). 2026-09-02.

create extension if not exists vector;

create table memories (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null check (kind in ('fact','preference','constraint','decision','relationship','event','lesson','summary')),
  text text not null,
  source text not null check (source in ('chat','onboarding','scan','receipt','self_review','intake','founder','brief')),
  source_ref text,                       -- chat message id / run id / intake id …
  confidence numeric not null default 0.7 check (confidence between 0 and 1),
  importance int not null default 3 check (importance between 1 and 5),
  tags text[] not null default '{}',
  happens_at timestamptz,                -- for kind = 'event'
  valid_from timestamptz not null default now(),
  valid_to timestamptz,                  -- set when superseded / forgotten
  superseded_by uuid references memories(id) on delete set null,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on memories (account_id, kind) where valid_to is null;
create index on memories (account_id, created_at desc);
create index on memories using ivfflat (embedding vector_cosine_ops) with (lists = 50);

create table kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  metric_key text not null,              -- revenue_28d, orders_7d, roas_7d, sessions_7d, repeat_rate_90d …
  value numeric not null,
  currency text,
  window_start date,
  window_end date not null,
  platform text,
  provenance text not null default 'live', -- live | fixture | founder_stated
  captured_at timestamptz not null default now(),
  unique (account_id, metric_key, window_end)
);
create index on kpi_snapshots (account_id, metric_key, window_end desc);

create table account_profiles (
  account_id uuid primary key references accounts(id) on delete cascade,
  tone jsonb not null default '{}',      -- {formality, length, humour, directness} learned + founder-set
  decision_style jsonb not null default '{}', -- {approval_rate, median_decision_hours, holds_by_kind, risk_appetite}
  cadence jsonb not null default '{}',   -- {brief_time_local, timezone, quiet_days}
  channels jsonb not null default '{}',  -- {email, whatsapp, slack} preferences
  founder_notes text,                    -- free text the founder writes about how to work with them
  updated_at timestamptz not null default now()
);

create table daily_briefs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  day date not null,
  body text not null,
  items jsonb not null default '[]',     -- [{kind: happened|needs_you|noticed|reminder, text, ref}]
  created_at timestamptz not null default now(),
  unique (account_id, day)
);

create table intake_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  label text not null default 'n8n',
  key_hash text not null unique,         -- sha256 of the bearer key; plaintext shown once
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table intake_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  key_id uuid references intake_keys(id) on delete set null,
  payload jsonb not null,
  outcome jsonb not null default '{}',   -- what was written: memories/profile/goal hints
  created_at timestamptz not null default now()
);

create table playbooks (                  -- Junction's expertise; global, not per-account
  id uuid primary key default gen_random_uuid(),
  domain text not null,                  -- email | paid | seo | content | sales | strategy | analytics
  title text not null,
  body text not null,
  source text,
  tags text[] not null default '{}',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (domain, title)
);
create index on playbooks using ivfflat (embedding vector_cosine_ops) with (lists = 20);

-- RLS
alter table memories enable row level security;
alter table kpi_snapshots enable row level security;
alter table account_profiles enable row level security;
alter table daily_briefs enable row level security;
alter table intake_keys enable row level security;
alter table intake_events enable row level security;
alter table playbooks enable row level security;

create policy member_all on memories for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy member_read on kpi_snapshots for select using (is_account_member(account_id));
create policy member_all on account_profiles for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy member_read on daily_briefs for select using (is_account_member(account_id));
create policy member_read on intake_keys for select using (is_account_member(account_id));   -- hashes only; creation via service role
create policy member_read on intake_events for select using (is_account_member(account_id));
create policy authed_read on playbooks for select using (auth.role() = 'authenticated');
revoke all on intake_keys, intake_events, kpi_snapshots, daily_briefs, playbooks from anon;

-- similarity search helpers (service role / server use)
create function match_memories(acct uuid, query_embedding vector(1536), match_count int default 12, kinds text[] default null)
returns table (id uuid, kind text, text text, importance int, confidence numeric, happens_at timestamptz, similarity float)
language sql stable security definer set search_path = public as $$
  select m.id, m.kind, m.text, m.importance, m.confidence, m.happens_at, 1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where m.account_id = acct and m.valid_to is null and m.embedding is not null
    and (kinds is null or m.kind = any(kinds))
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

create function match_playbooks(query_embedding vector(1536), match_count int default 6, domains text[] default null)
returns table (id uuid, domain text, title text, body text, similarity float)
language sql stable security definer set search_path = public as $$
  select p.id, p.domain, p.title, p.body, 1 - (p.embedding <=> query_embedding) as similarity
  from playbooks p
  where p.embedding is not null and (domains is null or p.domain = any(domains))
  order by p.embedding <=> query_embedding
  limit match_count;
$$;
