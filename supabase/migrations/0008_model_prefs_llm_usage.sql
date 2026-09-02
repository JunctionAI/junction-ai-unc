-- Unc — model-provider layer (2026-09-02). Additive only; 0001–0007 untouched.
--
-- 1. account_model_prefs — the founder's per-task model choice (src/lib/llm/router.ts:
--    account setting → env LLM_MODEL_<TASK> → default). One row per (account, task);
--    no row = default. Members read/write their own account's rows.
-- 2. llm_usage — one row per model call: who (account, nullable for the pre-account
--    onboarding calls), which task, provider + model, tokens, an APPROXIMATE USD cost from
--    the hand-maintained catalogue prices, latency and the stop reason. ONLY the service
--    role writes (the router runs server-side); members may read their own account's rows.

create table account_model_prefs (
  account_id uuid not null references accounts(id) on delete cascade,
  task text not null check (task in ('chat','plan_narrative','business_scan','self_review','routine_decision')),
  model_id text not null,                                        -- catalogue id or "<provider>:<model>"
  updated_at timestamptz not null default now(),
  primary key (account_id, task)
);

alter table account_model_prefs enable row level security;
create policy member_all on account_model_prefs
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

create table llm_usage (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete set null,   -- null = no account (onboarding before sign-in, dev ping)
  task text not null,                                            -- chat | plan_narrative | business_scan | self_review | routine_decision | ping
  provider text not null,                                        -- anthropic | openai | gemini | openrouter | custom
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  est_cost_usd numeric,                                          -- null = price unknown for this model
  latency_ms int not null default 0,
  stop_reason text not null default 'end',                       -- end | max_tokens | refusal | error:<code>
  created_at timestamptz not null default now()
);
create index llm_usage_account_idx on llm_usage (account_id, created_at desc);
create index llm_usage_created_idx on llm_usage (created_at desc);

alter table llm_usage enable row level security;
create policy member_read on llm_usage
  for select using (account_id is not null and is_account_member(account_id));
-- no insert/update/delete policy: only the service role writes
