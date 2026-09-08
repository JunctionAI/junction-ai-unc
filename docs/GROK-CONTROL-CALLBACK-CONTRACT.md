# Junction Grok control callback — implementation handoff

Status: sender, callback route and account-scoped status reader implemented. Callback deployed to production on September 8 at commit `b33e085`, deployment `dpl_64SjUzZPH7FLiLBX55caX2GBPwPn`. NOT connected to customer switches and NOT a completed live Grok callback proof.

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
