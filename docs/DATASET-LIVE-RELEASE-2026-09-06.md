# Matched release and bounded AVGAR Meta warm

Batch 51, 6 September NZ / 5 September UTC. **PASS: matched release, two-query ingestion, stored reuse and restored hold. PARTIAL: business metrics and ongoing refresh.** Full B01–B24/all-client scope remains active.

## Deploy Result

- **URL:** https://junction-unc.vercel.app/app
- **Immutable app URL:** https://junction-ee0ag4n4w-tom-junctionmedis-projects.vercel.app
- **Target:** production, existing `junction-unc` project
- **Status:** READY, promoted after candidate health and anonymous-denial checks
- **Commit:** `7cf363cadee7e1c72e86a014812550f7b000fee0`
- **Framework:** Next.js 16.3.4
- **Build Duration:** 44.610 seconds (API buildingAt → ready)
- **Deployment:** `dpl_5jXKUjsrnTgYCK6c9Kt1qr6EydZC`
- **Worker:** Fly release 29, sole Sydney machine `1857466fd76998`, started/health checks passed
- **Worker image:** `registry.fly.io/unc-worker@sha256:aa617890ce47dce3d2d45bf848a157ff12f9fd7fc1e209449857b3545b2f6e7f`
- **Image tag:** `deployment-01M1S5WYKWND55A8JXEZGF94WH`

Release was built from detached clean worktree `/tmp/unc-dataset-release.PmoPva`; no production secrets were copied into it. The unrelated `src/lib/runtime/context 2.ts` stayed untouched in the working checkout. The Vercel candidate used production configuration and `--skip-domain`, not a preview with copied production credentials. Explicit source SHA was supplied at build and runtime. Worker cloud TypeScript compilation and clean dependency install passed; no path-alias imports remained in the emitted worker.

Canonical health at `2026-09-05T16:23:41.825Z` reports `7cf363cadee7`, database healthy and worker heartbeat fresh with no last error. The warm script running inside the actual worker requires the full matching SHA before any access and passed that check. Signed-in owner UI loads AVGAR, four saved runs/work items and zero enabled routines; reload after closure shows the setup pause banner. No success was inferred from a configuration row alone.

### Post-Deploy Observability

- **Error scan:** no error or fatal entries returned in bounded deployment-specific `--since 1h --limit 20` scans.
- **Drains:** zero configured.
- **Monitoring:** heartbeat and release checks pass; independent alert delivery remains an open acceptance gap.
- Anonymous keyword request returns 401 with `private, no-store`. Anonymous account-state returns 401; its response uses `public, max-age=0, must-revalidate`, not the keyword endpoint's cache policy. No private payload is returned on either denial.

Rollback references retained: prior app `dpl_EbKoF9dtfj4TBNVzGdZENAqvygmG` at `5be9cfe81df31ac8624e55fc56d0a4b7e25b98dc`; prior worker release 28 image `sha256:1c9280694468f0896e4601e6db58b7206e2d799779ceb17005ef331069f28a45`. No schema migration in this batch. Before rollback, keep producer/consumer lists and command scopes off; older code couples the producer to the reader allowlist.

## Bounded operator warm

The old `verify-avgar-datasets.mjs` diagnostic predates the mandatory token-context RPCs and captured generation; it is not suitable to rerun unchanged. The new `scripts/warm-avgar-meta-datasets.cjs` uses the deployed worker's existing credential provider and server credentials, with explicit account/generation/owner/asset/build guards. It never edits n8n or enables a routine. Its default is metadata-only inspection. `run(true)` requires an already-unpaused account, all routines off, empty command scope and disabled command/action/sync flags.

The operator must own the test window and restore its hold; the script does not modify pause itself. It bounds execution to 110 seconds between requests, caps Meta GETs at 11 and snapshot inserts at two, permits only the exact Meta account/insights/adsets paths, blocks provider POSTs/redirects and credential refresh/reseal, and permits only the needed dataset lease/snapshot and existing token-context RPCs. No token is put in a URL or logged. Success-only token settlement cannot write sealed credentials in this script. A process crash or uncertain result requires reconciliation, not automatic replay.

Actual sequence:

1. Worker metadata-only inspection at `16:22:44.408Z`: generation 1, paused; insights stale, adsets missing; 20 database GETs, zero provider calls/writes.
2. Exact AVGAR account hold temporarily opened at `16:23:27.626112Z`, conditional on generation 1, owner and zero enabled routines. Commands, dataset-schedule opt-in and external-action flags remained off; no daemon job configuration was changed.
3. Existing Meta credential read verified account `3235248400060604` and currency **NZD**, matching account currency. No refresh or credential replacement.
4. Two real queries stored complete provider output; second sync of each returned `fresh`; new stored-reader instances returned the same snapshot IDs without another provider request.
5. End-of-warm coverage at `16:23:36.831Z`: both proposed D02-W01 queries available, reader and producer routing still off. **83 database GETs, three Meta GETs total, two snapshot inserts, zero routine runs or provider mutations.** Database GET count excludes permitted internal lease/token RPCs.
6. Hold restored at `16:23:50.249645Z`. A subsequent `run(true)` refused with `test_window_closed` before credential/provider access. No repeated Meta request.

| Dataset | Snapshot | Source fetched | Rows |
|---|---|---|---:|
| D02-W01 insights, 7d/adset | `09726ed5-f15a-4fc8-a432-d616b82d7f61` | `2026-09-05T16:23:32.816Z` | 3 |
| D02-W01 adsets | `e1a4b0c9-a7fd-4c1b-bc6b-906c55ff8033` | `2026-09-05T16:23:36.380Z` | 62 |

Independent SQL readback joins both snapshots to connector `e205b686-e207-485e-a8fa-12f0852375b0`, account `aa5cfc84-2569-4c99-9b40-67003ae55eda`, exact expected query hashes and `ok` provenance. The old snapshot remains historical. Post-check `16:26:47.523624Z`: account paused, zero enabled routines, four historical runs, one historical command, three total snapshots. Meta asset/status/last-sync remain unchanged; encrypted-secret updated_at remains `2026-09-03T11:28:25.913Z`.

Nine isolated Node tests prove wrong runtime/project and enabled action/sync/scope flags fail before loading compiled worker dependencies or creating a database client. Script syntax and lint pass; actual dry inspection, successful warm and paused refusal are live acceptance, not synthetic provider fixtures. Deployed application source retains the previous 215-file/2,771-test validation.

## Important metric finding — next Codex fix

Snapshot freshness does not mean every derived metric is correct. The ad-set reader currently sums **all configured** daily budgets into `daily_budget_total` and picks the largest across every status. The actual snapshot contains:

| Configured status | Effective status | Count | Configured daily budgets (NZD) |
|---|---|---:|---:|
| PAUSED | PAUSED | 14 | 73.17 |
| ACTIVE | CAMPAIGN_PAUSED | 43 | 62.89 |
| ACTIVE | ACTIVE | 2 | 32.61 |
| PAUSED | WITH_ISSUES | 3 | 5.00 |

All configurations total **173.67**, while the two effectively active daily-budget ad sets total **32.61**. The returned largest ad set is campaign-paused. Neither configured budget sum is actual spend, projected account spend, a verified whole-account budget including campaign-owned budgets, or an instruction to change an ad. The warm did not execute any recommendation. Insights already correctly keep unsupported budget/projection fields null.

**Do not cut readers over or enable paid-ad decisioning based on this aggregate.** Next: correct active/daily/lifetime/campaign-owned budget semantics, preserve unknown values, exclude ineligible action targets and version the normalization/storage contract so historical aggregate results are not silently relabelled as fixed. Reuse saved provider observations for tests where possible; no need to refetch just to expose this issue. Product mapping/current market price still gates Tom's 50%-of-product-price CPA policy.

## Remaining boundaries

No background synchronization was enabled and no two-interval/restart freshness claim is made. The account is still paused; the scheduler requires enabled demand. Metrics, durable late-writer/lease acceptance, refresh lifecycle/health visibility and later routines/clients/channels remain in the original register.

Code review also confirms native refresh/reseal now always uses lease/atomic context settlement; absence of the legacy `CONNECTOR_REFRESH_LEASES_ENABLED` variable does **not** turn that protection off. This warm did not exercise OAuth rotation/revocation and does not close that acceptance.

One fresh Upwork read found no message after the 4:09 AM coordinated correction clearance. Nguyen still owns output corrections and the agreed Email/calendar/five-lane deliverables. No duplicate message, workflow edit, extra charges or provider execution was sent to him.
