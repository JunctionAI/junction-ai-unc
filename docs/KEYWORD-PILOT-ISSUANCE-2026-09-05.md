# Keyword pilot issuance — original implementation record

**Current update, 09:34 UTC:** issuance is deployed; the [prepared-start recovery release](KEYWORD-PREPARED-START-2026-09-05.md) adds a one-use claim shared by initial starts and explicit recovery of untouched runs. The source-only/deployment statements below describe the 08:38 snapshot, not current deployment status. Live n8n acceptance remains unproven.

5 September 2026, approximately 08:38 UTC. B01–B24 remain the full goal. This advances B04/B13/B15/B16, not customer acceptance.

## Implementation

`src/worker/issueKeywordShadowPilot.ts` provides an operator-only first-test entry, not imported by any browser route, model tool, channel handler or scheduler. The operator must supply the existing owner identity, actual approval reference, original idempotency key, captured generation, one market, a one-DataForSEO-call allowance and expiry within ten minutes. The module never invents approval, keys, entitlement, monetary caps or retry allowances.

It pins AVGAR, `golf travel bag`, `avgarsport.com`, English and Nguyen's frozen `XiXJKuph1fAeH9pe` / `1bce8c54-637e-4770-af90-2da36f38369a`. US/NZ/AU use 2840/2554/2036 respectively. The provider's [location examples](https://docs.dataforseo.com/v3/keywords_data-bing-keyword_performance-locations_and_languages/) corroborate country codes, not live wrapper coverage/results. The actual saved website is `https://avgarsport.com/`; the entry/SQL accept that canonical representation or its bare/unslashed equivalent without rewriting the profile. The workflow contract remains a bare domain; unrelated hosts/paths are refused.

The engine captures the initial full spec/context before connector work. The service-only `issue_keyword_shadow_pilot` transaction:

1. Locks AVGAR and checks unpaused generation, owner membership, saved website/currency/budget and the exact frozen business contract.
2. Validates the original six-node manual keyword read/draft pipeline and empty initial execution context.
3. Returns original run/permit IDs for an already-issued approval. A different country/spec/approval cannot reuse its key.
4. Creates the account registry row if absent, or reuses an exact active matching row. Disabled/changed registrations are refused, never reactivated or overwritten.
5. Creates the original dry-run plus one-use permit with immutable, allowlisted approval metadata atomically.

Only the first successful issuance response starts the existing engine; the engine does not create the same run twice. Failed/lost replies stop before connector/provider work. A retry raises `KeywordPilotAlreadyIssued` with the original identity rather than restarting even a still-reserved run.

A unique account/routine registry index prevents duplicate bindings. The RPC is `SECURITY INVOKER` with explicit service-only grants, following [Supabase function security](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker). No client grants or definer shortcut were added. An ordinary built-in produce-step registration cannot call the reserved receiver without the explicit shadow contract/permit.

The original optional Search Console/Shopify reads, draft review and final receipt remain; none is silently skipped or replaced with synthetic business output. The one-call bound concerns DataForSEO, **not a currency-denominated cost cap or permission for ad spend**. The entry does not enable switches, promote/edit live or draft specs, schedule anything, unpause AVGAR, buy access, create keys or mutate Nguyen's workflow. It is an operator canary, not finished customer command dispatch.

## Verification

- **197 files / 2,430 tests PASS**, including 32 new approval/market, original-run, duplicate/lost-response, field-projection, receiver fallback, website, pause/context and configuration tests. Mock RPCs prove application wiring only.
- App TypeScript, worker compilation, production build and diff checks pass. Lint: zero errors / 39 existing warnings.
- Real PostgreSQL admission/recovery/completion/issuance canaries pass together in one rolled-back transaction. The issuance canary tests the actual hard-pinned AVGAR function and compiled canonical spec. It locks the account row; the temporary test-only unpause is never visible outside the transaction. All synthetic runs/registrations/allowances are rolled back; no provider/model/network work occurs.
- SQL tests prove tenant/owner/pause/generation/seed/revision/currency/market/expiry/snapshot denials, separate US/NZ/AU allowances, same-key refusal, immutable approval metadata, no registration reactivation or switch enablement, and rollback of a registry insert when the subsequent run insert fails. This is not simultaneous multi-connection stress or live workflow proof.
- Independent **08:38:12 UTC** readback: AVGAR generation 1 / paused; zero registrations/runs/enabled routines/canary accounts; staged shadow tables and issuance RPC absent. No persistent DDL/account changes remain.
- Canonical **08:38:14 UTC** health: `00fc57cfd07b`, healthy DB/fresh worker. No deployment, workflow mutation, provider/model call, outgoing message, purchase or key creation occurred. Security advisors remain six WARN/eight INFO; existing [function-exposure warnings](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) are not closed by source-only work.

## Remaining gates

1. Approved n8n API entitlement/key scope and actual saved-execution read proof. Configured access is not healthy access; the owner plan/key decision remains unanswered.
2. Securely reconcile receiver auth. The previously observed 21-character worker value was not printed, changed or accepted by weakening validation.
3. Coordinate **ten** staged migrations with app/worker and provenance-correct preservation of existing AVGAR chats. Do not deploy source against the old schema.
4. Finish remaining context/queued-work/OAuth identity safeguards before unpausing. The pilot request cannot clear that hold.
5. Execute/read back the actual three market tests, then customer chat/switch/reload, phone and second-client acceptance.
6. A lost reply immediately after issuance leaves a `keyword_start` snapshot and reserved permit. There is no automatic resume/new-key retry. Inspect original records; operator pre-start recovery still needs implementation. Missing webhook-response/execution discovery and unattended recovery also remain unfinished. No uncertainty path grants another paid call.

Batch 21's previously pending source was independently confirmed on GitHub as `b0d665b139aa5022517611b915639b5967b8532c` before this batch. The live source is still `00fc57cfd07b`; source publication is not deployment or execution proof.
