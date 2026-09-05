# Calendar campaign read and staged registration — Batch 70

6 September NZ / 5 September UTC. **PARTIAL: real source read verified; customer
calendar round trip remains unproven.** This continues, not narrows, B01–B24.

## Native provider evidence

Separate Codex-owned manual workflow `Jx7LgmNcyz3Y6d42`,
[open probe](https://junctionai8.app.n8n.cloud/workflow/Jx7LgmNcyz3Y6d42), has two
nodes, no schedule, no pinned data and no Unc authorization or result-writing
step. It remains inactive. Existing native Klaviyo credential
`4mkTKL1q0njNafh9` supplies the reviewed campaign GET; secrets were not copied.

Saved execution **98**, actual revision `9a2c614a-7ad0-46e5-869c-4afe95919b5f`,
ran at **21:25:23.926–21:25:26.215 UTC**. The native request took **2,247 ms**:
HTTP 200, provider account **SuYidF**, API revision **2026-07-15**, **42 sent
campaigns**, one complete page with `links.next=null`. All send times are strings
and all archived fields are booleans. No contacts or messages were requested.

The actual compiled receiver normalizer accepts those saved provider inputs:
**10 campaigns** fall within the run's 90-day window; 32 older rows are excluded.
The compatibility calculation uses the original saved read clocks, not today's
clock. It does not invent a customer run, consumed authority, business artifact,
live execution receipt or a current stored-data freshness claim.

Authenticated GET-only verification at **21:35:19.875 UTC** independently matched
the current definition and saved execution graph, parameters, credential binding,
execution policy, parent edge and actual executing revision. Definition digest:
`ad1e9abfdcd3d850f184a0e796fffcb4c3074a225d58fbf7b1fe8b33993d585c`.
Receiver bundle SHA-256:
`20c76c1a8a9c32fb72b313e97e4dc97d9f6f3826ece460570e768c0ab722caa2`.

The saved Cloud snapshot resolves a few no-op node defaults absent from the
editor export. The verifier normalizes only their exact observed values; any
changed authentication, body/query, TLS, parameter or execution behavior still
fails parity. Initial snapshot-parity failures were reconciled against the same
saved execution. **No repeat provider call was made to repair the verifier.**

This proves the native first-page/terminal-page behavior and actual input
compatibility. It does not prove following multiple live pages. The request has
five-page and five-second per-request limits; the probe has a 40-second total
timeout, redirects and retries disabled. Larger incomplete datasets fail closed.
The watched manual probe is not an unattended workflow or an alerting solution.

## Receiver, registration and configuration

Fresh receiver GET at **21:36:11.271 UTC** still matches the reviewed 13-node
draft `rQeWMo5ANO9OtUJp`, revision `52b301af-a66a-4377-9e36-fe836879e833`.
It is unpublished and inactive. Definition digest:
`ac91b90d8460bd8f3f685b0a388c97ceb7f3b5da836986836c6d6e1d4a04104c`.

The guarded transaction in `scripts/stage-avgar-calendar-registration.sql`
created one **inactive** AVGAR registration after a rollback rehearsal:
`33336ed7-41b9-410b-9560-4fdf42938e32`, routine `D05-W07`, destination
`https://junctionai8.app.n8n.cloud/webhook/unc/d05-w07/calendar-shadow`.
It checks the original paused generation-1 NZD account and current owner,
refuses conflicting destinations, and does not overwrite a changed record.
No new schema, grants, credential, binding, allowance or routine state was created.

Independent SQL readback at **21:36:06.031219 UTC** confirms that registration is
inactive, AVGAR remains paused / generation 1 / NZD, with **zero calendar bindings,
zero calendar runs and zero enabled routines**. The account's saved calendar
timezone is still null. Provider US/Eastern/USD has not overwritten Unc context.
The first combined readback query used nonexistent table names; it failed without
writes and was corrected against the actual migration-defined names.

Vercel Production metadata confirms all five separate calendar settings exist;
Fly metadata confirms all five are **Staged**, not deployed:

| Setting | Nonsecret value or state |
|---|---|
| `N8N_CALENDAR_SHADOW_RECEIVER_URL` | Reserved calendar URL above |
| `N8N_CALENDAR_SHADOW_WORKFLOW_ID` | `rQeWMo5ANO9OtUJp` |
| `N8N_CALENDAR_SHADOW_TRIGGER_NODE_ID` | `15393260-968f-4820-91f5-c38c189f00aa` |
| `N8N_CALENDAR_SHADOW_RESULT_NODE_ID` | `3193f942-2781-4122-9415-c653a32b1e39` |
| `N8N_CALENDAR_SHADOW_RECEIVER_TOKEN` | Dedicated secret; no value projected |

The pending CLI handles were missing on continuation; metadata reconciliation
confirmed completion instead of blindly repeating configuration writes. Vercel
presence and Fly staging are not proof of values in running application code.
No app/worker deployment or action-flag change occurred in this batch.

## Local validation and remaining delivery

**82 Node tests pass**, including 23 new probe/projection cases. They cover
source shape, native read bounds, old/future/missing campaign times, provider
identity/revision, complete pagination, duplicates, parent edges, retry/pin/
redaction refusal and secret-safe errors. Existing receiver/fixture tests remain
green. Focused lint and diff checks pass. App source is unchanged; the prior
Batch 69 full app/type/build evidence is retained, not presented as a new run.

Next Codex-owned work: finish the accepted immutable account binding using the
chosen calendar timezone, publish the reviewed receiver with appropriate failure
visibility, release coherent configuration and prove a bounded Unc calendar
request through saved artifact/receipts and the actual client screen. Customer
selection/recovery and all other lane/client/channel/security/cost/retention
requirements remain in the original goal. The pending timezone choice is not
the only remaining work and does not make Nguyen a launch dependency.

No Nguyen workflow was changed, no messages or ads were changed, and no calendar
schedule or outward-action permission was enabled. The advice-only preceding
turn made no backend progress; this continuation reconciles and verifies real
source/configuration/database work. Full goal remains active and incomplete.
