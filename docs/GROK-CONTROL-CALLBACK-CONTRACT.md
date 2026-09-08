# Junction Grok control callback — implementation handoff

Status: sender, callback route and account-scoped status reader implemented. Callback deployed to production on September 8 at commit `b33e085`, deployment `dpl_64SjUzZPH7FLiLBX55caX2GBPwPn`. NOT connected to customer switches and NOT a completed live Grok callback proof.

## September 9 transport correction (not deployed)

The live database guard requires an explicit captured generation for run-less receipts. Sender/result writes omitted that field, so generation >0 failed persistence; the input schema also incorrectly rejected the valid generation 0 test account. Corrected both writes and bound receipt reads to their stored generation. The mock now emulates the live guard instead of accepting impossible writes. 23 targeted tests pass, with TypeScript/lint checks; real Supabase rollback test confirmed omitted generation refusal and explicit generation 0/1 persistence. The transaction restored generation=0, paused=true, cap=0.

**Remaining blocker:** account pause blocks all receipt inserts, including a Grok disable request. Earlier simulated coverage incorrectly claimed it worked. No webhook is sent when persistence is refused. This requires a dedicated control-plane persistence path that can record stopping while business execution remains paused; do not unpause the account or weaken generic runtime guards to bypass it. Native test runtime is still inaccessible while the Mac is locked. No live webhook/callback proof was obtained here.

### Dedicated stop-path implementation (staged)

The above persistence blocker is fixed in code by `grok_control_records`, an append-only service-only configuration table, separate from business receipts. Request/result storage now uses that table. Its insert guard locks account and saved routine state, validates generation/identity/exact saved timestamp and acknowledgement binding, refuses enabling paused accounts, and permits stopping while paused. It does not update routine settings or lift pause. The shared runtime guard is unchanged.

Migration `20260908170923_grok_control_records` is NOT installed; deploy only after installation and release checks. Existing receipt records are not migrated or reinterpreted; current live controller binding/legacy pending events must be inspected before cutover. No real confirmed callback was previously established.

Subsequent installation: live legacy control receipt count was zero. Installed as `20260908171415_grok_control_records`; local filename reconciled. Readback records=0, anon read=false, member insert=false, service update=false. Advisor warning counts unchanged; one expected service-only RLS INFO added. No switch, schedule, native routine or client binding changed. Sender/callback application code still requires isolated deployment and real callback testing.

`scripts/verify-grok-control-storage.mjs`: ten checks pass with actual transport and PostgreSQL WASM persistence, one simulated webhook, zero external calls. It covers stop while paused, persisted acknowledgement, duplicate/no resend, generation mismatch and grants. Real Supabase rollback test also saved request/result while paused and left the table absent, account paused, routine count zero. Unit suite 23 tests, typecheck and lint pass. Native webhook proof, atomic switch/outbox coupling and one-scheduler registration remain required.

### Deployed signed HTTP proof — internal fixture only

Release https://junction-i6b2djib1-tom-junctionmedis-projects.vercel.app uses source `0c8abce` and a deployment-only signing key. Canonical production key was not rotated. Production env download returned an empty local secret despite the deployed route being enabled; do not treat that retrieval limitation as proof of invalid runtime configuration. A launcher path-encoding error was corrected before the successful test; that failed launch created no database records.

`scripts/verify-grok-callback-live.mjs` passed: invalid token401, signed blocked result201, exact replay200, conflicting replay409, independent database readback. Request `425a1a25-e4e3-49ee-9430-d250f8f57350`, result `3231e1be-1b0d-45da-a6a8-d51592849589`. Worker label is explicitly `http-fixture-not-grok`; acknowledgement is synthetic blocked/runtime_error, NOT a claimed native confirmation.

The internal account now retains one disabled D02-W01 fixture row and two control records; paused=true, cap=0, contextGeneration=0, provider executions=0. Fixed IDs make the test refuse rerun; reconcile rather than rerunning or overwriting fixture state. No Grok webhook, model or provider was invoked. Native callback, customer switch/outbox and schedule-owner proof remain required.

## Deployment evidence — September 8

- Clean deployment snapshot excluded unrelated untracked files and the unused pilot route. Remote build completed in 45 seconds; TypeScript passed.
- Production callback signing secret provisioned server-side; callback release flag enabled. No client bindings, schedules or ad settings changed.
- POST without authorization to `https://junction-unc.vercel.app/api/external-agents/control/00000000-0000-4000-8000-000000000001` returns HTTP 401.
- Account status GET without a session returns HTTP 401.
- Deployed health check reported database healthy and an active worker with no last error. Its build SHA environment value is stale; use the deployment ID and sourceCommit metadata, not that health SHA, to identify this release.
- Three focused local test files passed, 42 tests total (simulated storage/network); local TypeScript passed.
- Live controller callback test could not start: native computer-use tool reported the Mac locked and unable to unlock automatically. User must unlock it. This is separate from the remaining software release gates below.

## What changes

The native webhook test showed Grok can enable, reschedule and disable a child routine but does not reliably produce a final response. The controller must now explicitly POST its result, not rely on final chat output.

`dispatchGrokChange` receives a server-approved binding, a saved account/routine setting and its exact revision timestamp. It persists a request in the existing receipts table before dispatch. A repeated change ID does not send another request. A timeout is ambiguous and requires reconciliation; it is not automatically retried.

The controller receives `contract: junction.grok-control.v1`, `change`, and `callback` fields. `change` includes the exact account, routine, context generation, saved-state timestamp, native worker ID, desired enabled state, daily schedule/timezone and expiry. `callback` supplies the HTTPS URL and narrowly scoped authorization header. Never print or store that authorization in the controller instruction, chat or result.

After applying the change and reading native state back, the controller MUST call the supplied callback with JSON:

```json
{
  "changeId": "<from change>",
  "workerId": "<actual pinned worker ID>",
  "status": "applied",
  "enabled": true,
  "schedule": { "time": "00:15", "timezone": "Pacific/Auckland" },
  "blocker": null
}
```

For blocked/failed, status must be `blocked` or `failed` and blocker one of `connection_required`, `skill_missing`, `policy_required`, `runtime_error`. Return actual observed enabled/schedule state, not desired state. No provider data, arbitrary error strings or secrets in the result. A failed request to pause cannot be reported as off.

Do not invent IDs or confirmations. Callback 201 means saved; identical replay returns 200. Conflicting result or superseded settings returns 409, expired change 410. Do not rerun the child when a callback fails. Retrying an identical callback is distinct from replaying the paid controller invocation; a bounded callback-only retry may be implemented next.

## Server configuration

- `JUNCTION_GROK_CONTROL_ENABLED=true` releases the callback only, not customer switches.
- `JUNCTION_GROK_CONTROL_SECRET`: server-only signing secret, at least 32 characters, securely generated. Never give the root secret to Grok; only the per-change derived authorization travels in its webhook event.
- Existing Supabase service environment required. No new tables, migrations or grant changes.
- Sender config contains the native webhook URL/key and canonical callback origin. It is an internal function, not a public arbitrary-URL dispatcher. The webhook hostname is restricted to the currently tested `api2.cursor.sh`; redirects are refused.

POST `/api/external-agents/control/<changeId>` is callback-authenticated. GET at the same path requires the existing account session and returns that account's change status only. Status distinguishes pending, confirmed, superseded and needs attention. `evidence: agent_reported` does not claim independent provider execution proof.

## Remaining release gates

1. Provision exact account → controller → worker binding and secrets server-side. Do not accept them from a customer request.
2. Integrate durable desired-state/outbox creation with the saved switch transaction. Current sender prevents duplicate dispatch once its receipt exists, but switch save and receipt creation are NOT yet atomic. No claim of guaranteed delivery across that gap.
3. Prevent the legacy n8n/worker scheduler from also running a routine handed to Grok. Do not merely add webhook dispatch after the current preference save.
4. Add the authenticated owner initiation path, schedule editor and status to the supplied UI. Current callback GET has no initiation UI.
5. Persist and deliver team setup tickets, including missing acknowledgements. `teamActionRequired` is a status signal today, NOT a delivered team notification or completed queue implementation.
6. Run one real Grok → HTTPS callback → database readback test. Then blocked and duplicate callback tests. No production database persistence tested yet.
7. Verify cancellation/reconciliation for in-flight settings and cross-client credential isolation before live account activation.

The old one-off read pilot remains unused. This is a direct event + callback design, not a new agent execution engine or provider integration.
# Configuration preflight addition — 2026-09-09

The sender now includes `authority: {url, authorization, method: "GET"}` alongside
the callback. Before applying the exact native configuration, the controller must
GET that supplied HTTPS endpoint using its scoped bearer token. Only a 200 body
with `authorized: true`, `scope: "routine_configuration_only"` and the exact
requested change permits proceeding. Non-200, unavailable, expired, superseded or
already-acknowledged changes must not be applied. Never log the token.

This read checks the stored account/generation, current switch timestamp and
enabled state, account pause, expiry and absence of an acknowledgement. It writes
nothing and grants no authority to send, publish, spend or execute provider actions.
A paused account may still authorize disabling a routine. Responses are no-store.

This is a preflight, NOT a distributed lock or a permanent scheduling lease.
The callback still checks current settings independently. A setting may change
between preflight and native application; reconciliation and scheduler ownership
remain necessary. The controller must retain change-ID idempotency locally; this
read endpoint alone does not prevent concurrent native application.

Implementation verification: 31 simulated transport tests pass, including eight
new preflight cases. Native controller adoption and live proof remain unverified.
No production deployment, native routine changes or provider calls in this slice.
Atomic desired-state/outbox creation and exclusive scheduler ownership are still
open; this endpoint does not claim to complete either.
