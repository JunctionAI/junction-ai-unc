# Captured chat context: verified source, coordinated release pending

5 September 2026, approximately 06:50 UTC. This closes specific source/database-rehearsal gaps in B01/B03/B16/B19/B20/B24; it does not complete those items or authorize channel sends.

## Implemented

- Chat rows carry their original `context_generation` and external sender/link scope. Delivery dedupe is keyed by account, generation, channel, scope and provider message ID. A provider's reused ID cannot suppress another tenant or sender's message.
- The staged SQL trigger locks the account and rejects stale inserts/updates. Row identity, account, generation, thread, position, external ID/scope and original timestamp cannot be reassigned. Archived rows remain intact. Current app chat remains available while automation is paused.
- Atomic autosave uses the generation-specific position key and rejects chat payloads from another generation even if supplied with the latest ordinary save revision. Current-context snapshot loading excludes archived and non-app rows from browser autosave. Existing revision/replay/owner protection remains.
- Web chat supplies the captured generation to history reads and guards the context before commands/model work, after data/model waits and before accepting the result. A reset is a 409, not a canned success or memory-learning event. Paused setup still permits ordinary chat.
- Web chat reads the same customer conversation across app/phone/other linked channels. Other accounts, old generations and human-support threads are excluded. Browser-invented prior history is ignored. An already-saved final app input is deduplicated.
- Chat/status/history requests include the browser's captured account ID and generation; an explicitly different session account is rejected even if both generations match. The server remains the identity authority.
- Thread polling is a bounded current-context snapshot, not `since=server wall clock`: delayed commits with earlier timestamps are picked up. It retains app anchors, rejects overlapping polls and disposed requests, masks old identity rows immediately, and requires the response's identity to match. A maximum-500-row tail can include one preceding app anchor, using absolute app positions for long histories. Equal timestamps retain server ordering.
- Inbound/reply/command writers propagate their captured generation and original link scope. Proactive channel reads filter briefs/receipts/approvals by generation before limits and verify the run/context before a push. This is preflight/persistence isolation, **not** an atomic provider-send guarantee.

## Verification

- Full suite: **189 files / 2,290 tests passed**. Added route, model-boundary, delayed-response, wrong-account, cross-generation dedupe, current-only worker-read and long-thread-anchor cases.
- App TypeScript, standalone-worker TypeScript and production webpack build passed. ESLint: zero errors / 39 existing warnings. `git diff --check` passed.
- The schema-checked fake now models multiple ORDER BY keys and retired unique indexes. It does not emulate SQL trigger/lock/role guarantees.
- `scripts/verify-chat-context.sql` passed on real PostgreSQL inside a transaction containing the staged migration, then rolled back. It exercised current paused chat, archive preservation, cross-account/generation/sender dedupe, immutable identity, stale insert/update/save denial and private RPC access.
- The existing `scripts/verify-account-state-atomic.sql` passed with the new staged migration in the same rollback-only rehearsal, preserving save replay, owner/cross-account denial, late-error rollback and channel preservation. This is not a simultaneous multi-connection stress test.
- Two initial rehearsal-harness problems (an ambiguous local `body` variable and a restricted-schema `regprocedure` cast) were corrected without broadening grants. Independent checks after failed attempts found no test accounts or schema residue.
- **06:50:40 UTC** independent readback: zero canary accounts, zero staged chat columns, AVGAR ordinary revision **15**. **06:48:54 UTC**: generation **1**, automation paused, enabled routines **0**, n8n registrations **0**.
- Live security advisors currently report **six WARN / eight INFO**. No persistent migration was applied in this batch. The warnings are still a separate hardening gate; passing this rehearsal is not a security sign-off.

## Release order and remaining work

Do not deploy this source against the old schema or apply this migration piecemeal. It replaces old chat uniqueness and the atomic save/snapshot functions. The two staged channel migrations and this staged chat migration need a tested compatible app/worker rollout.

1. Reconcile legacy chat rows before the immutability trigger is installed. Default generation zero is archival, not permission to relabel all history as current. Preserve AVGAR's previously verified post-repair rows through an exact-row, provenance-checked backfill prepared for the coordinated release. No such backfill was executed here.
2. Complete the original channel-binding check at atomic persistence/outbox boundaries, including delayed STOP/handoff audit projection, membership/link reassignment, queued command notifications and uncertain provider-send reconciliation. The current send-before-ledger path and legacy WhatsApp queue are not accepted as durable exactly-once delivery.
3. Complete any remaining delayed learning/profile writes and paid-call admission fences. Generation checks alone do not hold an authorization lock across model/provider network calls.
4. Run a real two-tab/account-switch browser acceptance test and phone/channel acceptance under separately approved messaging authority. The polling tests exercise the real helper and server route with synthetic transport; they are not a real browser or SMS receipt.
5. Release a compatible app/worker/schema set and repeat canonical history/reload, denial and paused-controls readbacks. Keep all external-action flags off and retain rollback references.

n8n remains separate: final origin-configured revision, valid matching receiver credential, supported execution-reader access, registration and durable admission/reconciliation precede the authorized `golf travel bag` US/NZ/AU pilot. No workflow, plan purchase, API key, provider call or customer message was changed/created in this batch.
