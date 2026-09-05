# Routine controls and inspector — Batch 32

6 September NZ time / 5 September UTC. Implements the concrete inspector contradictions observed in Batch 31. This is a scoped improvement, not a claim that every client or workflow is operational.

## Implemented

- Agents, legacy routine switches and first-routine setup use the same account/generation-bound preference endpoint. Compatibility URLs re-export that implementation; old revisionless requests refuse rather than inventing an expected revision. The existing service-only atomic switch function is reused. Selecting a routine does not request a run.
- Detail reads carry the account context and render the actual effective saved specification, including promoted cadence and version. Current list/detail revision disagreement blocks actions. A configured cadence is explicitly not a verified schedule; a registered n8n workflow is not an execution receipt. Failed settings/artifact reads are errors, not successful empty work.
- Manual run/resume checks current owner, account generation, pause and selected-routine eligibility. Start also requires the observed routine version/timestamp and refuses browser-supplied account inputs. The account resolver is checked again before dispatch. Responses are correlated to account/generation/routine; uncertain responses do not automatically retry. D03-W01 retains the separate operator-registration/independent-verification gate.
- Merely reading parameters no longer initializes a routine-state row. Settings requests and replies carry account/generation and expected configuration revision; mutations/validation are owner-only and pause-aware. Dry-run validation requires a selected routine; the keyword pilot cannot bypass its operator gate through validation/promotion.
- The inspector and contract cards fit a 390px viewport. No new provider, dependency, credential, migration, client membership or worker deployment is required.

## Verification and release

Application and worker type checks and local Next.js production build pass. Changed-file lint has zero errors and three existing warnings (two native-image warnings, one unused test import). Fourteen Agents/detail browser cases and fourteen existing workspace/ops cases pass in the isolated synthetic fixture; no live client/provider calls occur in these tests. The final unit-suite and deployed readback receipts are recorded below after verification.

## Explicit remaining work

- Parameter mutation preflight is **not** an atomic compare-and-swap transaction: existing params/draft/promote/discard writers still need coherent database acceptance across concurrent edits, pause, membership revocation and context repair. Historical dry-run proof also needs a current-generation promotion check. This batch does not claim those races are closed.
- General manual start/resume still needs durable request identity, execution acceptance/reconciliation, bounded request lifetime and duplicate/concurrent-start tests. The UI's in-flight guard and no-automatic-retry behavior are not server idempotency. A preflight check does not replace an execution-time authority fence.
- Routine availability still uses the older connector sync-status projection; selected-asset, credential renewal and actual fresh-provider evidence must be completed as a separate journey. Stored selection/specification is not reliable delivery proof.
- Recent history remains bounded, and full schedule, delivery/cost/stall monitoring and per-client useful-output acceptance remain open. Existing-client identity/system reconciliation is next independent work. Five missing client memberships must not be guessed from names.
- n8n supported execution-read entitlement/key authority and receiver-secret reconciliation are unchanged owner/platform dependencies. No paid upgrade, key creation, secret rotation or Nguyen workflow edit/execution is included.

Publishing, customer messaging, ad mutations and spend activation remain disabled. AVGAR remains paused. The full B01–B24 plus all-screen/all-client goal remains active.
