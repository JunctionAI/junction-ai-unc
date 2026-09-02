-- Runtime engine support (src/lib/runtime/store/interface.ts mapping)
alter table routine_runs
  add column if not exists approval_id uuid references approvals(id) on delete set null,
  add column if not exists dedup_key text,
  add column if not exists spec_hash text,
  add column if not exists snapshot jsonb;   -- paused run: {spec, ctx, nextNodeIndex}

create index if not exists routine_runs_dedup_idx on routine_runs (account_id, routine_id, dedup_key);

-- sumSpend(account, since, until) reads mutation receipts' payload->'spend'->>'amount'
create index if not exists receipts_spend_idx on receipts (account_id, created_at)
  where kind = 'mutation';
