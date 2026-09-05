# Independent n8n execution evidence — 5 September 2026

Status: implemented and covered by synthetic tests; **not activated or live-proven**. Nguyen can continue the keyword-only wrapper under `unc.keyword-shadow.v1`. No response-contract change or runtime version lookup is required on his side.

## Evidence path

1. Unc sends its server-pinned expected revision and authorized business payload to the authenticated keyword wrapper.
2. Nguyen returns the actual workflow/execution IDs, `workflowVersion: null`, and `revisionEvidence: "pending_unc_verification"`.
3. Unc separately reads `GET /api/v1/executions/<executionId>?includeData=true` from the fixed `junctionai8.app.n8n.cloud` origin using its own server-only `X-N8N-API-KEY` credential.
4. The reader requires terminal successful webhook execution, exact workflow/execution identity, a saved actual revision, and the pinned webhook node in the execution's own saved snapshot. It rejects manual/retried, redacted, truncated, ambiguous or mismatched evidence. Child-workflow nodes are denied until their separate execution provenance is supported.
5. Unc compares a canonical SHA-256 digest of the original webhook body with the exact JSON request it sent. Only the expiring root `dataToken` is excluded; client configuration, market, business inputs, reads and variables remain bound. Nguyen does not generate or echo this digest.
6. Only then can Unc enrich the stored receipt with `verified_execution_record`, observed revision and verification time/digest. Raw execution bodies, headers, API keys and bearer tokens are not stored in Unc receipts/logs.

The current/latest workflow is never substituted for the revision that actually ran. `workflowVersionId` is preferred; the legacy `workflowData.versionId` is accepted only from the saved execution snapshot. Conflicting/missing revisions fail closed. Snapshot node and Webhook output shapes must still be verified against this Cloud instance.

## Server configuration and authority

Both relevant app/worker runtimes need compatible source and securely provisioned configuration before activation:

| Variable | Requirement |
|---|---|
| `N8N_EXECUTION_READER_ENABLED` | Explicit `true` only after access and acceptance gates; absent is disabled. |
| `N8N_EXECUTION_API_BASE_URL` | Exactly `https://junctionai8.app.n8n.cloud/api/v1`. |
| `N8N_EXECUTION_API_KEY` | Separate server-only API credential; not the signing root, receiver bearer or customer/provider credential. Never commit or paste it in chat. |
| `N8N_SHADOW_WORKFLOW_ID` | Exact final keyword wrapper ID from Nguyen's handoff. |
| `N8N_SHADOW_TRIGGER_NODE_ID` | Exact Webhook node ID that Codex resolves from the frozen wrapper and verifies against the saved execution snapshot. |

This does not remove existing receiver URL/token, signing-key or pilot registration gates. An invalid/missing reader prevents the paid webhook POST. A syntactically valid but revoked API credential cannot be established healthy by configuration alone: live access must be verified before pilot admission.

Transport is GET-only, DNS-pinned to a public address, fixed-origin, no redirects/cookies and bounded to the existing 1 MiB response limit. It retries only the same execution read (up to four attempts inside an eight-second deadline) for not-yet-finalized or 404/429/5xx responses. It never retries or starts a workflow. Authentication, identity, malformed JSON, missing evidence and oversized responses stay terminal. A failed read must be reconciled before another paid provider call; durable caller-level uncertainty/deduplication remains B16 work.

Use the least available API scope and restrict the credential's project access where supported. n8n documents scoped keys as Enterprise-only; on non-Enterprise plans an API key may have much broader account authority than this reader uses. The fixed GET-only implementation is an application restriction, not a claim that the credential itself is read-only. That credential-risk choice requires explicit review before provisioning. No API key has been created by Codex.

## Access observed this turn

- Authenticated Cloud UI showed a trial with nine days remaining and no API-key entry in the Settings menu. No plan purchase or upgrade was made.
- Vercel/Fly environment metadata and local key-name checks found no execution-reader API credential/configuration. Secret values were not extracted or compared.
- n8n's official authentication documentation says the public API is unavailable during the free trial. Plan/access resolution is an owner/provider dependency, not a reason to fake execution evidence or use private browser-cookie endpoints.
- The official MCP `get_workflow_execution` implementation inspected below exposes execution metadata and optional run data, but omits `workflowVersionId` and the saved `workflowData` snapshot. It does not satisfy this reader's provenance requirements. This is a source finding, not a claim about an untested future MCP version.
- No Nguyen workflow was edited, executed, registered, published or activated. No source change in this batch has yet been deployed; the live matched runtime remains `b7c347bfd9ff862f00b01e6fb71740e26d783b0c` at documentation time.

## Acceptance before enabling dispatch

Codex owns reader access/configuration and independent acceptance. Obtain supported API access with an appropriately reviewed credential; verify one actual saved successful and failed execution supplied in Nguyen's handoff without starting another workflow; inspect revision/snapshot/trigger fields, retention and response size; pin the tested wrapper and node; then release matching source/configuration and verify denial cases. Only after the remaining account-generation, business-input, admission and duplicate-call gates may a separately authorized live shadow request run. Success must join the right persisted Unc artifact/receipt to fresh provider evidence.

44 new reader tests plus the existing suite pass: **182 files / 2,160 tests**. App/worker TypeScript, production build, lint (zero errors, 39 existing warnings) and diff checks pass. All reader fixtures are synthetic and do not establish Cloud API compatibility or live provider success.

## Primary sources inspected

- [n8n API authentication, trial access and key scopes](https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/n8n-api/authentication.md).
- [Pinned execution API specification](https://github.com/n8n-io/n8n/blob/33eb5c196e0ce3a2c71525929a4ef861cb94b168/packages/cli/src/public-api/v1/handlers/executions/spec/paths/getExecution.generated.yml).
- [Pinned execution public controller](https://github.com/n8n-io/n8n/blob/33eb5c196e0ce3a2c71525929a4ef861cb94b168/packages/cli/src/public-api/v1/controllers/executions.public.controller.ts).
- [Pinned MCP execution projection](https://github.com/n8n-io/n8n/blob/33eb5c196e0ce3a2c71525929a4ef861cb94b168/packages/cli/src/modules/mcp/tools/get-execution.tool.ts).

These source shapes inform the implementation; deployed API access and response data remain acceptance gates.
