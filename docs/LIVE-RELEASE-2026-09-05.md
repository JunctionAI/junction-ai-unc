# Unc atomic-account app release — 5 September 2026

Scope: continue Tom's approved backend replacement/security goal. No publishing, customer messaging, advertising mutation, credential transfer or Nguyen workflow change. This is an app release, not completion of the 24-item backend register.

## Deploy result

- URL: https://junction-unc.vercel.app/app
- Deployment URL: https://junction-13yh5a8gq-tom-junctionmedis-projects.vercel.app
- Existing project: `junction-unc` / `prj_WXwCzYpwmx9MmLBgqGrpWh8jnc6d`
- Target: production
- Status: READY, promoted; canonical health independently read back
- Deployment: `dpl_2yLzCP8TqcS6Go3DeHtvRzN4qbZX`
- Source: `5dde2407a3208d16e6a4295d457b319e87221a96`
- Framework: Next.js 16.3.4
- Build duration: 32 seconds (`Build Completed in /vercel/output`)

Both candidates used production-environment configuration and `--skip-domain`; no production secrets were copied into a preview environment. The first candidate `dpl_C1A5aio6eUJoqByzrp7D2V2sesBq` passed basic health but reported a null runtime SHA. It was not promoted. The second candidate included the source SHA explicitly and reports `5dde2407a320`. No action flags were enabled.

## Database order and actual checks

1. Additive owner-bound atomic snapshot/save function and revision triggers had already passed rollback-only SQL canaries.
2. New app promoted with legacy grants retained temporarily, so a failed first sign-in/save could still roll back safely.
3. Existing `halltaylor.tom@gmail.com` browser session loaded pilot `aa5cfc84-2569-4c99-9b40-67003ae55eda`. An atomic save persisted revision 1 at `2026-09-05T02:55:52.847052Z`.
4. Applied `20260905025609_account_state_server_writes_only` to `ycgayfsvcjpsnryrpukv`. Removed legacy client writes on accounts/goals/resources/team/plans/business profiles/state metadata/chat, including explicit account-column updates; retained existing read grants and RLS. No blanket RLS or role changes.
5. `scripts/verify-account-state-enforcement.sql` passed authenticated/anonymous denial checks. `scripts/verify-account-state-atomic.sql` passed again after enforcement. Both tests rolled back; independent readback found zero temporary accounts.
6. A neutral in-app chat-only test created user row `67818392-a00b-4a6e-a5da-0cc0ecacc001` at `02:56:30.958703Z` and assistant row `6eba9ffe-1d29-4ab3-959c-30a3eb85f7be` at `02:56:39.517584Z`, corner positions 4/5. Independent SQL read and visible browser reload confirmed both. No routine command was created; n8n registry remained empty.
7. Pilot connector identity/status fingerprint before/after stayed `b0f66c953199427e27567b11a9024927`. This fingerprint is not a token/read-freshness check; no credential was changed.

Source validation: 177 test files / 2,077 tests passed, app/worker TypeScript and production webpack build passed, lint zero errors/39 existing warnings. SQL enforcement changes were verified against the actual database. Tests do not certify n8n, phone or simultaneous multi-connection behavior.

## Post-deploy observability and action boundary

- Canonical health: DB healthy, source SHA correct, old worker heartbeat fresh/no last error.
- `GET /api/account/state` without session: HTTP 401, not demo fallback.
- `POST /api/webhooks/twilio` with no message: HTTP 503 `messaging_disabled`.
- Production command/messaging/live flags remain false. Data sync/stored-data/refresh-lease opt-ins remain unset/off. Channel flags fail closed while messaging is disabled.
- Post-deployment error/fatal log scan returned no entries through approximately 02:57 UTC. This is a bounded observation, not proof of monitoring/alert delivery.
- Vercel `/v1/drains` readback: zero team drains, so no project-scoped external drain. Alerting/retention delivery is a remaining operational gap; configure and test an appropriate receiver before the next production release rather than silently sending logs to a new third party.
- Security advisors: six existing warnings and seven informational notices, unchanged after enforcement. Server-only tables intentionally have RLS with no client policies. Review [definer exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) under B20; do not grant access to silence informational notices.

## Recovery and remaining work

The previous app was `dpl_4HDeQ79WtrZdnWVKzCpWFkyktTJp` / SHA `91d7ef60cde5`. **After the enforcement migration that old app is no longer a compatible save client.** Prefer forward repair or the current atomic-compatible deployment. An emergency return to browser-direct persistence would require a separately reviewed, narrowly scoped grant restoration and would reopen the stale-write risk. Do not blindly promote the old app or restore insecure grants.

Worker has not been replaced in this batch: `unc-worker`, machine `1857466fd76998`, image `registry.fly.io/unc-worker:deployment-01M1N91AEXTMADADNY8Q6FWKW7`, digest `sha256:3c028693f1fa5c8b6cc2fcfea9a4145cbe3f9463cad391a021134d506b6751d6`. App/worker pairing remains B02 work.

AVGAR profile still says Junction AI. Backed-up context repair must cover memories, chat history, prior briefs/artifacts and cached plan narratives before business advice is certified. Setup still overstates status-only connector readiness and the goal UI uses unverified pace semantics. These are recorded in `BACKEND-GOAL-PROGRESS.md`, not accepted as correct.
