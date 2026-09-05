# Connections: customer-visible stored-data readiness — Batch 56

## What changed

The Connections page previously showed dated connector reads without the stored
datasets required by enabled routines. It now reports required Meta-read coverage,
separately from connection health and account pause state. The panel explicitly
does not certify optional reads, other providers, worker refresh configuration,
ongoing schedules, completed routines or launch readiness.

`connectionDataState` derives required reads from the account's enabled **live**
specifications, uses the existing dataset identity/provenance/normalization/freshness
checks, deduplicates shared queries and retains the tightest consumer age limit.
No enabled demand is `no_demand`, not `ready`. Database failures or a changed
business generation, pause or selection return `unavailable` without query metadata.
The session-bound endpoint checks membership again before returning its response.

The response contains only query metadata and source/check timestamps. It does not
return raw results, credentials, provider asset IDs or deployment configuration.
App environment flags cannot establish the separate worker's configuration and
are intentionally not presented as such. Refresh status reads stored records only;
it neither calls providers nor unpauses automation.

The Next.js guidance kept database work in the existing no-store server endpoint
and the UI import type-only. Supabase guidance informed explicit tenant filtering,
membership checks and the read-only production check. No schema, grants, dependency
versions, account settings or worker behavior changed.

## Verification

- 219 Vitest files / 2,869 tests pass, including 14 added handler/data/presentation
  cases. App and worker TypeScript, focused ESLint and diff checks pass.
- New cases cover no demand, pause, shared strict freshness, metadata redaction,
  foreign-account snapshots, optional/disabled/draft exclusion, generation/pause/
  selection changes, metadata failure and membership revoked during inspection.
- Rendered tests cover unavailable, paused/all-off, dated fresh data and stale-data
  guidance. These are synthetic fixtures, not new provider observations.
- SQL at `2026-09-05T17:33:52.340068Z`: AVGAR generation 1, paused, zero enabled
  routines, four saved runs and four datasets. No settings changed for this test.
- Source `75d4f3c87f889fe098bfa30d80b5ef4e87fc51b7` pushed; independent remote ref
  matches. Clean release worktree `/private/tmp/unc-connections-readiness-release.qr4Jgc`.
  User file `src/lib/runtime/context 2.ts` excluded and untouched.

## Release and live readback

- Vercel `dpl_F82eaB3bwpEHEYknxPvXTtrEPue6`, source `75d4f3c87f88`, Next 16.3.4,
  44-second build, READY. Candidate: https://junction-jrnxffx4x-tom-junctionmedis-projects.vercel.app.
  Promoted to https://junction-unc.vercel.app/app after candidate health and
  unauthenticated endpoint checks. Anonymous connector state returned 401 with
  `cache-control: no-store`, no account metadata.
- Canonical health `2026-09-05T17:35:57.320Z` reports the new app SHA, healthy
  database and fresh worker heartbeat (32 seconds, no reported last error).
  Worker remains compatible at `ced3eff809cc85863123dc4baa35153ebe2c2933`, release 33;
  this app-only change does not alter its interface or behavior.
- Signed-in AVGAR Connections renders the new panel with `no_demand` and paused
  automation, checked `2026-09-05T17:36:16.874Z`. Both DOM and visual inspection pass;
  dated Shopify/Meta reads and existing controls remain intact. Loading showed
  unverified state rather than retaining a false ready label.
- Post-release SQL `2026-09-05T17:36:19.513002Z` retains generation 1, paused,
  zero enabled routines, four runs and four datasets.
- Error/fatal log query since 17:35 UTC returned no entries. This short observation
  is not proof of ongoing error-free operation. Drains remain zero; independent
  alert-delivery verification is still outstanding.

## Remaining gates

This closes the missing customer-facing observation, not B09/B17/B24 as a whole.
Actual ongoing provider sync/cadence, broader provider/history coverage, failure
alerts, remaining lane adapters, channel and second-client acceptance remain open.
AVGAR stays paused; publishing/customer messages/ad changes stay disabled. Nguyen's
correction handoff remains pending and his workflows were not changed or executed.
