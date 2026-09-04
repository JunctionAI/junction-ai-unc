# Junction / Unc readiness — 4 September 2026

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

- The open production app was signed in as `halltaylor.tom@gmail.com`, with Junction AI context. It is not the AVGAR account.
- The existing **AVGAR Sport** account is owned by `tom@getjunction.ai` (one owner member).
- AVGAR's Shopify, Meta Ads, GA4, Google Ads and Klaviyo connector records were all disconnected, with no external account reference or sync receipt. No credentials were copied from another business.
- In the target Junction database, `routine_commands` and `channel_inbox` do not yet exist. New command dispatch therefore needs reviewed migration and worker rollout before activation; leave `UNC_COMMANDS_ENABLED=false` and `LIVE_MODE_ENABLED=false` meanwhile.
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

The Vercel dry-run excluded local environment files and generated/test/private documentation directories (656 files, approximately 8.1 MB remaining). The actual preview upload was rejected by the security approval check before execution because explicit authorization to transmit this source payload to Vercel is required. No preview was deployed and production was not promoted. Ask Tom to approve uploading this code to the existing `junction-unc` project for an isolated, demo-only preview; do not retry via another tool or destination.

No GitHub push was performed. The local code and this readiness record are the deliverables so far. Full real-account acceptance remains open, not PASS.

## Next real pilot steps

1. Tom signs in to the existing AVGAR account using `tom@getjunction.ai`. No password or verification code should be shared in chat.
2. Connect AVGAR's own Shopify account first through its authorized OAuth flow; confirm actual store identity and a fresh sync receipt before enabling a source-dependent routine. Do not connect all platforms speculatively.
3. Provision a separately scoped authenticated test deployment and review/apply the queue/inbox migration and worker rollout to the intended environment. Confirm model/budget settings. No production credential copying into an unprotected preview.
4. From the phone, ask a source-backed business question, check source/freshness, reload and verify durable chat history. Then request one enabled draft-only routine and reconcile the resulting run/output receipt. Test switched-off, duplicate, failed lookup and wrong-account denial paths.
5. Keep Apple disabled until provider acceptance and the missing authentication/delivery/human-support contracts are verified. App chat does not depend on Apple approval.

Unrelated observed issue for a later scoped fix: the existing Gmail/Junction profile displayed a past goal deadline and mixed currency presentation. No real business goal or currency was edited here.
