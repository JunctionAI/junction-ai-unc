# Unc — the six-founder beta (Decision 11, 2026-09-02)

Six businesses Junction already knows get a seeded Unc account before they sign up, so their
first login lands on a goal, a plan and a Connectors card that already names their platforms —
not a blank onboarding. Everything here is built from the client files on Drive and Junction's
own work history; **nothing numeric was invented** (an unknown baseline is NULL in the
database, never 0, and every proposed goal line says so).

| What | Where |
|---|---|
| The six profiles (typed) + the seeder | `scripts/seed-beta.ts` — `BETA_ACCOUNTS`, `seedBeta(db, accounts, { dryRun })`, `betaSql(accounts, now)` |
| The seed as SQL (committed, generated) | `scripts/beta/seed-beta.sql` — `--sql` output, for the Supabase SQL editor / Management SQL endpoint |
| Standalone build config | `scripts/beta/tsconfig.json` |
| Invite table + attach RPC | `supabase/migrations/0009_beta_invites.sql` — `beta_invites` (service-role only) + `accept_beta_invites()` |
| The attach call | `src/lib/db/accountState.ts` `acceptBetaInvites()` — run by `ensureAccount()` before `create_account`, and by `requireAccountSession()` |
| Tests (schema-checked fake) | `src/lib/db/__tests__/seed-beta.test.ts`, `accountState.test.ts` (attach paths), `src/components/platform/__tests__/homeView.test.ts` |

## Running the seed

`tsx` is not in `node_modules`, so it builds with `tsc` like the worker (`src/worker/README.md`):

```bash
cd ~/junction-unc
set -a; source .env.local; set +a            # NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (process.env only)
npx tsc -p scripts/beta/tsconfig.json
node dist/beta/scripts/seed-beta.js --dry-run              # prints every row, writes nothing
node dist/beta/scripts/seed-beta.js                        # seeds / re-seeds all six
node dist/beta/scripts/seed-beta.js --only avgar,aerspan   # a subset (slugs below)
node dist/beta/scripts/seed-beta.js --sql --now 2026-09-02T09:00:00.000Z > scripts/beta/seed-beta.sql   # no env needed
# with tsx installed later: npx tsx scripts/seed-beta.ts --dry-run
```

**No node / no service-role key?** Apply `scripts/beta/seed-beta.sql` instead (same rows, same
idempotency, through the app's own mapping): Supabase SQL editor, or
`POST https://api.supabase.com/v1/projects/<ref>/database/query` with the Management token and
`{ "query": "<file contents>" }`. It must run AFTER migrations 0001–0009. Differences from the
node seeder: connectors / chat_messages / plans are insert-only in SQL (a re-apply never resets a
live connection, a real thread or an agreed plan), and the `beta_invites` inserts are emitted
**commented out** with `'[EMAIL: <founder>]'` placeholders — see "Invite flow" step 2.

Idempotent: keyed on the exact `accounts.name` (0001–0003 have no slug/metadata column, so the
name is the key — **don't rename an account in `BETA_ACCOUNTS` without moving the row**). Every
section upserts on its natural key through the app's own `saveAccountRows`, so a re-run after a
fact changes (currency, goal line, a baseline found) updates in place. Runs under the service
role; RLS is not in play.

What each account gets: `accounts` · one governing `goals` row · `resource_profiles` ·
`business_profiles` (facts, `scan_status` stays `pending` — no scan ran; `profile.beta.notes`
carries the source ledger) · `team_members` · `connectors` rows (`disconnected`) for the
platforms we know they use · one honest Unc opener + one human-lane line from Tom in
`chat_messages` · `plans`, `account_state_meta` (what `stateToRows` always writes). No
`approvals` rows: the three demo approval cards are demo furniture and are no longer persisted
for any account. `onboarded = true`, so first login lands on Home, not step 0.

## The six

Slug → `accounts.name`. "Goal source" is either the client's own docs or a Junction proposal
to confirm on the invite call. Deadlines are ~6 months out (2027-03-01) unless the client set one.

### `unity-mma` → Unity MMA
- **Known:** Auckland MMA gym; Instagram `@unitymma_` (instagram.com/unitymma_); TikTok in scope; coaches Brooke, Rory, Matt, Josh; technique content already travels (one tutorial 45.8K views); source `projects/unity-mma-content-audit/` (Content & Growth Playbook, Aug 2026).
- **Unknown:** owner's name, website, membership count, follower counts, ad spend, gym-management platform.
- **Seeded:** category *MMA gym — memberships (Auckland)*, NZD, goal **"30 new membership sign-ups/mo"** (leads, **proposed**), baseline NULL, channels Instagram + TikTok, strengths Video + Community, brand-led, focused. No connectors.

### `dbh` → Deep Blue Health
- **Known:** deepbluehealth.co.nz; DTC NZ supplements (Green Lipped Mussel, colostrum, deer velvet, marine collagen, propolis); Shopify, Klaviyo (two "Placed Order" metrics — the API one reads $0), Meta Ads, Google Ads all in use; Instagram dormant. Source: `clients/REGISTRY.md` + Junction's DBH work history.
- **Assumed:** a GA4 property exists (Google Ads runs) — confirm before it's offered as a connector.
- **Unknown this session:** founder's name (the client CLAUDE.md lives in `~/dbh-aios`, unreadable on Drive today), IG handle, revenue, repeat rate, ad budget, margin.
- **Seeded:** NZD, goal **"25% repeat purchase rate"** (retention, **proposed** — DBH is the retention case study), baseline NULL, connectors shopify/klaviyo/meta_ads/google_ads/ga4, brand+paid, broad.

### `avgar` → AVGAR Sport
- **Known:** avgarsport.com; luxury women's golf; Heather Anderson (founder, taste gate) + Gwyn (product truth); Shopify + GA4, Klaviyo, Meta, Google Ads, Triple Whale (`clients/avgar-sport/CHANNELS.md`); Junction goal tracker: 28-day revenue ~NZ$35K (▲69.7%) on 2026-07-12, target NZ$100–150K by 15 Jan 2027.
- **Unknown:** IG / TikTok handles (not in the files read), ad budget, margin. The NZ$10K/mo retainer is not an ad budget.
- **Seeded:** NZD, goal **"NZ$100,000 monthly revenue"** by **2027-01-15** (revenue, **client-docs**), **baseline 35,000 as of 2026-07-12** (`goals.baseline_date` set — refresh from `avgar.v_*` before it's shown as current), all five connectors, team Heather (Founder) + Gwyn (Product), brand+paid, broad.

### `home-invasion` → Home Invasion
- **Known:** home1nvasion.com (Shopify — `home1nvasionstore.myshopify.com`); founder Zac; Klaviyo installed, Meta pixel installed; hip-hop / pop-culture home decor (rugs, plushies); Meta ads primary lane; install started 2026-08-06 on the founder's Claude Max (`clients/home-invasion/CHANNELS.md`, `clients/REGISTRY.md`). **Trades in USD** — verified 2026-09-02 from the live store (`/meta.json`: currency USD, country NZ, Auckland; products priced e.g. 160.00). Business is Auckland-based, ships worldwide.
- **Unknown:** IG handle (TBC in the client file), GA4 property (TBC — not seeded), revenue, budget, margin.
- **Seeded:** **USD**, goal **"US$30,000 monthly revenue"** (revenue, **proposed placeholder**), baseline NULL, connectors shopify/klaviyo/meta_ads, paid+brand, focused.

### `rory` → Rory O'Keefe
- **Known:** product design services; Instagram-led founder brand (The Corner daily coaching, weekly leaderboard); follower goals 20K Jul 2026 / 100K Dec 2026 (Junction's Rory Corner work; `clients/REGISTRY.md`).
- **Unknown this session:** website, IG handle, current follower count, revenue — `clients/rory-okeefe/CLIENT-BRIEF.md` and `THE-PLAN-2026-08-04.md` timed out on Drive; the `rory.v_*` views hold the follower series.
- **Seeded:** NZD, goal **"100,000 engaged followers"** by **2026-12-31** (brand, **client-docs**), baseline NULL (pull the latest reading before the invite), channel Instagram, brand+sales, focused. No connectors.

### `aerspan` → Aerspan Airdomes
- **Known:** Mike Hall-Taylor; exclusive NZ/AU/Oceania distributor for DUOL air-supported domes; goal 12 projects a year, NZ then Australia; team Brett + Daniel Clapham; company mail on the aerspanairdomes.com domain, Microsoft 365 (GoDaddy-provisioned, federated) — Mike's address is in `clients/aerspan-airdomes/CLAUDE.md`, not in this repo; company incorporated 2026, **no completed NZ project yet**, Counties Tennis at tender; claims law: DUOL's record ≠ Aerspan's, price wedge banned from cold email (`clients/aerspan-airdomes/CLAUDE.md`).
- **Unknown:** whether aerspanairdomes.com serves a site (seeded from the mailbox domain), LinkedIn presence, pipeline value.
- **Seeded:** NZD, goal **"12 signed dome projects per year"** (leads, **client-docs**; deadline = the 6-month horizon, the goal itself is annual), **baseline 0 as of 2026-08-12 — a found fact, not a null**, channels LinkedIn + Email, sales-led, focused, team Mike + Brett + Daniel. No connectors (M365 mail has no registry entry yet).

## Invite flow (built 2026-09-02)

1. **Apply migration 0009** (`supabase/migrations/0009_beta_invites.sql`) with the rest of the
   migrations — before the build that carries this doc is deployed. (A deployed app without
   0009 still signs people in: `acceptBetaInvites()` reads PostgREST's "function not found" as
   "no invites" and warns in the server/browser console; nothing else is blocked.)
2. **Seed** (above) — node seeder or `scripts/beta/seed-beta.sql`. Accounts exist;
   `account_members` is empty for them — there is no `auth.users` row until the founder signs up.
3. **Claim** — one `beta_invites` row per founder, `email` (lower-cased) → `account_id`,
   written by Tom with the service role. The insert per founder is at the end of each block in
   `scripts/beta/seed-beta.sql`, **commented out** with a `'[EMAIL: <founder>]'` placeholder:
   fill the address, uncomment, run. Emails are never stored in the repo.
4. **Email** — Tom sends the invite (drafts below) pointing at `getjunction.ai/app`. Magic-link
   sign-up with the same address.
5. **Attach on first login** — `ensureAccount()` (`src/lib/db/accountState.ts`, called from
   `useAccountPersistence` on /app mount) runs `acceptBetaInvites()` → `db.rpc("accept_beta_invites")`
   **before** `listMemberships()` / `create_account()`. The RPC (security definer) reads the
   signed-in user's address from `auth.users` — only once `email_confirmed_at` is set, which the
   magic link does — matches open invites, inserts the `account_members` row(s) under a row lock
   and marks them accepted. `listMemberships()` then finds the seeded account, `loadAccountState()`
   returns `found = true` (the seed writes `account_state_meta`), and the founder lands on Home
   with their goal, plan and Connectors card — the client's local state is **not** written over
   the seed (`accountState.test.ts` + `seed-beta.test.ts` pin this end to end). The server-side
   routes that create accounts on a race (`requireAccountSession({ createAccount: true })` —
   billing, the Shopify install entry) accept invites first too.
6. **Wrong-address sign-up** (they use a different mailbox): no invite matches → an empty
   account is created as today. Recovery = add a second `beta_invites` row for that address,
   delete the empty account (cascade removes the membership), have them sign in again — the
   RPC is idempotent and runs on every sign-in.

## Known gaps

Closed 2026-09-02:
- ~~Null baseline renders as the demo number.~~ `baselineNum` is `number | null`; a NULL
  `goals.baseline` hydrates as null and Home (accounts mode) shows *"Baseline not set yet —
  tell me where you started and I'll work the pace out from there."* with an inline
  "Where it is now" field that autosaves into `goals.baseline`; the Unc chat context carries
  null pace/progress instead of demo maths. Demo mode is unchanged.
- ~~Demo approval cards.~~ Not persisted any more (`stateToRows` emits no `approvals` rows,
  the loader ignores legacy `demo-ap-*` rows) and never rendered in accounts mode — Home shows
  the runtime's list, a loading line while it fetches, or the error if the fetch failed.
- ~~Home Invasion currency.~~ USD, verified from the live store.

Still open:
- **`budget_monthly` / `hours_weekly` are 0 when unknown** (not-null columns). The profile
  card says "Not set yet"; the plan maths reads 0 until the founder types a number.
- **Baseline freshness.** AVGAR's 35,000 is a 2026-07-12 reading; Aerspan's 0 is from
  2026-08-12. Re-seed with today's readings before sending the invites (re-generate the SQL
  after editing `BETA_ACCOUNTS`).
- **Legacy `demo-ap-*` rows** on accounts created before 2026-09-02 (Tom's own test accounts)
  are left in place; delete by hand if they bother anyone (`delete from approvals where
  client_key like 'demo-ap-%'`).

## Invite emails (Tom's voice — short, honest, one of six)

Subject line for all: **You're one of six**

**Unity MMA**
> Kia ora team — I've been building something and you're one of six businesses I want in first. It's called Unc: an AI growth agent that reads your numbers, drafts the work, and never posts, sends or spends without you approving it. I set your account up from the content audit we did in August, so it already knows @unitymma_ and the plan. The one number I couldn't fill in is your baseline — how many new members a month you're doing now. Tell me that and we're away. Sign in here with this email: getjunction.ai/app. Honest ask: use it for a month and tell me what's wrong. — Tom

**Deep Blue Health**
> Hi — you're one of six I'm putting into Unc first. It's the AI growth agent I've been building: it reads Shopify, Klaviyo and the ad accounts, drafts the work, and nothing goes out without your approval. Every read is receipted, so you can see exactly what it looked at. Your account is already set up with what we know from the last few months; I've pencilled repeat purchase rate as the goal because that's where DBH wins. Change it if you disagree. Sign in with this address at getjunction.ai/app. Then tell me what's wrong with it — that's the deal. — Tom

**AVGAR Sport**
> Hi Heather — you're one of six. Unc is the product version of what we've been doing by hand: it reads the store, Klaviyo and the ad accounts, drafts the work, and holds everything until you or Gwyn approve it. Your account already carries the goal we agreed (NZ$100K a month by 15 January) and the July baseline; the connectors are waiting for you to click Connect. Sign in with this email at getjunction.ai/app. It's early. I want the honest version of what you think, not the polite one. — Tom

**Home Invasion**
> Zac — you're one of six businesses I'm putting into Unc before anyone else sees it. It's an AI growth agent: it reads Shopify, Klaviyo and Meta, drafts the work, and nothing publishes or spends without your approval. I've set your account up from what we've got so far, in USD like the store. One thing I need from you on first login: the monthly revenue number you're at now — Unc asks for it at the top of the page. Sign in with this email at getjunction.ai/app. Use it, break it, tell me. — Tom

**Rory O'Keefe**
> Rory — you're one of six. Unc is the thing The Corner has been growing into: an agent that reads your numbers, drafts the work, and waits for your approval on anything that goes out. Your account is set up around the 100K-by-December goal. I haven't put a baseline in — I'd rather you type today's follower count than have me guess it. Sign in with this email at getjunction.ai/app and tell me where it's wrong. — Tom

**Aerspan Airdomes**
> Dad — you're one of six. This is the product version of the sales agent: it drafts, you send, nothing leaves without you. Your account is set up around 12 projects a year, NZ first, with the claims rules baked in (DUOL's record stays DUOL's, no price wedge in cold email). The baseline is zero signed projects, which is true today and will change. Sign in with your aerspanairdomes.com address at getjunction.ai/app. Tell me what doesn't make sense — that's the useful part. — Tom
