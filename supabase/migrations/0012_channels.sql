-- Unc — channels layer (2026-09-02). Additive only; 0001–0011 untouched.
--
-- "Connect Unc on the platform you want — Slack, Telegram, text message — and the in-app
-- corner chat is the same conversation." One thread (chat_messages, thread 'corner') is
-- written from every channel; approvals and the daily brief go out to the founder's linked
-- channels; decisions come back through buttons / keywords into the same approve/hold path.
--
-- 1. channel_links      one row per linked destination (Telegram chat, WhatsApp number, Slack
--                       user, SMS number). Issued with a one-time link code (10-minute TTL);
--                       verified when the founder sends the code from that device (Slack:
--                       verified by the OAuth install). user_id = the founder who linked it,
--                       so a decision taken on that channel carries decided_by = them.
-- 2. chat_messages      + channel (where a turn was said), external_msg_id (the platform's
--                       message id — inbound idempotency), delivery (outbound send status).
-- 3. outbound_messages  the send ledger: every proactive push and every reply Unc sent on a
--                       channel, with `ref` as the durable dedup key for pushes
--                       (brief:<id> | draft:<run_id> | approval:<id> | reminder:<approval_id>).
-- 4. channel_secrets    per-workspace tokens (Slack bot token per team), sealed with the
--                       connector keyring (src/lib/connectors/crypto.ts). Service role only.
--
-- RLS: members read channel_links / outbound_messages (their own account); every write is
-- the service role (link codes, verification, prefs, the ledger). channel_secrets denies
-- every client role, like connector_secrets.

create table channel_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,   -- the founder who linked it (decided_by for channel approvals)
  channel text not null check (channel in ('telegram','whatsapp','slack','sms','email')),
  external_id text,                     -- telegram chat id | whatsapp phone (digits) | slack user id | E.164; null until verified
  handle text,                          -- @username / phone as typed — display only
  display_name text,
  verified_at timestamptz,
  link_code text,                       -- one-time, UPPERCASE, cleared on verification
  link_code_expires_at timestamptz,
  prefs jsonb not null default '{"brief": true, "approvals": true, "drafts": true, "quiet_hours": null}',
  meta jsonb not null default '{}',     -- slack: {team_id, team_name, bot_user_id, dm_channel}
  last_inbound_at timestamptz,          -- WhatsApp 24-hour customer-service window
  created_at timestamptz not null default now(),
  unique (channel, external_id)
);
create unique index channel_links_code_idx on channel_links (link_code) where link_code is not null;
create index channel_links_account_idx on channel_links (account_id, channel);

alter table chat_messages
  add column if not exists channel text not null default 'app' check (channel in ('app','telegram','whatsapp','slack','sms','email')),
  add column if not exists external_msg_id text,
  add column if not exists delivery jsonb not null default '{}';
create unique index if not exists chat_messages_external_msg_idx on chat_messages (channel, external_msg_id) where external_msg_id is not null;

create table outbound_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  link_id uuid references channel_links(id) on delete set null,
  channel text not null check (channel in ('telegram','whatsapp','slack','sms','email')),
  kind text not null check (kind in ('reply','brief','approval','draft_landed','reminder','link','system')),
  ref text,                             -- dedup key for proactive pushes (see header)
  body text not null,
  external_msg_id text,
  status text not null default 'sent' check (status in ('sent','failed','queued')),
  error text,
  created_at timestamptz not null default now()
);
create index outbound_messages_account_idx on outbound_messages (account_id, created_at desc);
create index outbound_messages_ref_idx on outbound_messages (account_id, ref);

create table channel_secrets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  channel text not null check (channel in ('slack','email')),
  scope_id text not null,               -- slack: team id
  ciphertext text not null,             -- base64 AES-256-GCM of the token bundle JSON (aad = "<channel>:<scope_id>")
  iv text not null,
  tag text not null,
  key_version int not null default 1,
  updated_at timestamptz not null default now(),
  unique (channel, scope_id)
);

-- ---------- RLS ----------

alter table channel_links enable row level security;
alter table outbound_messages enable row level security;
alter table channel_secrets enable row level security;

create policy member_read on channel_links for select using (is_account_member(account_id));
create policy member_read on outbound_messages for select using (is_account_member(account_id));
create policy deny_clients_cs on channel_secrets as restrictive for all using (false) with check (false);

revoke all on channel_secrets from anon, authenticated;
revoke insert, update, delete on channel_links from anon, authenticated;
revoke insert, update, delete on outbound_messages from anon, authenticated;
