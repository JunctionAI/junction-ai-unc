# Brief/KPI context release — 5 September 2026

Status: **PASS for this bounded release; PARTIAL for the full backend goal.** The 24-item register remains active. AVGAR stays paused. This is not an n8n E2E result, delivery proof, current-product-price verification or launch sign-off.

## What changed

- Briefs, KPI snapshots and the worker's derived decision-style update use the account generation captured before gathering inputs. Checks run around data/model/provider waits and before accepting a result. A failed model/provider call does not bypass a subsequent reset through fallback output.
- Database triggers serialize each short output write against account pause/reset. They reject stale/missing captured identity, immutable-identity changes and paused work. No account lock spans a network call.
- Same-day brief/KPI uniqueness includes generation, preserving history instead of overwriting a prior business context. Existing unbound outputs remain generation zero; nothing is relabelled using today's account generation.
- Receipt/approval generation is derived from the actual immutable parent run at insertion, then immutable. Run-less KPI failure receipts must explicitly carry the producer's captured generation. Run-less approvals/artifacts remain unsupported after generation zero.
- Brief evidence filters runs, receipts, approvals, KPI snapshots, upcoming memories and yesterday's brief by captured generation before result limits. Old receipts cannot crowd current receipts out of the 200-row window.
- The worker's brief candidate and persisted local-day marker include generation. A scheduled candidate cannot resolve into a different generation, and an old marker cannot suppress a fresh context. KPI jobs skip paused or missing accounts.
- The derived-style merge uses a service-only security-invoker RPC and a short account lock. It preserves unrelated profile keys and uses only current-context approval evidence and bound taste events. Unrelated profile/intake/hook writers are **not** claimed covered.
- GET/POST brief routes require the request generation after a repair, preserve owner-only generation/member reads, return sanitized errors and recheck context after stored-output reads. Paused accounts can still read an already-stored current-context brief.
- The brief card carries the generation header, uses an account/generation-keyed lifecycle and aborts/discards old requests on unmount. Initial output from a different context is excluded; Home's brief-presence state is context-bound. React guidance informed keyed resets rather than effect-driven state rebasing.

## Verification

- **185 test files / 2,216 tests pass** after the final SQL correction; app and standalone worker TypeScript pass.
- Production webpack build passes. Final app runtime uses Next.js 16.3.4. Lint: zero errors, 39 existing warnings.
- Added reset/pause race cases during successful and failed provider/model calls; omitted/malformed-generation denial; current-only evidence with 250 old receipts; separate same-day history; delayed style-write refusal; marker/candidate generation binding; sanitized endpoint errors and stale initial-card exclusion.
- These tests use fixtures, a schema-checked fake and server rendering. They do not prove interactive browser cancellation or simultaneous multi-connection SQL contention.
- Real rollback-only SQL rehearsals covered both legacy and new generation-zero conflict targets during the additive stage, then final same-day history and security behavior. No synthetic rows were retained.
- After all corrections, all three real PostgreSQL canaries passed: `verify-brief-kpi-context.sql`, `verify-runtime-run-context.sql`, `verify-command-context.sql`.

## Database release and correction

Supabase project: `ycgayfsvcjpsnryrpukv`.

| Applied migration | Repository file | Purpose |
| --- | --- | --- |
| `20260905052625_brief_kpi_context_fence` | `20260905051500_brief_kpi_context_fence.sql` | Add generation columns/new keys and guards while retaining legacy keys |
| `20260905052845_retire_brief_kpi_legacy_keys` | `20260905052336_retire_brief_kpi_legacy_keys.sql` | Remove old keys only after replacement app/worker readback |
| `20260905053022_fix_context_trigger_parent_access` | `20260905052957_fix_context_trigger_parent_access.sql` | Correct row-type-specific parent-field access |

The older runtime canary caught a real compatibility regression after the first two stages: a shared trigger expression referenced `NEW.run_id` while updating a `routine_runs` row, which has no such field. Boolean short-circuiting did not prevent PL/pgSQL field resolution. The database returned `42703`; the synthetic transaction rolled back.

This was corrected in an additive migration using a nested row-type branch, not by editing migration history or disabling the guard. A rollback rehearsal passed before applying it. Then the old runtime, expanded brief/KPI and command canaries all passed again against the actual database. The new canary now includes valid and stale updates of the parent run. There were zero real runs at correction preflight/readback, and AVGAR remained paused throughout.

Schema correction and expanded canary are pushed in `527d51707bd86d3e06863033be327756eed77d95`. This SQL/script-only follow-up does not change the deployed JavaScript runtime.

Final readback: no legacy brief/KPI keys; zero synthetic accounts across all three canaries; 18 pre-existing KPI snapshots retained. AVGAR remains generation **1**, revision **15**, pause **true**, runs **0**, commands **0**, briefs **0**, chats **2**. The six other accounts remain generation zero/unpaused. The approved seed memory is still active.

Security advisors remain **six WARN / eight INFO**, with no finding for the new invoker trigger/style RPC. Existing findings are not waived: see [function privilege review](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Application / worker receipts

- Runtime source: `00fc57cfd07b175bc0d0c452c94f32ecd2d1e735`, pushed and independently read back from `codex/backend-foundation-20260905`.
- Production app: https://junction-unc.vercel.app/app
- Vercel: `dpl_CJ3wGqojJj3eaWmktmQTCs6rsYy2`, production **READY**, Next.js. Candidate: https://junction-813hyta18-tom-junctionmedis-projects.vercel.app
- Remote interval: `05:25:55.083Z` → `05:26:43.772Z`, **48.689 seconds** from building to ready.
- Candidate health returned 200/new SHA; unauthenticated brief GET returned 401. Shadow-authority GET returned 401 without a bearer. An initial probe used unsupported POST and returned 405; that was **not** counted as authentication proof. No valid data token or provider call was used.
- Fly: existing single Sydney machine `1857466fd76998`, release **13**, image `registry.fly.io/unc-worker@sha256:694e435341a950bb3173004d07fa214f5fc9851107c6228290f56cddc8860e5c`.
- Built separately, then deployed that exact image with update-only/one-machine restrictions. Build, deploy and promotion exited zero. Independent machine metadata confirms image, release and all five action flags false.
- At `05:31:24.645Z`, canonical app health reports runtime `00fc57cfd07b`, database healthy and a fresh worker heartbeat. Worker reports the full matching SHA, **four ticks / zero routine starts**, no last error. Restart catch-up KPI/measure jobs completed; no brief or n8n routine ran.
- Signed-in owner UI reload retained AVGAR Sport, the pause, two dated verified connections, no invented goal/plan and disabled brief generation. What Unc knows still shows the approved discovery seed, US/NZ/AU and the constrained CPA rule. No chat, business setting or memory was edited in this release.
- Bounded app error/fatal scan after readiness returned no entries. Vercel drains: **0**. Continuous alert delivery remains unverified; a clean short scan is not operational monitoring.

## Recovery boundary

Keep the pause, restricted AVGAR archive, generation, current memories and all historical outputs. Do not reset/delete data to recover a deployment.

After legacy keys are retired, **do not blindly restore the old pre-generation app/worker**: their brief/KPI upsert conflict targets no longer exist. Prefer correcting forward or a generation-aware runtime such as this matched release, retaining the final corrected schema. Reintroducing old uniqueness would first require explicit duplicate/history reconciliation; it must not discard one generation to satisfy a constraint.

## Still open

- Captured account/link identity at message arrival, durable inbox processing, outbound claims/uncertainty and channel thread persistence.
- Intake, founder notes, other profile/memory hooks, outcomes/self-reviews and remaining delayed/run-less producer and read paths. Do not unpause based on this subset.
- Brief model-call deduplication/cost admission under concurrent generation requests remains separate from same-row upsert idempotency. No paid concurrent-call test was run.
- KPI metric completeness/currency/freshness contracts, stored-data synchronization and broader evidence quality remain in the register. These changes do not validate the metric definitions.
- Bounded per-market paid pilot admission, durable unknown-call reconciliation, matching worker signing root, supported authenticated execution-reader access/configuration and final Nguyen-validated origin/revision.
- Remaining B01–B24 customer, security, retention, channel, observability and second-client acceptance gates.

No n8n workflow was edited or executed. Publishing, messaging, ad mutation and spend activation remain disabled.
