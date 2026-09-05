# Calendar receiver: source and actual Cloud compatibility

6 September NZ / 5 September UTC, Batch 68. **PARTIAL calendar integration.**
This is a real n8n execution of synthetic inputs, not a real provider read or
customer calendar acceptance. Full B01–B24 and all-client/launch scope remains open.

## Delivered

- `src/lib/n8n/calendarReceiver.ts`: pure incoming-context checks, canonical
  authority-response validation, strictly bounded campaign pagination/selection,
  and six future weekly email proposals with account-bound source references.
  No network, credentials, model, database, send or scheduling code.
- `calendarDates.ts` holds the existing unchanged next-Monday date algorithm;
  the Unc artifact validator and receiver now share it. NZD business currency
  is checked independently of the provider's reporting currency. No financial
  performance or current product claims are derived from campaign names.
- `scripts/lib/calendar-receiver-bundle.mjs` compiles the actual TypeScript using
  installed TypeScript 5.9.3. No second hand-maintained implementation, dependency
  installation, runtime import or environment secret. Runtime imports other
  than the reviewed local date helper are refused.
- `scripts/lib/calendar-receiver-fixture.mjs` produces a reproducible manual-only
  Cloud fixture: 22 assertions over synthetic authority, campaign pages and
  execution identity. Empty history stays honest; future timing is a hypothesis.
- `scripts/verify-calendar-receiver-fixture.mjs` uses the existing supported,
  read-only n8n API credential on the worker. It verifies exact node identities,
  connections, no credential bindings, no pin/retry/error bypass, the exact code
  hash and the canonical complete output hash. Raw saved executions stay remote.

The fixed query fingerprint is
`cb73504f19d1ac1521f8dff33db3eb1611f143e70130396f2b7a88aaded65ad0`.
It describes sent-email campaign metadata, a locally selected 90-day window,
five-page/1,000-record bounds and only archived/name/send_time/status fields.
It is **not** the existing warehouse's day-specific query key. This receiver
currently refuses stored mode; warehouse ingestion is not proven by this work.

## Actual Cloud result and the defect it found

Separate Codex-owned workflow:
[CODEX — Test calendar receiver — SYNTHETIC ONLY](https://junctionai8.app.n8n.cloud/workflow/NLOGeeBNQMURm0kL).
Manual trigger → JavaScript Code only. Inactive/unpublished, no credentials,
HTTP nodes, schedule, subworkflow calls or connection to Unc dispatch.
It lives beside the existing probe in the observed Personal project; no new
folder or builder-tool capability was claimed.

Execution **86** failed because `URLSearchParams` is unavailable in the actual
Cloud Code sandbox. Local tests had supplied that global. The receiver now
requires neither `URL` nor `URLSearchParams`: it accepts only the literal approved
Klaviyo origin/path, validates the exact decoded query and reconstructs a fixed
target with an encoded opaque cursor. Duplicate/extra keys, malformed encoding,
control characters, credentials, alternate hosts/paths and fragments refuse.
This is a restricted target grammar, not a general-purpose URL parser.

The same fixture then passed in execution **87**:

| Evidence | Independently observed value |
|---|---|
| Workflow | `NLOGeeBNQMURm0kL` |
| Actual executing revision | `2a984e0d-0015-4450-a204-ba988ef0df4a` |
| Trigger node | `ef7c652f-b120-490d-90ca-314b338e03fb` |
| Code node | `557254f9-a192-451d-a210-aaf7d43a0452` |
| Start / finish UTC | `2026-09-05T20:32:27.555Z` / `2026-09-05T20:32:29.469Z` |
| Code runtime | 1,807 ms |
| Exact Code-node SHA-256 | `f22ebbf6d671859247c388f4184fb9eb3d7085ca8415fa73841c03facf3fa606` |
| Pure bundle SHA-256 | `cf8724f5da56ff20a04df8f3ffa7cf4929f7805c5a8ab01a37fcf80facbecf2d` |
| Canonical complete output SHA-256 | `f72df87467bc4ee11a8e0380a76f843738d56c8420fdb6bc06e83df285826b1c` |
| Verification | PASS at `2026-09-05T20:35:16.475Z`; 22 assertions |

The saved execution includes `workflowVersionId` at the top level but omits
`workflowData.versionId` and `active`. It also expands the manual trigger's
display-only `notice: ""` and the Code node's default mode/language. The verifier
accepts these observed snapshot differences explicitly; it does not fill in a
missing revision or infer one from the latest editable definition. Current
definition inactivity is checked separately. Failure 86 remains retained.

Reproduce without a new execution or provider call:

```sh
node scripts/verify-calendar-receiver-fixture.mjs 87
node --test scripts/tests/calendar-receiver-bundle.test.mjs
```

Local verification: 227 files / **3,050 Vitest tests**, 22 Node bundle/verifier
tests, app and worker TypeScript, production Next 16.3.4 build, focused ESLint
and diff checks pass. The initial test adapter's `worker.result.rows` mistake was
corrected to the real reader's `worker.rows`; worker production behavior did not
change. Additional pagination tests cover encoded-key and cursor ambiguity.

## What is still required

1. Create the separate authenticated calendar receiver with native HTTP nodes,
   fixed Junction authority URL, safe error outputs/statuses, reviewed pagination
   and its own Header Auth credential. Do not convert this synthetic fixture
   into a production receiver or reuse keyword/provider secrets.
2. Verify actual campaign response headers/account identity, revision and next-link
   shape before relying on the provider projection. The account-only read #85
   is not evidence of a complete campaign listing. The Code fixture does not test
   the Edit Fields expression runtime or HTTP-node pagination behavior.
3. Pin the actual published receiver/trigger/result identities and definition;
   create the accepted AVGAR binding and account-specific registration. Establish
   the explicit run allowance and canonical timezone/business context.
4. Run and independently reconcile one bounded real read/draft journey, then
   prove the customer request → result → reload → switch-off path. No customer
   chat/schedule calendar admission is implied by the operator adapter.

No Nguyen workflow/credential was changed or executed. No new provider read,
database admission, environment flag, app/worker deployment, customer message,
publish, ad mutation or spend activation occurred. The full goal remains active;
this is concrete source/Cloud evidence progress after an advice-only turn.
