# Backend goal execution ledger

Active goal: complete the acceptance gates in `BACKEND-COMPLETION-PLAN-2026-09-05.md`.
Started 5 September 2026. This file records progress; it does not replace the 24-item register.

## Current boundaries

- Nguyen owns n8n delivery. Do not edit, activate or execute his workflows while he is working. Integrate after his acceptance packet arrives.
- Keep publishing, customer messaging, ad mutation and spend activation disabled. Phone verification/provider approval and outward-action approval remain separate gates.
- Confirmed business inputs: US, NZ and AU; CPA ceiling 50% of the relevant product price; discovery seed `golf travel bag`, separately per market. Product/currency binding and a scaling target are not inferred.
- Account: `aa5cfc84-2569-4c99-9b40-67003ae55eda`. Existing Shopify/Meta credentials stay on that account; no transfer or reinstall.

## Latest state — Batch 12, 5 September 2026, approximately 05:45 UTC

**Further verified, source-only progress; full goal remains active.** Prepared immutable message-arrival identity and database-managed channel binding revisions. New code captures account/generation/link/user separately from provider payloads; duplicate acceptance preserves the initial binding, unknown arrivals never inherit later links, and pending codes carry their issue generation. Atomic claim and terminal-state denial helpers are ready for the consumer migration.

- **186 files / 2,241 tests**, application/worker TypeScript, production build and focused lint pass. New real PostgreSQL canary passes within a rollback-only migration rehearsal. No schema or synthetic data remains in production.
- This does **not** complete channel processing: existing webhook routes, raw consumer, multi-statement code consumption, channel history/persistence and outbound delivery still need the same identity enforced. The prepared helpers are not wired in yet. No channel/app/worker/n8n release or execution was performed, and messaging must remain disabled.
- Live health still reports runtime `00fc57cfd07b`, healthy database and fresh worker. AVGAR remains generation 1, revision 15, paused; channel links/inbox/outbound and leftover canary accounts all zero.
- Full behavior, canary scope, compatibility/release boundary and exact next work: [channel identity foundation](CHANNEL-IDENTITY-FOUNDATION-2026-09-05.md). Do not deploy source reading the new link fields until the migration and remaining channel protections are coordinated.

## Batch 11, 5 September 2026, approximately 05:31 UTC

**Further verified progress; full goal remains active.** Daily briefs, KPI snapshots and the worker's derived-style write now carry their captured business generation through evidence gathering, provider/model waits, persistence and readback. Brief evidence filters current-context inputs before limits; same-day output preserves separate generations. The browser brief lifecycle and worker local-day candidates/markers are generation-bound.

- App/worker runtime `00fc57cfd07b175bc0d0c452c94f32ecd2d1e735` is pushed and live. Vercel `dpl_CJ3wGqojJj3eaWmktmQTCs6rsYy2` is READY, 48.689-second remote build; Fly release 13 on the existing machine uses image `694e435341a950bb3173004d07fa214f5fc9851107c6228290f56cddc8860e5c`. Independent health readback: matching source, four ticks, zero routine starts, all five action flags false.
- Additive database stage `20260905052625_brief_kpi_context_fence` preserved legacy keys during the rolling replacement; `20260905052845_retire_brief_kpi_legacy_keys` then retired them. The original runtime regression canary caught a shared-trigger field-access bug. Correction `20260905053022_fix_context_trigger_parent_access` is applied and pushed in SQL-only follow-up `527d51707bd86d3e06863033be327756eed77d95`. All three real SQL canaries now pass, including the expanded run-update case. No real run existed during correction; failed synthetic work rolled back.
- **185 files / 2,216 tests**, app/worker typechecks and production build pass. Lint remains zero errors/39 existing warnings. Security advisors remain six WARN/eight INFO with no new-function finding. Bounded post-release app error/fatal scan returned zero entries; no log drains or confirmed alert delivery.
- Signed-in AVGAR identity, preserved connections, pause and approved seed survived reload/readback. Database: generation 1, revision 15, pause true, runs/commands/briefs zero, two chats. All 18 existing KPI snapshots are retained, six other accounts remain generation zero/unpaused, and no canary accounts remain.
- Full behavior, migration mapping, correction disclosure, proofs and **new rollback compatibility boundary**: [brief/KPI release](BRIEF-KPI-CONTEXT-RELEASE-2026-09-05.md). Do not roll back blindly to pre-generation upsert code after legacy keys are removed.

**Next:** channel inbox/link identity capture, thread/outbound fencing and uncertainty; intake/founder-note/other profile hooks and remaining telemetry writers/readers; bounded paid pilot admission/reconciliation, worker signing/reader access/configuration and Nguyen's final validated origin/revision. These are still Codex-owned dependencies alongside Nguyen's delivery. No n8n execution or outward action was performed. AVGAR stays paused; the full B01–B24 goal is not complete.

## Prior state — Batch 10, 5 September 2026, approximately 05:08 UTC

**Further verified progress; full goal remains active.** Durable commands now carry the generation captured by the accepting app request. New source checks it before/after interpretation and eligibility, claim/execution, result reconciliation and notification claims. The worker cannot resolve an old queued request into a newer account context. Stale work is left as history, never relabelled. Unavailable controls surface to worker health rather than appearing as an empty healthy queue.

- Applied `20260905050313_command_context_fence` from repository migration `20260905045726_command_context_fence.sql`. Two private **security-invoker** triggers protect immutable command identity and deterministic command/run binding in either insertion order. No definer privilege or customer table/RPC access was added. Legacy rows retain generation zero; old code cannot silently enqueue/claim into a repaired generation.
- Added a service-only invoker polling RPC that excludes paused/stale rows **before** limiting results, so old history does not starve current accounts. Notification polling includes Apple alongside the other supported channels; this does not enable any channel or certify delivery.
- Owner command status reads require the request's current generation, filter out older commands and recheck after fetching. App polling sends that captured header and drops late replies/errors across same-account generation changes. Existing account-chat availability during a setup pause is preserved; explicit `/run` receives the pause reason without intent-model work.
- Real PostgreSQL rollback rehearsal and post-apply `scripts/verify-command-context.sql` passed: stale/missing-generation denial, immutable request/tenant/claim, wrong or unclaimed run denial, legacy-worker rebase denial, pause/unpause, current-only polling, unrelated-account progress and server-only privileges. Independent readback confirmed zero synthetic accounts, commands and runs; AVGAR remains generation 1 / revision 15 / paused. Six existing WARN/eight INFO security findings remain unchanged, with no finding for the three new invoker functions.
- **184 files / 2,200 tests pass**, app/worker typechecks and production build pass, lint zero errors/39 existing warnings. The added hook harness and queue fake prove application behavior, not browser rendering or SQL trigger semantics; real SQL evidence is separate.
- Matching source `3b001703b65fe3dd0edeb421b2eef9a6ae43ccdb` is pushed and live. Vercel `dpl_FJfzNkmeGgJTfT4D6t1pkKPfsphA` is READY (38.926-second remote build); Fly machine `1857466fd76998`, release 12, image `1355c210104d58b500c63278ebc196135005f7487079c1c8670c2be2cb81ec56`, reports the same SHA and two healthy ticks / zero routine starts. All five action flags remain false. Candidate health and unauthenticated command/authority 401 checks passed before promotion. Signed-in AVGAR identity, pause and approved memory survived reload. No live command was submitted or executed. Full evidence and recovery reference: [command-context release](COMMAND-CONTEXT-RELEASE-2026-09-05.md).

**Still required:** generation-aware channel inbox acceptance and outbound persistence, intake/brief/founder-note/telemetry and other delayed/runless writers; bounded paid-pilot admission and durable uncertain-call reconciliation; worker signing/reader access/configuration; Nguyen's final configured revision. No network operation is locked atomically across a reset. No paid n8n execution, outward message, content publication or ad mutation was made. AVGAR stays paused until the full coverage and admission gates pass. This batch does not close B01–B24.

## Prior state — Batch 9, 5 September 2026, approximately 04:50 UTC

**Further progress; full goal remains active.** Captured-generation enforcement is now applied to `routine_runs` and linked artifacts/approvals/receipts in the database. Corresponding runtime/proxy source and the independent reader are deployed to matching app/worker source `d95aaa403217422dc53d655a4ff9b305516577c6`. Nguyen's keyword wrapper handoff is received and its denial execution independently inspected; no registration or provider call has been activated. Tom's approved discovery seed is persisted and visible in AVGAR's current memory.

- Run/account types and store mappings carry the captured generation; old runs cannot be relabelled. The engine captures it before execution, rechecks before/after nodes and store operations, and rejects stale approval/input/external completion. Account input gathering rejects an intervening reset. Production DB adapters supply the guard automatically.
- n8n tokens, context/reads/proposals and shadow authority revalidate captured context. A reset during context gathering or registration lookup prevents disclosure/authority; stale output is not converted into a new-context failure receipt.
- Applied remote migration `20260905044013_runtime_run_context_fence` (repository file `20260905042742_runtime_run_context_fence.sql`). A private trigger-only definer locks the account for each short DML operation, checks pause/generation/parent account/routine, and prevents reparenting or snapshot mismatches. No lock spans provider I/O, no client grant is broadened, no history is rebased. Legacy runless outputs remain allowed only at generation zero; generation-aware runless writers remain unfinished.
- Rollback rehearsal passed, then `scripts/verify-runtime-run-context.sql` passed against the applied migration under real service-role/trigger semantics. Post-canary readback: four enforced tables, zero canary accounts/runs, AVGAR generation 1/paused/revision 14 unchanged; the six other accounts stay generation zero/unpaused. This is not a simultaneous multi-connection stress test.
- Validation: **183 files / 2,174 tests**, app/worker typechecks and production build pass; lint zero errors/39 existing warnings; diff checks pass. Fixtures now explicitly contain account controls; the fake schema parser supports `ALTER TABLE public.<table>` rather than inventing a table named `public`. SQL enforcement is proved separately by the real canary, not simulated by that parser.
- Security advisors are unchanged at six WARN/eight INFO, with none naming the new trigger. Existing extension placement, auth helper exposure and password-protection review remain B20; no blanket privilege or RLS changes were made. Performance notices remain 26 unindexed FKs, nine initplan, nine unused-index, seven multiple-policy and one auth-connection setting notice; no new-function finding. See [security-definer guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [extension guidance](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- [Nguyen wrapper handoff](integration/D03-W01-WRAPPER-HANDOFF-2026-09-05.md): saved execution 72 links to the reported revision, took 1.787s and stopped at the missing-origin response. Header Auth reference and webhook node ID were inspected without reading secrets. `pinned_junction_origin` is a fixed placeholder: configuring it requires a new validated/published revision. No n8n mutation or paid execution was performed. Supported API access and Codex admission/registration/configuration remain gates. In particular, deployed Fly secret metadata lacks `N8N_SIGNING_SECRET`; matching worker signing configuration is Codex-owned and still required.
- [Matching runtime release](RUNTIME-CONTEXT-RELEASE-2026-09-05.md): Vercel `dpl_Dq6nSURoPPcrdd15md69MxD2G6jA`, Fly machine `1857466fd76998` release 11 / image `8b1afc9e60a1d5d7546b903128f2038d40a9630d8476d2a246e3189335aaa012`. Both report `d95aaa403217`; health/auth/pause checks passed, with all five action flags false. Bounded post-deploy error/fatal scan returned zero entries, but there are no log drains and this is not ongoing alert coverage.
- Tom approved `golf travel bag`, separately in US/NZ/AU, as discovery rather than a proven winner. At `04:49:17.900988Z`, the bounded reviewed SQL transaction added memory `e9f8979b-0a89-4f7b-945e-3eb5f01e51a6`, closed/superseded the old unknown-seed memory and updated the profile note. The existing profile trigger advanced revision 14 → 15; generation remains 1, pause remains true. Independent database and signed-in **What Unc knows** readback passed. Runs/commands/briefs/registrations/enabled routines all remain zero, with the two previous chat rows unchanged. No new model answer or keyword-provider result was generated.

**Next:** finish queued-command/intake/brief/founder-note/telemetry and other runless writer generation coverage, then bounded pilot admission/reconciliation; securely complete worker/reader configuration after supported access and the final validated wrapper revision are available. Do not unpause AVGAR or declare B01 complete because the run-bound subset is protected. Preserve the existing archive. All publishing, messaging and ad mutation/spend activation stays disabled.

## Prior release snapshot — Batch 6, 5 September 2026, 03:46 UTC

**Progress, not goal completion.** App and worker now run source `da799c992b75587055240a033134917ee228f6b3`. The AVGAR context repair is committed in the live database; owner chat correctly identifies AVGAR, its approved markets and CPA rule, and unconfirmed commercial settings. Automation remains paused. Full release, repair and recovery evidence: `AVGAR-CONTEXT-REPAIR-2026-09-05.md`.

- Added an account-level pause with database enforcement over routine/artifact/brief/approval/intake-derived writes. Existing connections are preserved, chat remains available, and routine switches can be turned off. This is a hold, **not captured-generation fencing**; do not unpause until old/in-flight runtime writers and admission paths are fully covered.
- Applied live migrations `20260905033152_account_automation_pause` and `20260905033435_unknown_business_resources`. Unknown budget/hours persist as NULL rather than fabricated zero. Chat autosave no longer generates a template plan when those inputs are missing. Added setup agreement generation checking and removed agreement-on-hydration.
- Rehearsed the account repair with rollback, then committed it once at `03:43:44.585771Z`, archive `e56cac77-1940-41b4-99db-677aa30e4222`. Original rows from 20 account/context/history tables are retained in a restricted private archive. Active Junction goals/team/history/derived outputs were removed; old memories were closed, not relabelled. Generation advanced 0 → 1, routine switches are all off, the plan is empty/unagreed, and only verified identity plus approved/unknown settings seed current memory. Credential and connector hashes are unchanged; unrelated context hashes passed the transaction assertions.
- Fresh existing-credential Shopify/Meta reads passed after repair, check `2701c7bd-24dc-49bc-abac-c6b26f75fced`. No auth/provider writes. Owner chat rows `3f5be0e8-fa85-4503-b96e-73ce1b8da0d7` and `d575894f-6cea-46cc-97d7-815306d0e976` persisted and survived reload. Revision stayed 14 after reload, with no runs, commands or briefs and no regenerated goal/plan. This is context/chat acceptance, not n8n acceptance or product-price verification.
- Local validation: 180 files / 2,109 tests, app/worker typechecks, production build, lint zero errors (39 existing warnings). The remote worker build caught one compiled path alias; corrected to a relative import and verified standalone compilation plus 30 focused tests before release. Database pause/atomic/generation canaries passed and rolled back.
- Vercel candidate passed health, unauthenticated account-state 401 and Apple 503 before promotion. Fly's command failed its final smoke-check authorization after updating the machine; independent machine/readback confirmed exact image, v8, passing health, new SHA, at least two completed ticks and all five action flags false. No blind retry or second machine was created. The previously staged receiver secret became deployed; no n8n flow is registered or called.

**Next Codex work:** fix the false Home/setup readiness claims found by the live browser check (template phases despite no agreed plan; five status-only connections vs two usable bindings; nightly/within-hour promises despite pause). This is correctness work, not a visual redesign. Then finish captured-generation runtime fencing, concrete independently authenticated n8n execution-record reader, readiness/sync/dispatch and remaining acceptance gates. B01 and B02 have substantive live evidence but the broader B01–B24 goal remains active. Nguyen is not yet the only blocker.

Nguyen can continue with actual workflow/execution IDs and pending revision evidence as documented in Batch 5. Independent execution revision verification is still Codex-owned and is not wired to a production reader. Keep refusing before provider dispatch when that reader is absent.

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

## Batch 5 — Nguyen revision-provenance clarification (source, not activated)

Nguyen correctly reported that the workflow cannot expose its own internal executing version through the runtime workflow context. The contract now separates expected configuration from observed evidence: request `shadow.workflowVersion` is the server's expected pin; response `workflowVersion=null` and `revisionEvidence=pending_unc_verification`, with actual execution/workflow IDs. Codex independently reads the named execution's saved revision and account/run/routine identity before enriching the stored receipt. Current/latest workflow metadata or an echoed expected value are not accepted as execution proof.

Implemented parser changes, a strict independent-observation validator, a server-owned reader hook and a bounded post-response verification wait. Without a reader configured, the shadow bridge refuses **before** calling the paid-provider webhook. A failed independent read never falls back to an LLM or repeats the provider call. An explicitly server-pinned dedicated wrapper ID is supported; parent IDs cannot substitute for the actual executing wrapper. Child-workflow provenance still needs explicit binding if that composition is used.

Updated `KEYWORD-SHADOW-INTEGRATION.md` and `integration/NGUYEN-NEXT-HANDOFF.md`, and provided Tom a copyable clarification so Nguyen can continue the keyword wrapper. No Nguyen workflow was inspected/modified/executed during this clarification. Public official n8n docs/source support the distinction, but the Cloud instance's exact execution-read fields and permissions have **not** been verified. The concrete authenticated reader transport/access, durable reconciliation and deployment remain Codex-owned gates; the injectable test reader is not a production integration.

Validation: 68 focused tests, **179 files / 2,104 full tests**, app/worker TypeScript, production build and focused lint pass. No additional app or worker deployment was performed for this contract change. Live app remains Batch 4 (`2bcbed838f7f`); the pilot remains unregistered/inactive.

## Batch 6 — matched app/worker and backed-up AVGAR context repair

Released matching application/worker source `da799c992b75587055240a033134917ee228f6b3`, applied account-pause and nullable-resource schema changes, and completed the restricted, recoverable AVGAR context repair. Full receipts, migration IDs, private archive identity, deployment/image references and live owner-chat readback are in `AVGAR-CONTEXT-REPAIR-2026-09-05.md`.

AVGAR is now context generation 1 and **automation remains paused**. Active mixed Junction context/history was removed only after archive, not relabeled as AVGAR output. Existing connections and credentials were preserved. US/NZ/AU and the 50%-of-product-price CPA ceiling are recorded; budget, hours, margin, keyword seed and commercial goal remain unknown. A real post-repair Shopify/Meta read and ordinary owner chat/reload passed. No n8n workflow was called.

This closes the backed-up pilot identity correction and proves the matched release, not the entire B01/B02/B03 or launch gate. Memory generation fencing is live; delayed runtime artifacts/briefs/commands and other admission paths still need captured-generation enforcement before removing the account pause.

## Batch 7 — evidence-based Home/setup and persisted-plan display

Previous goal turn classification: **progress** (Batch 6). This turn made further verified progress and is not blocked.

Home and Strategy now use saved phases only, with no fallback to a default three-phase play or elapsed-time inference of completion. Setup counts only asset-bound connections with a successful dated read; it explicitly distinguishes that past read from an ongoing live feed. NULL resource values remain unknown, not zero. Paused accounts no longer receive nightly/within-hour/next-morning delivery promises or actionable brief/plan-agreement/routine prompts. A failed routine-enable request no longer turns the local switch on optimistically.

The first release at `2bb2c579926e23cfc93a46794f176fc67c10a8c8` passed production owner-UI and matched-worker checks. That live check exposed a remaining Strategy label calling the default option the current play without an agreed plan. Follow-up source `b7c347bfd9ff862f00b01e6fb71740e26d783b0c` fixes that label, removes ownership claims on unagreed options and explains the empty phase list. It is now deployed as `dpl_Ccr4mnbwiaoT5Ma7391f94eLyXxj`; canonical app health and the exact worker image report the matching source. Complete release/readback evidence: `ACCOUNT-READINESS-RELEASE-2026-09-05.md`.

Validation: **181 files / 2,116 tests**, application/worker typechecks, final production build and lint pass (39 existing warnings, zero errors). No schema, business settings, credentials, Nguyen workflows or action permissions were changed by this batch. Final post-release SQL at 04:06:03 UTC retained generation 1, pause true, revision 14, two chats, zero enabled routines/runs/commands/briefs, empty unagreed plan and NULL budget/hours/margin. Bounded error/fatal scans returned no entries; zero drains and unverified alert delivery remain observability gaps.

## Batch 8 — concrete independent execution reader, still gated

Implemented the separate authenticated GET-only execution reader behind an off-by-default server gate. It uses the saved actual workflow revision and pinned webhook node, binds the entire original business payload with a canonical digest (excluding only the expiring data bearer), rejects wrong identity/manual/retried/redacted/truncated/child-workflow evidence, and bounds finalization reads without repeating the paid workflow POST. The shared bridge now creates this reader from valid server configuration; no new response field is required from Nguyen.

Validation: **182 files / 2,160 tests**, including 44 new synthetic reader tests; app/worker TypeScript, production build, lint (zero errors, 39 existing warnings) and diff checks pass. No workflow, registration, account setting or credential was changed. This batch is source-only at this point; live runtime remains Batch 7's `b7c347bfd9ff862f00b01e6fb71740e26d783b0c`.

The live Cloud UI shows a trial with nine days remaining and no API-key menu. Official n8n documentation excludes public API access during the free trial. No execution-reader key was found in inspected runtime configuration metadata, and no purchase/key creation was performed. The inspected official MCP execution projection omits the saved revision/snapshot, so it does not supply equivalent evidence. Supported API access, credential scope review and real saved-execution acceptance remain activation dependencies. Full details and pinned sources: `integration/N8N-EXECUTION-READER.md`.

This is further progress, not a blocked goal or completed pilot. Continue runtime generation and admission work independently; do not enable the reader or paid dispatch merely because tests pass.

## Next independent work

1. Atomic app/save and memory-generation boundaries are live; redundant initial saves are removed. Complete actual two-tab competing-edit/recovery checks. Do not roll back to a browser-direct memory/state writer under the new grants.
2. Keep the repaired AVGAR account paused while extending captured-generation fencing to runtime jobs, generated briefs/artifacts, founder notes, intake and command admission. The context repair is already complete and must not be replayed. Retain the private recovery archive; do not decrease generation or relabel old output. Finish two-tab and delayed-work acceptance checks.
3. The concrete independent n8n execution reader is now implemented/tested. Resolve supported API access and least-privilege credential provisioning, then prove the actual saved-execution shape/read path before activation. Never substitute the expected revision or a current-workflow lookup. The compatible app/worker and receiver-secret release are already proven; neither is proof of a callable n8n lane.
4. Continue connection/refresh-owner, stored-data, scheduler, metric and security work from the register. Nguyen's first keyword wrapper is now delivered; the fixed origin and final revision need the small follow-up documented in Batch 9.
5. Bind D03-W01 only after its final configured revision, independent API read access, seed and admission/reconciliation gates. Then perform the real shadow round trip and expand verified lanes.

## Register status

No complete pilot has been claimed. B01's archived identity correction and run-bound SQL fence are live, but complete delayed-work fencing still gates unpausing. B02's prior matched release is proven; new runtime source needs release. B03's authenticated dispatch/revision-reader gate remains. B04 has Nguyen's first wrapper/denial delivery, with origin/final revision and Codex integration acceptance still pending. B05–B18 retain the split implementation/provider acceptance work documented in the register. B19 includes third-party channel approval/verification. B20–B21 require targeted security/retention evidence. B22 remains deliberately action-disabled. B23–B24 require independent tenant/customer acceptance.

Mark an item complete only after its stated acceptance evidence exists. A code test, running worker, database row, workflow screenshot or contractor report alone is not end-to-end proof.
