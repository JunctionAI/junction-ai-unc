# Captured command-context release — 5 September 2026

**PASS for the bounded command-safety release; PARTIAL for the full backend goal.** The database, app and worker changes are live. AVGAR remains paused; no n8n dispatch, paid keyword run, outward message, publication or ad mutation was performed.

## Deploy result

- **URL:** https://junction-unc.vercel.app/app
- **Target / status:** production / READY
- **Commit:** `3b001703b65fe3dd0edeb421b2eef9a6ae43ccdb`, pushed to `codex/backend-foundation-20260905` and independently read back from GitHub
- **Framework:** Next.js 16.3.4
- **Remote build duration:** 38.926 seconds (`buildingAt=1788584697701`, `ready=1788584736627`)
- **Vercel deployment:** `dpl_FJfzNkmeGgJTfT4D6t1pkKPfsphA`
- **Tested candidate:** `https://junction-wfovtyuhw-tom-junctionmedis-projects.vercel.app`
- **Worker:** existing Sydney machine `1857466fd76998`, release 12, image `registry.fly.io/unc-worker@sha256:1355c210104d58b500c63278ebc196135005f7487079c1c8670c2be2cb81ec56`

The deployment guidance's two-phase approach was used: verify the additive schema, test the production-target candidate without switching the canonical domain, update only the existing worker to the exact built image, confirm its source/heartbeat, then promote the candidate. All build/deploy/promote commands completed successfully; no ambiguous mutation was blindly retried and no extra worker was created.

## What changed

- Commands persist the generation captured by the accepted message, independently of the routine/workflow fingerprints. The accepting app session supplies it; omitted legacy ingress is generation zero only, never a request to use today's generation.
- Interpretation, eligibility, worker claim, execution, completion and reconciliation recheck account generation and pause. Caller objects are copied/frozen across awaits. The worker rejects loading newer account inputs for an older command. Stale history is not relabelled or converted into a new-context error receipt; unavailable controls surface as worker errors.
- SQL protects immutable command identity (tenant, owner, channel/link, request, generation, routine/version/fingerprints) and deterministic command/run binding. A legacy worker cannot attach a stale claim to a fresh run. Both insertion orders check existing identity. These are private **security-invoker** triggers, not definer RPCs.
- A service-only invoker polling function filters paused/stale commands before the result limit, preserving progress for active tenants. Pending Apple notifications are included alongside other supported channels; no channel flag is enabled.
- Owner status APIs filter by captured generation and recheck after reads. The browser carries the original generation on status requests and discards late replies/errors after a same-account reset. Account chat remains available while setup is paused; explicit `/run` gets a truthful refusal without intent-model work.

This is command-level fencing, not yet end-to-end channel ingress/outbound or all background-writer fencing. Notification preflight is not a lock across network I/O; a provider operation already underway cannot be made atomic with a context reset by a database read.

## Database evidence

Applied migration **`20260905050313_command_context_fence`** to Supabase `ycgayfsvcjpsnryrpukv`, from repository file `supabase/migrations/20260905045726_command_context_fence.sql`.

`scripts/verify-command-context.sql` passed first as an entirely rolled-back schema rehearsal and again against the applied schema. It verifies real service-role/trigger semantics: stale/missing-generation refusal, immutable request/tenant/claim, single compare-and-set claim, wrong/unclaimed run refusal, legacy-worker rebase denial, current-generation success, pause/unpause, current-only polling, active unrelated tenant eligibility, Apple notification selection, server-only RPC/table access and invoker privilege.

Both runs rolled back all synthetic data; no auth user was created or changed. Independent readback confirmed no synthetic accounts and zero commands/runs. This is not a simultaneous multi-connection stress test or a live provider execution. The three new functions all have `prosecdef=false`; neither anon nor authenticated can execute them, and service_role can directly execute only the polling RPC, not the trigger functions.

Security advisors remain six WARN / eight INFO, with no finding naming the three new functions. Existing auth helper exposure, extension placement and password-protection work remains B20; no blanket RLS/grant changes were made. The [Supabase function guidance](https://supabase.com/docs/guides/database/functions) informed the invoker and explicit privilege choices.

## Application and runtime evidence

- **184 files / 2,200 tests passed**, including 26 added regressions; application and worker typechecks, final production build and diff checks passed. Lint: zero errors / 39 existing warnings.
- New tests cover nonzero generation, reset/pause/missing controls before paid interpretation, context changes during interpretation/eligibility/execution, replayed message IDs, caller mutation, stale reconciliation/notification, filtering before limiting, owner status isolation and browser polling/late-response behavior.
- The queue fake and mocked React hook harness are application tests, not SQL enforcement or browser-render acceptance. The PostgreSQL canary supplies separate database evidence.
- Candidate `/api/health` returned source `3b001703b65f` and healthy storage. Unauthenticated `/api/unc/commands` and `/api/n8n/shadow-authority` both returned **401** before promotion.
- Canonical production health after promotion reported the same source, healthy database and fresh worker. Worker heartbeat at **`05:07:42.874Z`** showed two ticks, zero routine starts, `dry_run`, live mode false and no stopping state.
- Fly machine readback confirmed one started machine, exact image, passing health and all five flags false: commands, messaging, live mode, TNZ SMS and Apple Messages.
- Signed-in app reload showed AVGAR Sport, the correct owner, zero enabled routines, explicit setup pause, disabled briefs, no invented goal/plan, and two dated verified-read connections (Meta/Shopify). **What Unc knows** retained the approved `golf travel bag` seed, separate US/NZ/AU markets and the 50%-of-product-price CPA limit. No new model answer was generated.
- An additional attempt to navigate the signed-in browser directly to the command-status JSON endpoint was blocked by the browser client (`ERR_BLOCKED_BY_CLIENT`). It is **not** counted as live owner-status evidence, and no cookie extraction or alternate authenticated request bypass was attempted. The browser was returned to the app. Positive owner/current-generation and stale-header behavior are currently covered by tests, not a live submitted command.
- Final SQL readback: AVGAR generation **1**, revision **15**, paused; runs/commands/briefs/registrations/enabled routines all **0**; approved seed still current. All six other accounts remain generation zero/unpaused.

### Post-deploy observability

- **Error scan:** the bounded error/fatal scan of this deployment, starting `05:04 UTC` and refreshed after promotion, returned no log entries.
- **Drains:** none configured (`drains=[]`).
- **Monitoring:** short release smoke checks and heartbeat verified; continuous alert/drain/tracing acceptance remains incomplete. An empty bounded scan is not a guarantee that no runtime error can occur.

Existing KPI-snapshot/measurement catch-up jobs ran on worker restart, as before. They are not proof of a dispatched routine or paid n8n keyword run.

## Remaining work / recovery

Next Codex work: generation-aware channel inbox acceptance and outbound persistence, intake, briefs, founder notes, telemetry and other delayed/runless writers; then bounded pilot admission/duplicate/uncertain-call reconciliation. Worker signing and supported independent execution API access/configuration remain required. Nguyen still needs to return a validated published revision with the canonical origin configured. No n8n workflow was inspected, edited, registered or executed in this batch.

Preserve the full 24-item completion register. This release does not certify phone delivery, automatic sync/recovery, all workflow combinations, a second customer or approval-controlled external actions.

Recovery reference: previous matched source `d95aaa403217422dc53d655a4ff9b305516577c6`, Vercel `dpl_Dq6nSURoPPcrdd15md69MxD2G6jA`, Fly image `registry.fly.io/unc-worker@sha256:8b1afc9e60a1d5d7546b903128f2038d40a9630d8476d2a246e3189335aaa012`. Keep AVGAR paused and preserve the additive context schema, approved memory and private repair archive. Do not roll back or replay the account repair or relabel history. Reverify schema compatibility before any runtime rollback; none was needed.
