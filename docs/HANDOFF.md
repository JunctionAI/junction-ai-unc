# HANDOFF — Unc (Junction's growth-agent product)
*Written 2026-09-03 for whichever agent continues this build. Read this file first, then `docs/RUNBOOK.md`, then `docs/PRODUCT-EXPERIENCE.md`. Everything here is verifiable in the repo; nothing is from memory.*

---

## 0. The one-paragraph brief
Junction AI (Tom Hall-Taylor, New Zealand; entity JUNCTION CENTRAL LIMITED, co. 7879076, NZBN 9429047921313) is building **Unc**: a self-serve "growth operating agent" for founder-led businesses. Unc onboards a founder, agrees a goal and a phased plan, connects their platforms, runs **routines** (content, paid ads, SEO, sales, email) that produce real work products, and asks the founder to **approve** anything consequential. The product is the design in `design-reference/` (Claude Design handoff, 2026-09-01) made real: guided, simple, no fake data, Unc-first (he guides on any channel; the UI is his hands). Pricing US$100/mo, 14-day trial. **Public north star: US$1M/month by 22 Jul 2027.** Current phase: **private beta with six named founders (Unity MMA, Deep Blue Health, AVGAR Sport, Home Invasion, Rory O'Keefe, Aerspan Airdomes) — target: live within days.** Public self-serve launch is behind OAuth app reviews and billing.

## 1. Non-negotiable rules (the founder's, encoded in code and tests)
1. **No invented data, ever.** In a real account every number, list, status and example comes from the database or a certified read. Unc may only state numbers present in his context (`src/lib/unc/prompt.ts`, validators in `narrative.ts`, `brief.ts`, `artifacts/validate.ts`, `nicheBrief.ts`). Demo data exists only behind "Skip — explore with demo data" with a banner. A test (`accountHome.test.ts` and the COPY-AUDIT guard) asserts demo phrases can't render in accounts mode. **Fixture credentials can never reach a real account** (`NoCredentialsProvider`, commit 701435b) — this was a real leak found in the founder's first run; never regress it.
2. **Nothing sends, spends or publishes without an approval.** `LIVE_MODE_ENABLED = false` in `src/worker/service.ts`; per-risk enablement via `UNC_LIVE_ACTION_RISKS`; the engine structurally refuses execute without an approved, unexpired gate on the same run; spend caps fail closed; every read/draft/decision/mutation writes a **receipt**.
3. **Unc's voice** (`docs/UNC-VOICE-AND-JUDGEMENT.md`): first person, answer first, ≤3 sentences unless depth is asked (code-enforced re-ask in `src/lib/unc/concision.ts`), numbers over adjectives, takes a defensible position and pushes back cleanly, never agreeable for its own sake, banned phrases list in the eval rubric. Founder is the source of truth for memories.
4. **No assumptions about business type.** Platform suggestions come only from what the founder said (onboarding step 2/4 → `resource_profiles.known_platforms`) or what the site scan evidenced; store-only routines hidden for non-stores (`src/lib/runtime/availability.ts`, `src/lib/unc/businessType.ts`).
5. **Design system is fixed** (`design-reference/README.md`): OKLCH tokens in `src/app/globals.css`, Space Grotesk, pills, cards, chat-bubble grammar, amber only where a decision waits (≤2 per screen), cyan spent like money, only `jfloat`/`jpulse` move. Copy strings in demo mode are verbatim from the prototype; parity harness `npm run e2e:parity` (≤0.33% diff per screen at last run).
6. **Secrets**: never read `.env` files in app code; never log or return tokens; never copy keys between services in scripts (the permission classifier blocks it and it's the wrong pattern — the founder pastes into Vercel). Local dev sources the Junction root `.env` in-process via `scripts/dev.sh`.
7. **Every commit signed** (repo-local SSH signing configured), **main is protected** (CI `verify` must pass, admins enforced, linear history, no force-push). Work on `build/*` branches → PR → squash-merge. Commit trailer used so far: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 2. Where everything lives
| What | Where |
|---|---|
| Code (Next.js 16 App Router, TS, Supabase, vitest, Playwright) | `~/junction-unc` on Tom's Mac · GitHub **JunctionAI/junction-ai-unc** (private) |
| Design source of truth | `design-reference/` (prototypes `.dc.html`, README = spec, `parity/REPORT.md`, `evals/`) |
| Product docs (read in this order) | `docs/RUNBOOK.md` → `PRODUCT-EXPERIENCE.md` → `ROUTINES-REAL-WORK.md` → `CLIENT-BRAIN.md` → `PROACTIVE.md` → `CHANNELS.md` → `N8N-ROUTINES.md` + `N8N-INTAKE.md` → `PRESETS.md` → `ACTIONS.md` → `AUTH-PROVIDERS.md` → `CONNECTORS-FIRST-BOOT.md` / `FIRST-BOOT.md` / `BILLING-FIRST-BOOT.md` → `LAUNCH-CHECKLIST.md` → `MODELS.md` → `UNC-VOICE-AND-JUDGEMENT.md` → `IMPROVEMENT-LOOP.md` → `COPY-AUDIT.md` → `PRICING-BY-COUNTRY.md` / `INFRA-COSTS.md` / `SHOPIFY-APP.md` / `BETA.md` |
| Founder-side tracker (Google Drive) | `clients/junction-ai/product/unc-growth-agent-design-2026-09-01/GOAL-CHARTER.md` (tick log + Tom-only ASKS table), `PHASE-0-DECISION-BRIEF.md`, `BUILD-PLAN-2026-09-01.md`, `legal-and-oauth/`, `MESSAGE-TO-NGUYEN-n8n-integration.md` |
| Plan page (artifact) | https://claude.ai/code/artifact/7e8fa68b-78c6-4f58-8a50-a327c3ee3f21 |
| Production | Vercel project `junction-unc` (team `tom-junctionmedis-projects`, id `prj_WXwCzYpwmx9MmLBgqGrpWh8jnc6d`) → **https://junction-unc.vercel.app** (public; getjunction.ai flip ON HOLD by Tom's call) |
| Database | Supabase **`junction-ai-unc`** ref `ycgayfsvcjpsnryrpukv`, Sydney (`ap-southeast-2`), **migrations 0001–0015 applied** (0015 applied? → see §6 open items), auth via Resend SMTP, templates in Unc's voice |
| Worker | `src/worker/` (daemon: cron scheduler, dry-run routines, KPI snapshots, daily brief, self-review, benchmarks, channels tick, oauth sweep) — **not yet deployed**; `deploy/worker/{Dockerfile,fly.toml}` ready for Fly.io |
| n8n | Tom's team (Nguyen) builds skills at `junctionai8.app.n8n.cloud`; first workflow = `TEST — AVGAR — Paid Ads — Shadow` (execution #50 reviewed) |

## 3. Architecture in one screen
```
Founder ──(app / Telegram / WhatsApp / Slack / SMS: ONE thread)── Unc
   │  onboarding → plan (deterministic core + reasoning + narrative) → connect data → first routine → daily rhythm
   ▼
Next.js app (Vercel)  ── API routes (all wrapped in withErrorCapture) ── Supabase (Postgres + RLS, pgvector)
   │ chat/scan/narrative/brief/self-review via src/lib/llm router (Anthropic | OpenAI-compatible: OpenAI/Gemini/OpenRouter/custom;
   │   per-task + per-account model prefs; llm_usage ledger; monthly cap per account)
   │ Client Brain: memories (extract→retrieve), account_profiles, playbooks (39, embedded), kpi_snapshots, daily_briefs
   ▼
Routines runtime (src/lib/runtime): spec = TRIGGER → READ* → CHECK → DECIDE → PRODUCE (skill | n8n) → GATE → EXECUTE (actions) → RECEIPT
   • 35 catalog specs; wave 1 (10) draft-only; skills in src/lib/runtime/skills; artifacts table + Drafts UI (edit/approve/hold/why)
   • waiting_input when a skill lacks its minimum; presets (7 industry bands) + one-screen inspector; versioning draft→dry-run→promote
   • Store: MemoryStore (demo) | SupabaseStore (service role) via src/lib/runtime/store/index.ts
Worker (Fly, pending): runs due routines dry-run, telemetry jobs, channel pushes; adapters = readers (Shopify/Klaviyo/GA4/Meta/HubSpot; Google Ads fixture),
   LlmProducer, LlmDecisionProvider (+ taste patterns + presets), ActionExecutor (being built; dry-run only), credentials = ConnectorCredentialProvider | NoCredentialsProvider (never fixtures with a DB)
Connectors: own OAuth apps (Shopify/Klaviyo/Meta/GA4/Google Ads/Search Console/HubSpot + unified "Connect Google"), owner token-paste, AES-256-GCM secret store,
   post-connect pickers, read-now on connect, revoke + tenant purge, Shopify GDPR webhooks, optional Composio/Nango adapters (flag-gated; verdict: Nango self-hosted for long tail only)
n8n bridge: routine → signed webhook → workflow pulls via /api/n8n/reads + /api/n8n/context with a 15-min run-scoped data token → returns {artifact}|{needs}; actions queue as approvals; Skills page registers/tests; fallback to built-in skill
Channels: migration 0012; adapters telegram/whatsapp/slack/twilio; approvals from buttons/keywords; proactive pushes with quiet hours
Billing: Stripe (checkout/webhook/portal/paywall) env-gated, not configured for beta. Locale: per-country pricing + copy (US/NZ/AU/GB/IN), India needs a merchant of record.
```

## 4. State of the build (facts)
- **138 test files, 1,729 unit tests green** on `build/action-library` (four gates: `tsc`, worker `tsc`, `npm test`, `npm run build`). Live chat evals: judge mean 9.4–9.8/10 (25 scenarios; `design-reference/evals/`).
- **main** = PR #5 merged (n8n skills + launch hardening). **Branch `build/action-library`** carries: auth-provider spike, presets, **Meta action library** (`src/lib/actions`, `docs/ACTIONS.md`, ActionExecutor dry-run + live refuse).
- Migrations applied to the live DB: **0001–0015** (`account_presets`, `routine_params` verified 2026-09-03).
- Vercel env present: Supabase URL/anon/service, ANTHROPIC/OPENAI/GEMINI/RESEND keys, APP_URLs, TELEGRAM_BOT_TOKEN/USERNAME/WEBHOOK_SECRET, N8N_SIGNING_SECRET, UNC_ADMIN_EMAILS. **Missing: CONNECTOR_SECRET_KEY** (Tom pastes; `openssl rand -base64 32`), STRIPE_*, connector client ids, NANGO_*.
- Real accounts in the DB: six seeded founder accounts (no members yet), Tom's fresh test account (`halltaylor.tom@gmail.com`, plan agreed 2026-09-02, three routines on), invite `tom@getjunction.ai → AVGAR`. Fake fixture runs were purged from Tom's account.
- Telegram bot **@JunctionAI_bot** webhook registered + verified (401 without secret, 200 with). Tom personally doesn't want Telegram; it stays as a founder option. WhatsApp/Slack/SMS need credentials.

## 5. How to work here
```bash
cd ~/junction-unc
PORT=3400 ./scripts/dev.sh          # dev server; sources the Junction root .env in-process (ANTHROPIC/OPENAI/GEMINI keys)
# accounts mode locally: export NEXT_PUBLIC_SUPABASE_URL/ANON_KEY + SUPABASE_SERVICE_ROLE_KEY + CONNECTOR_SECRET_KEY in the SAME shell first
npx tsc --noEmit && npx tsc -p tsconfig.worker.json --noEmit && npm test && npm run build     # the four gates
npx playwright test                 # e2e (needs :3400 in DEMO mode for control-centre specs; landing spec works either way)
npm run e2e:parity                  # prototype-vs-port pixel diff → design-reference/parity/REPORT.md
node dist/brain/scripts/eval-chat.js (after npx tsc -p scripts/brain/tsconfig.json)   # live chat evals (needs a provider key)
npx tsc -p tsconfig.worker.json && node dist/worker/worker/main.js --once|--probe <platform> --account <id>|--measure|--self-review|--benchmarks|--kpi-snapshot|--daily-brief
```
- Deploy: from a clean worktree (`git worktree add /tmp/unc-deploy HEAD`), `.vercel/project.json` = project id above, `npx vercel deploy --prod --token $VERCEL_TOKEN --scope tom-junctionmedis-projects --yes`. Migrations: Supabase Management API `POST /v1/projects/{ref}/database/query` with `SUPABASE_ACCESS_TOKEN` (send a real User-Agent or Cloudflare 403s).
- GitHub: `gh` is logged in as JunctionAI (scopes repo+workflow); push with `git -c credential.helper='!gh auth git-credential' push`. PR → `gh pr checks N` → `gh pr merge N --squash --delete-branch`.
- Pattern that worked: parallel background agents with **disjoint file ownership** stated in the brief, additive edits to shared files, each agent verifies the four gates and commits signed; a coordinator applies migrations, opens PRs, deploys, and updates the Drive charter every tick. Drive reads can hang — cap them at 2 minutes; the Google Drive connector works when the filesystem doesn't.
- Environment gotchas: the Browser-pane preview sandbox can't read the Drive folder (start the dev server from a shell); one `next dev` per project dir; emulated-viewport screenshots blank after scroll (use native size or Playwright); the classifier blocks copying keys between services and embedding tokens in git remotes — hand those to Tom.

## 6. Open items — in priority order
**A. Land the action-library branch.** Code + docs + 0015 on the live DB are done (four gates 1,729 tests; approvals/api-routes clocks are relative). AVGAR Graph v23 proof: 3 ad sets, NZ$307.25 last_7d (Junction env token, not copied into Unc). Remaining: PR → CI → squash-merge → production deploy. Unc-side Meta reads still need `CONNECTOR_SECRET_KEY` in Vercel.
**B. Adopt the three Graphed lessons** (Tom agreed): (1) a **verified metric catalog** with locked definitions (`get_metric`) as the only thing Unc/skills read for numbers; (2) **shadow-mode agreement gate**: score every dry-run proposal against what the founder approved/held; unlock `apply` per routine at ≥80% agreement over N weeks (the product already promises "graduate them"); (3) **skill-file template** `goal/owns/reads/decides/writes/never/apply/examples` added to `Skill` and rendered in the inspector.
**C. Beta go-live (Tom-gated, see `docs/LAUNCH-CHECKLIST.md`)**: CONNECTOR_SECRET_KEY → token-paste AVGAR's Shopify/Klaviyo/Meta → real numbers; Fly login → deploy worker (`fly launch` with `deploy/worker/`, secrets pasted by Tom); Meta app + Google consent screen in testing mode (~1 h, drive the dashboards with Tom in Chrome; texts in `legal-and-oauth/OAUTH-PREP-PACK.md`); six founder emails → `beta_invites` rows (`scripts/beta/seed-beta.sql` has commented inserts) → invites (`docs/BETA.md` drafts); beta domain decision.
**D. n8n skills with Nguyen**: he converts the AVGAR shadow workflow per `MESSAGE-TO-NGUYEN-n8n-integration.md` (webhook + HMAC, `/api/n8n/context`, `/api/n8n/reads`, `{artifact, actions}`/`{needs}`, split into D02-W01 + D02-W03), registers on the Skills page. Use his policy as the oracle for `rules/meta.ts`.
**E. Quality levers**: judgement dipped slightly with the concision cap (1.56→1.48) — next lever is "reason in the first sentence"; `rambling-focus`/`plan-rationale-gate` scenarios at 8/14; `source:'unc'` preset adjustments from self-review (column exists, nothing writes it); account-wide presets screen; `app/uninstalled` Shopify webhook; GA4/Ads/Meta pickers verified live; India MoR decision; Nango self-host for the long tail.
**F. Public launch (weeks)**: Meta App Review, Google verification, Shopify App Store (billing exemption request), Stripe live, lawyer review of `/privacy` + `/terms`, getjunction.ai flip.

## 7. Tom's working style (respect it)
Direct, fast, voice-note-style messages; wants honesty over comfort ("it's not hooked up" → diagnose, don't defend); hates fake/placeholder anything; thinks in bottleneck lists; decides quickly when given a recommendation; will paste env vars and run one-line commands but not more; shares tokens in chat when it's faster (remind him to rotate). Every session: update the Drive charter (tick log + ASKS), keep the one-signature list current, and tell him exactly what only he can do.
