# Unc — the improvement loop (Phase 7: "improves over time")

Five loops make Unc better every week. Each is env-gated like the rest of the product: with no
database configured the app is in demo mode and none of this runs or renders (Home is
byte-identical to the prototype); with the database + service role, the loops write to the
migration-0006 tables and Home reads them.

| # | Loop | What it does | Automated | Founder sees |
|---|---|---|---|---|
| 1 | **Taste learning** | Every Approve / Hold / Why? / edit writes a `taste_events` row (engine `resumeRun`). | yes, on every decision | the "Why?" bubble; patterns feed loop 4 |
| 2 | **Certified reads** | Every routine run receipts what it read, with provenance (`ok` / `empty` / `fixture` / couldn't-ask). | yes, every run | receipts on Home |
| 3 | **Outcome telemetry** | Every routine has a **KPI contract** (`KPI_CONTRACTS`, `src/lib/runtime/catalog-specs.ts`). `--measure` compares the contract to the actual — a certified platform read through the same `ConnectorReader` the routines use, or the routine's own ledger for draft-only routines — and writes `routine_outcomes`. `scoreRoutine()` gives hit / miss / trend. | daily, worker `--measure` | KPI card + the self-review; "The bar" own values |
| 4 | **Unc's weekly self-review** | `--self-review` gathers the last 7 days (runs, drafts, approved/held by routine, outcomes vs contract, taste patterns) and writes "what worked / what I'm changing / one ask" to `self_reviews` — one row per account + ISO week (Monday UTC). Sonnet (`claude-sonnet-5`, `max_tokens` 4000, effort low) writes it when `ANTHROPIC_API_KEY` is set; every field is validated against the evidence (numbers must exist in the evidence; `changes` may only enable / disable / reprioritise a catalog routine or adjust a cadence to `manual` / 5-field cron; exactly one ask). A field that fails falls back to the deterministic copy, which is what runs without a key. | weekly, worker `--self-review` (or POST `/api/unc/self-review`) | the **"MY REVIEW"** bubble on Home, with the proposed changes as chips that open the routine |
| 5 | **The benchmark moat** | `--benchmarks` aggregates opted-in accounts' latest measured outcomes per KPI key into p50 / p75 per segment (`all`, `shopify`, `revenue_band:<band>`) and writes `benchmarks`. **A row is published only when n ≥ 5 accounts contributed** — below that it is suppressed entirely (not rounded), so no aggregate can be reversed to a business. Enforced in `computeBenchmarks`, in both stores' `putBenchmarks`, and by a `check (n >= 5)` on the table. | weekly, worker `--benchmarks` | **"The bar"** on Home |

## What "The bar" shows, honestly

Three cards: Content output (`content_drafts_per_week`), Repeat purchase (`repeat_purchase_pct`),
Response speed (`lead_response_hours`). In DB mode (`src/lib/platform/telemetry.ts`):

- a **published Junction benchmark** (n ≥ 5, most specific segment first, falling back to `all`)
  → the bar is the top quartile (p75), the proof cites *n* and the median, and the status compares
  the account's **own latest measured value**;
- **no benchmark yet** → the industry reference number the demo uses, labelled
  *"Industry reference — not yet from Junction accounts."* The demo's "you're at 3" is never
  shown: the own value appears only when it was measured, otherwise the card says
  **"Not measured yet"** and offers no fix button.

Demo mode keeps the prototype's cards verbatim.

## Hours saved (automation strip)

DB mode: Σ over enabled routines of `hoursSavedPerRun × completed runs in the last 7 days`.
The constants (`HOURS_SAVED_PER_RUN`, catalog-specs.ts) are conservative — the time a founder
would spend doing the same read + draft by hand, per category (Content 0.75 h, Paid ads 0.25 h,
SEO 0.5 h, Sales 0.5 h, Email & SMS 0.75 h) with heavier drafting routines overridden (e.g.
Founder content engine 1.5 h, Campaign calendar prep 2 h). Demo mode keeps `2.5 h × routines on`.

## Worker flags + suggested schedule

The flags are one-shots: run across every account the accounts source lists (DB: accounts with
≥ 1 enabled routine; demo: `demo`), or a single account with `--account <id>`, then exit.

| Flag | Suggested cron (UTC) | Notes |
|---|---|---|
| `--measure` | daily `0 2 * * *` (02:00 UTC) | Windows end at the start of the measuring day, so re-running the same day rewrites the same rows. |
| `--self-review` | weekly `0 6 * * 1` (Mondays 06:00) | Idempotent per ISO week: accounts that already have this week's review are skipped. Account-local scheduling (Monday 06:00 in the founder's timezone) is a follow-up — today the worker runs UTC. |
| `--benchmarks` | weekly `0 3 * * 1` (after Monday's measure) | Look-back 35 days (covers the 28-day contracts). Segments resolved from `connectors` + the governing revenue goal. |

```
node dist/worker/worker/main.js --measure
node dist/worker/worker/main.js --self-review
node dist/worker/worker/main.js --benchmarks
node dist/worker/worker/main.js --measure --account <accountId>
```

Local: `npx tsc -p tsconfig.worker.json && node dist/worker/worker/main.js --measure --self-review --benchmarks`.
On Fly (`deploy/worker/`), add these as scheduled machines / a cron sidecar alongside the daemon.

## Anonymisation rule (n ≥ 5)

- An aggregate (metric × segment) is written only when **five or more distinct opted-in
  accounts** contributed a measured value. Four accounts → no row at all.
- One value per account per metric (its latest measured window), so no account can dominate.
- Unmeasured outcomes (couldn't ask, fixture data) never contribute.
- Opt-out: `benchmark_optins.opted_in = false` (default true; the founder's row, RLS member_all).
- The `benchmarks` table carries no account ids; it is readable by any signed-in user, written
  only by the service role.

## Tables (migration `0006_telemetry.sql`)

`routine_outcomes` (member read, service-role write, unique per account/routine/kpi/window_end) ·
`self_reviews` (member read, service-role write, unique per account/week_start) ·
`benchmarks` (authenticated read, service-role write, PK metric_key/segment, `n >= 5`) ·
`benchmark_optins` (member read/write).

## Module map

| | |
|---|---|
| KPI contracts + hours constants | `src/lib/runtime/catalog-specs.ts` (`KPI_CONTRACTS`, `HOURS_SAVED_PER_RUN`), types in `src/lib/runtime/types.ts` (`KpiContract`) |
| Measurement | `src/lib/telemetry/outcomes.ts` — `measureOutcomes`, `scoreRoutine` |
| Self-review | `src/lib/telemetry/selfReview.ts` — evidence, prompt, validator, deterministic fallback, `generateSelfReview` |
| Benchmarks | `src/lib/telemetry/benchmarks.ts` — `computeBenchmarks`, `benchmarkFor`, `barInputs`; segments in `segments.ts` |
| Home payload | `src/lib/telemetry/home.ts` → `GET /api/telemetry/home`; review routes `GET/POST /api/unc/self-review` |
| Home mapping (client, pure) | `src/lib/platform/telemetry.ts`; hook `src/components/platform/useHomeTelemetry.ts`; render in `HomeView.tsx` |
| Store | `src/lib/runtime/store/{interface,memory,supabase}.ts` (outcomes, reviews, benchmarks, opt-ins, taste-event listing) |
| Worker | `src/worker/telemetry.ts` (jobs), `src/worker/cli.ts` (flags), `src/worker/main.ts` |
