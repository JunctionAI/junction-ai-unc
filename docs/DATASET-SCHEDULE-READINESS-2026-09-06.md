# Stored-data producer / scheduled consumer readiness — Batch 55

6 September NZ / 5 September UTC. B09/B17 progress, not full background-refresh
or multi-client schedule acceptance. The previous goal turn completed a verified
release; this turn reproduces and fixes a concrete cold-cache scheduling failure.

## Failure reproduced

The actual `Worker.tick` ran scheduled consumers before `runDatasetSyncTick`.
With stored-reader cutover enabled and two absent required snapshots, the routine
created a failed run (`stored data ... has not synchronized`) immediately before
the producer fetched the first query. The scheduler then treated the failed
start as a served cron slot. A successful refresh could not recover that slot.

Two regression tests failed on this sequence before the fix. Tests use the real
worker loop, dataset sync, native Meta request shaping, stored reader and engine,
with synthetic HTTP replies and schema-checked in-memory storage. They are not
real provider observations or production scheduling evidence.

## Changes

- Independent dataset producer runs before commands and scheduled consumers.
  Its result is included in `TickReport.datasets`; command admission receives
  only the remaining tick budget. Existing one-provider-query-per-sync-tick
  limit, opt-in accounts, account pause, leases and atomic save checks remain.
- Scheduled consumers using opted-in stored reads inspect their required exact
  queries before creating a run. Missing, stale, unverified, misbound or
  unreadable data produces `dataDeferred` and a structured diagnostic, not a
  failed run, provider fallback or served slot. A later tick can retry within
  the existing scheduler look-back window.
- Optional reads retain their existing optional behavior. Non-opted-in direct
  readers are unchanged. The actual engine still rechecks context, switch state
  and source freshness; the metadata precheck is not authority to execute.
- Shared query readiness uses the strictest consumer freshness limit, capped by
  the existing one-hour stored-reader policy, including final inspection-time
  recheck. Query provenance and normalization checks are unchanged.
- Producer demand is deduplicated across enabled routines before execution, with
  the shortest required refresh interval. This fixes a second mismatch: a
  two-minute freshness requirement could previously wait for the fixed
  fifteen-minute refresh policy. The default remains fifteen minutes; no
  consumer can extend it. Invalid refresh intervals fail before claiming/fetching.

## Verification

- **217 files / 2,855 Vitest tests pass**, app and standalone-worker TypeScript,
  changed-file ESLint and `git diff --check` pass.
- Seven new worker integration cases cover cold two-query warming, one subsequent
  successful synthetic read-only routine, no duplicated run after worker
  recreation, independent next refresh cycle, provider failure, metadata-store
  unavailability, switch-off during warming, optional reads, non-opted-in direct
  reads and stricter freshness refresh.
- The successful case makes exactly two synthetic HTTP calls for two snapshots;
  engine read receipts both point to stored snapshots. Later refresh makes two
  more calls and stores two more observations without another scheduled run.
- Additional cases cover shared-query minimum freshness and one-query dedupe,
  slow-inspection expiry, invalid limits and unchanged default refresh behavior.
- Test lease/commit RPCs are explicitly stubs. Actual PostgreSQL locking and
  completion-fence evidence remains in `DATASET-SYNC-FENCE-2026-09-06.md`;
  this suite does not substitute for real concurrent SQL or process-restart proof.

## Release / remaining gates

**Worker-only release complete.** Source
`ced3eff809cc85863123dc4baa35153ebe2c2933` is pushed and independently matched by
the remote branch ref. Clean build checkout:
`/private/tmp/unc-schedule-ready-release.vdZpqk`. Fly **release 33**, sole Sydney
machine `1857466fd76998`, image
`sha256:66f2008f3687c55d6201e7b5b83b09912f5c4b901c1f3d9c7dbf0bf1ae3c7c24`,
tag `deployment-01M1S9GJEGDMTAYGN014QR5HXH`. Remote TypeScript compilation,
standalone import check, rolling smoke and machine health pass.

No app route imports the changed scheduler/readiness entry points; its existing
stored-reader interface is unchanged. The compatible app intentionally remains
at `1e72947d12a5` / `dpl_BcR3ws4fPoDSg5Krx4RVDGyvT2QL`; this is not a claim
that app/worker SHAs are identical. No schema/provider API change, new registration,
Nguyen workflow call/edit or routine/action/sync flag change.

At **17:24:26.541Z**, `scripts/verify-dataset-schedule-worker.cjs` ran inside the
actual new worker. Full build SHA and actual disabled flags match. Its transport
allowed only GETs to six allowlisted tables in the pinned Supabase project:
**30 database GETs**, zero credential resolutions/provider calls/writes. Actual
runtime sync is off; an explicitly scoped helper invocation still excludes the
independently read paused account. Compiled readiness refuses it and reports both
actual saved queries stale. Function arguments did not change environment flags
or establish a live schedule test.

Canonical app health at **17:24:45.203Z**: DB healthy, worker fresh at 20 seconds,
one tick, no last error. Independent SQL at **17:24:47.364527Z** retains generation
1, paused, zero enabled routines, four runs/one command/four snapshots, unchanged
from the pre-release read. Fly machine is started with passing health. A buffered
log read at 17:25:10Z returned no rows; that is not an error-free runtime-log proof.
Independent alert delivery remains open.

Rollback: worker release 32/image
`sha256:02f11916e5a29f45a82956f77829f2ecac63412fb8dfcde90962d209bcf0a8c9`;
retains prior dataset fencing/output validation but loses this producer ordering
and consumer deferral. Keep sync/cutover/action holds unchanged if rolling back.

Live two-interval refresh and process restart remain unproven. AVGAR stays paused;
sync/reader cutover and all routines remain off. This fixes the prerequisites but
does not silently open a new unpause window. Existing fifteen-minute cron
look-back still means a longer outage can miss a slot; durable overdue queues,
capacity/fairness across many clients and delivered alerts remain open. One query
may paginate; total request cancellation across lease expiry remains separate.
Full provider coverage, historical backfills, account/provider reporting timezone
reconciliation, remaining lane adapters and the full B01–B24/all-client journeys
are not closed by these synthetic tests.

## Nguyen handoff update

Fresh Upwork read at approximately 05:24 NZ confirms his **05:11 AM** response:
he accepts the output-only keyword corrections, exact fixed-clock fixtures/edge
cases, corrected Email/calendar packaging and honest inventory within the existing
scope. ETA **within two hours**, approximately **07:11 AM NZ**. No new provider
runs, credentials, sends, spend changes or later-lane adapter work agreed. No
duplicate message was sent; do not poll the unchanged handoff before that ETA
without a new notification or other concrete reason. Codex continues independent
backend work; this is not proof that corrected files have arrived.
