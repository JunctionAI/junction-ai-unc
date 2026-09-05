# Manual execution admission — Batch 35 source checkpoint

6 September NZ / 5 September UTC. **PARTIAL, NOT DEPLOYED.** Previous batch deployed the editor; this batch implements manual start/validation/input admission and sends the newly authorized Nguyen message. The full B01–B24/all-client goal remains active.

## Implemented and checked

- Account/generation/owner/request-keyed journal, exact request replay, original captured run/spec/context and a two-step prepare/claim protocol. One claimed operation is never leased out again on timeout. Independent new starts are refused while an existing same-routine run is unresolved.
- Manual Run and editor Validate use the server's account and captured spec. Input resumes claim the original waiting snapshot with a database-managed monotonic input revision; they do not create another run. Keyword pilot is excluded and unchanged.
- Service-only security-invoker RPCs with RLS/no anonymous/member grants. Checks include actor, account generation, pause, selection, configuration revision and original run identity. Additional runtime checks stop further work after authority/settings changes; no SQL lock spans provider I/O.
- Read-only `/api/routines/request` reconciliation and versioned account/generation/purpose-scoped browser session journal. No automatic POST retries. Explicit prepared-request continuation keeps its original identity. The UI distinguishes unknown budget from an explicit zero.
- 208 files / **2,601 tests PASS** at 12:56 UTC (synthetic providers), with the 22 focused manual/client/inspector tests repeated after final hook cleanup. App/worker TypeScript and changed-file ESLint PASS after that cleanup. Production webpack build PASS at 13:00 UTC (compiled 2.6s, TypeScript 2.3s; complete route/build trace finished). React review identified synchronous effect updates; changed the journal hook to an external-store subscription.
- Real PostgreSQL transaction using staged migration + `scripts/verify-manual-admission.sql` passed twice, including the monotonic input-revision addition. Checks cover second-write rollback, original identity replay, reused-key refusal, owner/generation/pause denial, one claim and input resume on the original run. No provider/model call.
- Independent SQL readback: temporary table absent (DDL rolled back), zero canary accounts, zero routine runs, seven accounts and two memberships. No migration applied or production app/worker changed.

## Required before release — do not skip because tests pass

1. Finish negative-admission cancellation/recovery. A browser journal is saved before POST; a preflight rejection or lost request can currently leave no server row, so readback returns 404 and the UI correctly refuses to forget/restart it but has no safe cancellation action. Add an atomic cancellation tombstone so a delayed original request cannot arrive after a user starts a replacement. Prepared requests invalidated by new settings need the same safe cancellation path. **Do not clear the journal on 404 alone.**
2. Verify two different concurrent input request IDs against the same waiting cursor, including a provider returning identical needs/inputs; test that the monotonic input revision defeats stale resumes. Expand real PostgreSQL concurrency and client recovery acceptance, not just transport mocks.
3. Review and finish the legacy approval-resume route and any other bypasses; general worker/scheduled dispatch is not made idempotent by these new UI routes. Review terminal/uncertain provider outcomes and original-run reconciliation/restart separately.
4. Harden/minimize the browser journal (currently stores the supplied answer body in session storage), request shape/size and readback validation; retain context-safe late-response handling. Verify reload, cancellation, two-tab, paused and disabled browser journeys.
5. Repeat final app/worker TypeScript, complete tests, lint/build; apply the migration with security/readback checks; deploy a coherent release and prove the actual client journey. Production remains the prior editor release until then.

## New authorization and Nguyen coordination

Tom explicitly authorized Codex to create the n8n API key, securely store it in server environment configuration, and message Nguyen on Upwork. He subsequently explicitly confirmed upgrading if needed, after the €24/month plus tax monthly Starter price was explained. **Key creation and the Starter purchase are now approved.** Receiver rotation was not separately approved; native-agent OAuth approval is separate and unchanged.

Fresh signed-in n8n UI: trial with 9 days remaining; no n8n API settings item. Upgrade screen offers Starter **€24/month**, billed monthly, excluding applicable sales taxes, or Pro €60/month. After Tom's approval, selected monthly Starter and reached Paddle checkout: **€27.60 including €3.60 GST today, then €27.60 monthly, next 6 October 2026**. Account email/country already populated correctly. Payment step has empty card fields plus PayPal/Google Pay; no completed purchase or API key yet. Do not use browser-session auth as an API workaround.

**Message sent and independently visible September 6, 12:53 AM NZ**, in the existing [Nguyen Upwork room](https://www.upwork.com/ab/messages/rooms/room_0f100dc754d2a6f5f5ca732c0c6af987?companyReference=1701042640006557696&sidebar=true). The sent message:

- Confirms frozen wrapper XiXJKuph1fAeH9pe / 1bce8c54-637e-4770-af90-2da36f38369a and no redesign/version-discovery/republish request.
- States Codex owns API key/environment, supported saved-execution read, registration and run authority. Commercial entitlement still pending; no provider-test green light.
- Requests the existing Header Auth credential name/ID and whether bearer length is at least 24 with no whitespace. No secrets in chat; no rotation yet. Prior deployed worker value is 21 characters; equality remains unverified (not re-read this batch).
- Requests exact five proven/two blocked Email IDs against D05-W01–W07 mapping; separate backlink/Google Ads mappings/contracts remain Codex work.
- Keeps unavailable rights/data/margin/frequency/CMS lanes blocked, Shopify OAuth/Admin parked and all publishing/customer messaging/ad mutation/spend activation disabled. Authorized country tests remain golf travel bag separately for US/NZ/AU only after readiness.

The message is delivered, not evidence Nguyen has replied or integration is finished. No Upwork payment/milestone action was performed.
