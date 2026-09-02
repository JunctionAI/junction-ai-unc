# Unc — billing first boot (Stripe)

Phase 6 (2026-09-02): one plan, **$100 USD / month, 14-day free trial, card required to start
the trial, cancel any time**. Built and unit-tested without a Stripe account — the webhook
signature check runs against a locally signed payload, the SDK is faked for Checkout/Portal.
This is the exact sequence for the day the account exists. Until then the product runs in
**demo** (`isBillingConfigured()` false → every account is open, no paywall, no Stripe call
anywhere; the beta runs on this).

## 0. What is env-gated

| Var | Where | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | Vercel env (server, *Sensitive*) + `.env.local` | `sk_live_…` / `sk_test_…` — constructs the SDK lazily (`getStripe()`) |
| `STRIPE_WEBHOOK_SECRET` | same | `whsec_…` — every `POST /api/billing/webhook` is verified against it (400 otherwise) |
| `STRIPE_PRICE_ID` | same | `price_…` of the $100/month recurring price |
| `NEXT_PUBLIC_APP_URL` | Vercel env + `.env.local` | `https://<domain>` — Checkout success/cancel and Portal return URLs |
| `SUPABASE_SERVICE_ROLE_KEY` | already in FIRST-BOOT.md | **required for billing**: `subscriptions` is written by the service role only |

`isBillingConfigured()` (`src/lib/billing/config.ts`) is true iff the four `STRIPE_*`/`APP_URL`
vars are present and non-blank. Billing *engages* (`isBillingActive()`) only when Supabase is
configured too — the subscription row lives there. The app reads `process.env` only; nothing
reads `.env` files, nothing logs a key, and the secret never reaches the client bundle
(`config.ts` is server-only; components import `plan.ts` and receive the entitlement as a prop).

## 1. Stripe dashboard — Tom's steps

1. **Create the account** (business: Junction AI; currency can stay NZD — the price is in USD).
   Stay in **Test mode** for the smoke run; repeat steps 2–5 in Live mode afterwards (keys,
   price id and webhook secret all differ between modes).
2. **Product catalogue → Add product**
   - Name: `Junction — Unc` (what shows on Checkout and invoices)
   - Description: `Your whole growth department. One agent, in your corner.`
   - Pricing: **Recurring**, **$100.00 USD**, billed **monthly**. Tax behaviour: *Exclusive*
     (Stripe Tax adds tax on top where it applies). Save → copy the **price id** (`price_…`) →
     `STRIPE_PRICE_ID`.
   - Do **not** put the trial on the price; Checkout sets `trial_period_days: 14` per session.
3. **Stripe Tax**: Settings → Tax → turn on, add the NZ registration (and AU once registered);
   Checkout runs with `automatic_tax: { enabled: true }` and `customer_update: address auto`,
   so it collects the address it needs. Without Tax enabled, Checkout will refuse the session
   with a clear error — either enable it or ask for the `automatic_tax` line in
   `src/lib/billing/checkout.ts` to be dropped.
4. **Customer portal**: Settings → Billing → Customer portal → *Activate*.
   Enable: cancel subscription (immediately or at period end — pick **at period end**),
   update payment method, invoice history. Disable plan switching (there is one plan).
   Business information: Junction name/support email. The portal link is created per
   request by `POST /api/billing/portal`, no default link needed.
5. **Developers → API keys**: copy the **secret key** → `STRIPE_SECRET_KEY`. Never the
   publishable key (unused) and never paste either into chat, docs or the repo.
6. **Developers → Webhooks → Add endpoint**
   - URL: `https://<domain>/api/billing/webhook`
   - Events (exactly these five):
     `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.payment_failed`
   - Save → **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
7. Optional: Settings → Emails → turn on *Successful payments* and *Upcoming renewals*;
   *Trial ending* reminders (Stripe sends 3 days before the first charge — this is the
   "cancel any time" promise made visible).

## 2. Environment

Local (`~/junction-unc/.env.local`, gitignored):

```
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…          # from `stripe listen` locally (step 3), from the dashboard in prod
STRIPE_PRICE_ID=price_…
NEXT_PUBLIC_APP_URL=http://localhost:3400
SUPABASE_SERVICE_ROLE_KEY=…            # see FIRST-BOOT.md
```

Vercel: Project → Settings → Environment Variables — same five; mark the three `STRIPE_*`
and the service role key *Sensitive*. `NEXT_PUBLIC_APP_URL` is baked in at build time →
redeploy after setting it. Restart `scripts/dev.sh` after editing `.env.local`.

## 3. Migration

```bash
npx supabase db push        # applies 0004_billing.sql (additive: subscriptions, billing_events)
```

or paste `supabase/migrations/0004_billing.sql` into the SQL editor. Verify: `subscriptions`
has RLS on with one policy (`member_read`), `billing_events` has RLS on with **no** policies.

## 4. Local webhook loop

```bash
brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:3400/api/billing/webhook \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed
```

`stripe listen` prints a `whsec_…` — that is `STRIPE_WEBHOOK_SECRET` for local runs (the
dashboard secret is for the deployed endpoint). Fire synthetic events with
`stripe trigger customer.subscription.created` etc.; the route answers
`{ received: true, handled: false, reason: "unknown_account" }` for triggered fixtures (they
carry no `account_id` metadata) — that is the correct answer, it proves signature + routing.

## 5. Smoke checklist (test mode, fresh browser profile)

1. **Demo untouched** — with the `STRIPE_*` vars removed, `/app` behaves exactly as Phase 2
   (no paywall, no plan line); `POST /api/billing/checkout` → `{ "fallback": true }`.
2. **Paywall** — vars set, sign in with a new email → `/app` shows the paywall card: Unc,
   "Pricing — simple, like the rest", $100 USD / month, "14-day free trial", the four ✓
   lines, "Start your free trial", "Cancel any time". `subscriptions` has no row yet.
3. **Checkout** — click the button → Stripe Checkout, trial shown as 14 days, $0 due today,
   card field present (test card `4242 4242 4242 4242`, any future date). `subscriptions`
   now has a `status = 'none'` row with `stripe_customer_id`.
4. **Return** — after paying, land on `/app?billing=welcome` with the control centre open
   and the sidebar line **Trial · 14 days left · manage**. Row: `status = 'trialing'`,
   `trial_ends_at` 14 days out, `stripe_subscription_id` set. `billing_events` has the
   `checkout.session.completed` + `customer.subscription.created` ids (the return route
   wrote the row first; the webhook events are then applied on top — same state).
5. **Duplicate delivery** — Webhooks → the endpoint → *Resend* an event → response
   `{ handled: false, reason: "duplicate" }`, nothing changes.
6. **Trial → active** — Stripe → the subscription → *Update* → set trial end to *now*
   (or use a test clock) → webhook `customer.subscription.updated` → sidebar
   **Plan · active · manage**.
7. **Failed payment** — test clock advance with card `4000 0000 0000 0341` attached, or
   Stripe → the subscription → *Update* payment method to that card and advance → the amber
   banner "Your last payment didn't go through…" with **Update card** → Portal opens.
8. **Cancel** — sidebar *manage* → Portal → cancel at period end → back on `/app`, sidebar
   **Plan · ends YYYY-MM-DD · manage**. Advance the clock past the period end →
   `customer.subscription.deleted` → the paywall returns with "Your plan ended."
9. **Second start** — "Start your free trial" again reuses the same customer
   (`customers.create` is not called; Stripe shows one customer, two subscriptions). Note:
   Stripe grants a second trial by default — decide whether to keep that (drop
   `trial_period_days` when `status = 'canceled'` if not).
10. **RLS** — SQL editor as `anon`: `select * from subscriptions` → nothing; as
    `authenticated` for that user → their one row; `insert`/`update` as that user → denied.
11. **Bad signature** — `curl -X POST https://<domain>/api/billing/webhook -d '{}' -H 'stripe-signature: t=1,v1=00'` → 400.

## 6. Things that can only be verified live

- Stripe's actual Checkout behaviour with `payment_method_collection: 'always'` + trial
  (the $0-today screen), Stripe Tax address collection, and the Portal configuration —
  the unit tests assert the parameters we send, not Stripe's rendering.
- Event ordering and timing in the wild; the tests cover duplicate + stale-event handling,
  not Stripe's retry schedule.
- The `current_period_end` field location: read from `items.data[0]` (2025+ API versions),
  falling back to the legacy top-level field — confirm on the first live subscription.
- `invoice.payment_failed` → `invoice.parent.subscription_details.subscription` on the
  pinned API version; the handler tolerates its absence (matches by customer).
- The Next `/app` route becomes dynamic once billing is configured (it reads the session
  cookie to resolve the entitlement) — check the first deploy's route table.

## 7. How it fits together

| Piece | File |
|---|---|
| Env gate, SDK, plan constants | `src/lib/billing/config.ts`, `src/lib/billing/plan.ts` |
| Entitlement state machine | `src/lib/billing/gate.ts` |
| Stripe → row (idempotent) | `src/lib/billing/sync.ts` |
| Checkout / Portal params | `src/lib/billing/checkout.ts` |
| Request plumbing (`/app` page + routes) | `src/lib/billing/server.ts` |
| Routes | `src/app/api/billing/{checkout,webhook,portal,return}/route.ts` |
| UI | `src/components/platform/Paywall.tsx`, `BillingBanner.tsx`, plan line in `Sidebar.tsx`, gate in `Platform.tsx` |
| Schema | `supabase/migrations/0004_billing.sql` |
| Tests | `src/lib/billing/__tests__/` |

Entitlement: `demo` (unconfigured) · `none`/`canceled` → paywall · `trialing` → "Trial · N
days left" · `active` → "Plan · active" · `past_due` → banner + "Update card". The row is
Stripe's view of the subscription, never a local guess: a lapsed trial reads "0 days left"
until Stripe's own status event moves it.
