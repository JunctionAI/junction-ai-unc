# Connector refresh and reader context — Batch 27

Scope: B07/B08 progress, not full auth or private-beta acceptance. No provider was called, no grant was replaced, and no external action was enabled during verification.

## Implemented

- Capture the account generation, optional initiating owner/pause policy, selected asset, provider pointer/status and sealed-grant fingerprint in a service-only transaction. Refresh errors and successes must still match the captured grant; stale invalid-grant responses cannot downgrade a newer connection.
- Refresh/reseal uses a mandatory per-connector database lease even if the legacy optional-lease flag is false. Flights coalesce only identical captures. Every caller validates its returned context and expiry.
- Persist a private attempt before refreshing. A lost POST/response or unknown commit does not authorize another refresh after a lease expires. A fresh stored replacement is recoverable without reposting the old grant. Only classified OAuth failures permit a 30-second cooldown and at most three attempts per generation/grant. This is on-demand retry admission, not a new scheduler.
- Atomically settle encrypted replacement, connector auth status and attempt outcome. The same grant can finish rotating after an asset-selection change, but that old read fails instead of silently changing its target. Actual grant/provider/owner/generation/status changes still refuse settlement.
- Worker reads pass their original account generation into credentials and validate before and after each HTTP page and the whole read. First reads retain the originating owner. Already-started HTTP requests are not magically cancelled; stale results and later pages are rejected.
- The authenticated connector-state endpoint exposes only redacted current-grant recovery status. Pending refreshes whose lease has expired show uncertainty; exhausted retries require operator attention. New login/reset hides obsolete attempt status. Generic read/configuration/temporary errors no longer prescribe reconnecting, and a missing read result no longer renders a fictitious running-read animation.

## Verification

- 200 files / 2,542 tests passed; app and worker TypeScript passed; production webpack build passed; lint zero errors, 39 existing warnings; diff check clean.
- `scripts/verify-token-context.sql` passed both a schema-in-transaction rehearsal and the applied schema under the real service role, with all synthetic rows rolled back. Covers stale context/owner/pause/provider/grant, lease/attempt refusal, cooldown and retry budget, atomic replacement, same-grant asset change, redacted member-only health, and no anonymous/authenticated function/table grants.
- This is not a simultaneous multi-session PostgreSQL stress test or an actual provider OAuth/refresh/revocation test. Application fixtures cover independent client facades, delayed results and per-page context changes.
- Additive service-invoker migration: source `20260905100539_connector_token_context.sql`, applied as `20260905102214_connector_token_context`. Independent 10:22:50 UTC readback: zero canary accounts, refresh attempts and AVGAR runs; account generation 1 / paused. Keep old functions for safe matched rollback; do not drop schema while newer instances use it.

## Still open

- Canonical shared Google grant ownership/refresh coordination across copied child connector IDs.
- Disconnect/revoke ordering, captured revocation of the intended old grant, and hosted/manual/picker mutation races. Those handlers were not changed by this batch.
- An audited operator reconciliation/recovery action for uncertain or exhausted refreshes. Do not clear an attempt or retry its old refresh token merely because its lease expired. Fresh authorized consent can replace a grant, but is not presented as a universal repair.
- Proactive expiry/incident delivery, retry scheduling, attempt retention/cleanup, provider-specific acceptance and required scopes/selected-asset validation. Stored metadata is not proof of a recent provider read.
- n8n entitlement and broad-key approval, authenticated execution read, receiver-secret reconciliation and separate US/NZ/AU keyword acceptance; five-lane integration; frontend ZIP port/wiring and ops authorization. Full B01–B24 scope remains active.

## Release

**Production READY:** https://junction-unc.vercel.app/app

- GitHub and live code: `1a1b0596e67c549425255446db9971ec69524069`, branch `codex/backend-foundation-20260905`. Clean detached release checkout; unrelated `src/lib/runtime/context 2.ts` preserved and excluded.
- Vercel deployment `dpl_2pvHPR8wb55mykjBnuy7orjgiJaE`; protected candidate `junction-g0906scft-tom-junctionmedis-projects.vercel.app` independently checked and promoted. Next.js 16.3.4; build-to-ready 43.392 seconds. Canonical health reports the matching code and healthy DB.
- Fly existing machine `1857466fd76998`, release 19, image `registry.fly.io/unc-worker@sha256:d882624a87f8d270973bfd574a068eced262fc9917c66d721c69e277d5babab3`. Exact SHA matches the app; started 10:25:23.968 UTC, two ticks through 10:26:24.089 UTC, zero runs and dry-run mode. Independent machine metadata confirms command/messaging/live/SMS/Apple flags all false.
- Authenticated owner Home/Connectors load. Meta/Shopify selections and historical successful reads retained. Instagram/TikTok/YouTube now say no completed data read instead of claiming an active 90-day read. No connect/reconnect/disconnect action was taken. Unauthenticated connector state returns 401; Apple webhook remains 503 `apple_channel_not_ready`.
- 10:26:21 UTC DB readback: zero synthetic accounts, refresh attempts, runs and OAuth states. AVGAR stays generation 1 / paused. There are 19 connector rows and two sealed credentials **database-wide**; the active AVGAR account has six connector rows and two dated successful selected bindings. Earlier shorthand must not be interpreted as 19 AVGAR connections.
- Security advisors: six existing WARN and thirteen INFO; the extra INFO is intentional service-only RLS-with-no-client-policies on the refresh-attempt table. Actual anonymous/authenticated grants denied and tested. The pre-existing warnings remain open.
- Bounded Vercel error/fatal scan since 10:24 UTC returned zero entries. Drains were not re-inventoried; ongoing monitoring remains an acceptance gap, not signed off by this snapshot.

Rollback pair: Batch 26 code `0c673111e1867181d938919d8f01509c58624aa0`, Vercel `dpl_BhJ3V2t2TGqfSFutWHxjKhNJBwYC`, worker image `b33071940bad4b066521c890a842ee3c54cbcb484c8ccdf0d2e20876c1776c69`. Additive schema can stay. Rollback would remove the new refresh safeguards; reconcile any intervening refresh attempts before doing so.

Nguyen's frozen wrapper and the supplied design ZIP are unchanged. [Tom's updated all-screen/all-client acceptance and next work](LAUNCH-ACCEPTANCE.md) supersedes any implication that another isolated safety batch finishes the product.
