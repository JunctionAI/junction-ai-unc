# Customer keyword request — 6 September 2026

The keyword detail screen now uses the shared command queue, not `/api/routines/run`. The request remains read/draft-only; no new provider or action executor is introduced.

`POST /api/routines/keyword-request` accepts only an original UUID, reviewed market, version 2 and exact displayed settings timestamp. Session owner, account/generation/actor headers, canonical stored recipe, verified market evidence, release scope, enabled switch, connector requirements and budget are checked server-side. A changed recipe/registration is refused before enqueue; the worker and existing database permit checks repeat their checks before provider work. No model call is needed for the button's exact `/run D03-W01` instruction. Plain-language chat retains the shared dispatcher.

`GET` resolves the original request UUID to the same account/owner/channel command ID. Reads remain available when paused or commands are off. Saved commands are returned without replay; missing records are unknown, not proof nothing happened. Terminal command status alone does not unlock a new request while its provider permit is unresolved.

The browser stores identity plus displayed configuration before POST. It does not store credentials or outputs. Double clicks/pending journals cannot create a second identity; lost replies are recovered by GET only. A positive pre-queue refusal clears its journal; an unknown/lost response retains it. A late response after account/actor/generation change is discarded. Completed/definitely refused work permits an explicit new request, not automatic retry.

Verification before release: 214 unit files / 2,747 tests pass (24 new request tests); app/worker typechecks pass; focused lint has no errors and the existing RoutineDetail image warning. Thirteen isolated browser checks pass across configuration and request controls, including mobile/desktop, lost response, reload, unreadable storage and context switching. Existing real PostgreSQL command/configuration verifiers and CLI pilot/preflight tests are rerun separately. These fixtures do not prove customer execution against live n8n.

Declared `zod` as exact production dependency `4.5.4`, matching the validation package used by the tests. Previously the local tree could resolve it without a direct production declaration. Lockfile updated; npm audit reports zero vulnerabilities.

Release gate: build a clean committed source checkout, create a production-configured Vercel candidate without assigning domains, build/push a worker image without replacing the running machine, then verify and release the same artifacts with command/external-action flags off. Exact pilot scope and signed-in acceptance remain a separate supervised step. Full B01–B24/all-client acceptance and Nguyen output corrections remain outstanding.

## Release receipt — 5 September 15:58 UTC / 6 September NZ

- URL: https://junction-unc.vercel.app/app
- Target/status: production / READY and promoted.
- Source: `5be9cfe81df31ac8624e55fc56d0a4b7e25b98dc`, independently matched to the remote `codex/backend-foundation-20260905` branch.
- Framework/build duration: Next.js; 37.518 seconds from Vercel `buildingAt` to `ready`.
- Deployment: `dpl_EbKoF9dtfj4TBNVzGdZENAqvygmG`, https://junction-dyt9f87ww-tom-junctionmedis-projects.vercel.app.
- Worker: existing sole machine `1857466fd76998`, Sydney, release 26, `registry.fly.io/unc-worker@sha256:1c9280694468f0896e4601e6db58b7206e2d799779ceb17005ef331069f28a45`.

Both artifacts were built from the clean detached source checkout, excluding unrelated user file `src/lib/runtime/context 2.ts`. Worker used build-only/push first and was later deployed by exact digest with `--ha=false --update-only --only-machines 1857466fd76998`. No second machine was created.

The first candidate, `dpl_2tSC3eeLPwkVjygNyWDxozJpgdm5`, reported `build.sha=null` and was not promoted. Its app deployment supplied `UNC_BUILD_SHA`, but app health reads `VERCEL_GIT_COMMIT_SHA`; the corrected candidate supplied the exact source SHA as that build/runtime variable. This was deployment configuration, not a change to health verification. Production configuration was used with `--skip-domain` until checks passed; no production secrets were copied into a preview environment.

### Live checks

- Corrected candidate READY; health SHA `5be9cfe81df3`, database healthy. Both `/api/routines/keyword-configuration` and `/api/routines/keyword-request` reject anonymous GET with 401 and `cache-control: private, no-store`.
- Canonical app independently returns the same SHA and database health after promotion. Actual worker SSH reads only allowlisted nonsecret variables: full SHA matches; `UNC_COMMANDS_ENABLED`, `UNC_MESSAGING_ENABLED`, `LIVE_MODE_ENABLED`, `TNZ_SMS_ENABLED`, `APPLE_MESSAGES_ENABLED` all `false`. Worker public health reports matching source, fresh dry-run heartbeat and zero runs started.
- Signed-in AVGAR Today retains all three actual market results and zero enabled routines. Keyword screen loads the reviewed three-market selector and new disabled request control.
- Actual owner UI saved US (`golf travel bag`, English). Independent SQL: version 2, location 2840, frozen revision `92135add-3c35-43e4-9649-5bb3d4557814`, updated `2026-09-05 15:56:44.058433+00`; full browser reload retains United States and manual configuration. No run or provider permission was issued by saving.
- Actual account chat `/run D03-W01` returns “Routine requests aren’t enabled here yet. Nothing was queued or started.” Post-request SQL agrees: generation 1, paused true, zero commands, three original runs/artifacts, zero enabled routines. The chat message/refusal is intentionally saved as acceptance evidence.
- Bounded Vercel error and fatal scans returned no entries through approximately 15:58 UTC. Drains API returned `drains: []`. Alert delivery and broader monitoring remain unverified; a clean bounded scan is not ongoing monitoring acceptance.

### Rollback and remaining work

Previous app: `dpl_8Ybx7cqot5wX3WfUF1Z8LArVpBSs`, source `12b93528b26f9acdf3e3b99a9a2d47babf9c3335`. Previous worker release 25 image: `registry.fly.io/unc-worker@sha256:658a5e2eb9acf5927ca1979dc190f7005d335334e919642d4d39120f00b8f356`. This release added no schema migration; preceding command/configuration migrations are additive. Keep commands off on rollback, preserve saved v2 market and historical evidence, and do not reset the account or rerun the old empty-account canaries.

Customer success is still unproven: release one exact expiring account/generation/app/routine/spec/workflow scope, preserve all outward-action prohibitions, then verify one signed-in request, original-ID recovery/deduplication, independently matched execution/result and reload before restoring setup hold. Do not treat the prior operator runs or disabled-button check as this success. Current scope parser permits one entry per account/generation/channel/routine, so do not insert three duplicate market entries.

Nguyen's pending output-quality corrections and other-lane deliverables remain separate. This release does not close stored-data/auth lifecycle, schedules/costs, other-client/channel, security/retention or full customer acceptance.
