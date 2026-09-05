# Durable channel outbox — verified source, not a messaging release

5 September 2026, approximately 07:12 UTC. Part of B16/B19/B20; the full B01–B24 register remains open.

## What changed

- A linked-channel send now persists an immutable operation before provider I/O. Identity includes account, business generation, original link ID/revision, user and destination (including Slack workspace). A stable operation reference, payload, buttons, reply context and delivery options cannot be replaced under that identity.
- A database claim verifies the original current membership/link/generation and pause state, then atomically assigns one attempt. Preferences, Apple human-handoff restrictions, quiet hours and the WhatsApp window are checked from database state at claim time. The first claimant owns the attempt; subsequent callers cannot send it again.
- Provider acceptance is recorded as sent; errors/timeouts are uncertain, not safe-to-retry failures. A provider accepting a message does not prove delivery to a device. A lost finalization response does not reset the durable claim.
- Actual delivery evidence remains attached to the original context even if the business resets or the connection is removed during I/O. The captured link ID and destination survive the existing nullable live-link foreign key.
- Only confirmed sends enter the shared conversation, deduplicated across channel copies by account/generation/kind/reference. Ordinary reply model/fallback metadata is retained. Queued and uncertain sends do not become fictional assistant messages or a delivered=true result.
- Bounded worker maintenance marks interrupted claims uncertain, expires old unsent operations, and repairs missed confirmed-history projections. It does not call providers or retry uncertain work, and can run while messaging is disabled. Old-context receipts are not projected into a replacement conversation.
- WhatsApp drains use the original stored payload and exact account/generation/link revision. Unbound legacy rows never gain current authority. Stable references were added to inbound replies, handshakes and the existing Slack welcome call.
- Production messaging is now fail-closed unless UNC_MESSAGING_ENABLED is explicitly true. This source change did not modify deployed environment values.

## Database rehearsal and important correction

New staged migration: 20260905065409_channel_outbound_claims.sql. It depends on the staged channel identity, inbound controls and chat-context migrations from Batches 12–15.

The first real PostgreSQL canary failed because the existing blanket account_automation_pause trigger prevented finalizing an already-started send after a pause. The migration now replaces only that table's INSERT/UPDATE pause behavior with a captured-binding/claim guard; the existing DELETE hold remains. New work is still gated, while original delivery facts can be persisted. No global pause bypass, public grants or security-definer RPC was added.

The corrected rollback-only rehearsal passed as actual service_role, anon and authenticated roles. It covered:

- Idempotent enqueue and single-winner claim, changed payload/options denial, original-attempt finalization and conflicting receipt denial.
- Immutable content/identity, unbound insert denial, cross-account and ABA connection reassignment denial.
- WhatsApp queue/window behavior with retained buttons; confirmed cross-channel conversation deduplication.
- Interrupted-attempt/expired-queue housekeeping and missed projection recovery.
- Reset between claim and receipt: old receipt retained, old queue cancelled, no new-context chat contamination.
- Connection deletion preserving captured receipt identity, plus actual RPC/client permission denials.

The SQL canary proves transaction/trigger/role behavior and repeated claims within one transaction. Application tests exercise concurrent callers; a simultaneous two-session PostgreSQL contention/load test is still additional release evidence, not claimed here.

All DDL and synthetic rows were rolled back. Independent **07:10:09 UTC** readback: zero outbox canary accounts, zero staged outbox/chat/link columns, zero outbound rows, AVGAR generation 1 / revision 15 / paused; zero registrations and zero enabled routines. No provider, model, message or n8n execution occurred.

## Verification

- 190 files / **2,310 tests pass**, including 20 new outbox cases.
- Application TypeScript, standalone worker TypeScript, production webpack build and diff checks pass.
- Lint: zero errors / 39 pre-existing warnings.
- Live security advisors at approximately 07:10 UTC: six WARN/eight INFO, unchanged. This is not a clean security sign-off; the staged functions are not installed in production.
- Logs: /tmp/unc-outbox-full-tests.log, /tmp/unc-outbox-build.log, /tmp/unc-outbox-lint.log.
- Repeatable SQL: scripts/verify-channel-outbox.sql, preceded by all four staged migrations in one BEGIN/ROLLBACK transaction with bounded lock/statement timeouts.

Supabase's [function privilege guidance](https://supabase.com/docs/guides/database/functions#function-privileges) informed the service-only RPC grants and actual client-denial tests. Outstanding [definer exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) warnings remain separate targeted work.

## Remaining release gates — do not activate messaging yet

1. Command notification identity, revision/source checks and outbox correlation are now covered by the subsequent [command-delivery source batch](COMMAND-DELIVERY-2026-09-05.md). They are not deployed or live phone-proven.
2. Replace the artifact-send route's timestamp-based operation reference with a stable user operation, captured business generation and original destination. Finish the remaining delayed/runless writer fences.
3. Capture Slack install identity at OAuth initiation through callback; the new welcome reference alone does not fix generation-zero fallback or late-install rebinding.
4. The unlinked-sender help path still calls its adapter directly. It needs durable, anonymous-arrival-scoped attempt handling; the connected outbox does not protect that path. Provider button acknowledgements are also outside this ledger.
5. Finish bounded resumption of unsent quiet-hours work and original business-object validity/expiry checks, including queued approvals. Never infer permission to send an expired or superseded proposal.
6. Implement provider-specific independent reconciliation/status evidence where supported. A timeout does not cancel an in-flight provider request; late results may remain uncertain until readback. There is no blanket exactly-once delivery guarantee and no recall of an already-started send after revocation.
7. Coordinate schema/app/worker release with exact provenance-checked preservation of AVGAR's current chat rows before enabling the immutable chat trigger. Do not deploy this source against the current schema or roll back blindly to the legacy ledger writer afterward.
8. Prove opted-in phone/web, disabled switches, cross-tenant/connection reassignment, restart and second-client acceptance on the released system. All publishing/messaging/ad/spend activation remains disabled.

The n8n origin/revision, receiver reconciliation, execution-reader access, registration and bounded paid-admission gates remain independently open as documented in the configuration readback. No plan purchase or broad API-key creation was authorized or performed in this batch.
