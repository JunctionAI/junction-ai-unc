# Atomic routine editor — Batch 34

6 September NZ / 5 September 2026 UTC. **Implementation and database acceptance PASS; broader routine execution and launch remain PARTIAL.** This does not close B01–B24 or the all-client goal.

## Change

- Opening settings reads one account/member/generation-bound database snapshot without creating a row. Its revision includes the routine state, saved parameters, account preset and the actual profile/resource/current-generation AOV/niche inputs used to render defaults. No raw snapshot or server credential is returned to the browser.
- Parameter validation and candidate spec construction happen before persistence. One service-only, security-invoker transaction checks current owner, context, pause and the exact reviewed revision, then saves both editor parameters and draft spec or neither. Unbound parameter changes participate in the revision too; a stale tab cannot overwrite them because the workflow version stayed the same.
- The newest same-account/current-generation dry-run record of the draft version and existing spec hash must still pass at promotion. SQL rechecks the selected run ID/status/finished timestamp and exact current draft JSON under the configuration transaction. Promotion never enables a routine or starts a run. Keyword remains operator-gated.
- Validation executes its captured draft instead of loading a different draft after the request check. A changed configuration after execution is reported as a conflict with the recorded run ID, not a successful configuration validation.
- Optional catalog steps remain available in the editor after their removal has been promoted; they can be included again in a new draft without replacing other promoted/custom nodes. Merged cross-field parameters are validated, not just the changed field in isolation.
- Client writes carry the reviewed configuration revision, prevent same-render double clicks and ignore completed responses after unmount. No automatic write retry. All params responses, including anonymous and failed responses, now use `private, no-store`.
- Discard explicitly says it drops the draft workflow while retaining saved editor values; it does not falsely claim a full settings rollback. Saved unbound editor values still use the existing preset semantics and are not a newly implemented immutable live-settings history.

## Verification

- Full suite: **206 files / 2,587 tests PASS**; app and standalone worker typechecks PASS; production webpack build PASS. Changed-file lint: zero errors/warnings. Focused tests include stale unbound edits, mid-save owner/context/profile changes, malformed transaction replies, no-store errors and optional-step removal → validation → promotion → re-inclusion.
- `scripts/verify-routine-editor.sql` passed against actual PostgreSQL before and after applying the migration, under the service role. It verifies missing-row reads, tenant/actor/pause/generation/preset refusals, stale revisions, promotion provenance and a forced failure after the params write but before the state write. Both writes roll back. All rollback canaries are absent afterward.
- Two separately dispatched concurrent PostgreSQL requests used the same initial revision on synthetic account `bc00705d-f76f-499c-9fcb-cb65434d9bb3`. Candidate `postsPerWeek=4` committed; candidate `5` was refused with SQLSTATE `40001 editor_changed`. Independent 12:36:25 UTC readback shows exactly `4`, disabled/version 1, zero runs. This is a real two-request database check, not a many-client load or two-browser UI test.
- The exact synthetic account, membership and cascading settings were deleted after readback. At **12:36:30 UTC**: seven accounts, two members, nineteen connectors, eight routine states, zero params/runs/canaries. No real client's rows were changed.
- The first synthetic setup attempt hit the intentional `auth.users` service-role denial and rolled back. A zero-fixture readback preceded the corrected admin identity lookup → service-role canary. No grant was broadened.
- The initial staged SQL parse error was corrected before any DDL application; the complete rollback rehearsal then passed. Migration source: `20260905122638_routine_editor_atomic.sql`; only two new RPCs/explicit execution grants, no data migration or table-policy changes.
- Security advisories before application: six existing WARN/fourteen INFO. This is not a security sign-off. Existing [definer exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) work remains scoped separately.

## Remaining execution acceptance

General manual start, draft validation and resume still need durable request identity, one-use execution admission, deadline/recovery handling and actual duplicate/restart acceptance. This editor transaction is not a lock held across a model/provider request. No at-most-once execution claim is made.

The promotion path retains the runtime's existing non-cryptographic `stableHash` matching. Current-generation filtering and transactional draft/run checks improve it; an immutable exact-spec validation receipt and broader catalog-upgrade handling remain follow-up work, not cryptographic attestation. Snapshot revisions use SHA-256 in PostgreSQL and are not authorization tokens.

Real eligible provider results, auth/fresh-read coverage, schedules, external-history binding, client memberships, monitoring, security/retention, phone/second-client and useful-output acceptance remain open. Nguyen's wrapper and the pending n8n/Hyperagent approval questions are unchanged. AVGAR remains paused; publishing, messaging, ad mutation and spend activation remain disabled.

## Release

Database functions are applied and verified. App release/readback will be appended after candidate acceptance. Existing worker need not restart for the editor-only API/UI change: the shared preset refactor preserves account-input mapping and the worker does not use the new editor RPCs. Full standalone compilation passed; do not claim identical app/worker source SHAs.

Next.js guidance preserved route-handler/server boundaries; Supabase guidance kept privileged reads/writes server-only and required actual transaction/denial checks. Vercel guidance requires a checked candidate before promotion.
