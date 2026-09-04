# Junction / Unc readiness — 4 September 2026

## Approved live release update

The subsequent explicit approval authorized production database/security updates and replacing the app and worker while publishing, external messaging and ad changes remain disabled. This section supersedes the historical pre-release statements below. Detailed receipts: [LIVE-RELEASE-2026-09-04.md](./LIVE-RELEASE-2026-09-04.md).

Six migrations are applied; the production app and existing Fly worker are replaced. Existing AVGAR Shopify/Meta credentials passed fresh read-only checks without reconnecting. Command dispatch remains OFF pending controlled workflow acceptance. Final chat persistence acceptance is recorded in the linked release receipt, not inferred from a successful build.

## Historical preparation and preview record

Scope: six agreed improvements while Apple/provider approval and n8n development continue. Production data, connectors, messaging and workflow activation were not changed. Existing uncommitted command/SMS work was preserved and included in local verification.

## Implementation and acceptance

| Workstream | Local result | Remaining live acceptance |
| --- | --- | --- |
| Testable release | Local regression/build checks; isolated, clearly labelled demo preview preparation | A demo preview is not the authenticated AVGAR release |
| Phone connection | Exact-link verification, expiry, serial polling, bounded requests, error backoff and retry UI | Real approved provider + owned handset handshake and disconnect |
| Unc voice | Shared lowercase, concise, lightly expressive conversation instructions; preserve codes, names and deliverable formatting; receipt-grounded claims | Real model/account conversations on each enabled channel |
| Apple preparation | Hard-disabled adapter/503 receiver; internal scoped identity contract; local pairing, duplicate, opt-out, closure and human-pause tests; compatibility migration | Apple/Infobip acceptance, authentic payloads, credentials, sender, human-support operation, in-flight opt-out and handset receipts |
| Honest readiness | Connector account reference and dated sync evidence; failed reads clear stale ready state; routine lookup errors clear stale switches; execution-time permission/source/off/version checks | Fresh provider source reads and real worker receipts |
| AVGAR mobile chat | 390px mobile layout and chat fixture verified; queued/waiting/done/blocked/error feedback tested | Correct sign-in, owned data source, durable chat reload and real draft receipt |

## Live facts checked in this work

- Correction after Tom confirmed the intended pilot: `halltaylor.tom@gmail.com` owns account `aa5cfc84-2569-4c99-9b40-67003ae55eda`, which is the AVGAR pilot account. Its saved business context still says Junction AI; the profile label must not be mistaken for connector ownership.
- A separate account named **AVGAR Sport**, owned by `tom@getjunction.ai`, has disconnected connectors. That is not the account Tom selected. Do not move credentials there or request another OAuth connection.
- Fresh provider reads through the updated compiled backend passed on 4 September at 15:43 NZST using the Gmail account's existing encrypted connections: Shopify `avgar-sport.myshopify.com` returned 14 seven-day order rows; Meta `act_3235248400060604` returned two seven-day insight rows with AVGAR-named ads/ad sets. Check ID: `6fa09ba3-d70c-4f48-9664-9475f2cc2c6b`; completed `2026-09-04T03:43:48.662Z`. This diagnostic wrote no database rows and made no provider mutations. It proves current reader access, not deployed app or worker acceptance.
- In the target Junction database, `routine_commands` and `channel_inbox` do not yet exist. New command dispatch therefore needs reviewed migration and worker rollout before activation; leave `UNC_COMMANDS_ENABLED=false` and `LIVE_MODE_ENABLED=false` meanwhile.
- Fresh schema read also found `llm_spend_reservations`, `reserve_llm_spend` and `release_llm_spend_reservation` absent. The updated router requires these even with command dispatch disabled; do not deploy/promote it over the working app without the budget migration. The prior client-write policies and public RPC grants are still present, so the pending security migrations need an explicit project-wide permission-change decision. No migrations or production release were performed in the fresh-read follow-up.
- Vercel project `junction-unc` was resolved and linked. Preview environment listing showed no Supabase or model configuration. Local environment files and generated/test/private documentation directories are excluded from preview upload.
- Apple review is reported by Tom. No fresh Apple approval or real message-delivery evidence was obtained here. The prior Infobip request was Pending; do not submit a duplicate without reconciliation.

## Verification receipts

- Unit baseline before the changes: 164 files / 1,951 tests passed.
- Final expanded suite: 167 files / 1,967 tests passed at 14:47 NZ time after the final implementation edits.
- Four focused browser fixtures passed: mobile 390×844, queued→waiting→done, switched-off/blocked, failed status lookup. Responses were stubbed; these are UI contracts, not real execution proof.
- Mobile DOM readback after fixing overflowing dashboard grids: viewport 390px, document scroll width 390px, chat panel within x=16..374.
- Minimal local PostgreSQL migration smoke test covers channel compatibility, RLS/grants, single command claim, enum constraints and duplicate inbox rejection. It does not prove the complete production migration chain.
- Final app/worker TypeScript and production build passed. Lint completed with zero errors and 39 warnings (principally existing image/navigation warnings); this is not zero-warning cleanliness. `git diff --check` passed.

## Release boundary

### Preview READY — verified 4 September 2026

- URL: https://junction-6cmgci9hq-tom-junctionmedis-projects.vercel.app/app
- Deployment: `dpl_9Hr4mScpP9MFCpbFSYeGamAXht84`; target Preview; state READY; Next.js 16.3.4; commit `854ff333f05ea45d6e7b6d5340276baa0224f40d`. Build duration approximately 60 seconds.
- Deployment-specific settings requested: `NEXT_PUBLIC_READINESS_PREVIEW=true` at build/runtime; `UNC_COMMANDS_ENABLED=false`; `LIVE_MODE_ENABLED=false`. No shared environment values changed and no production credentials copied.
- Browser readback confirmed the demo-only warning, working demo-dashboard navigation and opening chat. At the 390px mobile viewport the document width was 390px (no horizontal overflow). The viewport was reset after the test.
- Deployed health endpoint returned `ok: true`, build SHA `854ff333f05e`, `db.configured: false`, `worker: null`. This is intentionally not real AVGAR data or workflow execution.
- The deployed Apple placeholder returned HTTP 503 with `apple_channel_not_ready` to an empty POST, confirming it remains disabled.
- The production alias `junction-unc.vercel.app` was independently resolved after upload and still points to `dpl_H9MGF4UraVQQEhzN1QuaTjLGA2Lv`, the same deployment as before.
- No GitHub push, production promotion, database migration, connector activation or live messaging was performed. The earlier blocked preview remains as a diagnostic record; it was not deleted.

### Approved preview upload follow-up

Tom explicitly approved uploading this code to the existing `junction-unc` Vercel project as a demo-only preview. The source upload succeeded on 4 September, but deployment `dpl_3k9H6HUPDMKSWYAAMbD3okK9Wjst` was BLOCKED before build: Vercel could not authorize the checkpoint's automatically inferred Mac-local Git author email.

Read-only identity reconciliation confirmed the authenticated Vercel owner's email is `tom@junctionmedia.ai`; GitHub attributes the existing successful deployment commit `4fc0d13304a1a8d0ff63fe727c834fdc576ad781` with that email to the currently authenticated `JunctionAI` account. The next local checkpoint uses this verified existing owner identity through per-command Git configuration. No account membership, credential, global Git setting or security policy is changed. The old checkpoint remains preserved in history. Preview readiness still requires a successful build and readback.

Historical pre-approval boundary: the Vercel dry-run excluded local environment files and generated/test/private documentation directories (656 files, approximately 8.1 MB remaining). The initial upload command was rejected before execution pending explicit source-upload approval. Tom subsequently gave that approval, and the READY receipt above supersedes this earlier blocker.

No GitHub push was performed. The local code, this readiness record and the demo-only preview are the deliverables so far. Full real-account acceptance remains open, not PASS.

## Next real pilot steps

1. Keep the intended pilot on `halltaylor.tom@gmail.com`. Existing Shopify and Meta credentials passed fresh reads; no reconnection or credential transfer is required.
2. Reconcile the saved business profile with AVGAR before treating its company goals/context as authoritative. Do not invent a new goal, deadline or budget.
3. Obtain approval for the live database migration/security-policy changes and replacing the production backend (earlier deployment approval was demo-only). Review dependencies and current grants, verify the model-budget migration, stage a production-environment build without changing the main alias, then test before promotion. Queue activation needs a matching durable worker; keep it OFF until that receipt exists. No production credential copying into an unprotected preview.
4. From the phone, ask a source-backed business question, check source/freshness, reload and verify durable chat history. Then request one enabled draft-only routine and reconcile the resulting run/output receipt. Test switched-off, duplicate, failed lookup and wrong-account denial paths.
5. Keep Apple disabled until provider acceptance and the missing authentication/delivery/human-support contracts are verified. App chat does not depend on Apple approval.

Unrelated observed issue for a later scoped fix: the existing Gmail/Junction profile displayed a past goal deadline and mixed currency presentation. No real business goal or currency was edited here.
