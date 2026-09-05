# Meta budget normalization and saved-data correction

Batch 52. PASS: source validation, real saved-data correction/reuse and matched production release. This advances B02/B09/B11, not completion of the B01–B24/all-client goal.

## Corrected semantics

`unc.meta-budget.v2` requires configured and effective ACTIVE status for the active daily-budget subset. Paused/campaign-paused/deleted/archived/in-process/issue configurations are not targets. Lifetime allocations remain separate. Missing, malformed, conflicting or possibly campaign-owned budgets stay unknown; duplicate/missing IDs, unknown statuses and unsafe amounts prevent a usable total/target.

`active_daily_budget_total` means eligible active daily-budget configurations within the returned listing. It is not account spend, forecast spend, an account cap, or a complete campaign/ad-set ownership join. `daily_budget_total` and `projected_daily_spend` remain null. Largest-adset selection is limited to the eligible daily subset. Raw conversion still assumes two currency decimals; AVGAR's NZD was independently verified in Batch 51, not generalized to every currency.

Meta adsets/campaigns query hashes include the normalization version. Reader, save, readiness and reuse paths require its marker; old results under a new hash cannot be ready. Insights and other platforms retain prior hashes. Native pacing's skill check refuses missing/invalid/unverified forecasts and its prompt forbids budget configurations as forecasts. Pacing remains unavailable pending its projection, cap/currency and catalog/adapter contract.

## Actual saved-data acceptance

`scripts/correct-avgar-meta-budget-snapshot.mjs` defaults to GET-only. Explicit `--persist` permits one exact insert, checks fixed project/account/owner/generation/asset and requires AVGAR paused. It refuses stale/changed data, uses a deterministic ID and reconciles repeated invocation. No credential reads, provider requests, unrelated table access, RPCs, account updates or deletes. SourceNote retains lineage: source ID and normalized-row SHA256.

- Source: `e1a4b0c9-a7fd-4c1b-bc6b-906c55ff8033`, 62 normalized adsets, fetched `2026-09-05T16:23:36.380Z`.
- Original record hash: `0b1cae06d0033d68980e6eee9cd438e9b733e042ca3a91318301936955f0f150`.
- Source rows hash: `a5be313dddda96232c6b4ad5beb93307964553389e03013578a6d19aec37b520`.
- Derived: `a1223279-93b6-59fe-a6a2-089222fe77f3`, stored `2026-09-05T16:39:20.756Z`, same original source time.
- Query hash: `9ff158ea4ed8cd7502ede2785e86b11103089ad62864c546e9ebe30b4ab640cc`.
- Result: 2 active daily adsets, NZD 32.61; largest eligible ID `120249470895090580`, daily amount 22.61. Ambiguous/forecast metrics null. No second division by 100.
- Dry inspection: 9 database GETs, 0 writes/provider requests.
- Persist/readback at `16:39:21.077Z`: 15 GETs, one insert, 0 provider requests. A new StoredDatasetReader serves the derived ID and unchanged rows/source timestamp.
- Repeat explicit persist at `16:39:45.235Z`: 11 GETs, zero writes/provider requests, same served ID.
- Independent SQL at `16:39:57.249623Z` confirms both records. Historical aggregate 173.67 preserved, not relabelled. AVGAR paused/generation 1/NZD; four runs and one command unchanged.

Normal 60-minute source expiry still applies. No background sync or read-routing cutover enabled.

## Validation and remaining work

Full Vitest: 216 files / 2,820 tests passed. Ten Node derivation tests passed (identity, query, provenance, source time, units, cardinality, deterministic ID, preserved history). App/worker TypeScript and Next.js 16.3.4 production webpack build passed. Full lint: zero errors, 44 existing warnings; changed-file lint and diff whitespace check passed.

Next: scoped ongoing producer cadence/restart proof before stored-reader cutover, including late-holder acceptance. Complete query/metric joins, product-price CPA policy, auth lifecycle, customer/channel/second-client acceptance and remaining original register items. Nguyen owns his agreed five-lane delivery; no workflow or contract/payment changed. The later handoff-file request below is the only outgoing message in this batch.

## Deploy Result

- URL: https://junction-unc.vercel.app/app
- Immutable URL: https://junction-m66b9m0pp-tom-junctionmedis-projects.vercel.app
- Target: production, existing junction-unc project; candidate checked before promotion.
- Status: READY; deployment `dpl_qwBs38btjfsjNhEM5m1fmkgmJUzX`.
- Commit: `bb538e2e3638e297b259369ce6ebb467dc67b2cb`, independently verified on GitHub before release.
- Framework: Next.js 16.3.4. Build duration: 47.407 seconds (API buildingAt 1788626537458 → ready 1788626584865).
- Clean source worktree: `/tmp/unc-budget-release.VdNyuu`; unrelated `context 2.ts` untouched, no secrets copied.
- Fly worker: release 30, sole Sydney machine `1857466fd76998`, started, smoke/health checks pass.
- Image: `registry.fly.io/unc-worker@sha256:30b3fc937427ec3c4debe539d6d894cad74e3142d99265faa82ab1a6dfd201ba`; tag `deployment-01M1S760639E58EAP75V3CHZQH`.

Actual worker verification `2026-09-05T16:44:14.125Z` checks the full source SHA and executes its compiled StoredDatasetReader. It serves derived snapshot `a1223279-93b6-59fe-a6a2-089222fe77f3`, exact 62 rows, preserved source time, total 32.61 and largest eligible daily 22.61. Four database GETs, no provider calls/writes. Account pause/generation/currency verified; commands/messaging/live/TNZ/Apple false, command scopes empty, producer and consumer opt-ins absent.

Canonical app health `16:44:45.587Z`: build bb538e2e3638, database healthy, worker fresh (8 seconds), ticks 2, no last error. Signed-in owner reload confirms AVGAR, four saved runs/work items, zero enabled routines, pause and disabled-action notices. SQL `16:44:50.394341Z` retains pause/generation 1/NZD, four runs, one command and four datasets.

### Post-Deploy Observability

- Error and fatal scans: no entries returned, deployment-specific since 1 hour, limit 20 each.
- Drains: zero. Independent alert delivery remains unverified; a fresh heartbeat is not scheduled-routine acceptance.
- Anonymous keyword-request denial: HTTP 401, private/no-store. Canonical account-state denial: 401, public/max-age=0/must-revalidate; no private data returned. These are different cache policies, not blanket no-store proof.
- Rollback: app `dpl_5jXKUjsrnTgYCK6c9Kt1qr6EydZC`, source `7cf363cadee7e1c72e86a014812550f7b000fee0`; worker release 29 image `sha256:aa617890ce47dce3d2d45bf848a157ff12f9fd7fc1e209449857b3545b2f6e7f`. Keep all producer/consumer/action flags off. No schema changes; derived snapshot can remain as immutable history.

## New Nguyen handoff received

Fresh Upwork read after release found his 4:27 AM message: claimed output-only revision `e5ae41ae-d025-4231-9f5c-99589c43e88a`, only Build Artifact And Receipt/jsCode changed; US/NZ/AU saved-data fixtures reportedly pass. He also reports completed Email drafts, six-week calendar and five-lane inventory under `scripts/issue45_artifacts/`. This is a reported delivery, not independent acceptance or a repin. The named files are absent from the shared Junction workspace. Codex requested actual attachments/access links and exact commit, retaining freeze and no-new-provider-run boundaries. No additional scope, charges or n8n changes authorized. Next integration action: inspect the actual published diff and delivered artifacts, then repin and clear only the bounded tests justified by that review.
