# Approved Unc live release — 4 September 2026

Authority: Tom explicitly approved applying database/security updates and replacing the live backend, with publishing, messaging and ad changes disabled. No connector transfer, OAuth change, business goal edit, n8n workflow edit, GitHub push or external message was performed.

## Deployment

- Production project: `junction-unc`, `prj_WXwCzYpwmx9MmLBgqGrpWh8jnc6d`; canonical https://junction-unc.vercel.app/app.
- Final app LIVE: source `91d7ef60cde5`, deployment `dpl_4HDeQ79WtrZdnWVKzCpWFkyktTJp`, https://junction-ccopk919q-tom-junctionmedis-projects.vercel.app. Build READY in 27 seconds, promoted successfully; independent alias API readback confirms `junction-unc.vercel.app` targets this exact deployment.
- Prior release checkpoints: `bb20e0c` / `dpl_AAvzAbpGnbB8uGQ143UQExNUbJNB`, then `e1c32d9` / `dpl_3TJDz7pHRjwFda47zDzB75pivWFY`. The first fixed no-op save flight cleanup; final candidate additionally removes an empty-patch render loop that starved autosave.
- Existing Fly app `unc-worker`, machine `1857466fd76998` in Sydney, replaced in place. Image `registry.fly.io/unc-worker:deployment-01M1N91AEXTMADADNY8Q6FWKW7`, digest `sha256:3c028693f1fa5c8b6cc2fcfea9a4145cbe3f9463cad391a021134d506b6751d6`. Startup `2026-09-04T04:06:18.74Z`; fresh database heartbeat and no last error.
- In-container verification: correct Supabase project, messaging disabled, zero outbound adapters. Worker uses the backend release snapshot before the UI-only persistence fixes.
- Both app and worker: `UNC_COMMANDS_ENABLED=false`, `LIVE_MODE_ENABLED=false`, `UNC_MESSAGING_ENABLED=false`, `TNZ_SMS_ENABLED=false`, `APPLE_MESSAGES_ENABLED=false`. Production demo flag false. Webhook requests fail closed; channel UI buttons disabled. No credentials copied into a preview.
- Original production recovery reference: `dpl_H9MGF4UraVQQEhzN1QuaTjLGA2Lv`, source `4fc0d13304a1a8d0ff63fe727c834fdc576ad781`. Do not blindly roll back to a client version incompatible with hardened grants.

## Database and security

Project `ycgayfsvcjpsnryrpukv` only. Actual applied migration versions:

| Version | Name |
| --- | --- |
| 20260904035303 | llm_spend_reservations |
| 20260904035311 | routine_command_queue |
| 20260904035318 | apple_channel_preparation |
| 20260904035807 | harden_rpc_tenant_boundaries |
| 20260904035815 | owner_governed_runtime_tables |
| 20260904035822 | private_beta_admission |

Verified RLS enabled and client CRUD denied on new server-only tables; authenticated writes denied on runtime/connector control tables. Private model-budget, memory/playbook and account-provisioning RPCs denied to client roles. Owner account name/currency changes retain column-specific access; client monthly model-cap updates denied.

Real JWT/role-scoped read test: pilot owner sees 6 own connector rows and 0 other-account rows. Transaction rolled back. Service-role budget reservation canary passed and rolled back. Connector fingerprint unchanged: `4000137d5f520dab8fb041626e4449bf`; two encrypted connector secrets and seven accounts retained. Pre-change policy/grant inventory: `release-2026-09-04-policy-snapshot.json`; this is a reference, not permission to restore insecure grants.

Security advisors improved from 14 to 11 findings, not clean: 6 warnings and 5 informational notices remain. Remaining warnings concern the public-schema vector extension, exposed `accept_beta_invites`/`is_account_member` security-definer functions and disabled leaked-password protection. No broad extra grant or auth-setting changes were made. Server-only RLS-without-policy notices are expected fail-closed behavior.

Remediation references: [security-definer grants](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [extension schema](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).

## Fresh provider proof

Pilot `halltaylor.tom@gmail.com`, account `aa5cfc84-2569-4c99-9b40-67003ae55eda`. Existing connections only. Check `7699552e-60bd-4812-ae1f-cb083490346e`, completed `2026-09-04T04:06:05.494Z`: Shopify `avgar-sport.myshopify.com` returned 14 seven-day orders; Meta `act_3235248400060604` returned two seven-day insight rows with AVGAR-named ads/ad sets. Real provider provenance checked. The diagnostic blocks non-GET provider calls and database mutations; no customer detail or credential is in this receipt.

## Verification and remaining gates

- 170 test files / 1,975 tests PASS; app TypeScript PASS; worker build/import PASS; focused lint and whitespace checks PASS. Existing full-lint warnings remain.
- Real app model reply and durable chat reload PASS. Initial chat reload FAILED; the first autosave queue fix alone was insufficient. After the final no-op state identity fix, the canary `release check 1613` persisted as corner position 2 at `2026-09-04T04:12:30.61299Z`, with the real assistant reply at position 3 at `2026-09-04T04:12:37.10252Z`. Both were independently read from SQL and remained visible after navigating/reloading the canonical production URL. No routines or external actions requested by this canary.
- Final health read at `2026-09-04T04:11:56.576Z`: build `91d7ef60cde5`, database healthy, worker fresh (38 seconds), no worker error. Final deployment runtime error query returned no entries.
- Unauthenticated chat returns 401; messaging webhook returns 503 while disabled. Prior deployed runtime error query returned no error entries; this is not proof of configured alerting/drains.
- Remaining pilot gates: reconcile the saved Junction profile/old goal with actual AVGAR settings with Tom; GA4 missing connection; explicit command/n8n output/version/budget acceptance; phone provider/Apple acceptance. No claim that all advertised routines or channels are operational.
