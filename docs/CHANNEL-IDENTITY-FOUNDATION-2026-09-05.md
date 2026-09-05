# Channel identity foundation — 5 September 2026

Status: **PASS for the bounded source/SQL rehearsal; PARTIAL for B01/B16/B19 and the full backend goal.** This is a source-only checkpoint. The migration is **not applied**, the new ingress/claim helpers are **not connected to the production routes/consumer**, and no app/worker deployment, provider call, channel message or n8n execution occurred. Do not enable messaging or remove AVGAR's pause based on this batch.

## Verified gap and intended behavior

Existing inbox rows contain provider events but no original tenant/context/link identity. `handleInbound` resolves a sender when processing starts. Telegram/WhatsApp, and Slack/Twilio when commands are off, also acknowledge before durable storage. The existing outbox sends before recording a durable claim; channel thread rows and reads are not generation-bound. These remain real gaps, not fixed by merely adding a column or checking identity once.

The prepared contract records identity on the **first durably accepted delivery**, before acknowledgement. It cannot reconstruct a network arrival that never reached storage. It retains:

- Account and context generation, separate from ordinary autosave revision.
- Verified link ID, database-managed binding revision and original app user.
- Linked / pending-code / unlinked classification, separate from customer-controlled payload fields.

A message accepted before reset/reconnection must not acquire the new identity. An unlinked arrival stays unlinked even if that number connects later. Existing verified links can survive an account context reset; only *new* messages use the new generation. Pending link codes instead carry their issue generation and cannot authorize a reset context.

## Prepared implementation

- `20260905053820_channel_inbox_identity.sql`: additive `binding_version` / `link_code_generation` on channel links and an immutable `binding` envelope on the inbox. NULL binding is legacy/unbound, never permission for a late account lookup.
- Database-managed link revisions increment for account/user/channel/destination/verification/code/routing metadata changes, including an A→B→A rebind. Display names, inbound timestamps and preference edits are not identity changes. Outbound processing must independently honor current preferences.
- Service-only **security-invoker** `accept_channel_inbound`: one transaction, duplicate-ID serialization, link/account row locks, current membership and workspace/pilot scope checks, database-derived identity. Reused event IDs with different content fail closed; duplicates retain the initial envelope.
- Service-only **security-invoker** `claim_channel_inbound`: claims one row with `FOR UPDATE SKIP LOCKED`; legacy unbound rows and stranded running claims become uncertain. Terminal rows cannot be automatically requeued. No lock spans a provider/model call.
- `acceptedInbox.ts`: explicitly projects adapter fields, waits for the durable receipt, canonicalizes JSON field order for comparison and never supplies provider payload fields as trusted binding values. Helpers are deliberately not wired into the legacy consumer yet.
- `binding.ts`: strict envelope validation; checks the original link ID/revision, sender membership, workspace/pilot scope and account generation. Unknown arrivals never resolve a new link. This is a short preflight, **not** an atomic side-effect or output-persistence guarantee. Pause is allowed only at this identity layer so STOP/unlink remains possible; processing must separately enforce automation pause.
- Link readers/writers expose the database-managed revision and pending code generation. Code issuance captures a fixed generation before later awaits; a conditional update prevents issuing onto a changed pending link. Verification helpers read back the stored revision rather than fabricating it locally.

## Evidence

- **186 files / 2,241 tests** pass, including 25 new binding/application-contract cases. Focused channel/inbox suite: 13 files / 121 tests.
- Application TypeScript, standalone-worker TypeScript, production webpack build and focused ESLint pass. No dependency changes.
- Real PostgreSQL rehearsal executes the staged migration and `scripts/verify-channel-inbox-identity.sql` in one transaction that always rolls back. It passes immutable capture, reset/rebind/ABA, original unlinked identity, workspace/pilot scope, pending/expired/stale code, textless button and lifecycle capture, terminal-state denial, sequential claim/replay and role tests.
- An initial rehearsal's final catalog assertion tried to cast a private-schema function name while running as service_role and correctly received `42501`. The fixture was changed to inspect catalog names without granting private-schema USAGE. All prior synthetic changes rolled back. A subsequent source review also fixed nullable code classification for textless events before expanding and rerunning the canary. No live migration required correction.
- The canary is **not simultaneous multi-session contention proof**, and neither fixtures nor SQL simulate a real provider message. Provider retry timing and cost/sending guarantees remain unproven.
- Fresh post-rehearsal readback: zero channel links/inbox/outbound rows and zero canary accounts; staged column absent. AVGAR generation **1**, pause **true**, revision **15** unchanged. Security advisors before rehearsal: six WARN/eight INFO; no persisted DDL was introduced.
- Canonical production health at **2026-09-05T05:45:23.284Z**: database healthy; app source `00fc57cfd07b`; fresh worker, 18 ticks, no last error. No runtime release was performed in this batch.

## Required continuation before release

1. Replace raw event processing with the immutable envelope. Persist every supported, authenticated ingress before success acknowledgement; never fall back to post-response raw processing when storage is unavailable. Apple remains a reserved 503 endpoint until its provider contract is approved/verified.
2. Consume captured pending codes atomically with generation/link revision/membership checks and scoped transfer. The current multi-statement `consumeLinkCode` is **not yet covered**, nor are OAuth/phone verification request generation and all relink/unlink races.
3. Carry the same identity through command dispatch, evidence/history reads, model waits, approvals, STOP/human-handoff and every channel thread write. Reject stale context without sending a fallback response. Generation columns/atomic persistence guards are still required on channel chat/output storage.
4. Add durable pre-network outbox claims carrying original generation/link revision. Handle ambiguous outcomes without automatic resend; fence WhatsApp queue release, proactive pushes and command notifications. No claim can cancel network I/O already underway.
5. Verify races/denials, compatibility and recovery across all paths. Apply this migration and subsequent writer guards only as part of that coordinated release; deploy/read back matching app and worker with all action flags still off.
6. Only after full B19 and provider/owner approval gates pass, request an explicitly bounded phone canary. The full 24-item backend register remains authoritative.

Recovery: retain old history, context generation and the restricted AVGAR repair archive. Do not fabricate a binding for legacy inbox rows or backfill their identity from today's account. The new source reads added link columns and therefore must not be deployed against the old schema. Old code issuers omit `link_code_generation` and will fail closed after this migration; coordinate their replacement before offering channel onboarding.
