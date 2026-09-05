# Calendar durable integration — Batch 62

6 September 2026 NZ. **Backend implementation; no live customer calendar claim.**

**Batch 68:** [receiver source and Cloud compatibility proof](integration/CALENDAR-RECEIVER-COMPATIBILITY-2026-09-06.md)
now pass in separate synthetic execution 87. This does not create a binding,
callable calendar receiver, allowance, provider read or customer calendar result.
The next step remains Codex-owned receiver/registration and bounded E2E work.

## Implemented

- Dedicated server-only binding and run tables, immutable owner allowance and
  account/generation/run-scoped transitions. Credentials remain native references,
  not copied keys. Token/request fingerprints do not disclose bearer tokens.
- Separate `unc_calendar_private` schema. The existing `unc_private` schema was
  not accessible to service_role; its privileges were not broadened. All seven
  new functions are security-invoker with empty search_path and explicit grants.
- Atomic issuance/start/dispatch/authority and one-way consumed states. Neither
  uncertainty nor expiration restores an allowance. Duplicate issuance returns
  original IDs and does not silently restart the engine.
- Candidate checkpoint, independently verified result, single transaction for
  one draft/three correlated receipts/run completion, and original-result readback
  after lost completion responses. Recovery reads only the named saved execution;
  it preserves original source time and verifies both request and result hashes.
- Worker factory wiring, separate POST-only authority route and explicit operator
  `runCalendarShadow` selection of an accepted binding. No generic chat/scheduler
  permission is inferred. Missing reader/receiver pins refuse before issuance.

## Verification

`npx tsc -p tsconfig.calendar-sql.json` followed by
`node scripts/verify-calendar-shadow-ledger.mjs /tmp/unc-manual-pg.x8Y6jR`
runs the exact migration on an isolated real PostgreSQL cluster. The small SQL
transport invokes actual production adapters; it does not mock SQL semantics.
The full engine → admission → authority → bridge → saved-output projection →
atomic completion path passes with exactly one **synthetic** POST and GET, zero
real provider/remote database calls. A recreated recovery/completion adapter also
finishes the original result after a simulated day without another dispatch.

Real concurrent connections test one-winner issue/start/dispatch/authority and
completion, failed receipt-insert rollback, role/tenant/asset/key/expiry boundaries,
immutable evidence, and stored data. Eighteen observed lock-wait cases cover
pause, generation, owner, switch, registration and expiry at start/dispatch/auth.
An additional observed connector lock reproduced acceptance of a snapshot that
expired while waiting; freshness now rechecks after that lock and the test passes.
The initial SQL variable ambiguity was also caught and corrected before migration.

At 07:10 NZ: **226 files / 3,014 tests pass**; app TypeScript, standalone-worker
TypeScript, production Next 16.3.4 build, focused ESLint and diff checks pass.
The schema inventory test now accounts for the two new tables.

## Production database

Migration `20260905185010_calendar_shadow_ledger.sql` applied successfully at
approximately 07:11 NZ. Independent function-body MD5s match all seven local
bodies; public/authenticated cannot execute any new function. Both new tables
have RLS enabled, no browser-role access, service read/insert/update and no delete.
No binding, registration, allowance, customer run or provider call was created.

Security advisors retain six existing WARN findings. The only additions are two
INFO [RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
for the intentionally server-only tables (19 INFO total). No browser policies or
existing-role grants were added to suppress them. The prior warning inventory
and broader B20 security work remain open.

**App/worker release is complete; calendar activation is not.** See the release
and transport-correction addendum below. No live calendar result is claimed.

## Matched release and transport correction

- Runtime source `2b4bcfbe5f364b170029f179e4aa124c9518e1f8`, independently
  read back from GitHub before deployment. Vercel `dpl_9QB6yhzc1D7aztoEwDvofKZwbiLy`
  built in 44 seconds, passed candidate health/anonymous POST refusal, then was
  promoted to https://junction-unc.vercel.app . Candidate:
  https://junction-ht58bb0dg-tom-junctionmedis-projects.vercel.app .
- Fly release **37**, sole Sydney machine `1857466fd76998`, image
  `sha256:5ae170a8ae17d650496333ceaa3cebea521a3ca2ee085bc03e6e8e250c833a25`,
  tag `deployment-01M1SFW1YVP15K6F0ZHT8ZNN02`. Remote build, alias check,
  rolling smoke and health pass. All five external-action flags remain false.
- Production verification exposed a transport bug not covered by direct SQL:
  the explicit paused/context refusal used `40001`, a serialization-failure code.
  Actual worker RPC checks hung; database observation found the completion query
  still active after the client deadline. This is consistent with PostgREST's
  documented [automatic transaction retry issue](https://github.com/PostgREST/postgrest/issues/3673).
  The installed JavaScript client does not retry non-idempotent POST requests.
- Applied additive migration `20260905192350_calendar_context_conflict_sqlstate`.
  It checks the two exact predecessor function-body hashes and changes only six
  deliberate business-refusal codes to `PT409`. No conditions, locks, signatures,
  grants or policies change. PostgREST supports this explicit
  [HTTP conflict mapping](https://docs.postgrest.org/en/v16/references/errors.html#raise-errors-with-http-status-codes).
  Genuine database serialization errors are not rewritten.
- Full isolated real-PostgreSQL calendar suite passes with both migrations,
  including the same 18 lock-wait refusals, snapshot expiry, one-use concurrency,
  rollback, actual engine/authority/completion and recovery. No production TS
  changed, so the preceding 3,014-test/type/build evidence is reused rather than
  rerunning an unchanged full application build.
- At **19:24:59.939 UTC**, the actual compiled worker passed
  `scripts/verify-calendar-worker.mjs`: expected source, compiled modules,
  actual service-role account/table access, missing-permit refusal, and paused
  completion **HTTP 409 / PT409 in 22 ms**. Seven database calls, zero provider
  or n8n calls/writes; both calendar tables empty, receiver pins absent.
- Independent final bodies: `calendar_current` MD5
  `21e530de08faffe298ed0620ecc4620d`; `commit_calendar_shadow_completion` MD5
  `5e166a080d337f03db679c5e191e4648`. Both remain invoker/empty-search-path,
  service-executable and denied to anon/authenticated. Advisors remain 19 INFO /
  six pre-existing WARN. At 19:25:40 UTC, zero active completion queries remain.
- Canonical health at **19:25:30.095 UTC**: matching SHA, healthy DB, fresh worker
  at 53 seconds, tick 10, no error. Final SQL: generation 1, paused, zero calendar
  bindings/runs, four historical runs. Earlier post-release signed-in ops read
  restored run `aeb10060-f0c5-508e-a99a-d70e919eea27` and its artifact/five receipts,
  with audit `8c6773af-70b6-476f-9f3e-5b12fd2b983c`; it is historical work, not fresh
  provider evidence. Bounded deployment error scan from 19:15 UTC returned no
  entries; this does not prove alert delivery or ongoing monitoring.

Rollback runtime targets: app `dpl_76TiVoWiU386VtBTGk5YnVsvjs8z` / source
`1e1fd836e54bd7dfa4be3cfc46346a51e26fa79e`, worker release 36 / image
`sha256:dbecd419f0e04d2daf67224856ba1dde63901f6296b26508594ff27ead807cc3`.
Keep the additive schema and PT409 correction on runtime rollback; restoring the
retrying business-refusal code is not a safe rollback. All activation holds remain.

Follow-up: audit other user-authored `40001` business refusals through the actual
Data API, with compatible application error mapping. Do not globally replace
real serialization errors or repeatedly trigger known retry loops as a test.

## Handoff and remaining gates

At 07:11 NZ, a fresh Upwork read found Nguyen's 05:37 corrected handoff:
revision `ac771cd3-8899-4401-915c-40d4477e48e2`, attachment
`tom-2026-09-06-final.zip` (21 entries, 84,889 uncompressed bytes), downloaded to
Tom's Downloads. ZIP SHA-256:
`214c41dacbc4c0faf82a25a5bd99c8208072c2b31cc3f757873f235d3017e1ab`.
The initial received-only status is superseded by the
[independent final review](integration/NGUYEN-FINAL-REVIEW-2026-09-06.md).
Specific output corrections are accepted; no registration repin or live run was
performed. No complaint, payment release or new run authorization was sent.

Batch 67: [the native Klaviyo account identity is now independently proven](integration/KLAVIYO-ACCOUNT-BINDING-PROOF-2026-09-06.md)
by manual probe 85. The credential belongs to AVGAR `SuYidF`; provider USD /
US/Eastern must remain distinct from Unc's NZD business context. The corrected
handoff is already accepted; no need to ask Nguyen to repeat it.

Next: create the reviewed binding, package the callable calendar receiver, configure its separate pins,
finish customer selection/recovery, and run an explicitly bounded shadow window.
AVGAR stays paused, zero enabled routines; publishing/messages/ad changes/spend
activation remain off. No fresh provider window has been opened.

Retention is explicit unfinished work: restrictive FKs preserve original evidence;
B21 needs the governed archive/purge sequence before real calendar bindings are
retired or their account is deleted. This does not claim full retention support.
The complete B01–B24/all-client/launch goal remains active and incomplete.
