-- Unc — Phase 4 connector plumbing (2026-09-02). Additive only; 0001–0004 untouched.
--
-- 1. connector_secrets — the ONLY place an OAuth token lives. One row per connector, the
--    token bundle sealed with AES-256-GCM (src/lib/connectors/crypto.ts) under
--    CONNECTOR_SECRET_KEY; key_version lets the key rotate without a re-auth. RLS is on and
--    there are NO member policies: the anon/authenticated roles are denied everything, the
--    service role (which bypasses RLS) is the only reader/writer. Never add a member policy.
-- 2. oauth_states — single-use CSRF/PKCE state for an in-flight "Connect" (10-minute TTL).
--    Service role only for the same reason; swept by expires_at.
-- 3. connectors.sync_ref — non-secret provisioning handles (Airbyte source / destination /
--    connection ids) so ensure* calls are idempotent. Never a token.

create table connector_secrets (
  connector_id uuid primary key references connectors(id) on delete cascade,
  ciphertext text not null,             -- base64 AES-256-GCM ciphertext of the token bundle JSON
  iv text not null,                     -- base64, 12 bytes
  tag text not null,                    -- base64, 16-byte auth tag
  key_version int not null default 1,   -- which CONNECTOR_SECRET_KEY sealed it (rotation)
  updated_at timestamptz not null default now()
);

create table oauth_states (
  state text primary key,               -- 32 random bytes, base64url; the OAuth `state` param
  account_id uuid not null references accounts(id) on delete cascade,
  platform text not null,
  code_verifier text,                   -- PKCE verifier (Klaviyo, Google); null for Shopify / Meta
  shop text,                            -- Shopify only: the myshopify.com domain the flow was started for
  redirect_to text not null default '/app',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index oauth_states_expires_idx on oauth_states (expires_at);

alter table connectors add column if not exists sync_ref jsonb not null default '{}';

-- ---------- RLS: service role only ----------

alter table connector_secrets enable row level security;
alter table oauth_states enable row level security;

-- No permissive policy exists, so RLS already denies every client role. The restrictive
-- policies below make that explicit and survive any future "member_all" copy-paste.
create policy deny_clients on connector_secrets as restrictive for all using (false) with check (false);
create policy deny_clients_os on oauth_states as restrictive for all using (false) with check (false);

revoke all on connector_secrets from anon, authenticated;
revoke all on oauth_states from anon, authenticated;
