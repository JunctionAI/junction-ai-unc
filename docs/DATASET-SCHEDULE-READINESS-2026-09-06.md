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

Worker-only release pending. No app route imports the changed scheduler/readiness
entry points; its existing stored-reader interface is unchanged. No schema or
provider API change, no new registration, no Nguyen workflow call/edit, and no
routine/action/sync flag change is part of this batch.

Live two-interval refresh and process restart remain unproven. AVGAR stays paused;
sync/reader cutover and all routines remain off. This fixes the prerequisites but
does not silently open a new unpause window. Existing fifteen-minute cron
look-back still means a longer outage can miss a slot; durable overdue queues,
capacity/fairness across many clients and delivered alerts remain open. One query
may paginate; total request cancellation across lease expiry remains separate.
Full provider coverage, historical backfills, account/provider reporting timezone
reconciliation, remaining lane adapters and the full B01–B24/all-client journeys
are not closed by these synthetic tests.
