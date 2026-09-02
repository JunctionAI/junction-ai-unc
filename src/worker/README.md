# Unc worker — the always-on DRY-RUN scheduler

The process that runs due routines on their cadence, using the runtime library in
`src/lib/runtime/` (engine, catalog specs, versioning, store). It is **read-only and
dry-run-only**:

- `LIVE_MODE_ENABLED = false` in `service.ts` is a hard constant. Every run the worker or
  the API starts is `mode: "dry_run"`. Flipping it is a product decision gated by the
  founder (Wave 2) — see the last section.
- The only Executor shipped is `RefusingExecutor`: every mutation returns
  `{ ok: false, error: "not_implemented — mutations are Wave 2, founder-gated" }`, and the
  engine fails the run closed with a receipt saying so. This holds even for a live run
  with an approved gate.
- Credentials are chosen in `wiring.ts`: `ConnectorCredentialProvider` (real tokens from
  `connector_secrets`) when Supabase (service role) + `CONNECTOR_SECRET_KEY` are configured,
  else `FixtureCredentialProvider`. `FixtureCredentialProvider` returns fixture
  markers, never tokens. Nothing in `src/worker/` reads `.env` files or platform tokens
  from `process.env`.
- Dry runs never pause: a gate becomes a `Would ask <approver>: …` draft receipt and the
  run finishes. `waiting_approval` only arises from live runs, which are disabled.

## Module map

| Path | What it is |
|---|---|
| `cron.ts` | Pure 5-field cron matcher (UTC): `*`, `*/n`, lists, ranges, stepped ranges, vixie dom/dow rule. `latestSlotBetween(expr, from, to)`. |
| `scheduler.ts` | Pure due-selection: `dueRoutines(now, candidates, {lookbackMs})`. `manual` and `event:*` cadences are never scheduled. Dedup for dry runs is store-backed (see below). |
| `service.ts` | Shared trigger/resume used by the loop **and** the API routes. `LIVE_MODE_ENABLED`, `buildAdapters`, `triggerRun`, `resumeApproval`, `collectCandidates`, `WorkerError`. |
| `loop.ts` | The daemon: `Worker` class — tick every N s, per-tick time budget, structured JSON logs, atomic heartbeat file, graceful SIGTERM/SIGINT, `whenIdle()`; after the routines each tick runs the due telemetry jobs and the hourly `oauth_states` sweep. |
| `jobs.ts` | Pure in-loop schedule for the telemetry jobs (`measure` 02:00 daily, `benchmarks` Mon 03:00, `self_review` Mon 06:00 UTC): `dueJobs(now, markers)`, per-job "already ran" markers that ride on the heartbeat file. |
| `telemetry.ts` | `runMeasure` / `runSelfReview` / `runBenchmarks` — what the jobs and the one-shot flags call (docs/IMPROVEMENT-LOOP.md). |
| `main.ts` | CLI entry (flags below). |
| `health.ts` | Optional `GET /health` (200 while the heartbeat is fresh, 503 otherwise). |
| `accounts.ts` | `AccountsSource` interface + `StaticAccountsSource` (one `demo` account) + `DbAccountsSource` (accounts with ≥ 1 enabled routine, from the DB). |
| `credentials.ts` | `CredentialProvider` interface + `FixtureCredentialProvider`. The live one is `src/lib/connectors/tokens.ts` `ConnectorCredentialProvider`. |
| `wiring.ts` | Environment → which credentials / accounts source the worker and the API routes get. |
| `log.ts` | JSON-lines logger with unconditional secret redaction (key names and token-shaped values). |
| `providers/connectorReader.ts` | `WorkerConnectorReader` — resolves credentials, dispatches by platform, maps reader answers onto the engine's `ReadResult`. |
| `providers/executor.ts` | `RefusingExecutor`. |
| `providers/llmDecision.ts` | `LlmDecisionProvider` for `rule: { kind: "llm" }` decide nodes (Sonnet, env-gated), strict `{optionId, reasoning}` validation, deterministic fallback on any failure. |
| `readers/{shopify,klaviyo,ga4,meta,googleAds,hubspot}.ts` | `read(query, creds, opts)` per platform: request shaping for real read endpoints + fixture rows. |
| `readers/http.ts`, `readers/types.ts` | Shared fetch-with-timeout, window parsing, `ReaderResult` contract. |
| `../lib/runtime/store/index.ts` | `getStore()` — process-wide `MemoryStore` (TODO Supabase swap). |
| `../app/api/routines/run/route.ts` | `POST {accountId, routineId}` → dry-run now. |
| `../app/api/routines/resume/route.ts` | `POST {runId, decision}` → resume a paused run. |
| `../../deploy/worker/{Dockerfile,fly.toml}` | Fly.io deployment sketch. |

## Running locally

`tsx` is not in `node_modules`, so the worker is built with `tsc` (a separate
`tsconfig.worker.json` emits CommonJS to `dist/worker`; `dist/` is git-ignored):

```bash
npx tsc -p tsconfig.worker.json
node dist/worker/worker/main.js --once --enable D05-W02 --run D05-W02   # smoke test: one manual dry run + one tick
node dist/worker/worker/main.js --interval 60 --enable D01-W01,D05-W02 --health-port 8080   # the daemon
```

(If you install `tsx` later: `npx tsx src/worker/main.ts …` works unchanged.)

Flags (all optional):

| Flag | Default | Meaning |
|---|---|---|
| `--interval <sec>` | 60 | Seconds between ticks (min 5). Tick budget = 80% of it. |
| `--heartbeat <path>` | `.unc-worker/heartbeat.json` | Heartbeat file (atomic write; `stopping: true` on shutdown). |
| `--health-port <n>` | off | Serve `GET /health` for a process check. |
| `--once` | off | Run one tick, exit. |
| `--enable A,B` | — | `setEnabled(true)` those catalog routines for `--account` on start. MemoryStore starts empty, so nothing is scheduled until something is enabled. |
| `--run A,B` | — | Dry-run those routines immediately (manual trigger), printing the receipt trail. |
| `--account <id>` | `demo` | Account the two flags above apply to (and, when given explicitly, the only account the telemetry one-shots below run for). |
| `--measure` | off | Measure every routine's KPI contract against actuals → `routine_outcomes`, then exit. |
| `--self-review` | off | Write Unc's weekly self-review per account → `self_reviews` (idempotent per ISO week), then exit. |
| `--benchmarks` | off | Aggregate opted-in accounts' outcomes into anonymised p50/p75 (n ≥ 5 only) → `benchmarks`, then exit. |

The three flags are manual / catch-up runs. **The daemon runs the same jobs itself** at
their UTC slots (`jobs.ts`; see "How a tick works" and `docs/IMPROVEMENT-LOOP.md`).

Logs are JSON lines on stdout: `worker.start`, `tick.start`/`tick.end`, `run.start`/`run.finish`,
`run.error`, `tick.budget_exhausted`, `tick.stopping`, `read.ok`/`read.failed`,
`decision.llm_ok`/`decision.llm_rejected`/`decision.llm_failed`, `worker.signal`, `worker.stop`.
Fields whose key looks like a secret, or whose value looks like a token, are replaced by
`[redacted]` before serialisation.

### Environment variables

| Var | Required | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | no | The Anthropic SDK, for `LlmDecisionProvider` (Sonnet, `claude-sonnet-5`, `max_tokens` 4000, effort low) and the self-review. Without it every `llm`-rule decide node resolves to its declared fallback with a reasoning line that says so. The worker never reads or logs the value. |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | no | `wiring.ts`: DB accounts source, the `oauth_states` sweep, benchmark segments. Absent → the static `demo` account, no sweep. |
| `CONNECTOR_SECRET_KEY` (+ `_VERSION`, `_PREVIOUS`) | no | With the DB: `ConnectorCredentialProvider` (live tokens from `connector_secrets`). Absent → `FixtureCredentialProvider`. |
| `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | no | The Google Ads credential shape (reads are fixture-only today regardless). |
| `GOOGLE_CLIENT_*`, `KLAVIYO_CLIENT_*`, `HUBSPOT_CLIENT_*` | no | Token refresh for those platforms (`src/lib/connectors/tokens.ts`). |

There are no platform-*token* env vars: readers get credentials only through the injected
`CredentialProvider`; tokens come sealed from the DB or are fixture markers.

## How a tick works

1. `accounts.listAccounts()` (StaticAccountsSource today).
2. For each account, `collectCandidates(store, accountId)`: every catalog routine with a
   `routine_states` row → effective spec (promoted `liveSpec` or catalog default) → trigger
   cadence + newest run.
3. `dueRoutines(now, candidates)`: enabled + cron cadence + a slot inside the look-back
   window (default 15 min) that the newest run has not served (`lastRunStartedAt < slot`).
4. Each due routine → `triggerRun(…, { mode: "dry_run", triggeredBy: "schedule" })` →
   `runRoutine` from the engine, sequentially, until the tick budget is spent (the rest stay
   due for the next tick because their slot is still unserved).
5. Housekeeping, each part isolating its own failures: the telemetry jobs whose UTC slot
   is due and unserved (`jobs.ts` — markers on the heartbeat, reloaded on restart, so a
   redeploy inside the 6 h look-back never double-runs; a failing job waits for its next
   slot), then `sweepOauthStates()` once an hour when a DB is wired.
6. Heartbeat written (`jobs`, `lastSweepAt` included); stats updated.

**Dedup.** The engine's own per-day dedup (`engine.ts` trigger node) applies to *live* runs
only. Dry runs are deduped by the scheduler against the store's newest run for that routine,
so a tick never double-runs a slot and — with a persistent store — neither does a restart.
With `MemoryStore`, a slot inside the look-back window fires once more after a restart
(harmless: it is a dry run).

## API routes

Both go through `service.ts`, i.e. the same adapters and checks as the loop. Both use
`getStore()` from `src/lib/runtime/store/index.ts`.

- `POST /api/routines/run` — body `{ accountId, routineId, vars?, account?: { currency,
  budgetMonthly, approver? }, mode?: "dry_run" }`. `mode: "live"` → **403**
  `live_mode_disabled`. Unknown account (and no `account` fallback) or routine → 404.
  Returns `{ run: { runId, status, summary, receipts[], approval } }`.
- `POST /api/routines/resume` — body `{ runId, decision: "approved" | "held", decidedBy? }`.
  404 when the run/approval is unknown, 409 when the run is not `waiting_approval`.
  Since nothing this app creates ever pauses (dry runs don't), this route answers 404/409
  today; it exists so the approval UI is wired to the right place for Wave 2. Even then
  "approved" on a mutating routine fails closed via `RefusingExecutor`.

**MemoryStore caveat.** `getStore()` returns a process-wide `MemoryStore` (cached on
`globalThis` so Next's per-route module graphs share it). Runs, receipts, approvals and
routine states **do not survive a restart**, and the Next server and the worker daemon are
separate processes with separate memory — a run started by the API is not visible to the
worker and vice-versa until the Supabase swap below.

No auth is implemented in these routes; the app middleware (built separately) is expected
to gate them.

## Readers — "couldn't ask" vs "nothing happened"

Each reader returns `{ ok: true, rows, count, metrics, provenance: { platform, fetchedAt,
source: "live" | "fixture", note? } }` or `{ ok: false, reason }`. The ConnectorReader maps
that onto the engine:

| Reader answer | Engine sees | Meaning on the receipt |
|---|---|---|
| `{ ok: false, reason }` | the read throws → run **failed** with `couldn't ask <platform> <resource>: <reason>` | an incident: bad credentials, HTTP 4xx/5xx, timeout, no reader |
| `{ ok: true, count: 0 }` (live) | `provenance: "empty"` | the platform answered; nothing happened |
| `{ ok: true }` (live) | `provenance: "ok"` | live data |
| fixture credentials | `provenance: "fixture"` | canned rows — never mistakable for a live read |

Request shaping is real (10 s timeout, tokens only in headers, no query-string secrets,
failure reasons carry host + path only):

| Platform | Live endpoint shaped | Notes |
|---|---|---|
| Shopify | `GET https://{shop}/admin/api/2026-01/{orders,products,customers,checkouts,pages}.json` + `X-Shopify-Access-Token` | single page (≤250), `created_at_min` from `window` |
| Klaviyo | `GET /api/flows?filter=equals(name,…)`, `/api/segments`, `/api/campaigns`, `POST /api/metric-aggregates` + `Authorization: Klaviyo-API-Key` + `revision` | `metrics` needs `filter.metricId`; the catalog names a flow instead, so a live metrics read is an honest "couldn't ask" until the connector resolves ids (Wave 2) |
| GA4 | `POST analyticsdata.googleapis.com/v1beta/properties/{id}:runReport` + bearer | `fields` → metrics, `groupBy` → dimensions, `filter` → string-equals AND group |
| Meta | `GET graph.facebook.com/v21.0/act_{id}/{insights,ads,campaigns}` + `Authorization: Bearer` | catalog aliases mapped (`roas`→`purchase_roas`, `purchases`→`actions`, …); `daily_budget` dropped from insights with a provenance note |
| Google Ads | **fixture only** | live reads need a developer token + OAuth refresh token + login-customer-id; a non-fixture credential gets `{ ok: false }` with that reason |
| HubSpot | `POST api.hubapi.com/crm/v3/objects/{contacts,deals}/search` + `Authorization: Bearer`; `deals` also `POST …/emails/search` | catalog names → HubSpot properties (`title`→`jobtitle`, `stage: "open"`→`hs_is_closed=false`, `lastActivityOlderThanDays`→`notes_last_updated LT`, …); Unc-side filters (`scored`, `contacted`, `fitScore`, `winLossCaptured`) dropped + noted; `median_response_hours` = median hours from a thread's first `INCOMING_EMAIL` to the first outgoing `EMAIL` after it (null when no thread was answered — never 0); `contact_email` is association-only and left empty |

Platforms with no reader yet (instagram, tiktok, linkedin, youtube, search_console, gmail,
gorgias, xero, quickbooks, slack, web, llm_search, calendar) answer an empty fixture
result under fixture credentials — so every catalog routine dry-runs end to end — and
"couldn't ask" under anything else.

## LLM decisions

`LlmDecisionProvider` handles `rule: { kind: "llm" }` decide nodes (threshold/first rules are
delegated to `DeterministicDecisionProvider` unchanged). The model is offered the node's
options and a compact context (reads' counts + metrics + 3 sample rows, checks, caps, vars)
under Unc's voice rules, and must answer `{"optionId", "reasoning"}` as strict JSON. The
validator rejects anything that is not an offered option id or lacks reasoning; every failure
(no key, refusal, transport error, malformed JSON, unknown option) resolves to the node's
declared fallback (or the first option) with a reasoning line that says so — never a guess.
Reasoning is whitespace-collapsed and capped at 600 chars before it reaches a receipt or an
approval's `reasoning`. Tests inject a fake `LlmClient`; there are no live calls in tests.

## Tests

`npm test` (vitest). Worker suites under `src/worker/__tests__/`:

| File | Covers |
|---|---|
| `cron.test.ts` | 35 matcher cases + parse errors + `latestSlotBetween` |
| `scheduler.test.ts` | due-selection, look-back, dedup, in-flight guard, all catalog cadences |
| `readers.test.ts` | request shaping per platform with `vi.stubGlobal("fetch")`, timeouts, error mapping, no token leakage, fixtures |
| `hubspot.test.ts` | HubSpot search shaping, the engagements pass + median, fixtures, dispatch, the sealed credential |
| `jobs.test.ts` | `dueJobs` on a fake clock, markers in memory / on the heartbeat / across a restart, a failing job, the hourly `oauth_states` sweep against the schema-checked fake DB |
| `llmDecision.test.ts` | validator, prompt, provider fallbacks (fake client) |
| `providers.test.ts` | credentials, ConnectorReader dispatch/provenance, RefusingExecutor incl. an approved live run failing closed, log redaction |
| `loop.test.ts` | full tick on MemoryStore (receipts, dedup across ticks/days), tick budget, error isolation, heartbeat file, start/stop, manual trigger, resume via the service (held / approved-but-refused) |
| `api-routes.test.ts` | both route handlers end to end against `setStoreForTests` |

## Deploying (Fly.io sketch)

`deploy/worker/Dockerfile` builds with `tsc -p tsconfig.worker.json` and runs
`node dist/worker/worker/main.js --health-port 8080`. **Relative imports only** in every
file the worker pulls in (`src/lib/connectors`, `src/lib/db`, `src/lib/runtime`, …): the
standalone build has no `@/` path-alias resolver, so an alias import compiles fine and then
crashes the daemon at boot with `Cannot find module '@/…'`. The Dockerfile fails the image on
any `require("@/` left in `dist/worker`; locally, `node dist/worker/worker/main.js --once` is
the same check. The telemetry cron is in-loop (`jobs.ts`) — no scheduled machines. `deploy/worker/fly.toml` keeps exactly
one machine running (never scale to two on MemoryStore — the dedup is per store) with an
HTTP check on `/health`, which reads the heartbeat file and returns 503 when the loop has
not ticked for 3 intervals or is shutting down. `kill_signal = "SIGTERM"` lets the loop finish
its in-flight tick and write a final heartbeat.

```bash
fly launch --no-deploy --copy-config --name unc-worker
fly secrets set ANTHROPIC_API_KEY=…                      # optional
fly deploy --config deploy/worker/fly.toml --dockerfile deploy/worker/Dockerfile
```

Not deployed yet; deploying is a founder-gated step like any other outward action.

## The SupabaseStore swap

`src/lib/runtime/store/supabase.ts` (built separately, same `Store` interface, maps onto
`supabase/migrations/0001_init.sql` + `0002_runtime_columns.sql`) is not imported anywhere in
the worker yet. To swap:

1. In `src/lib/runtime/store/index.ts`, construct the SupabaseStore instead of `MemoryStore`
   in `getStore()` (the TODO marks the line). Nothing else in the worker or the routes changes.
2. In `src/worker/main.ts`, replace `StaticAccountsSource` with an `AccountsSource` that reads
   `accounts` + `resource_profiles` (currency, `budget_monthly`, approver) through the same
   client. The interface is two methods.
3. `tsconfig.worker.json` currently excludes `supabase.ts` from the standalone build; remove
   that exclusion (`@supabase/*` is already a dependency).
4. The scheduler's dedup then survives restarts and the API and the daemon see the same
   runs — `POST /api/routines/run` results appear in the worker's candidate list and
   vice-versa.

## Wave 2 (founder-gated)

What real executors and live mode would need — none of it is built, and nothing here should
be flipped without Tom's explicit decision:

1. **`LIVE_MODE_ENABLED = true`** in `service.ts` (a one-line change, deliberately a constant
   so it shows up in review, not an env var that could be set by accident).
2. **Real executors** per platform behind the engine's three hard rules (approved unexpired
   gate on this run, live mode, spend caps): Meta `update_adset_budget` / `pause_ad` /
   `swap_ad_creative` / `create_test_adset` / `create_ad_from_post` / `reduce_daily_budgets`;
   Klaviyo `update_flow_message` / `add_flow_message` / `update_flow_delay` /
   `update_segment_definitions`; Shopify `update_page_seo`; HubSpot `update_deal_properties` /
   `update_deal_stage`. Each needs idempotency (`idempotencyKey` is already on the node), a
   read-back for the receipt, and a rollback path (`rollback` is already described per node).
3. ~~A real `CredentialProvider`~~ — built (`ConnectorCredentialProvider`, sealed tokens,
   refresh for Google / Klaviyo / HubSpot, Meta reauth). What remains here is the Google Ads
   **reader** (GAQL `searchStream`; the developer token + customer id are already wired).
4. **Approval UI → `/api/routines/resume`** with auth (middleware) and `decidedBy` set from
   the session user, plus expiry handling (the engine already expires stale approvals).
5. **Live-mode dedup + concurrency**: the engine's per-day dedup covers live runs; the
   worker should additionally take a per-account lease when more than one machine runs.
6. **Event triggers** (`event:<platform>:<event>`): webhook receivers that call `triggerRun`
   with `triggeredBy: "event"` — the scheduler deliberately never fires these.
7. **Remaining readers** (search_console, instagram, gorgias, gmail, calendar, …) and
   Klaviyo metric-id resolution, so live reads stop being "couldn't ask". HubSpot is done.
8. **SupabaseStore swap** above, so anything live is durable and auditable before it is live.
