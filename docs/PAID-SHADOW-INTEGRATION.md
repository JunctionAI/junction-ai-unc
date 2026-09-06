# Paid-ads shadow lane — AVGAR Meta routines and the Google Ads BOFU plan

Contract `unc.paid-ads-shadow.v1` (`src/lib/n8n/paidShadowContract.ts`). Written 6 September 2026 on
branch `claude/avgar-paid-lanes-20260906` from `41622c6`. **Status: code, tests and this handoff only.**
Nothing here is registered, pinned in server configuration, migrated, deployed or run against a
provider. Every claim below is verifiable in the repo; none is a live receipt.

## What it covers

| Routine | Key | Lane | Skill items | Decision vocabulary |
|---|---|---|---|---|
| D02-W01 Daily paid decisioning | `daily_decisioning` | meta | 1 | SCALE · TURN_OFF · HOLD · KEEP · NOT_ENOUGH_DATA |
| D02-W02 Creative testing sprints | `creative_testing` | meta | 3 | LAUNCH_PROPOSED · WAIT · BLOCKED |
| D02-W03 Hook rotation engine | `hook_rotation` | meta | 1 | ROTATE_PROPOSED · NONE_READY · BLOCKED |
| D02-W04 Ad fatigue watch | `ad_fatigue` | meta | 1 | PAUSE_PROPOSED · KEEP · BLOCKED |
| D02-W06 Creative test planner | `creative_test_planner` | meta | 8 | HYPOTHESIS · BLOCKED |
| D02-W07 Budget pacing guard | `budget_pacing` | meta | 1 | CUT_PROPOSED · WITHIN_CAP · BLOCKED |
| **D02-W09 Google Ads BOFU campaign plan** (new catalog routine) | `bofu_campaign_plan` | google_ads | 5 | PLAN_PROPOSED · BLOCKED |

Deferred, unchanged: D02-W05 (creator rights) and D02-W08 (approved organic-performance source).
`*_PROPOSED` states are proposals for the founder. The built specs have no execute node; the
receipt must say `executedAction: "none"`; any `apply_ready`, `mutation`, `action_id`, `scheduled`
or `mutate_attempted: true` is rejected.

## The 50% rule as arithmetic

Any cited cap must be `{ value, currency, basis: "product_price_50pct", product_price, product_ref? }`
with `currency === client.currency`, `product_price > 0` and `value === round2(product_price × 0.5)`.
A SCALE needs observed CPA ≤ cap; TURN_OFF / PAUSE_PROPOSED need CPA > cap (or spend ≥ cap with no
purchases). An unmapped or foreign-currency price is `cap_reason: "pending_product_price"` with no
cap — never a converted, compare-at or store-wide number. Markets are US, NZ and AU, one per request.

## Request envelope

The standard `HttpN8nBridge` payload (signed, `dataToken` with **no** read scopes) plus:

```json
"shadow": {
  "contract": "unc.paid-ads-shadow.v1", "lane": "meta",
  "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
  "workflowId": "<Nguyen's wrapper ID>", "workflowVersion": "<frozen revision uuid>",
  "routineId": "D02-W01", "routineKey": "daily_decisioning",
  "policy": { "cpaCapPct": 50, "cpaCapBasis": "verified_product_price_same_currency" },
  "client": { "id": "avgar", "adAccountId": "act_<id>", "currency": "NZD", "timezone": "Pacific/Auckland", "reportingWindow": "last_7d", "market": "NZ" },
  "data": { "mode": "provider" }
}
```

Google Ads lane client: `{ id, customerId (10 digits), currency, primaryDomain, seedKeyword, market, locationCode (2840/2554/2036), languageCode: "en" }`.
The contract is strict: unknown fields, a different cap, a deferred routine or a market/location
mismatch are refused before any network call.

## Reply

`{ artifact, executionReceipt }` within 60 seconds, synchronous only (202 is refused).

- `artifact.kind` **must be `generic`** — `meta_decisions` / `campaign_plan` are rejected, not relabelled.
  One routine per run: an item carrying `routines: [...]` or another `routine` is rejected.
- Meta item meta (whitelisted, everything else dropped): `decision_state`, `status` (hypothesis | observed | blocked),
  entity IDs (`ad_id`, `adset_id`, `campaign_id`, `creative_id`, `winner_ad_id`, `underperformer_ad_id`, `next_ad_id`, `next_creative_id`; digits only),
  `observed` (numeric or null: spend, purchases, purchase_value, cpa, roas, ctr, frequency, impressions, clicks, daily_budget, window_spend, daily_budget_total, projected_daily_spend),
  `cpa_cap`, `rollback_proposal` (required for every proposal), `daily_budget_cap` (same currency), `window`, `next_action`, `cap_reason`,
  `blocked_field`, `experiment_ledger_connected`, `test_budget_per_variant`, `hook` / `format` / `offer` / `hypothesis`, `needs[]`.
- Google Ads item meta: `campaign_status: "PAUSED"` (only), `customer_id` = contract customer, `market`, `ad_group`,
  `keywords[≤50] { keyword, match_type EXACT|PHRASE|BROAD, search_volume, cpc, competition, intent }`, `negatives[≤100]`,
  `landing_url` (https, on `primaryDomain`), `headlines[≤15, ≤30 chars]`, `descriptions[≤4, ≤90 chars]`,
  `cpa_ceiling` or `cap_reason: "pending_product_price"`, `login_customer_id` / `conversion_action` (null allowed), `mutate_attempted: false`.
- `executionReceipt`: same skeleton as the keyword/calendar lanes (`workflowVersion: null`,
  `revisionEvidence: "pending_unc_verification"`, real `executionId`, timing inside the run, `client` echoed, `lane`) plus provider:
  - meta: `{ name: "meta_graph", dataset: "ads_insights", adAccountId, currency, reportingWindow, statusCode: 200, itemsCount, fetchedAt, credentialRef? }` — all bound to the contract client.
  - google_ads: `{ name: "dataforseo", statusCode: 20000, taskStatusCode: 20000, taskId, itemsCount ≥ 1, locationCode, languageCode, fetchedAt }`.

Unc then reads the named execution independently (trigger node **and** result node pins), matches
the request digest and the exact returned envelope digest, and only then stores a verified draft.

## Server-side pieces added

- `paidShadowSpec(contract, version)`: trigger(manual) → n8n → gate → receipt; `mutates: false`; passes `assertValidSpec`.
- `shadowProtocols.ts`: third protocol kind `paid`; `protocolReaderKind` → `meta` | `google_ads`.
- Bridge: own admission (`paidShadowAdmissionFor`), own receiver pins (`N8N_META_SHADOW_*`, `N8N_GADS_SHADOW_*`), own reader pins, currency must equal the run account, keyword ledger refuses paid contracts.
- Engine: `reservePaidShadowRun` / `claimPaidShadowStart` / `completePaidShadow`; snapshot `awaiting: paid_start | paid_started | paid_shadow`, `startProtocol: paid_claim_v1`; `planPaidShadowCompletion`, `resumePreparedPaidShadowRun`.
- `POST /api/n8n/paid-shadow-authority` (one-use allowance, lane-pinned receiver, `expected_only` revision).
- Command path: `paidCommandLane` (app, or Slack inside `UNC_MESSAGING_PILOT_SCOPE`) requires the stored spec to equal `paidShadowSpec(contract)` and the registered workflow to be the lane receiver; `dispatch.eligible` refuses otherwise; `worker/commands.ts` derives a fixed one-dispatch approval per command.
- Operator entry `runPaidShadow` (needs an accepted `n8n_paid_bindings` row) and `completePaidShadowRun`.

## Requirements before any real run (none done here)

1. **Nguyen**: one keyword-style wrapper per lane (Meta: one wrapper serving six routines by `routineId`; Google Ads: one), Header Auth per lane, pinned Junction origin, `generic` artifact + receipt exactly as above, frozen revision, real success/refusal execution IDs, trigger and result node IDs. Confirm or replace the proposed receiver URLs `…/webhook/unc/d02/meta-shadow` and `…/webhook/unc/d02-w09/gads-bofu-shadow`.
2. **Database migration (Codex-owned, not written here)**: `n8n_paid_bindings`, `n8n_paid_runs`, `issue_paid_shadow_run(input)`, `transition_paid_shadow(input)` with operations `start | dispatch | authorize | checkpoint | finish` and `commit_paid_shadow_completion(acct, generation, requested_run, packet)` — same semantics as `20260905185010_calendar_shadow_ledger.sql`, with the receiver check per lane and `initial_run #> '{snapshot,spec,nodes,1,shadowContract}'` as the contract source. Until applied, every paid dispatch fails closed at the RPC.
3. **Environment (worker + app)**: `N8N_META_SHADOW_RECEIVER_URL/TOKEN`, `N8N_META_SHADOW_WORKFLOW_ID/TRIGGER_NODE_ID/RESULT_NODE_ID`, the `N8N_GADS_SHADOW_*` equivalents, existing `N8N_EXECUTION_READER_ENABLED` / `N8N_EXECUTION_API_KEY`. Tokens must differ from the keyword and calendar credentials.
4. **Business inputs (Tom)**: verified AVGAR Meta ad account ID and its currency; Google Ads customer `1797030595` billing currency (the contract requires it to equal the Unc account currency; if it is not NZD the lane needs a versioned FX rule, not a workaround); per-market verified product prices for the promoted products.
5. **Reviewed pinned spec per routine** in `routine_states` (operator-written) and an active `n8n_workflows` row per routine pointing at the lane receiver; `UNC_COMMANDS_ENABLED` + `UNC_COMMAND_RELEASE_SCOPES` for the exact spec/workflow fingerprints; the AVGAR pause lifted only for the test window.
