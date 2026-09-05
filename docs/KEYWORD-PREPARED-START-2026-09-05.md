# Keyword pilot: recovery before the first start

Status at approximately 09:34 UTC, 5 September 2026: source verified; private database helper applied; matching app and worker released. No real pilot has been issued or run.

## Deploy result

| Field | Verified result |
|---|---|
| URL | https://junction-unc.vercel.app/app |
| Target / status | Existing production project / READY and promoted |
| Source | `dc349188ec326d4e7b42318d44109b469c53b7e8` |
| Deployment | `dpl_DuvSLuycvCBiuoNA7dAqkaxrRjvY` |
| Candidate | https://junction-kx6t10g8x-tom-junctionmedis-projects.vercel.app |
| Framework / build-to-ready | Next.js 16.3.4 / 40.787 seconds |
| Worker | Existing machine `1857466fd76998`, release 17, Sydney |
| Exact image | `registry.fly.io/unc-worker@sha256:94bddaa45d1adfa0715f477708b101cf7961eece90107b1f6c82dc17f1834fcc` |

Built from clean detached checkout `/tmp/unc-start-release.VCrfRV`, excluding the unrelated untracked `src/lib/runtime/context 2.ts`. The candidate used production configuration with `--skip-domain`; health and unauthenticated connector-state 401 passed before promotion. Canonical health stayed on Batch 24 until promotion. Worker image build/push preceded replacement of the existing machine only. No secret, action-flag or Nguyen workflow changes.

Canonical health at **09:32:52 UTC** reports `dc349188ec32`, healthy DB and the fresh restarted worker. Worker public and loopback health independently report full `dc349188ec326d4e7b42318d44109b469c53b7e8`; ticks advance from 1 to 2 at 09:33:42, with zero runs. Live machine inventory reports the exact image, release 17 and all five command/messaging/live/SMS/Apple flags false. Canonical Apple webhook POST refuses with 503 `apple_channel_not_ready`; unauthenticated connector-state GET refuses with 401.

Signed-in browser reload shows AVGAR Sport, the existing owner, two dated verified Meta/Shopify connections, zero routines on and the setup hold. No model request, reconnect, account edit or routine run was made. Independent SQL at **09:33:23 UTC** retains generation 1 / paused and zero permits, runs, registrations and enabled routines.

Post-deploy error/fatal scan for this deployment since 09:30 UTC returned zero entries. This is a bounded scan, not continuous monitoring. The last drain inventory (Batch 24) was empty; drain inventory was not refreshed here. `vercel drains` is unsupported by the installed CLI, so no successful fresh inventory is claimed. Previous compatible rollback references: app `dpl_9TaGizmQnEutAP9BMq3kZTaPzaAP`, worker image `9b6af2ed73512da004240225900e5b1c07a23649cf6d47a5fb31c833c68bde95`. No rollback performed.

## What changed

Issuance already reserved the registration, original run and one-call allowance atomically. If its response was lost, a second issuance correctly returned the original IDs but there was no supported way to start that untouched run.

Initial starts and `recoverPreparedKeywordShadowPilot(deps, originalRunId, originalGeneration)` now share one database claim before the engine performs any read. Recovery uses the saved run/spec/context and existing allowance, never a second `runRoutine` invocation. The application compares the full reviewed specification, not just a hash. The database locks and verifies the exact saved snapshot, current owner/account/generation/pause, registration, original country/seed/revision, expiry and unused permit.

The `keyword_claim_v1` marker excludes legacy snapshots, which cannot prove that the old runtime had not started. A successful claim changes `keyword_start` to `keyword_started`. A competing claim returns false; an ambiguous/lost claim response is not a lease and is never reclaimed by timeout. Before the provider step, the existing `keyword_shadow` checkpoint takes over. Previously implemented saved-execution verification and atomic original-run completion are unchanged.

The helper is SECURITY INVOKER, with execution granted only to `service_role`. No browser, chat, scheduler or public callback imports the recovery entry. It cannot enable switches, unpause AVGAR, renew approval, change credentials or modify Nguyen's wrapper. Recovering an untouched, still-approved run can perform its original provider work: it is not an archive-only diagnostic command.

## Evidence

- Full suite: **198 files / 2,476 tests pass**, including 18 added start-claim/recovery cases. App and worker TypeScript, production webpack build, and diff checks pass. Lint: zero errors, 39 existing warnings.
- Tests cover a lost issuance, original identity preservation, competing recovery callers, initial claim-before-I/O, lost claim reply, non-boolean/false claims, missing claim wiring, legacy/already-started/partial/changed snapshots and context refusal. Concurrency tests use an application/database seam, not two live SQL sessions.
- `scripts/verify-keyword-shadow-prepared-start.sql` passes against real PostgreSQL under `service_role` in a rolled-back transaction. Its 13 refusal scenarios cover pause, removed owner, disabled/repointed registration, wrong account/run/generation, changed/legacy/partial/started snapshots, a dispatched permit and expired approval. Original start wins once; it creates no new run, receipt, artifact or paid allowance.
- Migration source `20260905092340_keyword_shadow_prepared_start.sql` was applied as live migration **20260905092758**, name `keyword_shadow_prepared_start`. Timestamp differs because the deployment tool assigns it; do not blindly reapply by source timestamp.
- Independent **09:29:04 UTC** readback: AVGAR generation 1, paused, zero permits/runs/registrations/enabled routines. RPC execution: anon false, authenticated false, service role true. All canary fixture changes rolled back.
- Security advisors report six warnings and twelve informational entries. The new helper is not flagged. The informational no-policy entries are intentional server-only tables, not a reason to grant browser access. Existing [public-extension](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [anonymous security-definer](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated security-definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) warnings remain separate security work; no broad role/RLS changes were made.

## Still required

This is **not** B16 or the full B01–B24 completion. An interruption after the start claim but before provider dispatch is deliberately not auto-resumed. A missing webhook response/checkpoint still needs supported execution discovery; no provider replay is allowed. Operator tooling, monetary policy and customer-command acceptance remain separate from this bounded module.

Live provider acceptance still requires supported authenticated n8n execution access, receiver-secret reconciliation, explicit run approval and current unpaused context. No plan purchase, API key creation, real provider/model call, message, n8n mutation or client activation occurred. Nguyen's frozen wrapper/revision and requested contract are unchanged.

Logs: `/tmp/unc-keyword-start-tests.log`, `/tmp/unc-keyword-start-build.log`, `/tmp/unc-keyword-start-lint.log`, `/tmp/unc-keyword-start-vercel.log`, `/tmp/unc-keyword-start-worker-build.log`, `/tmp/unc-keyword-start-worker-deploy.log`, `/tmp/unc-keyword-start-deploy-errors.jsonl`.

The n8n error-handling guidance informed explicit uncertainty handling rather than blind paid retries. Supabase guidance informed the private invoker RPC and rollback verification; deployment/browser guidance informed clean-source promotion and signed-in readback.
