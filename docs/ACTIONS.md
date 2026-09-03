# The typed action library

`src/lib/actions` is the only way a routine touches a platform. Every mutation Unc can propose is an
**Action**: data (id, platform, title, risk, a typed params descriptor) plus four small functions —
`guards`, `dryRun`, `execute`, `rollback`. Today the set is Meta (Graph API v23.0).

**Hard rule, unchanged:** `LIVE_MODE_ENABLED` is `false` in `src/worker/service.ts`. Nothing in this
tree performs a real mutation. Every action has a dry run that produces the *exact* request it would
send, with the bearer token redacted, and that request is what lands on the draft receipt and the
approval preview. Live execution additionally needs the action's risk class enabled
(`UNC_LIVE_ACTION_RISKS`), and `meta.campaign.create_from_brief` refuses to execute at all until wave 2.

## Module map

| File | What it holds |
|---|---|
| `src/lib/actions/types.ts` | The contract: `Action<P,R>`, `ActionContext`, `Violation`, `ShapedRequest`, `DryRunResult`, `ExecuteResult`, `ActionError`, `RateLimitState`, `RollbackPlan`, `ActionRisk` |
| `src/lib/actions/registry.ts` | `ACTIONS` (id → action), `getAction`, `isActionId`, `risksOf`, `pickDeclaredParams`, `idempotencyKey(runId, actionId, params)`, `describeActionsForPrompt(ids?)` |
| `src/lib/actions/presets.ts` | `MetaPreset` (the numbers the rules run on), `DEFAULT_META_PRESET`, `INDUSTRY_META_PRESETS`, `PresetSource` (what `src/lib/runtime/presets/store.ts presetSource(db)` implements), `withPresetDefaults`, `resolveMetaPreset` |
| `src/lib/actions/meta/graph.ts` | Graph plumbing: request shaping (GET query / POST form-encoded), token redaction, minor units, `mapMetaError` (Meta codes → honest reasons), `parseRateLimit` (usage headers → back-off), `send` (the only place the token is used) |
| `src/lib/actions/meta/insights.ts` | Insights rows → `PerformanceRow` (spend, purchases, CPA, ROAS, frequency, daily budget) + `summarise` |
| `src/lib/actions/meta/actions.ts` | The Meta action set (below) |
| `src/lib/actions/rules/meta.ts` | Hold / scale / turn-off as data: `META_ADSET_RULES`, `evaluateAdset`, `evaluateAdsets`, `cpaCaps`, `adsetMetricsFromRow` |
| `src/lib/actions/rules/decision.ts` | `RulesDecisionProvider` — the deterministic DECIDE for rule-bound routines (`RULE_BINDINGS`); the LLM only writes the reasoning line |
| `src/worker/providers/executor.ts` | `ActionExecutor` (dry-run shaping, live gating, guards, idempotency, back-off) + `RefusingExecutor` (zero-capability fallback) |
| `src/worker/readers/meta.ts` | additive: the `adsets` resource (daily budgets) + `largest_*` metrics |
| `src/lib/runtime/engine.ts` | additive: `Executor.dryRun` hook at execute nodes in dry_run; `mutation.action` may be a template (`{{decision.params.actionId}}`) |
| `src/lib/runtime/catalog-specs.ts` | D02-W01/02/03/04/07/08 execute nodes reference action ids + params templates |

## The contract

```ts
interface Action<P, R> {
  id: "meta.adset.set_daily_budget";      // platform.noun.verb
  platform: "meta_ads";
  title; description;
  risk: "read" | "reversible" | "spend" | "publish" | "destructive";
  secondaryRisks?: ActionRisk[];           // create_from_brief = publish + spend
  params: ParamsSchema;                    // JSON-schema-like, typed; the prompt + inspector read it
  guards(params, ctx): Violation[];        // pure — every reason it must not run
  dryRun(params, ctx): DryRunResult;       // pure — the EXACT request(s), token redacted, + one human line + spend
  execute(params, ctx): Promise<ExecuteResult<R>>;   // sends; only the executor calls it
  rollback?(params, result): RollbackPlan | null;    // the inverse, as another action invocation
}
```

`ActionContext` is what the executor injects: account id, run id, mode, currency, the account's caps,
the resolved `MetaPreset`, the taste ceiling (`suggestedSpendCeiling` from the approvals ledger), the
credential (or `null`), `now`, and `fetch` for execute. Nothing in `src/lib/actions` reads the
database, the worker or the network on its own.

**Idempotency.** `idempotencyKey(runId, actionId, params)` = `runId:actionId:<stable hash of the
params>`. The executor's ledger (`MemoryIdempotencyLedger`; a durable table is the wave-2 follow-up)
refuses a repeat with `duplicate — …`. The key is also on every dry-run receipt so the approval and
the mutation can be matched.

**Redaction.** `ShapedRequest.headers.Authorization` is always `Bearer ••••`. The token is added to a
copy of the headers inside `graph.send()` and nowhere else; it never appears in a URL, a body, a
receipt or a log. Ids in previews are tails (`…000002`).

## The Meta set

| Action | Risk | Request | Guards | Rollback |
|---|---|---|---|---|
| `meta.campaign.read_performance` | read | `GET act_{id}/insights?level=&fields=spend,impressions,clicks,ctr,frequency,purchase_roas,actions,action_values,…&date_preset=\|time_range=` (+ `GET act_{id}/adsets` or `/campaigns` for daily budgets) | level / preset / date shape | — |
| `meta.adset.pause` / `meta.adset.resume` | reversible | `POST /{adset_id}` `status=PAUSED\|ACTIVE` | Meta object id | the other one |
| `meta.adset.set_daily_budget` | spend | `POST /{adset_id}` `daily_budget=<minor units>` | id; `dailyBudget` **or** `changePct` with `currentDailyBudget`; ≤ caps per day and per month; change ≤ preset `maxBudgetChangePct`; increase ≤ taste ceiling | restore the previous budget |
| `meta.ad.pause` / `meta.ad.resume` | reversible | `POST /{ad_id}` `status=` | Meta object id | the other one |
| `meta.ad.rotate` | reversible | `POST /{next_ad}` `status=ACTIVE`, then `POST /{tired_ad}` `status=PAUSED` | two distinct ids | swap back |
| `meta.campaign.create_from_brief` | publish + spend | `POST act_{id}/campaigns` → `POST act_{id}/adsets` (billing_event, optimization_goal, bid_strategy, targeting, promoted_object) → `POST act_{id}/ads` per creative — **all `status=PAUSED`** | name, objective, budget ≤ caps/ceiling, ISO-2 countries, age band, ≥ 1 creative ref, pixel for sales/leads (or an explicit optimisation goal) | none (created paused; deletion is a founder action). **Dry-run only until wave 2** — `execute` answers `not_available` |
| `meta.creative.upload_image_from_url` | publish | `POST act_{id}/adimages` `url=` | https URL | — |

Money travels as minor units (`7200` = NZD 72.00) except for the currencies Meta bills in whole units
(`ZERO_DECIMAL_CURRENCIES` in `graph.ts`). Creative refs: `{creativeId}` · `{instagramMediaId}` (an
Instagram post boosted as an ad) · `{imageHash, primaryText, headline, linkUrl, pageId}`; reader rows
with `creative_id` are accepted too.

### Errors → honest reasons

`mapMetaError` reads Meta's `{error:{code, error_subcode, message, is_transient, fbtrace_id}}`:

| Meta | class | receipt line | retry |
|---|---|---|---|
| 190, 102 (+ subcodes 458/460/463/467) | `token_expired` | "the Meta token is expired or invalid — reconnect Meta" | no |
| 10, 200, 294 | `permission` | "the Meta token lacks permission for this action (ads_management)" | no |
| 4, 17, 32, 613, 80000, 80004; HTTP 429/503 | `rate_limited` | "… request limit reached — backing off" | yes, after the back-off |
| 1, 2, `is_transient` | `transient` | "Meta reported a temporary service problem — safe to retry later" | yes |
| 100 (+ 1487126, 1487390, 1885154, 2446079) | `invalid_param` | Meta's own detail ("the daily budget is below Meta's minimum …") | no |
| 368 | `policy` | "this ad account is temporarily blocked by Meta policy" | no |
| anything else | `unknown` | `Meta error <code>: <message>` | no |

### Rate limits

`parseRateLimit` reads `X-Business-Use-Case-Usage` (per business: call_count / total_cputime /
total_time %, `estimated_time_to_regain_access` minutes), `X-Ad-Account-Usage` (`acc_id_util_pct`,
`reset_time_duration`) and `X-App-Usage`. ≥ 90 % or a regain time → `throttled`, back-off = max(60 s,
regain minutes); ≥ 75 % → a 15 s slow-down. The executor keeps `backoffUntil` and refuses mutations
until it passes; a `rate_limited` error does the same.

## Decision rules as data (`rules/meta.ts`)

`evaluateAdset(metrics, preset)` walks `META_ADSET_RULES` in order; the first rule whose `when` holds
gives the verdict, a stable `ruleId`, a `reasonCode`, a reason line with the numbers, a `nextAction`
and the proposed action (`meta.adset.pause` for turn-off, `meta.adset.set_daily_budget` for scale).
Deterministic — the LLM never picks a verdict.

Verdicts: `not_enough_data` · `turn_off` · `hold` · `scale` · `keep`.

| Order | Rule | Verdict | Reason code | Next action |
|---|---|---|---|---|
| 1 | spend < `minSpendBeforeJudging` | not_enough_data | `insufficient_or_initial_evidence` | GATHER_EVIDENCE |
| 2 | `ageHours` < `minAgeHours` (48) | not_enough_data | `insufficient_or_initial_evidence` | GATHER_EVIDENCE |
| 3 | price policy on, `productPrice: null` | hold | `pending_product_price` | RESOLVE_PRODUCT_PRICE_MAPPING |
| 4 | would be OFF but `measurementClean === false` | hold | `soft_off_blocked_unclean_measurement` | REPAIR_MEASUREMENT |
| 5 | 0 purchases and spend ≥ off line | turn_off | `no_results_over_cap` | — |
| 6 | CPA > off line | turn_off | `cpa_over_cap` | — |
| 7 | ROAS < floor **and** CPA > scale line | turn_off | `roas_under_floor` | — |
| 8 | frequency ≥ `fatigueFrequency` | hold | `fatigue_frequency` | REFRESH_CREATIVE |
| 9 | CTR drop ≥ `fatigueCtrDrop` % | hold | `fatigue_ctr` | REFRESH_CREATIVE |
| 10 | changed < `holdDays` ago | hold | `learning_hold` | GATHER_EVIDENCE |
| 11 | ROAS < floor (CPA fine) | hold | `roas_under_floor` | GATHER_EVIDENCE |
| 12 | CPA ≤ scale line but streak < `scaleStreakDays` (3) | hold | `pending_3d_scale_streak` | GATHER_EVIDENCE |
| 13 | CPA ≤ scale line, budget not read | hold | `budget_not_read` | READ_BUDGET |
| 14 | CPA ≤ scale line (+ budget) | **scale** +`scaleStepPct` (≤ `maxBudgetChangePct`) | `at_or_below_cap` | — |
| 15 | otherwise | keep | `in_band` | — |

`evaluateAdsets(all, preset, { accountDailyBudgetCap })` evaluates every ad set, turns a scale that
would take the account's total daily budget over the cap into a hold (`account_daily_budget_ceiling`,
REVIEW_BUDGET_CEILING — the account's `caps.perDay` in the routine), and picks the one to act on:
turn-offs first (protect money), then the scale, ties to the larger spend.

**The CPA cap.** Two sources, the same rules. From the preset: `targetCpa` is the scale line, `maxCpa`
the off line. From the certified product price (the n8n oracle policy `cpa_cap_off_hold_scale_v1`):
when an ad set carries `productPrice`, cap = price × `cpaCapFromProductPricePct` / 100 (50 %) and both
lines sit on it. `productPrice: null` = the policy applies but the price is unmapped → hold;
`undefined` = the policy is not in use for that ad set. The reason-code vocabulary is shared with the
n8n policy so both can be compared on the same data.

`MetaPreset` fields: `targetCpa`, `maxCpa`, `roasFloor`, `minSpendBeforeJudging`, `fatigueFrequency`,
`fatigueCtrDrop`, `scaleStepPct`, `maxBudgetChangePct`, `holdDays`, `cpaCapFromProductPricePct`,
`minAgeHours`, `scaleStreakDays`, `industry`. Industry presets: dtc_general, dtc_fashion,
dtc_supplements, dtc_premium, lead_gen_services, b2b_saas — conservative starting points a founder
edits in the inspector, never a claim about an account. The store (`src/lib/runtime/presets/store.ts`)
implements `PresetSource.getPreset(accountId, "meta", routineId?)`; `resolveMetaPreset` fills gaps
from the industry default and repairs incoherence (max ≥ target, step ≤ bound).

### Where the rules run: D02-W01 Daily paid decisioning

`RULE_BINDINGS` binds D02-W01's decide node to the ruleset: rows from `reads.spend` (adset-level
insights) + budgets from `reads.adsets`. `RulesDecisionProvider` (wired in `service.ts` around the
`LlmDecisionProvider`) evaluates every ad set, maps the pick to an option (`scale` / `turn_off`, else
the terminal `hold`) and returns a `Decision` whose `params` carry `actionId` + the action's params
plus the full evaluation table (`table`, `counts`, `reasonCode`, `nextAction`). The execute node reads
`{{decision.params.actionId}}`, `{{decision.params.adsetId}}`, `{{decision.params.dailyBudget}}` …

The LLM's only job is the reasoning line: it gets the verdict, the rule line and the evidence and
writes 1–2 sentences; the line is accepted only when every number in it appears in the evidence
(`numbersAreGrounded`), else the deterministic line stands. Without an LLM the deterministic line is
the reasoning. The binding applies only to decide nodes whose options declare typed actions — a
hand-built spec with the same routine id keeps its own rule; the catalog's threshold rule (ROAS ≥ 2.5
→ one +20 % step) is the honest fallback in demo mode.

## The executor and the enablement map

`ActionExecutor` (`src/worker/providers/executor.ts`) answers the engine in three ways:

* **dry run** — the engine calls `executor.dryRun(node, mutation, ctx)` at every execute node in
  `dry_run`. The receipt line becomes `Would <preview>` (e.g. `Would Set ad set …000001 daily budget
  NZD 60.00 → NZD 72.00 (+20%)`) and the payload carries `action: { actionId, risk, params, request,
  followUps, spend, before, after, violations, idempotencyKey, rollback, enabled, connected }`. Guard
  violations append `— but guards would block it: …` (the caps message stays alongside). Nothing is
  sent.
* **live** — reached only past the engine's three hard rules (approved unexpired gate on this run,
  mode live, spend caps). Then in order: registered action (else `NOT_IMPLEMENTED_REASON`) →
  `LIVE_MODE_ENABLED` (else `live_disabled — …`) → every risk the action carries enabled (else
  `risk_disabled — <id> carries 'spend' and that risk is not enabled (UNC_LIVE_ACTION_RISKS)`) → guards
  (`guard_violation — …`) → idempotency (`duplicate — …`) → back-off (`rate_limited — backing off Meta
  until …`) → `action.execute()`. The mutation receipt's readback carries the redacted requests sent,
  the platform reply, the rollback plan and the idempotency key.
* **unknown verb** — a mutation naming no action fails closed with `NOT_IMPLEMENTED_REASON`.

`ENABLED_ACTION_RISKS` comes from `UNC_LIVE_ACTION_RISKS` (comma-separated risk classes; default
empty). The intended order once `LIVE_MODE_ENABLED` flips: `read` → `reversible` (pause/resume/rotate)
→ `spend` (budgets) → `publish` (image uploads; campaign creation also needs wave 2). Both switches
are needed: the constant in code and the env var per risk.

## How to add an action

1. Write it in `src/lib/actions/<platform>/actions.ts`: `id`, `risk` (+ `secondaryRisks`), `params`
   descriptor, pure `guards`, pure `dryRun` returning the literal request(s) through `shapeGet` /
   `shapePost` (headers already redacted), `execute` that goes through `graph.send` and maps errors,
   `rollback` as an invocation of the inverse action.
2. Add it to the platform's list (`META_ACTIONS`); the registry, `describeActionsForPrompt`, the
   executor and the inspector pick it up.
3. Reference it from a spec: `execute("meta_ads", "<action id>", { target, params })` with
   `{{decision.params.…}}` templates, or carry the id on the decision (`params.actionId`) and use
   `"{{decision.params.actionId}}"` as the action so one execute node serves several verdicts.
4. Tests: guards (caps, ceiling, step limits), the dry-run request shape, an execute path with a
   stubbed fetch, and the error mapping for the codes that action can hit.

### A validated n8n flow → an action

Tom's n8n flows are the oracle for what a mutation must look like once it has run for real. Mapping
one onto an action: the HTTP Request node's method + path + body become `dryRun`'s `ShapedRequest`
(same encoding, token moved to the header); the flow's IF nodes become `guards` (each condition a
`Violation` with a stable code); the flow's policy (`cpa_cap_off_hold_scale_v1`: 48 h minimum age,
7-day window, 3-day streak, soft-OFF block on unclean measurement, cap = 50 % of product price, the
account daily-budget ceiling) is already `META_ADSET_RULES` with the same reason codes and next
actions, so the two can be run on the same rows and diffed; and the flow's "undo" branch is
`rollback`. A flow that stays registered as a skill (`docs/N8N-ROUTINES.md`) may keep producing the
*proposal*; the action is what executes it behind the gate.

## What is deliberately not here

* No durable idempotency ledger yet (in-memory per worker process) — a `action_ledger` table when live
  mode is on the table.
* No Google Ads / Klaviyo / Shopify actions — same contract, next platforms.
* `meta.campaign.create_from_brief` does not execute (wave 2); its dry run is complete.
* The streak / age / measurement-clean / product-price fields are read when a row carries them
  (`age_hours`, `streak_days`, `measurement_clean`, `product_price`); the worker's Meta reader does not
  compute them yet, so today those gates pass through as "not measured" and the rules say so.
