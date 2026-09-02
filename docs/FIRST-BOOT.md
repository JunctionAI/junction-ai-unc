# Unc — first boot with a real Supabase project

Phase 2 (accounts + persistence) is built and unit-tested against a schema-checked fake, but
no Supabase project existed when it was written. This is the exact sequence for the day one
does. Until then the app runs in **demo mode** (client-side state, `/app` open to anyone,
`/login` says accounts aren't switched on yet) — nothing here is required for that.

## 0. What is env-gated

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel env + `.env.local` | Project URL (public, inlined into the client bundle) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env + `.env.local` | anon / publishable key (public; RLS is the boundary) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (server) only | Service role for the runtime worker (`getServiceSupabase()`); **not** needed for sign-in or persistence |

`isDbConfigured()` (src/lib/db/client.ts) is true iff the two `NEXT_PUBLIC_*` vars are set.
Everything account-shaped keys off it: the proxy, `/login`, `/auth/*`, the autosave hook.
Never commit any of these — `.gitignore` already ignores `.env*`. The app reads
`process.env` only; nothing reads `.env` files directly.

## 1. Create the project

Supabase dashboard → New project (a **new** project for the Unc product — never the agency
warehouse). Region: Sydney (`ap-southeast-2`) for NZ/AU founders. Note the project ref.

## 2. Apply the migrations, in order

Either with the CLI:

```bash
cd ~/junction-unc
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push          # applies supabase/migrations/0001, 0002, 0003 in order
```

or by pasting each file into the SQL editor in this order:

1. `supabase/migrations/0001_init.sql` — tenancy, onboarding tables, routines, approvals, receipts, chat, RLS
2. `supabase/migrations/0002_runtime_columns.sql` — `routine_runs` approval/dedup/spec_hash/snapshot + spend index
3. `supabase/migrations/0003_account_state.sql` — `account_state_meta`, ordered-list keys, `approvals.client_key`, `create_account()` RPC

Verify: Table editor shows 15 tables; Database → Functions shows `is_account_member` and
`create_account`; every table has RLS enabled.

## 3. Auth provider

Authentication → Providers → **Email**: enabled, *Confirm email* on, magic link on
(passwords are never used — `LoginForm` calls `signInWithOtp`).

Authentication → URL configuration:

- Site URL: `https://<production-domain>` (locally `http://localhost:3400`)
- Redirect URLs: add `https://<production-domain>/auth/callback` and `http://localhost:3400/auth/callback`
  (and any Vercel preview domain pattern, e.g. `https://*-junction.vercel.app/auth/callback`)

Optional but recommended: Authentication → Email templates → Magic Link — rewrite the copy in
Unc's voice; keep `{{ .ConfirmationURL }}`.

Rate limits: the default is a handful of magic links per hour per address — fine for founders,
tight for testing. Raise under Authentication → Rate limits if the smoke run trips it.

## 4. Environment

Local (`~/junction-unc/.env.local`, gitignored):

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>      # optional until the worker exists
```

Vercel: Project → Settings → Environment Variables — same three; mark
`SUPABASE_SERVICE_ROLE_KEY` as *Sensitive* and server-only. Redeploy (the `NEXT_PUBLIC_*`
values are baked in at build time).

Restart the dev server after editing `.env.local` (`scripts/dev.sh`); Next reads env at boot.

## 5. Smoke checklist

Run through in a fresh browser profile.

1. **Gate** — `GET /app` with no session redirects to `/login`; `/login` renders the cream sign-in
   card with the mascot ("Tell me your email and I'll send a link…"). The landing page `/` is untouched.
2. **Magic link** — enter an email → "Link's on its way…" → open the link → lands on `/app`
   (via `/auth/callback?code=…&next=/app`). `auth.users` has the user; `accounts` and
   `account_members` each have one row (created by `create_account()`); `account_state_meta`
   has the seeded row.
3. **Onboard** — go through all seven steps (goal, resources, team, website/socials, strengths,
   platforms, plan). Watch the sidebar footer: "Saving…" → "Saved" within ~1 s of each change.
4. **Refresh** — F5. `/app` shows "Fetching your account…" briefly, then the control centre
   with the same goal line, deadline, budget, team, strengths and plan. (`onboarded` and the
   step come from `account_state_meta.client_state`.)
5. **Routine toggle** — Routines → toggle any routine on/off → refresh → it holds.
   `routine_states` has a row with `enabled` set and `version = 1`, `live_spec` null.
6. **Approval** — Home → Approve one card, Hold another → refresh → both hold. `approvals` has
   the three `demo-ap-*` rows with `status`, `decided_at`, `decided_by = auth.uid()`.
7. **Chat** — send a message in the corner chat → refresh → the thread is back
   (`chat_messages.thread = 'corner'`, ordered by `position`).
8. **Sign out** — sidebar "Sign out" → `/login`; `/app` redirects again.
9. **Second device / browser** — sign in with the same email → the same account hydrates
   (no second account is created).
10. **RLS** — in the SQL editor as the anon role (`set role anon; select * from accounts;`)
    returns nothing; as the service role it returns everything.

## 6. Things that can only be verified against the live project

- The magic-link email → callback → cookie session loop (PKCE code exchange, cookie names,
  the proxy refreshing tokens). Unit tests cover the redirect logic, not Supabase Auth itself.
- `create_account()` runs as `security definer` with `auth.uid()` — the fake asserts the call
  shape and the RLS consequence, not plpgsql.
- Postgres-specific behaviour the fake approximates: `numeric` columns arriving as strings
  (handled), `timestamptz` formatting (normalised on read in `SupabaseStore`), `uuid` type
  checks on `approvals.decided_by` (the runtime must pass a real `auth.users.id` or leave it
  unset; the engine tests use opaque strings), unique-index + partial-index semantics
  (mirrored, but the real planner has the last word).
- `upsert` behaviour under RLS `with check` for `chat_messages` / `team_members` bulk writes.
- PostgREST's `select` column list parsing for `"account_id, budget_monthly, …"`.
- Rate limits and email deliverability.

## 7. Upgrade paths noted in code

- `SupabaseStore.sumSpend` sums `payload.spend.amount` in JS; move to a `sum_spend(account_id,
  since, until)` SQL function over `receipts_spend_idx` once receipt volume warrants it.
- `saveAccountRows` writes every section each save; add per-section dirty tracking so a chat
  message doesn't rewrite goals.
- `account_state_meta.client_state` is schema-versioned (`CLIENT_STATE_SCHEMA_VERSION`);
  bump it and add a migration function in `mapping.ts` when the envelope shape changes.
