# Keyword shadow admission — source verified, not activated

5 September 2026, approximately 07:58 UTC. Full B01–B24 acceptance remains open.

## Outcome

The bridge can no longer dispatch an explicit keyword shadow call merely because it has a receiver URL/token and a configured execution reader. It also needs a **previously issued, durable, run-specific permit**. Neither the bridge nor the public authority endpoint issues that permit. Production has no permits, no registrations and no enabled routines.

`reserved → dispatching → provider_authorized → verifying → verified`

Failure may terminate as `refused` or `uncertain`. No state returns to `reserved`. An uncertain result may later become verified only through independent reconciliation; it never refunds permission to call the provider again.

- Issuance captures the account/generation, owning approver, exact run, registration ID/receiver URL, full spec/contract, spec fingerprint and an operator-chosen idempotency key. The same approved account/generation/key cannot be reused with a new run ID. Expiry is server-checked and capped at ten minutes.
- A single database update claims the dispatch before the webhook POST and binds SHA-256 fingerprints of the request and minted bearer. The bearer, receiver credential and API key are not stored in the permit.
- The frozen wrapper's existing authenticated `GET /api/n8n/shadow-authority` consumes that one allowance. The response JSON and receipt version contract are unchanged. This GET is deliberately non-repeatable and no-store: a lost response fails closed, not a second provider allowance. A future contract can use POST; this release does not ask Nguyen to rebuild his frozen wrapper.
- The database checks account pause/generation, current owner role, running dry-run identity/age, exact spec and active account-specific registration at issuance, dispatch and provider admission. A same-version draft edit is caught by full JSON comparison, not just the older non-cryptographic spec fingerprint.
- The reported execution ID is checkpointed before the independent execution read. A worker crash during verification leaves a named execution to inspect. The validated result is stored before returning an artifact to the engine. Failed/lost writes keep the allowance unavailable.
- Network, HTTP, parse and verification failures are conservatively uncertain unless a valid structured needs response is received. Uncertainty does not claim either provider success or zero cost. No automatic webhook retry.
- Original execution evidence may be finalized after pause/reset as an archived observation. It does not authorize fresh provider work or bypass the engine's current-context artifact/receipt persistence fence.
- New table/RPCs are service-only with RLS and explicit grants. Client roles cannot issue/read/consume permits; the service role has no direct DELETE permission. Scoped account deletion/cascade and retention still need the broader B21 acceptance.

## Verification

- **194 files / 2,350 tests pass.** Eight admission tests cover missing permits/registration, two independent bridge instances sharing storage, lost claim/transport responses, failed checkpoints/persistence, known-execution preservation and denial before paid provider work. Existing contract tests explicitly mock admission to keep testing their own transport/receipt boundaries; they are not admission proof.
- Application and worker TypeScript pass. Production webpack build passes. Lint: zero errors / 39 existing warnings. Diff checks pass.
- Real PostgreSQL rollback canary passes identity, owner/spec/registration revocation, pause, dispatch/authority single use, expiry, duplicate approved key across run IDs, immutable checkpoint, no rearming, unverified-result refusal, archived completion and grants. The first canary caught a fixture variable/column ambiguity; it was fixed without relaxing enforcement. Independent readback confirmed the failed transaction left no table/test account.
- Final independent readback **07:57:38 UTC**: staged permit table absent, zero synthetic accounts, AVGAR generation 1 / paused, zero registrations/enabled routines/AVGAR runs. No persistent DDL. Security advisors at 07:54 UTC remain six WARN/eight INFO; this is not a clean security sign-off. [Function exposure remediation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) remains tracked in B20.
- Canonical production health **07:57:39 UTC** remains source `00fc57cfd07b`, database healthy and worker fresh. No app/worker deployment, provider/model call, outgoing message, plan purchase, API-key creation or Nguyen workflow mutation occurred.

## Remaining activation/recovery work

1. Resolve supported saved-execution API entitlement and approved credential scope, securely reconcile receiver auth, and verify the actual API shape/retention/reader before issuing any live allowance. A configured key is not a healthy key.
2. Complete the operator's atomic pilot registration/run/permit issuance and approval/cost packet. The table is not an automatic spend allocator. No approval or arbitrary idempotency key may be generated by the model or an ordinary client request. Broader per-account currency-aware provider budget admission remains B18 work.
3. Finish a read-only reconciliation path for interrupted/uncertain dispatches and original result projection. The checkpoint/result ledger makes recovery possible; it does not yet prove unattended crash recovery or complete customer-visible status. Unknown execution IDs still require supported execution discovery, not another paid run.
4. Ship this migration with compatible app/worker after the other staged channel/schema dependencies and original AVGAR chat preservation are resolved. Do not deploy the entire branch against the current schema.
5. Run the approved keyword pilot separately per US/NZ/AU and independently join results/receipts in Unc. Live n8n/phone/browser and second-client acceptance are still unproven. OAuth-init/callback identity work was interrupted by the new Nguyen handoff and remains unfinished; its unused empty scaffold was removed.

Nguyen's corrected origin and saved refusal evidence are now independently checked in [the final handoff](integration/D03-W01-FINAL-PIN-2026-09-05.md). Do not request another origin fix or executing-version field.
