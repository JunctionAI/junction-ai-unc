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
