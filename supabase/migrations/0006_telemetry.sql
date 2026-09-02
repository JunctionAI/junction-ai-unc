-- Unc — Phase 7 "improves over time" (2026-09-02). Additive only; 0001–0005 untouched.
--
-- 1. routine_outcomes — every routine's KPI contract (src/lib/runtime/catalog-specs.ts
--    KPI_CONTRACTS) measured against actuals from certified reads or the run ledger.
--    One row per (account, routine, kpi, window_end) so a daily `--measure` is idempotent.
--    Members read; ONLY the service role writes (the worker measures — a client must never
--    be able to write its own outcomes).
-- 2. self_reviews — Unc's weekly self-review per account ("what worked, what I'm changing,
--    one ask"), one per (account, week_start). Members read; service role writes.
-- 3. benchmarks — anonymised cross-account aggregates that feed "The bar". A row exists
--    ONLY when n ≥ 5 opted-in accounts contributed (enforced in code AND by the check
--    below); readable by every authenticated user because nothing in it identifies an
--    account. Service role writes.
-- 4. benchmark_optins — an account's consent to be counted in those aggregates
--    (default true; the founder can opt out). Members read/write their own row.

create table routine_outcomes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  routine_id text not null,
  run_id uuid references routine_runs(id) on delete set null,   -- newest completed run in the window
  kpi_key text not null,
  kpi_target numeric not null,
  kpi_op text not null default 'gte' check (kpi_op in ('gte','lte')),
  kpi_actual numeric,                                            -- null = couldn't measure (see provenance)
  provenance text not null default 'ok',                        -- ok | empty | fixture | runs | error:<reason>
  window_start timestamptz not null,
  window_end timestamptz not null,
  measured_at timestamptz not null default now(),
  unique (account_id, routine_id, kpi_key, window_end)
);
create index routine_outcomes_account_idx on routine_outcomes (account_id, routine_id, window_end desc);

create table self_reviews (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  week_start date not null,                                      -- Monday (UTC) of the reviewed week
  body text not null,                                            -- Unc's review, plain text, his voice
  changes jsonb not null default '[]',                           -- [{action, routineId, cadence?, why}]
  evidence jsonb not null default '{}',                          -- the numbers the review was written from (+ ask, author)
  created_at timestamptz not null default now(),
  unique (account_id, week_start)
);

create table benchmarks (
  metric_key text not null,                                      -- a KPI_CONTRACTS key, e.g. repeat_purchase_pct
  segment text not null default 'all',                           -- all | shopify | revenue_band:<band>
  p50 numeric not null,
  p75 numeric not null,
  n int not null check (n >= 5),                                 -- the anonymisation floor, also enforced in code
  computed_at timestamptz not null default now(),
  primary key (metric_key, segment)
);

create table benchmark_optins (
  account_id uuid primary key references accounts(id) on delete cascade,
  opted_in boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------

alter table routine_outcomes enable row level security;
alter table self_reviews enable row level security;
alter table benchmarks enable row level security;
alter table benchmark_optins enable row level security;

-- members read their own account's outcomes and reviews; no member insert/update/delete
-- policy exists, so the service role (bypasses RLS) is the only writer.
create policy member_read on routine_outcomes for select using (is_account_member(account_id));
create policy member_read_sr on self_reviews for select using (is_account_member(account_id));

-- anonymised aggregates: any signed-in user may read; only the service role writes
create policy authenticated_read on benchmarks for select to authenticated using (true);

-- consent is the founder's to change
create policy member_all on benchmark_optins for all using (is_account_member(account_id)) with check (is_account_member(account_id));
