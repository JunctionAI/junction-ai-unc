# OAuth reconnect availability and single-use callbacks — 5 September 2026

Status: source and database protocol checks PASS; release readback pending. This advances B07, not full auth reliability or the B01–B24 acceptance gate.

## Corrected defects

- Native OAuth start used to set a healthy connector to `connecting`, causing ordinary token reads to refuse the current grant during consent. Start now inserts only when missing and conditionally updates unavailable rows. Neither statement downgrades `connected`, including a success between the two statements. The existing secret, selected asset and read evidence remain unchanged.
- Native and hosted callback failures used an unconditional upsert. They now update only an existing `connecting` row. A denial/expiry/exchange failure does not change a connected or disconnected row, nor recreate a removed row. Owner authority is checked before expiry can record a failure.
- Shared OAuth state consumption used separate SELECT and DELETE statements, so concurrent native/provider/Slack callbacks could both proceed. It now uses one DELETE RETURNING. The callback receiving no row cannot exchange the code. Database failure never falls back to a read or an automatic exchange/retry.
- Native/provider/Slack expiry rejects the exact expiry boundary and invalid timestamps.

## Evidence

- 198 files / **2,458 tests PASS** (28 additions); application and worker TypeScript pass; production webpack build passes; lint zero errors / 39 existing warnings; diff check passes.
- New native tests cover available grants during reconnect, all unavailable status transitions, denial/missing code/expiry/exchange error, unauthorized expired callbacks, disconnect/removal, late denial after newer success and completion between start statements.
- Concurrent callback fixtures prove one exchange/secret/first-read hook for native OAuth and one exchange/secret/link for Slack. Hosted failed callbacks preserve connected/disconnected/reconnect-needed rows; unauthorized expiry preserves pending state.
- A transport test uses the actual installed supabase-js client with a mocked network to inspect DELETE + `return=representation`, POST + `resolution=ignore-duplicates`, and account/platform/status-filtered PATCH requests. The schema fake was corrected to implement insert-ignore and empty duplicate RETURNING results.
- `scripts/verify-oauth-lifecycle.sql` passed against the actual Unc PostgreSQL database under service_role. It exercises the same SQL operations, row preservation, failure transitions, tenant predicates and denied client privileges. All synthetic records rolled back; independent readback at `2026-09-05T09:11:42.798547Z` found zero canary accounts/states. AVGAR remained paused with zero registrations/runs.
- This SQL check is not simultaneous multi-session stress testing; provider calls in tests are mocked. No real token was exchanged/refreshed/revoked, no actual connector was reconfigured, and no channel message was sent.

The DELETE representation follows [Supabase's documented API](https://supabase.com/docs/reference/javascript/delete). Next.js guidance kept the change inside the existing server-handler boundary; Supabase guidance informed the service-role canary and transport verification. No migration or client privilege change is needed.

## Still required for B07 and safe unpause

This patch does **not** establish a full account-generation / initiating-owner / individual-attempt / connector-revision protocol. In particular:

1. Competing successful callbacks and callbacks after a reset/disconnect still need captured identity and atomic compare-and-swap completion.
2. Connector status/asset and encrypted secret success writes are still separate. Commit them atomically; an unavailable grant must never acquire a success status.
3. A failed older attempt can still affect another pending attempt. The new guard protects connected/disconnected rows, not every attempt transition.
4. Hosted-provider start still stores its pending provider pointer in the connector row. Separate pending-attempt state before claiming uninterrupted hosted reconnects. Those prototype providers are not enabled for the pilot.
5. Disconnect/revoke, asset selection, refresh-owner/shared-Google-grant handling and delayed first-read callbacks still need the same captured identity protocol and cross-process/provider acceptance.
6. Add operator-visible bounded retry/expiry alerts and prove real refresh/rotation/revocation behavior. No permanent-authorization promise.

The account hold and disabled publishing/messaging/ad/spend flags remain. n8n receiver reconciliation, supported independent execution-read access and the original country-specific pilot are separate pending gates; no Nguyen workflow change is required by this patch.
