# Native OAuth and first-read acceptance — Batch 26

This is B07 progress, not an all-connectors or private-beta completion claim. The full B01–B24 register remains active.

## Change

- Native OAuth starts now atomically capture the initiating owner, account generation, exact target identities, selected assets, provider pointers and sealed-credential fingerprints. Only a digest of the attempt nonce is stored on member-readable connector rows. Healthy grants remain readable during consent.
- Callback state is consumed once. The same originating owner must still own the original account. Checks before/after exchange and a database-locked final check reject resets, newer consent attempts, disconnects, changed assets/provider pointers and replaced sealed credentials. Rejected old callbacks do not downgrade a newer connection.
- Connection status and encrypted tokens commit in one transaction. Google targets its three original child rows, all-or-nothing. Native success removes obsolete hosted-auth pointers. Old uncaptured native states fail closed; a new consent attempt is required. No pending OAuth states existed before application.
- First reads now use the captured account generation, rather than silently defaulting AVGAR to generation zero. Native callbacks carry their connector, generation and external account into the deferred read. Pause/reset/selection changes are not presented as bad credentials.
- First-read KPI rows, connector status and result receipt use one service-only transaction with account/owner/connector identity checks. A failed partial insert rolls back. A lost commit response is not automatically retried or overwritten as a known failure. KPI reporting outside first-read retains its existing sink.
- First-read receipts no longer embed raw provider error messages or promise a uniform 90-day read; the actual metrics use their defined windows.

## Verification

- 199 files / 2,510 tests pass; app and worker TypeScript and production webpack build pass. Lint has zero errors / 39 pre-existing warnings after removing an unused test import.
- `scripts/verify-native-oauth-context.sql` passed against actual PostgreSQL under `service_role`, including ownership/context/secret/newer-attempt checks, healthy grant preservation, forced third-Google-token rollback, first-read pause/asset/owner rejection and forced partial KPI rollback. All synthetic data rolled back. This is not simultaneous multi-session SQL stress testing or real OAuth/provider acceptance.
- Applied live migration: `20260905095705_native_connector_oauth_context`; source file was CLI-created as `20260905094229_native_connector_oauth_context.sql`.
- Independent 09:57:38 UTC readback: zero canary accounts/OAuth states/runs/enabled routines; 19 connectors and two encrypted secrets preserved; AVGAR remains generation 1 and paused. No real provider exchange, reconnect, revoke, message, ad mutation or workflow edit was performed.
- Security advisors: six WARN / twelve INFO, including the existing definer/vector/password warnings and service-only RLS tables without member policies. No new helper is SECURITY DEFINER or executable by public/signed-in clients. No schema usage/RLS grants were broadened.

## Still open

- Shared-grant refresh and single-flight identity, hosted-provider callbacks, manual-key/picker writes and disconnect/revoke ordering still need their own originating-context and conditional-commit review. A callback cannot overwrite an already changed row, but this does not prove all interleavings with older unfenced refresh/disconnect writers.
- First-read fencing binds account/selected connector identity, not a monotonically increasing credential revision. Legacy non-native hooks still do not capture account generation at their original mutation boundary. Same-asset grant replacement and owner changes during an already-started provider HTTP request require the remaining credential-bound reader work.
- No actual provider refresh/reconnect or signed-in consent flow was performed; SQL fixtures and unit tests do not establish those acceptance gates.
- n8n plan/API-key approval, supported independent execution reads, receiver-secret reconciliation and separate US/NZ/AU keyword runs remain unresolved. Nguyen's wrapper/revision is unchanged; do not ask for a redesign.
- Supplied frontend ZIP is mapped, not deployed. Landing waitlist truth, catalog reconciliation, client workspace and ops authorization remain implementation work. Full goal scope is unchanged.
- Browser readback also exposed pre-existing Instagram/TikTok/YouTube cards saying `Reading your last 90 days…` despite no selected account or dated read and no running work. Those stale connecting labels still need correction; this release changed first-read receipts, not every connector UI label. Do not count those cards as connected or operational.

## Release

**Production READY:** https://junction-unc.vercel.app/app

- Pushed/live source: `0c673111e1867181d938919d8f01509c58624aa0`, branch `codex/backend-foundation-20260905`. Deployment used a clean detached checkout; unrelated untracked `src/lib/runtime/context 2.ts` was excluded and preserved.
- Vercel: `dpl_BhJ3V2t2TGqfSFutWHxjKhNJBwYC`; Next 16.3.4; build-to-ready 43.324 seconds. Verified protected candidate `junction-6mpzf2xm4-tom-junctionmedis-projects.vercel.app`, then promoted to the existing canonical URL.
- Fly: existing machine `1857466fd76998`, release 18, image `registry.fly.io/unc-worker@sha256:b33071940bad4b066521c890a842ee3c54cbcb484c8ccdf0d2e20876c1776c69`. Independent metadata confirms all five command/messaging/live/SMS/Apple flags false. A transient 15-second public health timeout during single-machine replacement resolved; this is not a zero-downtime claim.
- Worker started `10:00:51.071 UTC`; two ticks through `10:01:51.088 UTC`, zero runs, dry-run mode. Worker exact SHA and canonical application SHA agree; DB healthy and worker heartbeat fresh.
- Signed-in owner Home and Connectors hydrated correctly: AVGAR, zero routines, setup pause, preserved Meta/Shopify selected accounts and dated successful reads (3 September; not fresh provider reads). No connect/reconnect/disconnect button was used. The other cards' stale connecting copy is recorded above.
- Anonymous `/api/connectors/state` returns 401; disabled Apple webhook returns 503 `apple_channel_not_ready`. Bounded deployment error/fatal log scan since 10:00 UTC returned zero entries; no continuous monitoring/drain readiness claim.
- Independent 10:01:50 UTC SQL readback: zero canary accounts, OAuth states, pending native attempts, runs and enabled routines; 19 connectors / two encrypted secrets; AVGAR generation 1 / paused. Nguyen's workflows and the supplied frontend ZIP remain unchanged.

Rollback pair if needed: Batch 25 source `dc349188ec326d4e7b42318d44109b469c53b7e8`, Vercel `dpl_DuvSLuycvCBiuoNA7dAqkaxrRjvY`, worker image `94bddaa45d1adfa0715f477708b101cf7961eece90107b1f6c82dc17f1834fcc`. The additive schema can remain; do not drop columns/functions while a newer instance may still use them.
