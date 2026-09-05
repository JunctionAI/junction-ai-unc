# Artifact context and delivery — verified source, not live

5 September 2026, approximately 07:39 UTC. Continues B03/B15/B16/B19/B20; the full B01–B24 goal remains active.

## Implemented

- Artifact API callers capture account ID and business-context generation. Account-mode routes require both headers, verify the session, and recheck context before returning results. Current artifacts are joined to their actual parent run and filtered before ordering/limits; an archived run cannot enter the current listing by being newer.
- A database-owned artifact revision advances on meaningful changes. Production decisions require the revision the browser actually inspected. Owner, account, parent-run generation, pause and revision checks plus artifact update, taste event and receipt now execute in one invoker-rights transaction. Two edits that both say `edited` cannot silently overwrite each other. Optional decision memory carries the captured generation; its failure does not erase the atomic decision receipt.
- A founder-requested copy has one durable request per account/generation/user/artifact/revision/channel. This is deliberately one copy per version/channel, not a resend button. Concurrent clicks, reloading and retrying reuse that request. A changed version requires a new deliberate click.
- The first accepted request stores its exact payload and outbox IDs for the requesting owner's verified destinations only. Another member's link is not selected. Retries do not reselect today's links or add a replacement device. Missing original evidence fails closed.
- Delivery resumes the original outbox ID. The atomic send claim checks original connection identity plus the artifact's current revision/status and current owner. Held, superseded, revoked or rebound work cannot become a send to a replacement destination. The original acceptance receipt survives a reset/unlink; it is not projected into the new context's conversation.
- Queued, sending, uncertain, cancelled and provider-accepted results are reported separately. The UI no longer labels queued work sent or provider acceptance as confirmed device delivery. A synchronous click guard prevents repeated in-flight clicks. Identity/version-keyed components discard disposed or mismatched decision responses.
- Apple proactive artifact delivery remains unsupported/hidden in the initial pilot. Messaging's release flag and account pause remain enforced. No change authorizes publishing or any customer campaign.

## Schema and compatibility

Staged migration `20260905072651_artifact_delivery_context.sql` follows all five staged channel identity/control/chat/outbox/command migrations. It adds the artifact revision, service-only current-context listing/decision/preparation RPCs, a server-only RLS-protected immutable delivery table, and an artifact-source send-claim trigger. Existing browser artifact column-update privileges are revoked; the owner route supplies atomic decision authority instead. No new definer privilege or client delivery-table grant is introduced, following the Supabase [function privilege guidance](https://supabase.com/docs/guides/database/functions#function-privileges).

Deploy the schema and compatible app/worker together after the wider release gates pass. The old artifact route's timestamp send reference is not compatible with the new source verification. Do not release this source against the old schema or restore the old route after applying it.

## Verification

- **193 files / 2,339 tests pass**. Includes 11 new delivery tests, four callback-lifecycle tests, expanded account-route denials, and store/schema regression coverage.
- App and worker TypeScript, production webpack build and diff checks pass. Lint: zero errors / 39 existing warnings.
- Four real PostgreSQL canaries pass together in one rollback transaction: existing outbox, command-context, command-delivery, and new artifact-delivery checks. They cover revision CAS, atomic decision/receipt creation, stable original request/payload, rebind/held/owner/reset denials, captured receipt preservation and actual authenticated RPC/column privilege denial.
- The first artifact SQL run failed because its synthetic fixture used an unsupported run status (`drafted`). Corrected the fixture to the actual `done` status and reran; no production constraint was weakened.
- Independent readback at **07:37:33 UTC**: zero synthetic canary accounts, zero staged artifact revision columns, no staged delivery table, zero commands/outbound rows; AVGAR generation 1 and paused. All rehearsal changes rolled back.
- Live advisors at 07:35 UTC remain six WARN/eight INFO. These are not a clean security sign-off. Outstanding items include [definer exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Logs: `/tmp/unc-artifact-full-tests.log`, `/tmp/unc-artifact-lint.log`, `/tmp/unc-artifact-build.log`. Reproducible SQL: `scripts/verify-artifact-delivery.sql`.

Application fixtures and the bounded React hook harness are not browser/device acceptance. Concurrent application tests are not a multi-session PostgreSQL load test. No persistent migration, deployment, real provider/model call, live message, workflow edit/execution, credential creation or purchase occurred.

## Remaining work

OAuth initiation/callback identity, anonymous reply journaling, queued non-command/non-artifact source expiry, general delayed delivery recovery, remaining delayed/runless writers and readers, and actual provider uncertainty reconciliation remain open. Receipt-based legacy home previews are not certified by the artifact listing tests. A later revocation cannot recall provider I/O already in flight.

Before coordinated release: preserve current AVGAR chat rows with verified provenance, complete remaining entry-point coverage, then run real signed-in/browser/phone and second-client acceptance. No channel or whole-product readiness is claimed here.

n8n receiver reconciliation, supported independent execution-reader access, final origin-configured revision, registration and bounded paid-call admission remain separate open gates. Nguyen's frozen workflow has not been edited or executed. Publishing, messaging, ad mutation and spend activation remain disabled.
