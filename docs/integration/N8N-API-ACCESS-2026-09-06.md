# n8n execution-read access — 6 September NZ

**PASS: the API-access dependency is cleared. Not a completed keyword pilot.** Tom confirmed the approved plan purchase. A dedicated server-only key was created through the authenticated Cloud UI with exactly `workflow:read`, `execution:read` and `execution:list`. Expiry: `2026-12-04T11:00:00.000Z` (5 December NZ). The ungranted users GET returns 403; no mutating permission probe was performed.

## Independent worker readback

`verify-n8n-worker-access.mjs` passed at `2026-09-05T13:24:01.999Z` on `unc-worker`, machine `1857466fd76998`, release **20**. The existing image remains `registry.fly.io/unc-worker@sha256:d882624a87f8d270973bfd574a068eced262fc9917c66d721c69e277d5babab3`. All five external-action flags remain false.

- Workflow `XiXJKuph1fAeH9pe`: GET 200; current and published revision both `1bce8c54-637e-4770-af90-2da36f38369a`.
- Saved execution **75**: GET 200, 29,391 bytes. Actual top-level `workflowVersionId` matches the pin. Saved webhook node `c934c229-1191-43b7-b035-5fc641fbe0d0`; POST `unc/d03-w01/keyword-shadow`, Header Auth. This is a **manual refusal test**, with no DataForSEO node executed, not authorized Unc provider execution.
- Saved SEO execution **59**: GET 200, 865,328 bytes; workflow `OUerIfgAkMnhkuen`, saved revision `cda63062-b8c5-4f3a-a718-a71bd6e1040f`, manual/success. Historical provider evidence, not Unc E2E.
- Credential reference obtained without its value: `Unc — AVGAR shadow receiver` / `Y9Xu3zApLSrcWu1e`.

## Storage and release

The key is stored as a **Sensitive Vercel Production variable** and deployed as a Fly secret. Five companion variables hold the API base URL, wrapper/node pins, expiry and `N8N_EXECUTION_READER_ENABLED=false`. No secret appears in source, receipts or chat. The browser's own Copy/clipboard path supplied the real key; the DOM input value was not the API key and produced an initial 401. The subsequent actual-key read and worker readback pass. Clipboard cleared after secure transfer.

Vercel Secret values cannot be pulled by `env run`; the verification attempt failed closed without changing protection. **The production application has not been redeployed with the new variables yet.** Worker acceptance is independently proven; app runtime acceptance is still pending. No registration, dispatch, provider run, workflow edit or action activation occurred.

## Handoff and next gates

Nguyen was messaged on Upwork at **1:25 AM NZ**, with sent-message readback. Requested only receiver format confirmation (at least 24 characters, no whitespace; never paste it) and exact five proven/two blocked Email IDs. No rotation, redesign or republish requested. The prior Unc receiver length was 21: equality/format reconciliation remains open, along with coherent app configuration release, account-specific registration and valid run-scoped authorization. Reader and paid dispatch remain disabled until those pass. Then perform separate `golf travel bag` US/NZ/AU shadow tests.

### Reply and masking correction

Nguyen replied at **1:26 AM NZ**: same credential reference, reported 54-character/no-whitespace bearer, no rotation. Email: W01 #63, W03 #69, W05 #70, W06 #71 and W07 #62 proven; W02 requires contact_frequency_cap, W04 requires margin_floor. Recorded as his workflow evidence, not Unc E2E.

Codex subsequently inspected the existing credential through the supported UI without saving/changing it; the stored plaintext is not exposed. Official n8n source defines `CREDENTIAL_BLANKING_VALUE` as a **54-character** sentinel and substitutes it for stored password data before returning it to clients. Therefore the reported length **might be the masking sentinel**, not the real secret. This is an inference pending Nguyen's clarification, not a claim that the actual credential is missing/corrupt. Codex sent him the exact distinction and asked whether he checked the original securely retained value or redacted field, without asking for a secret in chat. No masked value was staged as a real receiver token.

Primary source: https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/constants.ts and https://github.com/n8n-io/n8n/blob/master/packages/cli/src/credentials/credentials.service.ts (redactValues). Any eventual replacement must be coordinated across the exact dedicated n8n credential and Vercel/Fly, not a workflow redesign or provider credential rotation.
