# Dataset refresh: incomplete-client isolation — Batch 57

## Reproduced blocker

`syncDataset` refuses a missing, unselected or reconnect-required Meta connection
before resolving credentials or claiming a lease. Previously the background tick
treated this exactly like an attempted provider failure and returned immediately.
A first account in that condition prevented later admitted clients from syncing
on every invocation. The existing failure cooldown could not help: this failure
happened before its lease was created.

Three tests using the real tick, reader and dataset adapter reproduced
`{ synced: 0, failed: 1 }` instead of the expected successful second-client sync.
These tests use synthetic accounts, transport and schema-checked in-memory data;
they do not invoke live providers.

## Change and verified behavior

- Missing identity now throws a typed pre-provider error, retaining the existing
  error text for callers.
- The background job records that account's connection failure and proceeds to
  the next **admitted** account. It skips the remaining Meta queries for the
  unavailable connection, not just the first query.
- No alternate credentials are borrowed. A non-admitted healthy client remains
  untouched. Actual provider failures still end the tick after one provider query
  (which can paginate); lease cooldown and atomic completion fencing are unchanged.
- The `failed` count includes connection/preflight failures, not just HTTP calls;
  `dataset.connection_unavailable` distinguishes them in structured logs.
- All three reproduced cases now sync the healthy client's data. A fresh function
  invocation reuses its stored result without another provider request. Separate
  cases prove allowlist exclusion and one-real-provider-failure stopping behavior.

220 Vitest files / 2,874 tests pass. App and worker TypeScript, focused ESLint and
diff checks pass. Source `20ba9c9c4815f9f88458ca4eeba7b7c911a674d1` is pushed and
independently matched to GitHub. Clean worktree:
`/private/tmp/unc-dataset-isolation-release.yBKkBo`. Unrelated `context 2.ts` untouched.

The release verifier additionally exercises the deployed compiled loop with two
synthetic unbound accounts, forbidding every credential/provider/lease call. Its
live section permits only the existing six-table database GET allowlist and checks
the actual paused AVGAR account and disabled runtime flags. It does not activate
sync, create synthetic production accounts or write production records.

## Release status

Worker-only release completed on the sole Sydney machine `1857466fd76998`, release
34; Fly smoke/health checks passed. Source `20ba9c9c4815f9f88458ca4eeba7b7c911a674d1`,
image `sha256:1fbc717c8886efa32cce1f5a0fba2230fe4b1b81b59e59970a191ea8cb2adc1c`,
tag `deployment-01M1SAGZ9QP786MW920DTR9CPK`.

Actual compiled-worker check at `2026-09-05T17:42:35.031Z`: PASS. Two synthetic
unbound accounts both reached the pre-provider check, zero credential resolutions,
provider calls or writes. The live section used 30 database GETs, verified actual
runtime sync/action flags off, and refused paused AVGAR. Its two inspected proposed
Meta datasets are stale; this was not a refresh or live scheduling test.

Canonical app health at `17:42:33.094Z`: app `75d4f3c87f88`, database healthy,
worker fresh (20 seconds, one tick, no reported last error). SQL at
`17:42:41.402892Z`: generation 1, paused, zero enabled routines, four runs and four
datasets unchanged. No inference of ongoing error-free execution or delivered alerts.

App stays compatible at `75d4f3c87f88` with no schema or endpoint change.
Prior worker rollback reference: release 33, source
`ced3eff809cc85863123dc4baa35153ebe2c2933`, image
`sha256:66f2008f3687c55d6201e7b5b83b09912f5c4b901c1f3d9c7dbf0bf1ae3c7c24`.

## Remaining scope

This removes one concrete cross-client starvation path; it does not establish
general multi-tenant fairness or all-client readiness. An account-source/database
exception can still interrupt account enumeration. Query-wide provider deadlines,
capacity/fairness under sustained demand, broader dataset coverage, durable
missed-slot recovery and real authorized scheduling acceptance remain open.
No n8n workflow, credential, account switch, messaging or ad authority changed.
