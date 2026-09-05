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

App release and signed-in production output review are pending at this source
checkpoint. Worker-only code was not changed; existing release 36 at `dc41bc4`
remains compatible with this additive ops schema/API. No new worker rollout needed.

The audit table intentionally has no client read/update/delete grants. Retention,
approved account/user deletion and audit export procedures remain part of B21;
its account/user foreign keys restrict deletion until that policy is handled.
Do not invent a retention period or silently erase audit history.

This does not complete delivery/cost/stalled-run monitoring, all-client access,
second-client acceptance, provider sync/cadence, channel acceptance or the full
B01–B24 register. AVGAR stays paused, all routines/action controls off, Nguyen's
workflows untouched. No new provider run window was opened.
