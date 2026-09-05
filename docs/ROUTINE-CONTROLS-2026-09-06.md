# Routine controls and inspector — Batch 32

6 September NZ time / 5 September UTC. Implements the concrete inspector contradictions observed in Batch 31. This is a scoped improvement, not a claim that every client or workflow is operational.

## Implemented

- Agents, legacy routine switches and first-routine setup use the same account/generation-bound preference endpoint. Compatibility URLs re-export that implementation; old revisionless requests refuse rather than inventing an expected revision. The existing service-only atomic switch function is reused. Selecting a routine does not request a run.
- Detail reads carry the account context and render the actual effective saved specification, including promoted cadence and version. Current list/detail revision disagreement blocks actions. A configured cadence is explicitly not a verified schedule; a registered n8n workflow is not an execution receipt. Failed settings/artifact reads are errors, not successful empty work.
- Manual run/resume checks current owner, account generation, pause and selected-routine eligibility. Start also requires the observed routine version/timestamp and refuses browser-supplied account inputs. The account resolver is checked again before dispatch. Responses are correlated to account/generation/routine; uncertain responses do not automatically retry. D03-W01 retains the separate operator-registration/independent-verification gate.
- Merely reading parameters no longer initializes a routine-state row. Settings requests and replies carry account/generation and expected configuration revision; mutations/validation are owner-only and pause-aware. Dry-run validation requires a selected routine; the keyword pilot cannot bypass its operator gate through validation/promotion.
- The inspector and contract cards fit a 390px viewport. No new provider, dependency, credential, migration, client membership or worker deployment is required.

## Verification and release

Application and worker type checks and local Next.js production build pass. Final full unit run: **206 files / 2,583 tests PASS**, zero failures. Changed-file lint has zero errors and three existing warnings (two native-image warnings, one unused test import). Fourteen Agents/detail browser cases and fourteen existing workspace/ops cases pass in the isolated synthetic fixture; no live client/provider calls occur in these tests. Earlier failures were corrected stale expectations for the old contracts/copy and a real 390px header overflow; final suites pass.

## Live release receipt

- URL: [client app](https://junction-unc.vercel.app/app); [immutable candidate](https://junction-4nn86s373-tom-junctionmedis-projects.vercel.app).
- Source **`332dd3092b8de65cc145647478412385b52a0e8a`**, pushed to `codex/backend-foundation-20260905` and deployed from the clean detached checkout. Unrelated `src/lib/runtime/context 2.ts` remains untouched and excluded. Framework Next.js; production deployment **`dpl_CbNPVM6MZaSxUCvhvEi8Rw1QhmoL` READY**, explicitly promoted after candidate checks. Build-to-ready **43.007 seconds** from deployment timestamps. Runtime/build source markers match the source commit; no secret/action flag changed.
- Candidate health **12:06:48 UTC**, canonical **12:07:09** and **12:08:55 UTC** report SHA `332dd3092b8d`, healthy DB and a fresh unchanged compatible worker; ticks 102→104, no last error. Worker remains Batch 27/Fly release 19. No restart solely to match frontend SHA.
- Candidate/canonical anonymous Agents and canonical legacy state deny **401 / private, no-store**. Anonymous params also denies 401 but retains the existing `public, max-age=0, must-revalidate` response header; do not report every denial as private/no-store. Normalize this with the remaining settings boundary work.
- Actual signed-in AVGAR: Agents reads **0/35**, search/Inspect works, D03-W01 detail now says configured (not active/live), explicitly disclaims a verified schedule, and disables Run now, Save and settings while paused. Refresh settings, refresh routine and full-document app reload pass. Reload returns to Today; reopening Agents works, rather than claiming deep-link restoration.
- D02-W03 had **no state row** before inspection. Its actual detail and preset fields loaded, showed the existing missing `ctr trend` reader requirement, and remained read-only/paused. Independent SQL at **12:08:52 UTC** confirms no D02-W03 row was created. Across **12:06:34**, **12:08:03**, **12:08:52 UTC**, all eight routine rows retain fingerprint `2904a47688180bca2951c067cc6fd118` for account/routine/updated-at projection. This is live read-only evidence plus unit route checks, not simultaneous multi-connection mutation acceptance.
- Final inventory: seven accounts, two memberships, nineteen connector rows, zero saved runs, zero enabled routines; pilot generation 1/paused. No account, provider asset, credential, membership or workflow was changed. No live run, model/provider generation, publication or customer message occurred.
- Bounded deployment error/fatal scan **12:06–12:08:12 UTC** and 5xx scan **12:06–12:08:53 UTC** returned no entries. Drains were not rechecked; these short scans are not full monitoring/security acceptance. Rollback target remains Batch 31 `dpl_2hYaXcsufZYwMRgAJH81uvCZEH2d`, source `63e932a140479f43bebd3670ea7bfb70b7dedacd`.

Next/React guidance kept client/server boundaries and explicit loading/refusal states; Supabase guidance retained service-owned account authority and verified the removal of read-time writes. Vercel guidance kept candidate verification separate from promotion. No architectural/provider replacement was introduced.

## Explicit remaining work

- Parameter mutation preflight is **not** an atomic compare-and-swap transaction: existing params/draft/promote/discard writers still need coherent database acceptance across concurrent edits, pause, membership revocation and context repair. Historical dry-run proof also needs a current-generation promotion check. This batch does not claim those races are closed.
- General manual start/resume still needs durable request identity, execution acceptance/reconciliation, bounded request lifetime and duplicate/concurrent-start tests. The UI's in-flight guard and no-automatic-retry behavior are not server idempotency. A preflight check does not replace an execution-time authority fence.
- Routine availability still uses the older connector sync-status projection; selected-asset, credential renewal and actual fresh-provider evidence must be completed as a separate journey. Stored selection/specification is not reliable delivery proof.
- Recent history remains bounded, and full schedule, delivery/cost/stall monitoring and per-client useful-output acceptance remain open. Existing-client identity/system reconciliation is next independent work. Five missing client memberships must not be guessed from names.
- n8n supported execution-read entitlement/key authority and receiver-secret reconciliation are unchanged owner/platform dependencies. No paid upgrade, key creation, secret rotation or Nguyen workflow edit/execution is included.

Publishing, customer messaging, ad mutations and spend activation remain disabled. AVGAR remains paused. The full B01–B24 plus all-screen/all-client goal remains active.
