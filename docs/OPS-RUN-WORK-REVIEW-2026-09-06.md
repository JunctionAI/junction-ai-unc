# Operator run output and receipt review — Batch 60

## Implemented boundary and journey

Ops run-monitor rows and client draft headers now link to the actual run's saved
business output, original/edited body, item text, source references and linked
receipts. These are stored observations, not fresh provider checks. No approve,
send, retry, activate or impersonation controls were introduced.

`GET /api/ops/run` derives the actor through verified server authentication, then
calls the service-only `read_ops_run_work` RPC. Account/run/generation identity and
independent work-read scope are mandatory; metadata-only operator grants do not
implicitly expand. The function locks the account/grant, checks expiration after
waiting, and excludes old-context/foreign runs. SQL and API project selected
business fields only, excluding arbitrary metadata, snapshots and receipt payloads.
Correlated external execution identity is displayed as stored evidence only.
Text and references render inertly, without HTML or automatic external requests.

Keyset pages contain up to 20 artifacts and 50 receipts. Cursors must belong to the
same account/run/current context; followup pages carry generation. No cross-page
snapshot consistency is claimed: each page is a fresh dated read. Refresh resets
pagination; navigation/denial/context errors clear the old output. Requests abort
on navigation and timeout. Each successful RPC writes an actor/account/run and
returned-record-ID audit before returning data; an audit failure denies disclosure.
The audit never copies output, tokens or raw execution payloads.

## Database and acceptance evidence

- Local exact migration: isolated PostgreSQL checks pass for actual anon/member
  refusal, separate work scope, projection, audit failure, 43 artifacts/103 receipts
  across three pages, unknown/foreign/old-context denial, and independently observed
  concurrent revocation/context/expiry lock waits. Zero provider/remote calls.
- Live migration `20260905182203_ops_run_work_review`; RPC definition MD5
  `339cafd1f7b8de6ad80d1d2b1dac14e8`.
- Live rollback-only canary passes against all four existing AVGAR pilot runs,
  correlated audits, raw-field exclusion, absent work permission and unknown actor.
  Temporary permissions and test audits rolled back; no artifacts were edited.
- At `2026-09-05T18:22:53.259275Z`, the sole persistent work-read grant was added
  for Tom's freshly verified AVGAR owner (`74802c60-149a-4405-b719-dc058d174072`,
  account `aa5cfc84-2569-4c99-9b40-67003ae55eda`). Existing metadata grants untouched.
- Full suite: **224 files / 2,949 tests pass**; application typecheck/focused lint
  pass. Browser fixture: **9 tests pass**, including navigation/reload/receipts,
  denied refresh, cross-client late-response protection and 390/1280px work layout.
  Local rendered screenshot inspected. Synthetic browser checks are not live auth.
- Security advisors: unchanged six WARN; INFO 16 → 17, solely intentional RLS/no
  client policy on server-only `ops_work_reads`. Actual client privileges denied;
  no broad policy added to silence the advisory.

## Release and remaining scope

- Source `1e1fd836e54bd7dfa4be3cfc46346a51e26fa79e` pushed; independent remote ref
  matches. Clean release worktree `/private/tmp/unc-ops-work-release.JG7GAH` excludes
  the user's untracked `src/lib/runtime/context 2.ts`; no secret env files copied.
- Vercel `dpl_76TiVoWiU386VtBTGk5YnVsvjs8z`, Next **16.3.4**, build **43 seconds**,
  READY. Candidate https://junction-3pif4oanu-tom-junctionmedis-projects.vercel.app .
  Initial deployment returned `Not authorized`; actual whoami/team/project checks
  succeeded, and one explicit-team retry completed. No credential changes.
- Candidate health matched source, DB healthy/worker fresh; anonymous work GET
  returned **401 / private, no-store**. Then promoted to
  https://junction-unc.vercel.app/ops . Canonical health at `18:25:39.973Z` reported
  SHA `1e1fd836e54b`, healthy DB, worker fresh at 34 seconds, 19 ticks/no last error.
  Canonical anonymous work read also returns 401/private/no-store.
- Signed-in owner clicked the actual run-monitor link for customer run
  `aeb10060-f0c5-508e-a99a-d70e919eea27`. It displays artifact
  `c022a1e4-8e0a-4ae4-924d-b0d7d43c6590`, real historical keyword item, missing-GSC
  warning and five receipts. Expanding artifact and draft-receipt evidence shows
  execution **80**, workflow `XiXJKuph1fAeH9pe`, historical revision
  `92135add-3c35-43e4-9649-5bb3d4557814`, stored verified evidence and action `none`.
  This does not accept old keyword prioritization or Nguyen's pending corrections.
- Independent SQL confirms audit `5041133a-36a0-4a56-8951-4ac13e42b130` at
  `18:26:02.410386Z`, exact verified owner/account/run/generation, one artifact ID
  and all five receipt IDs. Selecting the other AVGAR account with that run is
  refused by the production UI; previous work disappears (metadata access only).
- Fresh direct-link document load at `18:27:07.294483Z` reproduces the same work
  and five receipts; audit `17b97204-22d8-41b3-9e04-d2322ceb2564` independently read
  back. Final error/fatal scan through approximately `18:27:13Z` has no entries.
- SQL at `18:26:35.654789Z`: AVGAR generation 1/paused, zero enabled routines,
  four runs, four artifacts, four datasets and exactly one work-read grant.
- Worker code unchanged: release **36**, source `dc41bc4`, sole Sydney machine
  `1857466fd76998`, image `dbecd419f0e04d2daf67224856ba1dde63901f6296b26508594ff27ead807cc3`
  remains started/compatible with the additive ops schema/API. Fly config retains
  all five action/channel flags false. No worker deployment or admission change.
- Bounded candidate error/fatal scan returned no entries; drains remain zero.
  This short window does not establish ongoing monitoring or alert delivery.
- App rollback target: `dpl_4ig4xyZC5xHufxALRZ6zLQk2qB2P` at `dc41bc4`.
  Existing schema/worker can remain; remove the single work grant atomically if
  work review must be disabled, retaining access history.

The audit table intentionally has no client read/update/delete grants. Retention,
approved account/user deletion and audit export procedures remain part of B21;
its account/user foreign keys restrict deletion until that policy is handled.
Do not invent a retention period or silently erase audit history.

This does not complete delivery/cost/stalled-run monitoring, all-client access,
second-client acceptance, provider sync/cadence, channel acceptance or the full
B01–B24 register. AVGAR stays paused, all routines/action controls off, Nguyen's
workflows untouched. No new provider run window was opened.
