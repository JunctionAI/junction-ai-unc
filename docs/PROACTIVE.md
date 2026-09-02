# Unc — the proactive layer (daily brief, KPI snapshots, taste-shaped decisions)

Three additions make Unc come to the founder instead of waiting to be asked. Each is env-gated
like the rest of the product: with no database configured the app is in demo mode and none of
this runs or renders (Home is byte-identical to the prototype — `TodayBrief` returns `null`
before any hook does work); with the database + service role, the jobs write to the
migration-0010 tables and Home reads them.

| # | What | Writes | Runs | Founder sees |
|---|---|---|---|---|
| 1 | **KPI snapshots** — a fixed metric set per account, read through the same certified `ConnectorReader` the routines use | `kpi_snapshots` (+ a `receipts` notification per "couldn't ask") | worker job `kpi_snapshot`, daily 01:30 UTC (`--kpi-snapshot` by hand) | the "noticed" line in the brief; later, cards |
| 2 | **Taste patterns** — what this founder approves / holds, how fast, at what spend | `account_profiles.decision_style` (jsonb merge of that one key) | inside every routine decision (read), refreshed daily before the brief (write) | proposals sized to their comfort; the approval's *Why?* says so |
| 3 | **The daily brief** — "Morning. Here's today:" | `daily_briefs` (one row per account + local day) | 06:30 in the account's timezone (`--daily-brief` by hand; `POST /api/unc/brief` from Home) | the bubble at the top of Home |

## Module map

| Path | What it is |
|---|---|
| `src/lib/brain/kpi.ts` | `KPI_METRICS` (the fixed set), `metricsForPlatforms`, `snapshotKpis` (reads → upsert), `computeDeltas` / `kpiDeltas` (week-over-week, `NOTABLE_DELTA_PCT = 15`), `describeDelta`. |
| `src/lib/brain/taste.ts` | `tastePatterns` (approvals + taste_events + draft receipts → rates by category / spend bucket, hold reasons, median latency), `suggestedSpendCeiling`, `applySpendCeiling` (never expands), `renderTasteForDecision` (2–4 lines), `readAccountProfile`, `deriveDecisionStyle` + `writeDecisionStyle`, `renderProfileForDecision`. |
| `src/lib/brain/brief.ts` | `gatherBriefEvidence`, `BRIEF_SYSTEM` + `buildBriefUserMessage`, `parseBrief` (the validator), `deterministicBrief`, `generateDailyBrief` / `getDailyBrief`, timezone helpers (`localDay`, `briefSlotUtc`, `readTimezone`). |
| `src/worker/jobs.ts` | `kpi_snapshot` on the UTC job list; `dueBriefs` + `BriefMarkers` for the account-local brief. |
| `src/worker/telemetry.ts` | `runKpiSnapshot`, `runDailyBrief` (refreshes `decision_style` first), `refreshDecisionStyle`. |
| `src/worker/loop.ts` | runs the UTC jobs and `runDueBriefs` each tick; `briefs` markers on the heartbeat; `TickReport.briefs`. |
| `src/worker/providers/llmDecision.ts` | `Personalisation` / `PersonalisationSource` / `StorePersonalisation`; the FOUNDER block in the DECIDE prompt; the spend ceiling applied after every decision (llm *and* deterministic). |
| `src/worker/service.ts` | `ServiceDeps.db` (optional) so the decider can read `account_profiles`; `buildAdapters` wires `StorePersonalisation`. |
| `src/app/api/unc/brief/route.ts` | `GET` today's brief · `POST` generate (idempotent per local day; `{ force: true }` rewrites). |
| `src/components/platform/TodayBrief.tsx` | the bubble (`TodayBriefCard` is the pure card), the ghost pill, `approvalAnchorId`. |
| `src/components/platform/HomeView.tsx` | mounts `TodayBrief` above "MY REVIEW" in accounts mode only; wraps each live approval card in `id="approval-<id>"` so a *needs you* line can jump to it. |

## Schedules

The daemon ticks once a minute (`src/worker/loop.ts`). After the routines:

| Job | When | Marker | Idempotency |
|---|---|---|---|
| `kpi_snapshot` | `30 1 * * *` UTC (before `measure` at 02:00) | `heartbeat.jobs.kpi_snapshot` (slot served) | upsert on `(account_id, metric_key, window_end)`; `window_end` = the UTC day, so a re-run rewrites the same rows |
| daily brief | **06:30 in `account_profiles.cadence.timezone`**, else 06:30 UTC; a missed slot is still served up to 6 h later (the job look-back) | `heartbeat.briefs[accountId]` = the local day served (ok or failed) | `daily_briefs` is unique per `(account_id, day)`; an existing row is returned untouched — a fresh machine with no heartbeat re-runs the job and writes nothing |

- Both markers ride on the heartbeat file and are reloaded on start, so a restart or redeploy
  inside the look-back does not double-run.
- A failing brief is logged (`job.error`), marked served for that local day, and tried again
  tomorrow — not every minute. Same for the snapshot at its next slot.
- The accounts the loop briefs are the accounts source's (`DbAccountsSource`: accounts with ≥ 1
  enabled routine). The snapshot job targets every account with a `connected` connector.
- Demo mode (no DB): both are logged skips; nothing is written, nothing renders.

One-shots (run across every account, or one with `--account <id>`):

```
node dist/worker/worker/main.js --kpi-snapshot
node dist/worker/worker/main.js --daily-brief
node dist/worker/worker/main.js --daily-brief --account <accountId>
```

## What is LLM and what is deterministic

| | Deterministic | Model |
|---|---|---|
| KPI snapshot | everything — reads, metric maths, provenance, deltas, the 15 % threshold | nothing (`kpi_insight` is reserved as a fast-tier task for a later card; unused) |
| Taste patterns | everything — rates, buckets, ceiling, hold-reason buckets | nothing |
| Routine decisions | threshold / first rules; the spend ceiling; the "kept under your usual …" line | `routine_decision` (fast tier): picks an option and writes its reasoning, with the FOUNDER block in view |
| Daily brief | the evidence, the validator, the fallback copy | `daily_brief` (balanced tier, `LLM_MODEL_DAILY_BRIEF` to override; max_tokens 4000, effort low): the body + items, kept only where they validate |

Model tasks resolve through `src/lib/llm/router.ts` like every other call site. `daily_brief`
and `kpi_insight` are *internal* tasks — not on `LLM_TASKS`, so they do not appear in the
founder's Models settings and there is no `account_model_prefs` row for them (the table's
check constraint lists the five settable tasks; extending it is a migration for another day).

## Evidence rules

- **Numbers only from the evidence.** The brief's body and every item are checked with the
  same numbers-only guard the plan narrative and the self-review use (`allowedNumbers` /
  `numbersOk`, copied into `brief.ts`): every number literal must exist in the gathered
  evidence (or be a small count 1–12; calendar pieces of evidence dates are allowed).
  Yesterday's brief is shown to the model *only* to avoid repetition — its numbers are not
  evidence for today. A field that smuggles in a number falls back to the deterministic copy.
- **Refs must exist.** `needs_you` only for a pending, unexpired approval (its id); `reminder`
  only for a memory of kind `event` in the next 7 days (its id, and the item carries `at`);
  `noticed` only for a metric whose delta is notable; `happened` may cite a receipt id or nothing.
- **Exactly one "noticed"** when any delta is ≥ 15 % week-over-week (the deterministic line is
  inserted if the model forgot; extras are dropped); **none** when nothing is notable — the
  model cannot "notice" a number that is not there.
- **At most 5 items**, `needs_you` and `noticed` first when trimming.
- **"Couldn't ask" is never zero.** A metric the platform could not answer writes no
  `kpi_snapshots` row and one `receipts` notification (`run_id` null, payload
  `{ source: "kpi_snapshot", metricKey, reason }`). Fixture reads are stored with provenance
  `fixture` and are never compared against live rows.
- **The ceiling only shrinks.** `suggestedSpendCeiling` is the largest per-day spend the founder
  approved, and only once they have held ≥ 2 proposals above it; `applySpendCeiling` lowers a
  proposal to it (month amounts ÷ 30) and appends *"Kept under your usual NZ$40/day (you have
  held the larger shifts)."* to the reasoning — which is what the approval's *Why?* shows.
  It never raises a proposal, never touches one without spend or in another currency.
- **`decision_style` is a merge.** `writeDecisionStyle` upserts only `account_profiles.decision_style`
  (+ `updated_at`), merging the derived keys over whatever is already in that jsonb; `tone`,
  `cadence`, `channels`, `founder_notes` belong to other writers and are never sent.
- **Nothing outward.** The brief proposes and reports; it never claims anything sent,
  published or spent — a dry-run receipt is described as a draft.

## The metric set

| Key | Platform · read | Value | Window |
|---|---|---|---|
| `revenue_28d` | shopify · orders 28d | `metrics.revenue` (account currency) | 28 d |
| `revenue_7d` | shopify · orders 7d | `metrics.revenue` | 7 d |
| `orders_7d` | shopify · orders 7d | row count | 7 d |
| `aov_28d` | shopify · orders 28d | `metrics.aov` | 28 d |
| `sessions_7d` | ga4 · report 7d (`fields: [sessions]`) | `metrics.sessions` | 7 d |
| `roas_7d` | meta_ads · insights 7d | `metrics.roas` | 7 d |
| `email_revenue_28d` | klaviyo · campaigns 28d | `metrics.revenue` (the `metrics` resource needs a metric id — Wave 2) | 28 d |
| `repeat_rate_90d` | shopify · customers 90d | `repeat_count / count × 100` | 90 d |

Only the metrics whose platform is `connected` are asked; one certified read per
(platform, resource, window) is shared by the metrics that need it. Google Ads has no live
reader yet (fixture only), so no metric depends on it.

## Tests

`npm test`: `src/lib/brain/__tests__/{kpi,taste,brief,briefRoute}.test.ts`,
`src/worker/__tests__/proactive.test.ts` (+ the extended `jobs.test.ts` and
`llmDecision.test.ts`), `src/components/platform/__tests__/todayBrief.test.ts`.
