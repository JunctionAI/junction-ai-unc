# Unc — first boot with a real Supabase project

Accounts, persistence and the governed runtime are tested against a schema-checked fake. This
is the exact sequence for a new Unc project. Until then a local development build can run in
demo mode; a production build without account storage fails closed at cost-bearing endpoints.

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
npx supabase db push          # applies every pending file in supabase/migrations/ in order
```

If the SQL editor is unavoidable, paste **every** `.sql` file in lexical filename order. Do
not stop at a numbered migration: the dated migrations revoke unsafe legacy grants and are
part of the release boundary.

Verify `supabase migration list` shows no pending local migrations. Confirm every application
table has RLS enabled; similarity RPCs and governed runtime/model/artifact tables reject
anon/authenticated writes; owner-editable configuration rejects a `member`; the browser cannot
update `accounts.monthly_llm_cap_usd`; `create_account(text,text)` is not executable by client roles; only `service_role` can
call the n8n data and `reserve_llm_spend` / `release_llm_spend_reservation` functions introduced
by the hardening migrations. Exercise one reservation and release under the service role, then
confirm the same RPCs are denied as anon and authenticated.

## 3. Auth provider

Authentication → Providers → **Email**: enabled, *Confirm email* on, magic link on, and
**public user sign-ups disabled**. Passwords are never used. For each beta founder, create or
invite the exact address from Auth Admin before sending Tom's invite; `LoginForm` calls
`signInWithOtp` with `shouldCreateUser:false`.

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
2. **Invite + magic link** — seed the account and `beta_invites` row, pre-create/invite the
   exact Auth address, enter it, open the link, and land on `/app` through the callback.
   `accept_beta_invites()` attaches that identity to the seeded account. An unknown address
   creates neither an Auth user nor an account and account APIs answer `403 invite_required`.
3. **Seeded state** — confirm the invited founder lands on Home with the pre-seeded goal, plan,
   resource profile, team, and disconnected connector cards. Edit one non-sensitive profile field
   and watch the sidebar footer move "Saving…" → "Saved"; an uninvited identity must never receive
   an empty auto-created tenant.
4. **Refresh** — F5. `/app` shows "Fetching your account…" briefly, then the control centre
   with the same goal line, deadline, budget, team, strengths and plan. (`onboarded` and the
   step come from `account_state_meta.client_state`.)
5. **Routine toggle** — Routines → toggle any routine on/off → refresh → it holds.
   `routine_states` has a row with `enabled` set and `version = 1`, `live_spec` null.
6. **Artifact taste gate** — dry-run one supported routine, then approve one generated artifact
   and hold another with a reason. Refresh and confirm `artifacts.status` plus matching
   `taste_events`; there are no persisted demo approval cards. Separately verify a `member` can
   read drafts but receives `403 owner_only` when attempting a taste decision.
7. **Chat** — send a message in the corner chat → refresh → the thread is back
   (`chat_messages.thread = 'corner'`, ordered by `position`).
8. **Sign out** — sidebar "Sign out" → `/login`; `/app` redirects again.
9. **Second device / browser** — sign in with the same email → the same account hydrates
   (no second account is created).
10. **RLS** — in the SQL editor as the anon role (`set role anon; select * from accounts;`)
    returns nothing; as a seeded `member`, reads stay inside the account while writes to the
    model, routine, artifact, approval, connector, account-cap, and plan boundaries are denied;
    as the owner, only the intended configuration fields are writable; as the service role the
    governed server paths work.

## 6. Things that can only be verified against the live project

- The magic-link email → callback → cookie session loop (PKCE code exchange, cookie names,
  the proxy refreshing tokens). Unit tests cover the redirect logic, not Supabase Auth itself.
- `accept_beta_invites()` confirmed-email lookup and row locking, plus the client-role revoke
  on legacy `create_account()`, require a real-role probe; static migration tests do not prove
  the target project has applied them.
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
