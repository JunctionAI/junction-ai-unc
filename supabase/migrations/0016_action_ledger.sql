-- Unc — durable action idempotency ledger (2026-09-03). Additive; 0001–0015 untouched.
--
-- One row per (run, action, params hash). The worker INSERTs status='started' BEFORE it
-- sends anything; a second process (or a restart retrying the same run) hits the primary
-- key and refuses with duplicate. Complete updates status to ok|failed after the platform
-- replies. A crash after claim and before complete stays 'started' — retry is still
-- duplicate (fail closed: do not double-spend). A new runId is a new key.
--
-- Service role only: the executor runs outside a user session. Clients never read this;
-- the receipt already carries the idempotency key.

create table action_ledger (
  key text primary key,                                          -- runId:actionId:<params hash>
  account_id uuid not null references accounts(id) on delete cascade,
  run_id text not null,
  action_id text not null,
  status text not null default 'started' check (status in ('started','ok','failed')),
  external_id text,
  error text,                                                    -- redacted reason; never a token
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index action_ledger_account_idx on action_ledger (account_id, created_at desc);

alter table action_ledger enable row level security;
create policy deny_clients_action_ledger on action_ledger as restrictive for all using (false) with check (false);
revoke all on action_ledger from anon, authenticated;
