# Review action execution — database installed, executor disabled

Approval alone is not execution. `runReviewAction` consumes an exact proposal only through a trusted, account/action/destination-bound adapter. No HTTP endpoint, scheduled consumer or real provider adapter is enabled by this module.

## Dispatch boundary

1. Check account release, connector ownership, agent policy and current context before claiming.
2. Transactionally lock account, approving owner membership, current output and proposal. Refuse pause, expiry, stale revision/context and missing owner approval.
3. Create one execution row per proposal. Even a same-token claim retry returns no ticket. A lost claim response requires reconciliation, not a second provider attempt.
4. Validate returned scope and the exact provider payload; check policy again. Adapter must validate its approved immutable assets and target before any write.
5. Make one provider attempt. Use `review-action:{proposalId}` for provider idempotency when supported. Never implement hidden transport retries for non-idempotent writes.
6. Independently read back the result. Persist succeeded only after confirmation; exceptions or unconfirmed readback become uncertain. A lost database completion response is also uncertain.

Claim is the dispatch boundary: a later hold cannot promise cancellation. The database rejects that decision change once claimed. This does not undo an action. The customer UI must display the execution state and disable misleading cancellation controls before release.

Result recording remains possible after a context change or pause because it records an existing attempt, not new authority. Repeated identical receipts are accepted; conflicting receipts are refused. Uncertain rows cannot be dispatched again.

Read-only reconciliation is implemented in `reviewReconciliation.ts` and the staged reconciliation migration. It verifies account/action/destination, makes one read-only provider check and records only positively confirmed success. Empty, missing or delayed results stay uncertain. The original attempt receipt is preserved; a separate append-only reconciliation row stores proof. There is no mutation callback, re-dispatch ticket, polling loop or automatic retry in the reconciler. Real provider adapters still must implement exact-resource/payload verification and read deadlines.

## Remaining release gates

- Migration installed as `20260908165411_review_action_execution` after full-schema rollback and five independent-session PostgreSQL concurrency checks. Readback confirms no execution rows, no anon/member read, no claim-token update grant, and the test account paused with zero cap. Advisors add only one expected service-only table INFO; warning counts unchanged.
- Read-only execution status is implemented in the staged RPC/API/UI, including dispatching/uncertain states; deployed/browser verification remains. No provider payload or claim token is exposed. Missing status from an older response disables decisions rather than assuming no execution.
- Implement concrete provider adapter with isolated sandbox/draft destination, schema/credential/asset checks and bounded deadlines. Never substitute a live client for missing sandbox access.
- Verify real provider readback, no duplicate mutation, stale/disabled refusal and reconciliation before enabling a consumer.
- Install the reconciliation migration after its release checks; it currently passes local SQL and real-schema rollback verification only.
- Per-agent automatic approval is not implemented by this path: it currently requires the existing owner approval record.

Tests use PostgreSQL WASM for SQL/role behaviour, independent PostgreSQL 17.10 sessions for races, and simulated adapters for TypeScript control flow. They are not proof of a live provider action. Supabase guidance informed invoker functions and explicit service-only grants: https://supabase.com/docs/guides/database/functions .
