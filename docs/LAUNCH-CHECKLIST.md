# Unc — private beta launch checklist (six founders)

**The beta:** six seeded accounts (`docs/BETA.md`) on the dry-run product — draft-only routines,
real reads, Unc on chat + channels, no customer-facing send, publish, spend, price change, or
destination mutation. Owner-linked briefs, draft notices, and approval reminders are a separate
notification lane and may deliver once the founder explicitly links that channel. Success = each founder agrees a plan,
connects one platform, turns on one routine, reviews one draft, and gets a morning brief. Rails:
`LIVE_MODE_ENABLED=false`, per-account model cap (US$15/mo default), every error captured
(`app_errors`), `/api/health` green. **Owner: Tom.** Support: Tom on the founder's channel
(Telegram / WhatsApp / Slack) + `tom@getjunction.ai`. Beta window: 2 weeks from the first invite.

## 1. Before invites (Tom, one sitting — ~2 h)

| # | Step | Check |
|---|---|---|
| 1 | Every file in `supabase/migrations/` applied in lexical order, through `20260903211025_llm_spend_reservations.sql`. | Worker/cap queries answer; public/authenticated similarity, admission, and release RPC calls are denied; service-role spend reservation works; member writes to governed runtime tables are denied |
| 2 | Vercel env (`junction-unc` project, Production): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CONNECTOR_SECRET_KEY`, `ANTHROPIC_API_KEY` (+ `OPENAI_API_KEY` for embeddings), `NEXT_PUBLIC_APP_URL` + `APP_URL` = `https://unc.getjunction.ai`, `N8N_SIGNING_SECRET`, `UNC_ADMIN_EMAILS=tom@getjunction.ai`, `UNC_ACCOUNT_MONTHLY_USD_CAP=15`, Stripe + connector client ids per `docs/RUNBOOK.md`. | `GET /api/health` → `ok:true`, `db.ok:true`, `build.sha` = the deployed commit |
| 3 | In Supabase Auth, disable public sign-ups and pre-create/invite each exact beta email; deploy the app only after review. | `/api/health` 200; invited email receives a magic link; unknown email creates no Auth user/account |
| 4 | Fly worker: `fly secrets set` the same DB / secret / model / n8n vars + `UNC_WORKER_INTERVAL_SEC=60`; `fly deploy --config deploy/worker/fly.toml --dockerfile deploy/worker/Dockerfile`; **one machine only**. | `fly status` healthy; `/api/health` shows `worker.fresh:true` within 3 min |
| 5 | Seed the six: `node dist/beta/scripts/seed-beta.js` (or the SQL) → then the `beta_invites` rows with each founder's confirmed email. | `select name from accounts;` lists the six |
| 6 | Smoke as Junction (account #1): agree the plan → connect Shopify (token path is fine) → turn on Founder content engine → a draft lands → approve it → next morning's brief exists. | the five "Getting set up" steps go green |
| 7 | Skills: sidebar → Skills → paste one n8n webhook → **Test** → artifact comes back. Pause it again unless it should serve. | test shows `Came back with a post_set …` |
| 8 | Error capture: hit a deliberately bad route once; `select scope, message from app_errors order by created_at desc limit 3;` | a row, no key in it |

## 2. Invites (Tom, day 1)

1. Send each founder the invite line (`docs/BETA.md` "Invite flow") from `tom@getjunction.ai`:
   the link, what they'll see first, the one thing to do today (agree the plan).
2. Ask where Unc should reach them; connect that channel with them on the call (`docs/CHANNELS.md`).
3. Open a Slack/WhatsApp thread per founder for support; note their timezone in
   `account_profiles.cadence.timezone` so the 06:30 brief lands in their morning.

## 3. Smoke tests per founder (Tom watches the first session; ~20 min each)

| Step | Pass when |
|---|---|
| Sign in → Home | the seeded goal + plan show; no demo furniture, no placeholder numbers |
| Agree the plan | `plans.agreed_at` set; the account is named in the sidebar |
| Connect the first platform | connector `connected`; "Reading your last 90 days" → a KPI line with a real number, or an honest "couldn't ask" |
| First routine on | a `routine_runs` row `done` within a minute; "What I drafted" shows the artifact |
| First review | Approve / Hold writes a `taste_events` row; Unc replies in their voice |
| Chat, one question | a reply from the model (not the canned fallback); under the cap |
| Next morning | `daily_briefs` row for their local day; delivered on their channel |

Watch daily: `GET /api/health`; `select scope, count(*) from app_errors where created_at > now() - interval '1 day' group by 1;`;
Skills → admin spend table (anyone near US$15 → raise `accounts.monthly_llm_cap_usd` or leave the honest line).

## 4. Rollback

- **App:** Vercel → Deployments → the previous good deployment → **Promote to Production** (instant; env unchanged). Confirm `/api/health` `build.sha` moved.
- **Worker:** `fly releases` → `fly deploy --image <previous image>`; or `fly scale count 0` to stop it (routines pause; the app keeps working — drafts just stop arriving, and `/api/health` says the worker is stale).
- **Migrations:** the release migrations are additive and forward-only. Do not delete tables or
  broaden grants to roll the app back; promote the previous app/worker, retain the schema, and
  reconcile the migration ledger before the next deploy.
- **Kill switch for model spend:** set `UNC_ACCOUNT_MONTHLY_USD_CAP=0` on Vercel + Fly → every account gets the honest line, no provider calls.
- **A single founder:** `update routine_states set enabled=false where account_id='…'` pauses their routines; their data stays.

## 5. Who does what

| | Tom | Claude (sessions) | Founder |
|---|---|---|---|
| Env, deploys, migrations, invites, every outward message | ✔ | drafts, never sends | |
| Reading `app_errors` / fixing | triage | fix + tests | |
| Raising a cap, registering a global n8n skill | ✔ (admin) | | |
| Connecting platforms, approving drafts | on the call | | ✔ |
| Support replies | ✔ | draft the answer | |
