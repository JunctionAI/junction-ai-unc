-- Unc — Phase 6 billing (2026-09-02). Additive only; 0001–0003 untouched.
--
-- subscriptions: one row per account mirroring the account's Stripe subscription. Written
--   ONLY by the service role (the webhook + checkout/return routes — src/lib/billing/sync.ts);
--   members may read their own row (the sidebar plan line / paywall gate). There is no
--   insert/update/delete policy for authenticated users on purpose.
-- billing_events: Stripe event ids we have already applied. The webhook inserts the id
--   first; a duplicate delivery hits the primary key and is acknowledged without re-applying
--   (idempotency). No policies → invisible to everyone but the service role.
--
-- status mirrors Stripe's subscription status collapsed to the six states the app knows
-- (src/lib/billing/gate.ts::stripeStatusToRow): incomplete_expired → incomplete,
-- unpaid → past_due, paused → canceled. 'none' = a customer exists but no subscription
-- (row created at checkout time so the customer id is reused on a second attempt).

create table if not exists subscriptions (
  account_id uuid primary key references accounts(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'none'
    check (status in ('trialing','active','past_due','canceled','incomplete','none')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_event_at timestamptz,            -- Stripe event `created` that last wrote this row (ordering guard)
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_stripe_customer_idx on subscriptions (stripe_customer_id);
create unique index if not exists subscriptions_stripe_subscription_idx on subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

alter table subscriptions enable row level security;
create policy member_read on subscriptions for select using (is_account_member(account_id));
-- writes: service role only (bypasses RLS). Deliberately no insert/update/delete policies.

create table if not exists billing_events (
  id text primary key,                  -- Stripe event id (evt_…)
  type text not null,
  created_at timestamptz not null default now()
);
alter table billing_events enable row level security;
-- no policies: service role only.
