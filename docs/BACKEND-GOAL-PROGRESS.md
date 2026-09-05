# Backend goal execution ledger

Active goal: complete the acceptance gates in `BACKEND-COMPLETION-PLAN-2026-09-05.md`.
Started 5 September 2026. This file records progress; it does not replace the 24-item register.

## Current boundaries

- Nguyen owns n8n delivery. Do not edit, activate or execute his workflows while he is working. Integrate after his acceptance packet arrives.
- Keep publishing, customer messaging, ad mutation and spend activation disabled. Phone verification/provider approval and outward-action approval remain separate gates.
- Confirmed business inputs: US, NZ and AU; CPA ceiling 50% of the relevant product price. Seed keyword, product/currency binding and a scaling target are not inferred.
- Account: `aa5cfc84-2569-4c99-9b40-67003ae55eda`. Existing Shopify/Meta credentials stay on that account; no transfer or reinstall.

## Batch 1 — context integrity (source changes; subsequently deployed in Batch 3)

Fresh database inspection confirmed the mixed identity goes beyond the business name: the stored website, scan, plan narrative, commercial baseline and onboarding memories describe Junction. The stored goal also has a past year-2000 deadline. These are **not verified AVGAR settings**. No live context rows were overwritten during this inspection.

Implemented:

- Signed-in ordinary chat rebuilds context from the session account's database rows. A stale or fabricated browser context cannot override business, switches, approvals or receipts. Failed canonical reads return an error before paid model work. Onboarding retains unsaved draft input and cannot dispatch routines.
- Shared account-facts loader supplies the same tenant-scoped connector evidence, switches, plan and receipts to browser and server; the new canonical path does not drop existing connection/receipt evidence.
- Default server hydration uses an empty real-account seed rather than the demo founder. Missing margin remains null; cleared deadline/team/chat state cannot reappear from a stale seed.
- Authoritative routine facts take precedence over optimistic browser switch state.
- Chat includes the persisted website/business profile. Missing targets/budgets/hours are unknown, explicit zero stays zero, and historical baselines are not represented as current performance. Demo-clock pace projections and rollout weeks are excluded from real-account chat.
- Added regressions for browser spoofing, cross-account fact/receipt exclusion, database outage, empty-account hydration, cleared values and unknown/zero numeric cases.

These repairs advance B01, B08, B14 and B23 but **do not close their live acceptance gates**. They do not fix all stale autosave races.

Verification for this batch: 175 test files / **2,065 tests pass**; application and standalone worker TypeScript pass; production webpack build passes. No application/worker release, provider request, n8n execution or database mutation was performed in this batch. Production profile repair remains outstanding.

## Batch 2 — atomic persistence and revision guard

Previous goal turn classification: **progress** (commit `c7bb8c3` and its tests were rechecked before this work).

Implemented an owner-only `PUT /api/account/state`, using a service-only, security-invoker database function. It verifies current owner membership again inside the transaction, binds every written row to the session account, excludes all connector/routine/approval controls, and saves all sections or none. A save ID plus content checksum allows a lost-response retry without a second write. A stale revision fails with HTTP 409 and does not silently rebase local edits over newer data.

`GET /api/account/state` loads a single MVCC snapshot and its revision. The browser now hydrates and autosaves through these endpoints. Members can read but not save. Server intake/plan/profile changes invalidate previously loaded revisions. Plan agreement was moved to the owner-checked server writer in preparation for retiring direct browser writes.

Applied additive migrations:

- `20260905024453_account_state_atomic_save`
- `20260905024727_account_state_revision_invalidation`

`scripts/verify-account-state-atomic.sql` passed against the actual Unc database: complete save, explicit zero, duplicate replay, stale revision, reused-ID mismatch, nested account-ID isolation, non-owner denial, late-error rollback, channel preservation and server-change revision invalidation. Independent readback found **zero remaining test accounts**. The pilot still reads `Junction AI`; no live business context repair is claimed yet.

Local validation: **177 test files / 2,077 tests pass**, application/worker typechecks and production build pass. SQL checks exercise real transactions; the test is not a simultaneous multi-connection stress test. Security advisors remained at the existing six warnings/seven informational notices after the first additive migration; no new public executable definer function was added. Existing advisory remediation references remain in the main register.

**Release order:** deploy and smoke-test the new app, revoke legacy client writes on the protected context/chat tables and account name/currency columns, prove legacy denial, then perform the backed-up AVGAR repair. Do not revoke the old app's save permissions before the replacement is ready. Do not claim the browser race closed until that enforcement step is live. Direct administrative `account_state_meta` edits must explicitly increment the revision and clear replay markers; the business-row triggers cover ordinary server intake changes.

## Batch 3 — live application and enforced save boundary

Released the app at source `5dde2407a3208d16e6a4295d457b319e87221a96` to the existing `junction-unc` project. The first unaliased candidate had no runtime SHA, so it was not promoted. The replacement candidate explicitly included the release SHA, passed health and unauthenticated-denial checks, and was promoted. The canonical URL independently reports `5dde2407a320`.

- Live deployment: `dpl_2yLzCP8TqcS6Go3DeHtvRzN4qbZX`, Next.js, build completed in 32 seconds. Full release/rollback references: `LIVE-RELEASE-2026-09-05.md`.
- Existing signed-in owner session hydrated successfully and used the atomic writer at 02:55:52 UTC. Only then was `20260905025609_account_state_server_writes_only` applied.
- Legacy client insert/update/delete/truncate/reference/trigger grants on eight context tables are now denied; account name/currency column updates are also denied. Existing SELECT/RLS stays intact. `account_profiles` and its founder-notes endpoint were deliberately not included.
- `verify-account-state-enforcement.sql` passed actual authenticated/anonymous role checks. The full atomic SQL canary passed again under the final grants, with zero test accounts remaining after rollback.
- Post-enforcement chat-only canary `release check 1456` and its real model reply persisted at corner positions 4/5, row IDs `67818392-a00b-4a6e-a5da-0cc0ecacc001` / `6eba9ffe-1d29-4ab3-959c-30a3eb85f7be`. SQL readback and a browser reload both passed. Revision advanced to 4 after reload; no command was queued.
- Pilot connector identity/status fingerprint remained `b0f66c953199427e27567b11a9024927`. No credentials were changed or transferred. Messaging returns 503 while disabled; unauthenticated account state returns 401. Publishing/ad mutations remain source-disabled.
- No error/fatal entries were returned for the new deployment during the post-release scan. Vercel's drain API returned zero drains. Security advisors remain six WARN/seven INFO; this is not a clean security sign-off. Monitoring/alert delivery still needs acceptance.

**Still incomplete:** worker replacement, AVGAR context repair and memory/history fencing, n8n handoff/registration/dispatch and the rest of B01–B24. The profile is still `Junction AI`; this release deliberately does not call mixed-account business advice correct. UI checking also found stale readiness copy: the sidebar correctly counts two usable connections but setup progress still counts five status rows and claims nightly reads; the goal/date display still applies demo-style pace semantics to a historical baseline. Fix these as part of B01/B08/B11/B24 before customer acceptance.

The new revision guard safely rejects competing writers, but browser hydration currently writes an unchanged initial snapshot. Remove that unnecessary write and test two-tab editing/recovery rather than presenting the SQL canary as full browser concurrency proof. Earlier chat history, generated briefs, memories and artifacts still need a context boundary before correcting the business identity.

## Batch 4 — live memory generation guard and hydration no-op

Previous goal turn classification: **progress** (Batch 3 release and SQL enforcement). This turn also made verified progress; it is not blocked and does not close B01 or the full goal.

Released source `2bcbed838f7fde22e2a6950b2d44eb65554407fa` on the existing production project, deployment `dpl_GFhVcW2yijx1SJKVUTuWAaSJNTYE`. Canonical health reports `2bcbed838f7f`. Branch `codex/backend-foundation-20260905` was independently read back from GitHub at that commit. Full evidence: `CONTEXT-GENERATION-RELEASE-2026-09-05.md`.

- Browser model/memory requests capture a server-owned business-context generation. Missing headers are compatible only with generation zero. After a repair advances it, stale browser requests return 409 before model work; replies are checked again after model waits.
- Ordinary chat uses persisted, tenant/channel/thread-scoped history rather than browser-supplied earlier turns. The current user input is retained; an already-autosaved final user turn is deduplicated. Onboarding retains its explicitly unsaved draft inputs behind the generation check.
- Memory writes carry the operation's original generation. A security-invoker SQL trigger locks the account row and rejects delayed old-generation inserts/updates; memory account/generation cannot be reassigned. Repair generations are monotonic and invalidate autosave/replay markers, including on accounts with no prior state metadata.
- Manual memory API writes now use the verified member's account-pinned service path; existing member access semantics are preserved. Direct anonymous/authenticated memory writes, including truncate/reference/trigger grants, are revoked while existing SELECT/RLS remains. No account UPDATE grant or definer shortcut was introduced.
- A new tab's hydrated projection is marked acknowledged by the browser save protocol. Opening/reloading the account no longer sends an unchanged initial save. Pending uncertain writes still reconcile before newer/reverted edits, and stale revisions never silently rebase.

Applied in order: additive `20260905031145_account_context_generation_guard`; new app promotion; then `20260905031418_account_context_memory_enforcement`. Repository filenames use their earlier CLI-created timestamps (`20260905030144`, `20260905030840`); migration names/content match. The pilot remains generation **0** and its business context was **not** repaired in this batch.

Verification: **179 files / 2,092 tests**, app/worker TypeScript and production build pass; lint zero errors / 39 pre-existing warnings. `verify-context-generation.sql` passed against real PostgreSQL/service/authenticated/anonymous roles with rollback-only synthetic accounts. Existing atomic-save and legacy-grant canaries passed again. No synthetic context accounts remain. This is not a simultaneous multi-connection stress test or a live generation-one browser acceptance test.

The live owner session added temporary marker `CTX-1514`, row `7f97af8c-7e10-4d58-9f1a-cd2b22711e26`, at `03:14:33.239Z` through the new API after enforcement. It was immediately forgotten at `03:15:01.261Z`; database and UI readback confirm it is no longer active (history retained). Browser reload left account revision **5** / save timestamp **03:12:00.735904Z** unchanged. The earlier old-app preflight load had moved revision 4 to 5 before this release; new-app loads did not change it. Routine command count stays zero. Connector identity/status fingerprint for this batch's exact projection stayed `e2db714e52c03d4502a260ab2e1d99f6`; it is not credential freshness proof.

Safety and remaining coverage: no provider workflow was edited/executed, no credential changed, no publishing/messaging/ad mutation enabled. The old worker remains deployed. This memory guard does **not** yet fence generated artifacts/briefs, manual founder notes, intake business fields or command enqueue across a context repair. Complete those paths or quiesce/reconcile them safely before changing the pilot business identity. Repair must lock the account first, preserve a restricted restore record and close old valid memories before advancing generation in the same transaction. Do not silently re-label historical facts as the new business.

## Next independent work

1. Atomic app/save and memory-generation boundaries are live; redundant initial saves are removed. Complete actual two-tab competing-edit/recovery checks. Do not roll back to a browser-direct memory/state writer under the new grants.
2. Extend the context boundary to old worker jobs, generated briefs/artifacts, founder notes, intake and command admission (or safely quiesce and reconcile them). Then preserve the original Junction context in a restricted audit/restore record and correct the pilot profile/resources without inventing AVGAR commercial settings. Close wrong-business memories/history/plan/cache in the guarded repair transaction. Align setup/goal UI claims with verified data.
3. Release the compatible app/worker pair, reconcile staged receiver configuration safely, and verify no action controls changed.
4. Continue connection/refresh-owner, stored-data, scheduler, metric and security work from the register while Nguyen delivers the first keyword wrapper.
5. Bind D03-W01 only after actual webhook/revision/credential/receipt delivery. Then perform the real shadow round trip and expand verified lanes.

## Register status

No complete pilot has been claimed. B01 is actively being repaired; B02–B03 need coordinated release/dispatch; B04 awaits Nguyen. B05–B18 retain the split implementation/provider acceptance work documented in the register. B19 includes third-party channel approval/verification. B20–B21 require targeted security/retention evidence. B22 remains deliberately action-disabled. B23–B24 require independent tenant/customer acceptance.

Mark an item complete only after its stated acceptance evidence exists. A code test, running worker, database row, workflow screenshot or contractor report alone is not end-to-end proof.
