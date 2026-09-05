# Runtime context release and approved AVGAR keyword

Verified 5 September 2026, approximately 04:50 UTC. **PASS for this bounded release and stored decision; PARTIAL for the complete backend goal.** No authorized n8n/provider round trip has run. AVGAR remains paused and the 24-item backend register remains active.

## Source and deployments

| Item | Verified value |
|---|---|
| Source | `d95aaa403217422dc53d655a4ff9b305516577c6` on `codex/backend-foundation-20260905`, pushed and independently read back from GitHub |
| Repository | [JunctionAI/junction-ai-unc](https://github.com/JunctionAI/junction-ai-unc/tree/codex/backend-foundation-20260905) |
| Production app | [junction-unc.vercel.app/app](https://junction-unc.vercel.app/app) |
| Vercel | `dpl_Dq6nSURoPPcrdd15md69MxD2G6jA`, production target, READY; remote build 58.347 seconds |
| Tested candidate | `https://junction-kcx12jvy6-tom-junctionmedis-projects.vercel.app` |
| Worker | `unc-worker`, existing Sydney machine `1857466fd76998`, release 11; no extra machine |
| Worker image | `registry.fly.io/unc-worker@sha256:8b1afc9e60a1d5d7546b903128f2038d40a9630d8476d2a246e3189335aaa012` |

The app was built without moving the production alias, smoke-tested, then promoted. The worker was updated to the exact built image with `--ha=false --update-only --only-machines 1857466fd76998`. Both deployment commands completed successfully; there was no blind retry. The deployed source includes captured-generation runtime/proxy guards and the independent n8n reader, which remains disabled.

Local validation: **183 test files / 2,174 tests passed**, application and standalone worker typechecks passed, production build passed, lint zero errors / 39 existing warnings, and diff checks passed. The remote app build and worker compilation passed separately. Tests of the reader are synthetic, not proof of this n8n Cloud API's response compatibility.

## Post-deployment readback

- Canonical app health at `04:47:10.541Z`: HTTP 200, source `d95aaa403217`, healthy database and fresh worker heartbeat, two completed ticks, no worker error.
- Worker at `04:47:07.712Z`: full source SHA matched, two completed ticks, `runsStarted=0`, `mode=dryrun`, `liveMode=false`.
- Candidate unauthenticated account state and shadow authority returned 401. Empty Apple-channel POST returned 503 / `apple_channel_not_ready`; no message was sent.
- Worker controls `UNC_COMMANDS_ENABLED`, `UNC_MESSAGING_ENABLED`, `LIVE_MODE_ENABLED`, `TNZ_SMS_ENABLED` and `APPLE_MESSAGES_ENABLED` all remained false.
- Signed-in app showed AVGAR Sport / `halltaylor.tom@gmail.com`, explicit automation pause, zero enabled routines, disabled brief generation, no goal or agreed plan, and two connections with dated verified-read evidence (Meta Ads and Shopify). This is not a claim of an always-live provider feed or a new credential read in this release.
- Existing background KPI snapshot/measurement catch-up jobs ran on worker restart. No n8n routine, provider mutation or paid keyword test was dispatched.
- Bounded Vercel error/fatal scan from `04:44` to `04:49:07 UTC` returned zero entries. Log drains were empty. This is a short post-deploy check, **not** continuous monitoring, alert delivery or full tracing acceptance; those remain work.

## Database guard release

Applied migration `20260905044013_runtime_run_context_fence` in Supabase project `ycgayfsvcjpsnryrpukv`, from repository migration `20260905042742_runtime_run_context_fence.sql`.

`routine_runs` captures context generation. A private trigger-only definer enforces account/generation/pause and parent consistency for runs, artifacts, approvals and receipts. Each short DML operation locks the account; no lock spans network I/O. Root identity/generation and child parentage cannot be rewritten. Client privileges were not broadened, archived history was not rebased, and runless legacy writes are permitted only at generation zero. This is not coverage for every queue, intake, brief, note or telemetry writer.

The migration passed a rollback rehearsal. `scripts/verify-runtime-run-context.sql` then passed against the live migration with actual service-role/trigger semantics; its synthetic rows were rolled back. Independent readback found the four triggers and no remaining test accounts/runs. At that point AVGAR remained generation 1 / paused / revision 14; all six other accounts remained generation zero / unpaused. No simultaneous multi-connection stress test is claimed.

Security advisors remained at six WARN / eight INFO with no new-trigger finding. Existing auth-helper exposure, extension placement and leaked-password protection remain under B20. Existing performance findings also remain open. No blanket RLS/grant changes were made to clear advisors.

## Approved seed: persisted, not merely documented

Tom explicitly approved **golf travel bag**, separately in the **US, NZ and AU**, for keyword discovery relevant to the UFORIA Travel Case. Demand, competition and SERP fit still need evidence; this is not a winning-keyword claim or authority to optimise/publish pages.

The already-executed bounded script `scripts/record-avgar-keyword-seed.sql` locked the exact paused AVGAR account/current revision and asserted no runs or duplicate source reference. A first rehearsal exposed the existing profile revision trigger; that entire transaction rolled back. The script was corrected to expect that trigger's single increment, passed another rollback rehearsal, and was committed once at `2026-09-05T04:49:17.900988Z`. Do not replay this script.

| Stored evidence | Value |
|---|---|
| Account | `aa5cfc84-2569-4c99-9b40-67003ae55eda` |
| New decision memory | `e9f8979b-0a89-4f7b-945e-3eb5f01e51a6` |
| Source reference | `founder-keyword-seed:2026-09-05:golf-travel-bag` |
| Superseded no-seed memory | `b8837a35-4e1d-4fd5-b76d-326b96d3040a`; closed and linked to the replacement, not deleted |
| Account state | Revision 15, context generation 1, automation paused |
| Unchanged counts | Runs 0, commands 0, briefs 0, n8n registrations 0, enabled routines 0, previous chat rows 2 |

Independent SQL readback confirmed the new memory, supersession and profile note. A fresh signed-in app reload showed the same seed and per-market limitation in **What Unc knows**; the stale no-seed-approved text was absent. No new model conversation was generated, so this verifies persisted/displayed context, not a new chat response. Credentials, provider bindings, commercial targets, budget and other unconfirmed settings were not changed.

## Remaining gates and next owners

1. **Nguyen:** set the fixed `pinned_junction_origin` field to `https://junction-unc.vercel.app`, validate/refusal-test, republish and freeze the resulting **new** revision. The reported `4fb2f570-705f-40ed-99cd-fdbdf041420b` currently evidences the unset-origin denial, not the configured wrapper. The n8n lifecycle skill requires validation before publication; Codex lacks those n8n validation tools and therefore made no partial browser edit. See [the copyable handoff](integration/D03-W01-WRAPPER-HANDOFF-2026-09-05.md).
2. **Codex:** finish generation coverage for delayed/runless work, bounded run admission and durable duplicate/uncertain-paid-call reconciliation. Preserve the account pause until these gates pass.
3. **Codex / supported provider access:** obtain appropriately reviewed execution API access, independently verify the actual saved execution shape, provision the missing worker signing root and remaining receiver/data-origin/reader configuration, pin final account/URL/revision/node registration and verify it. Vercel Production lists `N8N_SIGNING_SECRET`; the worker does not. Secret values were not extracted or compared. No paid-plan purchase or API-key creation occurred.
4. **Codex + Nguyen:** only then run the bounded keyword pilot, separately scoped by market, and correlate independent saved n8n evidence with persisted Unc artifacts/receipts. Keep no blind paid-call retries and no fabricated/fallback success.

The owner-approved seed is **no longer a blocker**. Product-to-price/currency binding and other business settings remain unconfirmed where needed; they were not invented. Phone-channel approval/testing, wider routine coverage, second-client isolation and ongoing operations remain in the broader register.

## Recovery reference

Previous matched source: `b7c347bfd9ff862f00b01e6fb71740e26d783b0c`; prior Vercel deployment `dpl_Ccr4mnbwiaoT5Ma7391f94eLyXxj`; prior Fly image `registry.fly.io/unc-worker@sha256:44231bcff9ea4f5d32e72353ddd71b509ece8e48f6f6dacf5d815203b3e9821f`.

Any operational rollback must preserve the paused account, protected context schema, approved memory and private repair archive `e56cac77-1940-41b4-99db-677aa30e4222`. Do not reverse or replay the context repair, relabel historical generations, or erase the seed decision. Reverify schema compatibility before choosing an older runtime. No rollback was needed or performed.
