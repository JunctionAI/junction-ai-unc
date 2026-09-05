# D03-W01 shadow integration — implementation and remaining activation gate

Status: initial bridge and authority code exists; **revision-evidence clarification below supersedes the earlier receipt requirement**. Updated revision verification tests are local; the independent execution-reader transport/access is still an Unc-owned activation gate. No pilot is registered or activated.
The integration owner is Codex/Unc, not Tom. Tom should not have to invent routine mappings,
relay schema decisions, or manually join execution receipts.

Bridge verification: 171 files / 1,995 tests PASS; app and standalone-worker TypeScript PASS;
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

### Revision-evidence decision — 5 September 2026 (for Nguyen)

You are correct not to fake or echo an internal n8n version ID. **Unc owns independent revision verification.**

- Request `shadow.workflowVersion` means the **expected frozen revision**, pinned in Unc's server-owned spec. Authority preflight still labels it `expected_only`.
- Return the actual executing `workflowId` and `executionId`. In the returned `executionReceipt`, set **`workflowVersion: null`** and **`revisionEvidence: "pending_unc_verification"`**. Do not copy the expected version into an actual-version field, hardcode n8n's rotating internal version ID or query the latest workflow version inside the running workflow.
- Unc must independently retrieve the named execution's saved revision and original trigger identity, compare them with the exact registered/pinned workflow revision and account/run/routine, and verify terminal success/timing before storing a verified artifact. Looking up the current/latest workflow is not enough. A webhook-supplied verification object is not trusted.
- The accepted stored receipt is enriched by Unc with the observed `workflowVersion`, `expectedWorkflowVersion`, `revisionEvidence: "verified_execution_record"` and verification provenance/time. Raw API data/headers/secrets are not copied into receipts.
- Your handoff supplies the final wrapper ID, tested/published revision, exact callable URL and actual success/failure execution IDs. Keep that tested revision frozen after handoff; changes require a new pin/retest. A dedicated wrapper may have a different ID from `OUerIfgAkMnhkuen`; Codex binds the ID that actually ran. If it calls child workflows, include their IDs/revisions/executions separately. Parent evidence does not prove a mutable child's revision; child provenance is an additional gate before that composition is enabled.
- Keep the response `{artifact, executionReceipt}` within 60 seconds; do not wait inside n8n for Unc's post-response verification. Unc performs the independent read after the response, allowing a bounded wait for n8n to finalize its execution record. Missing/mismatched/unreadable evidence never becomes a verified success. Reconcile an uncertain execution; do not automatically repeat the paid provider call.

**Implementation status:** the parser, independent-observation validator and fail-closed bridge reader hook are implemented/tested locally. The concrete server-authenticated execution reader is not yet wired or proven against n8n Cloud. Dispatch refuses before the paid webhook call if that reader is absent. This is **Codex's work, not an additional version-discovery task for Nguyen**. Continue the keyword-only wrapper using the receipt below; activation waits for the matching app/worker and reader acceptance.

Basis: n8n's [documented workflow runtime context](https://github.com/n8n-io/n8n-docs/blob/main/docs/build/work-with-data/transform-data/expression-reference/workflowdata.md) lists workflow ID/name/active, not internal version ID. Its [execution storage schema](https://github.com/n8n-io/n8n/blob/master/docs/generated/postgres-schema/execution_entity.md) records the executed workflow revision. This supports control-plane verification but does **not** establish which fields this Cloud instance exposes through its current API/permissions; Codex must verify that actual read path. If it is unavailable, keep the result unverified instead of relabelling an expected revision as observed.

The existing Unc request envelope remains. Its additional `shadow` field is:

```json
{
  "contract": "unc.keyword-shadow.v1",
  "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
  "workflowId": "<registered executing wrapper workflow ID>",
  "workflowVersion": "<expected frozen revision pinned by Unc>",
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
not node text or exported JSON. See owner setup readback below for provisioning progress;
the endpoint is not deployed or pinned yet.

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
  "workflowId": "<actual executing wrapper workflow ID>",
  "workflowVersion": null,
  "revisionEvidence": "pending_unc_verification",
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
Unc enriches the null version only after independent execution readback, as specified above.
The new wrapper revision must be frozen/identified before creating the server-side contract.

Missing business/provider input may return `{needs:[{input:"seed_keyword",why:"..."}]}`.
That means waiting for input, not a successful execution. Provider errors must not be masked
as a successful artifact. HTTP 202 is not supported by this pilot.

## Storage and acceptance

Unc alone writes `routine_runs`, `artifacts` and `receipts`. The validated external receipt is
stored as `artifacts.meta.executionReceipt` and `receipts.payload.externalExecution`; the draft
receipt links the artifact ID. A referenced n8n execution alone is reported evidence, not independent
revision or provider attestation. The bridge requires independent execution revision/identity verification;
live acceptance additionally inspects the provider result. Provider fields in the receipt remain reported provider evidence.

Activation still requires:

1. Provision authenticated callable keyword-only entry point without modifying unrelated lanes.
2. Validate workflow configuration/connections, test failures and bind the tested revision.
3. Resolve the pilot's search domain/seed/market from authoritative settings; do not guess from
   the old Junction profile or silently overwrite the developer's fixed Client Config.
4. Deploy matching app/worker, register only the pilot scope, persist the reviewed shadow spec.
5. Run one real manual shadow request; prove fresh provider evidence, persisted artifact and
   linked receipts, zero executor calls, and phone chat/reload. Only then expand to more routines.

## Fresh connection preflight — 4 September 2026

The former MCP access blocker is resolved. Fresh authenticated reads of both AVGAR SEO and
Paid Ads succeeded; workflow update scopes and editing/validation tools are available.
SEO remains at revision `cda63062-b8c5-4f3a-a718-a71bd6e1040f`, unpublished. No workflow was
changed, executed or published during this preflight.

Credential inventory returned one Header Auth credential, `4mkTKL1q0njNafh9`
(`Header Auth account`). Fresh workflow readback shows it is used by **Klaviyo Email Campaigns,
Klaviyo Flows and Klaviyo Lists** in `DV5Wv6wXlzpz4zeN`. It is not the Unc receiver credential
and must not be repurposed or copied into the webhook.

The local `.env.local` lacks `N8N_SHADOW_RECEIVER_URL`, `N8N_SHADOW_RECEIVER_TOKEN` and
`N8N_SIGNING_SECRET`. This is local configuration evidence only; deployed environment
values were not inspected during this preflight. Existing deployed signing keys must not
be replaced or exposed.

Owner setup required by the n8n credential-security skill:

1. Create a **Header Auth** credential in the existing personal project, named
   `Unc — AVGAR shadow receiver`.
2. Header name: `Authorization`. Header value: `Bearer ` followed by a newly generated,
   password-manager-stored random secret (32+ characters, no whitespace in the secret).
3. Keep this separate from DataForSEO, Klaviyo, Meta, and the Unc root signing key. Do not
   paste the secret into chat, workflow fields, source control, or a handoff document.
4. The same secret, **without** the `Bearer ` prefix, must be provisioned securely as
   server-only `N8N_SHADOW_RECEIVER_TOKEN` in the app and worker before activation. The exact
   validated endpoint will be pinned as `N8N_SHADOW_RECEIVER_URL` after the receiver is built.

Once the credential exists, Codex must resolve its ID, finish the authenticated receiver,
validate and test it, and complete the acceptance gates above. Credential creation alone
does not complete the integration. No Shopify/Meta reconnection is needed.

### Owner setup readback

- n8n credential `Unc — AVGAR shadow receiver` is now present, ID `Y9Xu3zApLSrcWu1e`,
  type `httpHeaderAuth`, in the existing personal project. Its value was not read.
- Vercel CLI readback confirms `N8N_SHADOW_RECEIVER_TOKEN` exists as **Sensitive**, scoped
  to **Production**, in linked project `junction-unc`. The secret is not retrievable for
  copying to another runtime. Presence is not proof that the value matches n8n.
- Owner subsequently ran the helper. Fresh `flyctl secrets list --app unc-worker --json`
  confirms `N8N_SHADOW_RECEIVER_TOKEN` is **Staged**, not Deployed. The worker was not
  restarted. `N8N_SIGNING_SECRET` remains absent. Do not launch the routine yet.
- `scripts/stage-n8n-receiver-secret.command` is an owner-run private-entry helper for
  the receiver token. It pipes one value to `flyctl secrets import --app unc-worker --stage`,
  writes no secret file, and does not deploy/restart. Syntax checked; owner-run staging
  verified through Fly metadata. Secret values were not read or compared.
- The existing app signing key still needs secure synchronization to the worker; it must
  not be replaced with a newly generated key. Endpoint pinning, actual receiver build,
  validation, deployment, pilot configuration and live acceptance remain outstanding.

### Receiver authorization preflight — local implementation

`GET /api/n8n/shadow-authority`, with `Authorization: Bearer <run-scoped data token>`,
now resolves the exact stored run/spec and returns only canonical `shadow` and `run`
fields plus authorization/expiry timestamps. It does not gather business context,
unseal platform credentials, call a provider, or write an artifact/receipt.

Before returning 200 it checks valid token/account/routine/scopes, running/dry-run status,
the stored spec fingerprint (not only its version), a valid explicit manual-only shadow
spec with no executor, fresh run timing, and an active account-specific registration
matching the server receiver URL pin. All responses, including errors, are `no-store`.
The disabled switch can remain disabled during a separately authorized manual dry run.

The receiver must call this endpoint at the independently pinned Junction origin with
redirects disabled and use its canonical client values, not incoming body overrides.
This preflight is **not** a one-use provider-spend permit or a replay/deduplication store.
It returns `revisionEvidence=expected_only`: the workflow version is a server expectation,
not attestation of the n8n revision that executed. The revision-evidence decision above defines
provenance ownership and the new reply fields. Actual execution-reader transport/access acceptance
and duplicate-call handling still need completion before receiver activation.

Current local verification after this addition: **172 files / 2,023 tests PASS** (28 new
authority tests); **61 focused tests PASS** across authority/proxy/shadow contract;
app/standalone-worker TypeScript, focused lint and production webpack build PASS.
These tests use synthetic data and MemoryStore.
No n8n workflow, live registration, deployment or provider execution was changed by this addition.
