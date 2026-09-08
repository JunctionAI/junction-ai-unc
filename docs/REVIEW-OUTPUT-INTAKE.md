# Finished-output callback

Implemented, disabled and undeployed. This is draft intake, not a Grok execution receipt or a publishing API.

`POST /api/external-agents/outputs/<grantId>` accepts `{ "content": { "title": "…", "body": "…" } }` or content with private image/video descriptors. No account IDs, source IDs, URLs, actions or approval fields come from the request body.

The trusted dispatcher resolves the real client/runtime binding and existing source run/artifact first. It calls `issueReviewIntakeGrant` with a stable grant UUID, worker ID, context generation, source run ID, complete output identity/kind/sections/duration, and an expiry no more than one hour after issuance. The grant is persisted in the existing receipts table before dispatch; exact retries return the same derived authorization. Conflicting IDs refuse. Neither signing secret nor derived token is stored in that receipt.

Send only the returned per-grant authorization to the selected test runtime via its secure job context; never send the root signing secret. Worker ID is bound metadata, not independent authentication of a computer or credential isolation. The callback authenticates the bearer of the scoped token.

Server-only settings:

- `JUNCTION_REVIEW_INTAKE_ENABLED=true`
- `JUNCTION_REVIEW_INTAKE_SECRET`: separate random signing secret, minimum 32 characters; not the Grok-control or n8n key.
- Existing `JUNCTION_REVIEW_ENABLED` and exact `JUNCTION_REVIEW_ACCOUNT_IDS` release gate.

The receiver validates stored grant/account, token, expiry, JSON byte cap, strict content and source/context through the existing registration RPC. Image/email output requires an image; video requires media and duration; textual output requires body. Every declared media slot must already exist in `junction-review-private` at the derived account/generation/output/revision-0 path, with matching byte length and SHA-256. Missing or public media refuses. There is no arbitrary external-URL downloader or agent storage credential exposure. Trusted upload preparation remains a separate integration step.

Context and expiry are rechecked after media verification. Finished previously-authorized drafts may arrive while execution is paused; intake never unpauses, enables, approves, sends, publishes or starts another job. Registration retains the immutable original and refuses conflicting content under the same output ID. Response 201 means saved; identical registration returns 200/duplicate. `executed:false` is explicit. A 503 is unconfirmed persistence: reconcile or retry the identical callback, never rerun paid generation on that basis. Expired authorization returns 410. The review link still requires normal customer login/membership.

Verification: 21 intake tests plus 5 existing producer tests pass using simulated storage. Covers scope/tampering, secret-free persistence, duplicate/conflicting grants, expiration, release, context, size limit, media presence/hash/private storage, uncertain completion and duplicate receipt. App and worker typechecks and changed-file lint pass. No real Grok callback, deployment, grant issuance, media upload or client action is claimed by these tests.

Remaining: bind the trusted dispatcher to the dedicated isolated test runtime; provision this separate signing secret and test-only deployment; perform real callback/database readback and media handoff; connect resulting review URL to the scoped Slack thread. Do not replace the configuration-ack callback or use a control acknowledgment as proof that a creative was produced.

## Live local callback verification

The real-schema test found receipt issuance is subject to the existing runtime pause/source-context trigger. Corrected the issuer to include source run ID and context generation; reads verify those columns against signed scope. No database guard was changed. The internal account was active only for grant issuance, with cap zero and no connectors/routines, then paused before the callback.

`scripts/verify-review-intake-live.mjs` passed using local HTTP and real Supabase storage/database. Grant `b06ed3a4-fb9b-46a7-b1cc-11917c692e33`, output `1a5273d2-f2a3-4b0b-a1c8-85a6175c24e1`: rendered demo email saved once, HTTP 201 and review link returned, identical callback HTTP 200/duplicate, conflicting content refused without replacing the original. Image 1,287,944 bytes, SHA-256 `312e779063139976788146577fd4b4c67dc9bec93dfb8c8d4bc4dc6d95066205`; public URL HTTP 400. Account stayed paused/cap zero after issuance. No model or Grok call, client operation or deployment occurred. This uses existing demonstration artwork, not a newly generated email.

The test experienced a slow database response. Added a 45-second callback deadline: unresolved work returns 503/uncertain, checks prevent later registration if timeout occurred before registration began, and an already-submitted write must be reconciled rather than assumed cancelled. Two targeted timeout tests cover both cases. This is not a guarantee that PostgreSQL cancels an in-flight transaction.
