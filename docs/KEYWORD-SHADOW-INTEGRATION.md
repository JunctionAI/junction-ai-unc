# D03-W01 shadow integration — implementation and remaining activation gate

Status: Unc-side implementation and contract tests complete locally; not deployed or activated.
The integration owner is Codex/Unc, not Tom. Tom should not have to invent routine mappings,
relay schema decisions, or manually join execution receipts.

Verification: 171 files / 1,995 tests PASS; app and standalone-worker TypeScript PASS;
focused lint PASS; production webpack build PASS; `git diff --check` PASS. The new tests
use synthetic responses and an in-memory store. They prove parsing, denial paths and linked
storage behavior, not a fresh n8n/provider execution or phone end-to-end success.

## Live source inspected

Read-only browser export of `TEST — AVGAR — SEO — Shadow`, workflow `OUerIfgAkMnhkuen`,
revision `cda63062-b8c5-4f3a-a718-a71bd6e1040f` on 4 September 2026. Inactive; manual trigger;
MCP access enabled in its settings. No webhook or response node. Existing DataForSEO nodes
reference the same encrypted Basic Auth credential; credentials were not extracted or changed.

Current Client Config: `client_id=avgar`, `primary_domain=avgar-sport.myshopify.com`,
`seed_keyword=travel bag`, `location_code=2840`, `language_code=en`. These are observed developer
test values, not newly approved customer search settings. The wrapper must not silently mix
them with Unc's old Junction profile. No profile, goal, domain, seed or market was changed here.

The existing workflow enables four branches and still calls SERP and backlinks even when only
keyword output is wanted. The callable first-routine wrapper must invoke only the keyword lane;
do not run all four and merely discard the other outputs. Provider response validation must
check DataForSEO's top-level and task status codes, not merely the absence of an HTTP error.

## Implemented on the Unc side

- `src/lib/n8n/keywordShadowSpec.ts` prepares an explicit, manual-only n8n step for D03-W01.
  It retains the catalog's optional reads and draft gate, adds no executor, and cannot fall back
  to an LLM on n8n failure. It performs no registration, database write, switch change or call.
- `src/lib/n8n/shadowContract.ts` binds the pilot account, workflow, revision, routine and explicit
  client configuration. Only the AVGAR keyword lane is supported initially. No global registration.
- `src/worker/providers/n8n.ts` includes the server-pinned `shadow` contract in its request,
  rejects live mode/cross-account registration before transport, and requires synchronous output.
- The result must have the requested artifact kind. A correlated execution receipt is checked
  for identity, revision, timestamps, no-action status and reported successful provider task.
  Validated execution metadata is attached to both the artifact and the linked draft receipt.
- No root signing secret goes to n8n. No external provider credential is migrated or duplicated.
- Backlink gap is not mapped to D03-W06; that remains competitor page/content analysis.

## Wrapper contract to implement

The existing Unc request envelope remains. Its additional `shadow` field is:

```json
{
  "contract": "unc.keyword-shadow.v1",
  "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
  "workflowId": "OUerIfgAkMnhkuen",
  "workflowVersion": "<tested revision that actually executes>",
  "routineId": "D03-W01",
  "routineKey": "keyword_opportunity",
  "client": {
    "id": "avgar",
    "primaryDomain": "<verified search domain>",
    "seedKeyword": "<verified seed>",
    "locationCode": 2840,
    "languageCode": "en"
  }
}
```

The location above is the observed test value, not a default supplied by the builder.
All client fields must be explicit. Do not use arbitrary incoming `dataBaseUrl`: the wrapper's
validation/proxy origin must be independently pinned to the intended Junction deployment.
Verify the run-scoped token against that origin and match its verified run/account/routine
before any provider call. A capability URL alone is not sufficient authentication for a paid
provider lookup. Add credential-backed webhook authentication matching the implemented bridge:
server-only `N8N_SHADOW_RECEIVER_URL` pins the exact HTTPS endpoint and
`N8N_SHADOW_RECEIVER_TOKEN` supplies a separate Bearer credential (minimum 24 characters).
The bridge refuses an unpinned URL, a missing credential or reuse of the root signing key.
Store the matching `Authorization: Bearer <token>` value in n8n's Header Auth credential,
not node text or exported JSON. These deployment settings/credentials are not provisioned yet.

Reply within 60 seconds with `{artifact, executionReceipt}`. The artifact is the existing
`keyword_list` contract: title, body, 1–15 `{title,body,meta?}` items and optional evidence.
Provider metrics are observations; content prioritization is a recommendation; GSC rankings,
clicks and CTR remain unavailable unless actually read.

Required execution receipt shape:

```json
{
  "contract": "unc.keyword-shadow.v1",
  "accountId": "<request accountId>",
  "runId": "<request runId>",
  "routineId": "D03-W01",
  "routineKey": "keyword_opportunity",
  "workflowId": "OUerIfgAkMnhkuen",
  "workflowVersion": "<actual tested executing revision>",
  "executionId": "<actual n8n execution ID>",
  "mode": "dry_run",
  "status": "succeeded",
  "executedAction": "none",
  "startedAt": "<ISO timestamp>",
  "finishedAt": "<ISO timestamp>",
  "client": {
    "id": "avgar",
    "primaryDomain": "<verified search domain>",
    "seedKeyword": "<verified seed>",
    "locationCode": 2840,
    "languageCode": "en"
  },
  "provider": {
    "name": "dataforseo",
    "statusCode": 20000,
    "taskStatusCode": 20000,
    "taskId": "<actual provider task ID>",
    "itemsCount": 1,
    "fetchedAt": "<ISO timestamp within this execution>"
  }
}
```

`client` is an object, not a serialized string. Values in angle brackets are explanatory,
not executable fixtures. The timestamps and provider count/status must come from the run.
Do not echo an unverified client-provided revision as proof of the executing workflow version.
The new wrapper revision must be frozen/identified before creating the server-side contract.

Missing business/provider input may return `{needs:[{input:"seed_keyword",why:"..."}]}`.
That means waiting for input, not a successful execution. Provider errors must not be masked
as a successful artifact. HTTP 202 is not supported by this pilot.

## Storage and acceptance

Unc alone writes `routine_runs`, `artifacts` and `receipts`. The validated external receipt is
stored as `artifacts.meta.executionReceipt` and `receipts.payload.externalExecution`; the draft
receipt links the artifact ID. A referenced n8n execution is reported evidence, not an independent
provider attestation. Acceptance must inspect the actual matching execution and provider result.

Activation still requires:

1. Provision authenticated callable keyword-only entry point without modifying unrelated lanes.
2. Validate workflow configuration/connections, test failures and bind the tested revision.
3. Resolve the pilot's search domain/seed/market from authoritative settings; do not guess from
   the old Junction profile or silently overwrite the developer's fixed Client Config.
4. Deploy matching app/worker, register only the pilot scope, persist the reviewed shadow spec.
5. Run one real manual shadow request; prove fresh provider evidence, persisted artifact and
   linked receipts, zero executor calls, and phone chat/reload. Only then expand to more routines.

Current access limitation: this Codex session can inspect/export n8n through the signed-in
browser, but exposes no n8n workflow editing/validation MCP tools. The n8n lifecycle skill
requires validation and connection readback before publishing; no workflow was changed or
published via a bypass. Re-enable the n8n tool connection or have the existing n8n developer
consume this pinned contract. No new OAuth connection to Shopify/Meta is needed for this step.
