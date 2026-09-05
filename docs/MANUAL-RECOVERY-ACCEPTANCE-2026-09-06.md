# Manual recovery — Batch 37 acceptance

6 September 2026 NZ / 5 September UTC. **PARTIAL: tested source, not a production release.** The B01–B24/all-client goal remains active. No client, provider, production app/worker or production database change was made in this batch.

## Implemented

- Browser v2 journal contains only account/generation/actor/routine/path/request ID. Answers are sent once from memory; they are not serialized into browser storage. Malformed/oversized/injected journals fail closed. An older actor-unbound v1 entry blocks a replacement rather than silently abandoning an uncertain request (v1 was staged, not deployed).
- `/api/agents` supplies the authenticated actor. The manual Run, Validate, input and recovery routes compare the captured actor header with the actual signed-in session. Outcomes must match that actor, account, generation, routine and original request ID. Detail/eligibility actors must agree; UI identity persists during a same-owner refresh and resets across owners.
- Explicit POST `/api/routines/request` with `action: continue` accepts identity only; extra answer/body fields are rejected. It loads the original body from the service-only database journal. Missing/cancelled identities never create requests; claimed operations are read-only replays. A changed editor revision refuses continuation.
- The existing prepare/claim/cancellation SQL remains unchanged. Lost replies never trigger an automatic POST retry. GET remains read-only. A 404 does not clear browser recovery state. Cancelling a prepared start while paused continues to respect the existing database pause guard; it does not temporarily unpause the account.
- Reviewed the legacy `/api/routines/resume` route: added account/generation capture, pause checks, same-generation run selection, malformed-body handling and private/no-store responses. This is not a claim that all scheduler, approval or external-provider paths now use the manual journal.

## Verification

Full Vitest run: **209 files / 2,626 tests PASS** at 13:55 UTC. App TypeScript and worker TypeScript PASS, followed by webpack production build PASS (compile 2.9s, TypeScript 2.7s). Full ESLint: **0 errors / 44 existing warnings**. No production deployment follows automatically from these commands.

The browser skill's interactive checks used the actual `ManualRecovery` component and `manualClient` code, served only on `127.0.0.1:4186`, with an explicitly synthetic, in-memory API. Verified:

1. Lost prepare reply disables a new submit and retains the original request ID.
2. Reload → GET finds prepared state; explicit Continue and subsequent GET produce **one prepare / one claim**, original ID unchanged (`09a7e5d1-8caa-4492-af3b-d34db23249e6`).
3. A fixture-server restart removed its synthetic state; GET 404 retained the old browser identity. Only a matching cancellation receipt allowed clearing it. This is intentionally not durable database evidence.
4. A paused prepared request could not be cancelled and remained recoverable.
5. Changed settings refused continuation. A deliberately lost successful cancellation reply retained the journal; reload → GET found the original cancelled identity (`45141e78-f39c-4adf-af94-a1fef11e5e9e`).
6. Switching to owner B showed no owner-A journal. Returning to owner A restored its ID and required fresh readback. Displayed journal contained no answer body.
7. Meaningful page content, controls and navigation rendered; screenshot inspected; no Vite/Next error overlay. Final fake-API counters: 2 prepares / 1 claim / 3 request records / **0 provider calls**.

The UI fixture is not a real authenticated customer, provider or multi-tab production acceptance test. Source: `tests/manual-recovery-fixture/`; re-use existing Vite config with `.env` loading disabled.

### Genuine PostgreSQL concurrency

`scripts/verify-manual-concurrency.mjs` creates its own local cluster; it never reads application `.env`, accepts a remote database URL or connects to Supabase. Dependency `embedded-postgres@17.10.0-beta.17` was installed in `/tmp/unc-manual-pg.x8Y6jR` only, not added to app dependencies. Cluster binds loopback, has a random local password, and is stopped in `finally`. It creates no operating-system user.

Run receipt **2026-09-05T14:00:12.342Z**:

- PostgreSQL **17.10**, independent backend PIDs **64973 / 64974**. Each race positively observed `pg_blocking_pids` before the winning transaction committed.
- Exact manual migration SHA-256: `87f8686addbf909e253dbb2b59d0ad70e6cb3964036e1b8def5afd2bc1718611`.
- Nine checks PASS: duplicate prepare preserves original run; duplicate claim has one true/one false; missing-request cancellation beats late prepare; distinct request IDs cannot create two unresolved runs; claim beats cancellation; prepared cancellation beats claim; distinct input requests have one winner; an identical waiting snapshot cannot bypass monotonic input revision; no anon/member grants on manual tables/claim RPC.
- **0 provider calls / 0 production connections**. Exact manual RPC migration, editor-read SQL and runtime guard ran against a minimal dependency schema assembled from checked-in definitions. This tests real locking/SQL but is not the entire Supabase schema, RLS/advisor or deployment acceptance.
- Stopped local cluster data retained at `/var/folders/fj/krfwzgjx3jd06qyd9yvcv1sc0000gn/T/unc-manual-concurrency-UMDYmh`. Earlier passing run data retained at the same parent under `unc-manual-concurrency-4cMpuL`. No user data was removed.

Reproduce after installing that pinned test dependency in an explicitly created temporary directory:

```sh
node scripts/verify-manual-concurrency.mjs /tmp/unc-manual-pg.x8Y6jR
```

## Still open before release

- Apply staged manual migration with production role/security/advisor/readback checks; release the app and compatible worker coherently. Current live app remains Batch 34 (`4284dcbc...`); unchanged worker image remains the Batch 36 secret-only release 20.
- Actual authenticated client and two-tab acceptance against the real deployed API/database, including run/validate/input recovery and durable artifact/receipt readback. Isolated tests do not close this gate.
- Other B01–B24 and all-client acceptance gates remain governed by the original register, not by these test counts.
- n8n: paid API key/read access is solved. Nguyen's exact proven Email mappings are known. The receiver format/equality is still unresolved: n8n's 54-character mask is not proof of a stored secret. No reply to the 1:43 AM clarification was visible at this batch's check. Receiver rotation is not approved; no secret was copied, rotated or sent. Registration, reader activation and authorized golf-travel-bag US/NZ/AU shadow tests await a correctly bound receiver and complete Unc readiness.

Publishing, customer messages, ad changes and spend activation remain disabled. The previously authorized getjunction.ai landing/Calendly release is separate and already delivered; videos/copy remain staged marketing assets, not published customer campaigns.
