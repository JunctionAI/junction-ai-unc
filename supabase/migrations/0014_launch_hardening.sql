-- Unc — launch hardening for the six-founder beta (2026-09-03). Additive; 0001–0013 untouched.
--
-- 1. accounts.monthly_llm_cap_usd   per-account override of the monthly model-spend cap
--                                    (src/lib/llm/budget.ts; null = the env default,
--                                    UNC_ACCOUNT_MONTHLY_USD_CAP, else 15). Computed against
--                                    llm_usage.est_cost_usd for the current UTC month.
-- 2. app_errors                      every caught server error (src/lib/observability/errors.ts
--                                    captureError / withErrorCapture): scope, redacted message,
--                                    truncated stack, the account when known. Service role only.
-- 3. worker_heartbeats               one row per worker process name, upserted on every tick, so
--                                    GET /api/health can say "worker last seen 40 s ago" without
--                                    reaching the worker's own file. Service role only.

alter table accounts add column monthly_llm_cap_usd numeric;

create table app_errors (
  id uuid primary key default gen_random_uuid(),
  scope text not null,                                          -- e.g. "api/routines/run", "worker.tick"
  message text not null,                                        -- redacted (no keys, no tokens)
  stack text,                                                   -- truncated to 4000 chars
  account_id uuid references accounts(id) on delete set null,   -- null = no account in play
  context jsonb not null default '{}',                          -- redacted free-form fields
  created_at timestamptz not null default now()
);
create index app_errors_created_idx on app_errors (created_at desc);
create index app_errors_scope_idx on app_errors (scope, created_at desc);

create table worker_heartbeats (
  worker text primary key,                                      -- "unc"
  pid int,
  started_at timestamptz,
  last_tick_at timestamptz,
  last_tick_ms int,
  ticks int not null default 0,
  runs_started int not null default 0,
  stopping boolean not null default false,
  last_error text,
  updated_at timestamptz not null default now()
);

-- RLS: nothing here is for a client role.
alter table app_errors enable row level security;
alter table worker_heartbeats enable row level security;
create policy deny_clients_app_errors on app_errors as restrictive for all using (false) with check (false);
create policy deny_clients_worker_heartbeats on worker_heartbeats as restrictive for all using (false) with check (false);
revoke all on app_errors from anon, authenticated;
revoke all on worker_heartbeats from anon, authenticated;
-- members may read (not write) their own account's cap through the existing accounts policy;
-- writes to monthly_llm_cap_usd are the service role's (Tom raises it).
revoke update (monthly_llm_cap_usd) on accounts from anon, authenticated;
