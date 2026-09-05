# Stored-data rollout: independent warming and read-only coverage

Batch 50, 6 September NZ / 5 September UTC. Source implementation and live **read-only database inspection**, not a deployed/activated sync or completed B07–B11 acceptance.

## Verified problem and change

The previous scheduler used `UNC_STORED_DATA_ACCOUNTS` both to authorize background reads and to force foreground consumers onto stored snapshots. That made a warm → inspect → cutover rollout impossible through the existing flags.

The producer now requires both `UNC_DATA_SYNC_ENABLED=true` and membership in `UNC_DATA_SYNC_ACCOUNTS`. The existing reader allowlist remains separate. No fallback from the reader list to producer authority. This is an intentional configuration migration; existing operators must supply the new producer list when deploying the new worker. No current runtime flag was changed in this batch.

The worker still derives queries only from enabled routines, deduplicates exact queries and makes at most one actual query per tick (a query may paginate). It also explicitly skips paused accounts even if an injected accounts source lists one. This does not grant scheduled reads for switched-off routines. Proposed-query inspection below does not change those switches or authorize warming.

Shared snapshot validation now checks identity/query, real `ok`/`empty` provenance and source age. A recent fixture/error cannot suppress a provider sync by being labelled fresh. Storage time never renews source age. New writes reject stale/future source timestamps and reporting-day changes across provider waits; stored reads also refuse a UTC-day change during their database wait. A refused request is not automatically replayed in the same call.

## Read-only inspection

`inspectAccountDatasets` loads the effective server-owned specifications and invokes the same snapshot availability policy as the reader. It supports current enabled demand or explicitly proposed catalog routine IDs without enabling them. It reports unique query hashes, consumer IDs, snapshot IDs, original timestamps and precise missing/stale/unverified/identity states. Empty demand is **not ready**. It withholds foreign snapshot metadata, propagates database errors, rechecks freshness after long inspections and rejects an account generation/pause change.

Scope is explicitly **Meta only**. A ready result covers the supplied query set at the inspection instant; it does not certify every routine, credentials, scheduler cadence, metrics, API access or customer usefulness. `syncAdmitted` and `readerEnabled` describe the inspection process environment, not actual worker runtime configuration. Pause/switch and other runtime gates remain separate.

Compile and inspect using the already-linked project:

```sh
npx tsc -p tsconfig.worker.json
vercel env run -e production --project prj_WXwCzYpwmx9MmLBgqGrpWh8jnc6d --scope team_qGDetNt9PJl2udQU72jPbwuj -- node scripts/inspect-avgar-dataset-readiness.mjs --routine D02-W01
```

Omit `--routine` to inspect enabled demand. This script pins the project, account and owner and accepts only GETs under that project's `/rest/v1/` path. No provider or auth-management endpoint, RPC or write is allowed. It prints metadata, not provider rows, metrics or secret values. Vercel's command loads environment into the subprocess and may load the existing local environment; do not mistake those effective values for a deployed worker readback. The CLI reported three unpullable secrets; no secret was requested, copied or printed, and the needed database GETs succeeded.

## Actual AVGAR evidence

At `2026-09-05T16:16:56.365Z`, the compiled inspection executed **14 database GETs**, zero provider calls and zero database writes. Account generation 1, paused true, selection proposed, D02-W01:

| Query | State | Evidence |
|---|---|---|
| Insights `d63f473997c4ac0713bd0e5d8e3cb1e09d8f91dda8513a0800bc7229f6ba0c6b` | stale | Snapshot `3f346547-ac99-4d95-96a3-1da67f0ca601`; source `2026-09-05T02:14:42.005+00:00` |
| Ad sets `b02e4876cef586c4b4891f26ad3675b905d9e5dd408cc847ca941af9d2a5ca5d` | missing | No matching snapshot |

Independent SQL at `2026-09-05T16:13:17.370762Z` confirmed zero enabled routines, unchanged Meta/Shopify asset IDs, GA4 needs reconnect/no selected asset, and Instagram/TikTok/YouTube records without selected assets or successful reads. Meta and Shopify `last_sync_at` remain September 3 onboarding evidence; they do not represent every later provider read. Do not call them a continuously refreshed feed or require blanket reconnection based on this age alone.

## Acceptance and remaining rollout

**45 targeted tests and 215 files / 2,771 full tests pass**, including disabled-producer isolation, paused source, query deduplication, invalid provenance, source freshness, midnight transition, zero-demand refusal, foreign metadata denial, database failure and context-reset denial. App/worker TypeScript, production build, focused lint and diff checks pass. One parallel standalone typecheck raced the build replacing generated `.next/types` files; a sequential rerun passed after the build. This was validation orchestration, not a route-contract change.

Independent post-inspection SQL at `2026-09-05T16:18:12.358528Z` retains pause true, zero enabled routines, one historical command and one historical snapshot. Actual worker SSH readback retains source `5be9cfe81df31ac8624e55fc56d0a4b7e25b98dc`, all four dataset/refresh flags absent (off), empty command scopes and commands/messaging/live/SMS/Apple false. No new source was deployed in this batch.

Next Codex work remains: compatible app/worker release; bounded, explicitly authorized warm of all required Meta queries; inspect completeness and metric semantics; then coordinate producer admission and consumer cutover only for the intended account. Prove two scheduled intervals and restart/lease recovery before claiming ongoing freshness. Current pause and disabled routines mean simply setting producer flags is insufficient, and must not be silently bypassed. Lease-expiry/late-writer acceptance, retention, refresh-owner coordination and connector-health timestamps/alerts remain open. No Nguyen flow was edited or called. No new production schema, flags, switches, credentials, messaging, ad changes or spend activation.
