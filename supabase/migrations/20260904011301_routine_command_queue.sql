-- Durable draft-only commands. Server APIs re-check owner identity; clients cannot write
-- queue state or substitute account IDs. No migration is applied by this change.
create table routine_commands (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('app', 'slack', 'sms', 'telegram', 'whatsapp', 'email')),
  request_id text not null check (length(request_id) between 1 and 200),
  link_id uuid references channel_links(id) on delete set null,
  request_hash text not null,
  routine_id text not null,
  spec_hash text not null,
  workflow_hash text not null,
  version integer not null check (version > 0),
  request text not null check (length(request) between 1 and 4000),
  status text not null check (status in ('queued', 'running', 'waiting', 'done', 'blocked', 'failed', 'uncertain')),
  reply text not null,
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notification_status text not null default 'pending' check (notification_status in ('pending', 'claimed', 'sent', 'failed'))
);
create index routine_commands_queue_idx on routine_commands (status, created_at);
create index routine_commands_account_idx on routine_commands (account_id, created_at desc);
alter table routine_commands enable row level security;
revoke all on table routine_commands from public, anon, authenticated;
grant select, insert, update, delete on table routine_commands to service_role;

-- Ingress includes messages from not-yet-linked senders, so there is deliberately no
-- customer-facing SELECT policy. Only the worker may resolve the sender to an account.
create table channel_inbox (
  id text primary key,
  channel text not null,
  event jsonb not null check (octet_length(event::text) <= 32000),
  status text not null check (status in ('queued', 'running', 'done', 'uncertain')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index channel_inbox_queue_idx on channel_inbox (status, created_at);
alter table channel_inbox enable row level security;
revoke all on table channel_inbox from public, anon, authenticated;
grant select, insert, update, delete on table channel_inbox to service_role;
