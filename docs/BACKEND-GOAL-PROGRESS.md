# Backend goal execution ledger

Active goal: complete the acceptance gates in `BACKEND-COMPLETION-PLAN-2026-09-05.md`.
Started 5 September 2026. This file records progress; it does not replace the 24-item register.

## Current boundaries

- Nguyen owns n8n delivery. Do not edit, activate or execute his workflows while he is working. Integrate after his acceptance packet arrives.
- Keep publishing, customer messaging, ad mutation and spend activation disabled. Phone verification/provider approval and outward-action approval remain separate gates.
- Confirmed business inputs: US, NZ and AU; CPA ceiling 50% of the relevant product price. Seed keyword, product/currency binding and a scaling target are not inferred.
- Account: `aa5cfc84-2569-4c99-9b40-67003ae55eda`. Existing Shopify/Meta credentials stay on that account; no transfer or reinstall.

## Batch 1 — context integrity (source changes, not deployed)

Fresh database inspection confirmed the mixed identity goes beyond the business name: the stored website, scan, plan narrative, commercial baseline and onboarding memories describe Junction. The stored goal also has a past year-2000 deadline. These are **not verified AVGAR settings**. No live context rows were overwritten during this inspection.

Implemented:

- Signed-in ordinary chat rebuilds context from the session account's database rows. A stale or fabricated browser context cannot override business, switches, approvals or receipts. Failed canonical reads return an error before paid model work. Onboarding retains unsaved draft input and cannot dispatch routines.
- Shared account-facts loader supplies the same tenant-scoped connector evidence, switches, plan and receipts to browser and server; the new canonical path does not drop existing connection/receipt evidence.
- Default server hydration uses an empty real-account seed rather than the demo founder. Missing margin remains null; cleared deadline/team/chat state cannot reappear from a stale seed.
- Authoritative routine facts take precedence over optimistic browser switch state.
- Chat includes the persisted website/business profile. Missing targets/budgets/hours are unknown, explicit zero stays zero, and historical baselines are not represented as current performance. Demo-clock pace projections and rollout weeks are excluded from real-account chat.
- Added regressions for browser spoofing, cross-account fact/receipt exclusion, database outage, empty-account hydration, cleared values and unknown/zero numeric cases.

These repairs advance B01, B08, B14 and B23 but **do not close their live acceptance gates**. They do not fix all stale autosave races.

Verification for this batch: 175 test files / **2,065 tests pass**; application and standalone worker TypeScript pass; production webpack build passes. No application/worker release, provider request, n8n execution or database mutation was performed in this batch. Production profile repair remains outstanding.

## Next independent work

1. Make the context repair recoverable and resistant to an already-open stale browser: implement/test atomic version-checked persistence or an equivalent enforced save boundary before changing the live profile. Existing autosave currently writes sections sequentially and can restore stale context.
2. Preserve the original Junction context in a restricted audit/restore record. Correct the pilot profile/resources and invalidate wrong-business memories, plan and cached narrative without inventing AVGAR commercial settings. Inspect chat summaries and memory extraction so old chat cannot relearn the removed business facts.
3. Release the compatible app/worker pair, reconcile staged receiver configuration safely, and verify no action controls changed.
4. Continue connection/refresh-owner, stored-data, scheduler, metric and security work from the register while Nguyen delivers the first keyword wrapper.
5. Bind D03-W01 only after actual webhook/revision/credential/receipt delivery. Then perform the real shadow round trip and expand verified lanes.

## Register status

No complete pilot has been claimed. B01 is actively being repaired; B02–B03 need coordinated release/dispatch; B04 awaits Nguyen. B05–B18 retain the split implementation/provider acceptance work documented in the register. B19 includes third-party channel approval/verification. B20–B21 require targeted security/retention evidence. B22 remains deliberately action-disabled. B23–B24 require independent tenant/customer acceptance.

Mark an item complete only after its stated acceptance evidence exists. A code test, running worker, database row, workflow screenshot or contractor report alone is not end-to-end proof.
