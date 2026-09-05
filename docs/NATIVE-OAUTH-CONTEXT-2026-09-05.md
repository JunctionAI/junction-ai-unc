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

## Release

Database applied and verified. Matched app/worker release receipts will be appended after independent readback; until then the canonical runtime remains Batch 25 (`dc349188ec326d4e7b42318d44109b469c53b7e8`).

Use an app/worker rollback to that matched release if needed. The additive schema can remain; do not drop columns/functions while a newer instance may still use them.
