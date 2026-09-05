# Keyword shadow recovery — private archive, not customer completion

5 September 2026, approximately 08:11 UTC. Source and rollback tests pass; not deployed.

**Subsequent update:** [Batch 21 atomic completion](KEYWORD-COMPLETION-2026-09-05.md) adds the original customer artifact/review/receipt/run commit path for both normal success and recovery. Archive-only remains the operator default; `--complete-original-run` explicitly requests projection. The historical limitations below describe this batch; live/browser acceptance and unknown-response discovery remain unproven.

## What changed

The bridge now atomically checkpoints the reported execution ID **and the validated business response** before attempting independent verification. Previously an interrupted verification retained the ID but lost the response needed to recover its artifact.

- `n8n_shadow_candidates` is a private, immutable, at-most-256 KB response checkpoint keyed by the original permit. It stores the parsed keyword artifact and validated reported receipt, not the raw webhook envelope, headers, data bearer or execution API response. Root artifact metadata is discarded; supported item metadata/evidence remains business data and is subject to the outstanding retention/privacy acceptance.
- `checkpoint_keyword_shadow_result` locks the original permit, accepts only its authorized provider phase, records the original account/generation/run/start time, and moves it to `verifying` in one transaction. Invalid/duplicate responses cannot partially commit or replace the original. No new allowance is issued.
- `reconcileKeywordShadowArchive` retrieves that exact permit/checkpoint and independently reads only the named saved n8n execution through the existing pinned GET-only reader. It verifies actual revision, original request digest/account/run/routine, terminal success, reported provider receipt and original dispatch/authorization window. It persists a verified **archive result** in the original permit, with independent readback.
- Historical reconciliation validates the original receipt against the saved execution's completion time. It retains original execution/provider timestamps and records today's `verifiedAt` with `method: historical_reconciliation`. The normal webhook's 15-minute freshness test remains unchanged. Old data is not labelled freshly fetched.
- Concurrent reconcilers and a lost commit response read back the first durable result. No overwrite, allowance refund, webhook retry, model fallback or provider redispatch.
- A pause/reset or removed registration does not erase already-observed historical evidence. The result stays in its original generation; recovery does not update a replacement business, re-enable anything or contact a customer.

The Supabase/n8n security skills guided explicit service-only grants, immutable checkpoints, no credential copies and separate read-versus-dispatch authority. There is no n8n wrapper change or new receipt field required from Nguyen.

## Operator entry point

Compile the worker with `npx tsc -p tsconfig.worker.json`, then run `scripts/reconcile-keyword-shadow.mjs` only under privately injected approved server configuration. It requires an exact `--permit`, `--original-generation` and `--persist-verified-archive`. Never infer the original generation from the current account. The command prints identifiers/status only and returns `projected: false` and `providerDispatches: 0`.

This command is **not scheduled, not exposed as a public route, not enabled in production and has not been used on a live provider execution**. It needs the staged schema, supported n8n API access and separate configured reader. It neither purchases a plan nor creates credentials. The owner decision requested in Batch 19 remains pending.

## Verification

- **195 test files / 2,379 tests PASS**, including 29 new recovery cases. A combined synthetic bridge → failed verification → recreated recovery adapter case makes one webhook POST total and restores the original verified archive. Other cases cover stale/future/invalid timing, wrong revision/digest/account/generation, missing checkpoint/reader, invalid/oversized artifact, concurrent recovery and lost/failed commit responses. These are not real provider E2E receipts.
- App TypeScript, standalone worker build and production webpack build PASS. Lint zero errors / 39 existing warnings. Diff checks PASS.
- Real PostgreSQL rollback canaries for admission and recovery pass together. They cover premature/invalid/cross-run/echoed-version/oversized checkpoints, atomic rollback, immutable identity, duplicate refusal, retention after reset, no customer projection and private grants. An initial canary failed because a fixture rename altered an RPC name; that test error was corrected, with no guard relaxed. Independent readback after the failed transaction confirmed no leftovers.
- Final independent database readback **08:10:50 UTC**: both staged tables absent, synthetic accounts zero, AVGAR generation 1 / paused, registrations zero, enabled routines zero, AVGAR runs zero. No persistent DDL. Live security advisors at **08:10:28 UTC** remain six WARN/eight INFO, not a clean security sign-off.
- Canonical health **08:11:01 UTC**: production still `00fc57cfd07b`, healthy database, fresh worker, no worker error. No app/worker deployment, provider/model call, outbound message, workflow mutation, purchase or API-key creation occurred.

## Remaining work — do not call B16 complete

1. **Customer-visible completion/reprojection:** join the recovered archive to the original engine run/artifact/receipt atomically and idempotently, preserving its continuation and current-context fence. The present recovery deliberately does not call `runRoutine`, resume the engine, mark a failed run done, create customer artifacts/receipts or notify anyone. It cannot yet fix the UI's failed/running state by itself.
2. **Unknown/lost response:** if the webhook response or checkpoint commit was lost before the candidate was durably stored, this path refuses. Supported saved-execution discovery/result reconstruction and retention acceptance remain necessary; never repeat the paid run to recover missing evidence.
3. **Live access/registration/admission:** approved API entitlement/key scope, matching receiver auth, actual saved-execution schema acceptance, atomic pilot run/registration/permit issuance and bounded cost authority remain prerequisites. Then perform the separately approved US/NZ/AU tests.
4. **Coordinated release:** eight staged migrations now accompany the branch. Recovery depends on `20260905074645_keyword_shadow_admission.sql` plus `20260905080359_keyword_shadow_recovery.sql`; the full branch also needs the six earlier channel/chat/command/artifact migrations and provenance-correct preservation of AVGAR's original chat. Do not deploy source against old schema.
5. Full B01–B24 acceptance, including OAuth callback identity, source-data coverage, metric/provider proof, retention/restore, phone/browser and second-client tests, remains active. A recovered revision/identity receipt is not independent validation of every provider metric or a customer launch receipt.
