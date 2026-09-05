# Coordinated backend release — 5 September 2026

Status: **PASS for the B02 matched-release gate; PARTIAL for the full B01–B24 backend goal.**
The ten previously staged migrations and matching application/worker are now live.
This does not establish a working n8n/provider round trip, phone delivery, recurring routines or launch readiness.

## Deploy result

| Field | Observed evidence |
|---|---|
| URL | https://junction-unc.vercel.app/app |
| Target | Production, existing `junction-unc` project |
| Status | READY, promoted, canonical health and signed-in UI checked |
| Source | `56dbfdb0d4b95e760ca3b045798d5ed3c4a7eeab` |
| Deployment | `dpl_3Luv3hHhwpf5vbyRMBY1CsVgnsrG` |
| Candidate | https://junction-70jhav5rt-tom-junctionmedis-projects.vercel.app |
| Framework/build | Next.js 16.3.4; 56.342 seconds remote build |
| Worker | Existing `unc-worker`, Sydney, machine `1857466fd76998`, release 15 |
| Worker image | `registry.fly.io/unc-worker@sha256:9195d64f0e70e0c278d3debfb94429081b36705aefcba02ea3cf9612eb2f6529` |

The worker image was built/pushed first without replacing the running machine. The app candidate used production configuration with `--skip-domain`; production secrets were not copied into a preview environment. The migrations were applied in order before app promotion and the one-machine worker update. No new worker was created.

The first unpromoted app candidate, `dpl_5czACtw9VWpfuegh7UmQGrgW4UW5`, had an incorrectly supplied runtime/build commit fingerprint. It was rejected and never promoted to the canonical app URL. The replacement above uses the independently read GitHub commit, confirmed in deployment metadata and health. No project-wide SHA override was added.

The preceding deployment `dpl_4zqqARcoMhiUZCagcLusCJvM6cHZ` / source `00fc57cfd07b175bc0d0c452c94f32ecd2d1e735` and worker image `694e435341a950bb3173004d07fa214f5fc9851107c6228290f56cddc8860e5c` are investigation references, **not safe blind rollback targets** after the new chat schema. Prefer forward repair from the verified release above. Never remove generation guards, downgrade account generation, or relabel archived history for rollback.

## Applied migration mapping

The deployment tool assigns live timestamps; source filenames retain their CLI-created timestamps. Names/content map as follows. Do not apply these source files again merely because their timestamp differs.

| Source timestamp | Live timestamp | Name |
|---|---|---|
| 20260905053820 | 20260905085523 | channel_inbox_identity |
| 20260905054958 | 20260905085528 | channel_inbound_controls |
| 20260905061454 | 20260905085533 | chat_context_fence |
| 20260905065409 | 20260905085537 | channel_outbound_claims |
| 20260905071413 | 20260905085541 | command_delivery_identity |
| 20260905072651 | 20260905085546 | artifact_delivery_context |
| 20260905074645 | 20260905085552 | keyword_shadow_admission |
| 20260905080359 | 20260905085556 | keyword_shadow_recovery |
| 20260905081458 | 20260905085600 | keyword_shadow_completion |
| 20260905083033 | 20260905085604 | keyword_shadow_pilot_issuance |

## Chat preservation and data integrity

The chat migration accepts only transaction-local operator attestations. For a repaired account with existing messages it requires: paused account, matching generation, matching restricted repair archive, exactly one attestation, exact count/checksum, messages newer than the repair, and app-only legacy rows. Missing or changed attestation aborts with no partial DDL. There is no new client route or permanent bypass.

The independently checked original AVGAR row set contains the two post-repair messages documented in `AVGAR-CONTEXT-REPAIR-2026-09-05.md`. Checksum `19b8119ae13345625e52e87c91bea4d8` was re-read at `08:52:33.007660Z`. Those rows alone received generation 1. Their IDs, contents, timestamps, sender and ordering did not change. Twelve messages belonging to the six other accounts remain generation 0. The old restricted repair archive was not restored, deleted or rebranded.

Immediately before and after rollout, all-row fingerprints matched for accounts (7), memberships (2), state metadata (7), business profiles (7), resource profiles (7), account profiles (1), memories (31), connectors (19), encrypted-credential records (2), KPI snapshots (18), and chat content/identity (14, excluding only the two newly added columns). Secret values were not printed.

After that unchanged-data check, one intentional owner-only chat smoke test added two messages. No customer/channel send or n8n/provider workflow was performed.

## Verification

- **197 files / 2,430 tests PASS**; application and standalone-worker TypeScript pass; selected remote production build passes; lint zero errors / 39 existing warnings; diff checks pass.
- All 18 real PostgreSQL canaries passed against the combined ten-migration rehearsal, then again against the applied production schema. Each canary was isolated by savepoint; synthetic changes were rolled back. Coverage: channel arrival/control, chat, outbox, command context/delivery, artifacts, keyword admission/recovery/completion/issuance, atomic state/save enforcement, context generation, runtime context, brief/KPI context, automation pause, and connector/data foundation.
- The older pause canary seeded a brief into an already-paused synthetic account, which newer protection correctly refused. Its fixture now seeds before applying the hold. Production protection was not weakened to make the test pass.
- Missing chat attestation and mismatched row-set checksum both refused; DDL rollback was checked. Positive preservation and existing atomic-save tests passed.
- Candidate account-state without login returned **401**; reserved Apple POST returned **503 `apple_channel_not_ready`**.
- Canonical health and direct worker health report matching source. The new worker started at `08:56:52.573Z`; fresh ticks advanced 1 → 2, with **zero runs started**. All five command/messaging/live/SMS/Apple flags remain false.
- Signed-in production UI displays AVGAR, two verified connections, no invented goal/plan, zero routines and the setup-pause banner. Both original chat rows are visible after upgrade.
- Owner-only prompt at `08:57:41.707683Z`, row `c9b9affe-d4a4-402a-8eba-28cd191b564a`, requested saved business/seed/markets and explicitly no routine/contact. Reply at `08:57:55.332899Z`, row `a94ab2e7-c979-41bc-b3ff-4a0a21055c9b`, correctly identified AVGAR Sport, `golf travel bag` as discovery rather than a proven winner, and US/NZ/AU. Both generation-1 rows were independently read from the database and survived browser reload.
- Reload did not autosave again: at `08:59:01.267272Z`, revision stayed 17 / saved time `08:57:55.335142Z`. The intentional chat had advanced revision 15 → 17. Commands, registrations and AVGAR runs remained zero.
- Read-only signing verification at `08:58:09.656Z` proved matching app/worker root, valid-signature/nonexistent-run **404**, altered-signature **401**, correct origins and disabled execution reader. No key was created, rotated or exposed.

The SQL rehearsals are real database checks, not simultaneous multi-connection stress tests. The chat smoke is one ordinary owner/model response, not a keyword result or latency SLA.

## Observability and remaining gates

The new deployment's error/fatal scan from `08:55Z` through approximately `08:58:40Z` returned zero entries. Fresh `/v1/drains` inventory returned no drains. Continuous alert delivery is not proven.

Security advisors report **six existing WARN / twelve INFO**. Four additional INFO notices correspond to intentionally service-only `artifact_deliveries`, `n8n_shadow_permits`, `n8n_shadow_candidates` and `n8n_shadow_completions`. Direct anonymous/authenticated SELECT/INSERT/UPDATE/DELETE privileges were independently checked and are absent. Existing definer/extension/password warnings remain; this is not B20 security sign-off.

AVGAR remains generation 1 and paused. The six other accounts retain their previous generation/pause states. No pilot registration, permit or enabled routine exists. The workflow receiver credential remains only 21 characters and fails the existing minimum validation; its intended equality across n8n/Vercel/Fly still requires secure reconciliation. The independent reader remains disabled, and the supported n8n API entitlement/key-scope approval is still pending. No plan purchase or key creation occurred.

Next: resolve those access/configuration gates; finish prepared-start/unknown-response recovery and remaining OAuth/profile delayed-writer identity coverage; then issue the exact authorized country-specific pilot and independently verify its original execution/result. Broader connector refresh, stored-data/metrics coverage, schedules/cost/alerts, security/retention, phone and second-client acceptance remain in the original register. Publishing, customer messaging and ad/spend activation remain disabled.

Supabase guidance informed transactional rehearsal and role checks; Vercel guidance informed the unaliased candidate, exact source identity and coordinated promotion; browser verification checked the actual signed-in experience. The n8n credential check was read-only and preserved native credential ownership.
