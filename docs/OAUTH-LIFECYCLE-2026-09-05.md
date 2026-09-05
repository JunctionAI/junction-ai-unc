# OAuth reconnect availability and single-use callbacks — 5 September 2026

Status: source, database protocol checks and matched production release PASS. This advances B07, not full auth reliability or the B01–B24 acceptance gate.

## Deploy result

| Field | Verified result |
|---|---|
| URL | https://junction-unc.vercel.app/app |
| Target / status | Existing production project / READY and promoted |
| Source | `b505033e9c3cf2a2e8615ef1287a8d7730316415` |
| Deployment | `dpl_9TaGizmQnEutAP9BMq3kZTaPzaAP` |
| Candidate | https://junction-lgt8rq6ba-tom-junctionmedis-projects.vercel.app |
| Framework / remote build | Next.js 16.3.4 / 45.828 seconds |
| Worker | Existing machine `1857466fd76998`, release 16, Sydney |
| Exact image | `registry.fly.io/unc-worker@sha256:9b6af2ed73512da004240225900e5b1c07a23649cf6d47a5fb31c833c68bde95` |

Built from a clean detached checkout of the pushed commit; the unrelated local `src/lib/runtime/context 2.ts` was excluded. The app candidate used Production configuration with `--skip-domain`; canonical origin remained on the prior release until promotion. Candidate health and unauthenticated account-state 401 passed. Worker build/push preceded its single-machine replacement; no new machine, schema change, environment-secret change or action activation.

At `09:16:26Z`, canonical app and direct worker health matched the release source, with two new worker ticks and zero runs. All five command/messaging/live/SMS/Apple flags remained false. Canonical `/api/webhooks/apple` POST returned 503 `apple_channel_not_ready`, unauthenticated connector-state GET returned 401. An earlier check used a nonexistent `/api/channels/apple/webhook` URL and returned 404; that was not counted as the disabled-channel test.

Signed-in browser reload and loaded Connectors view retained AVGAR, the two asset-bound Meta/Shopify connections, zero enabled routines and setup hold. No reconnect/disconnect button was used. Independent SQL at `09:16:55.602047Z` retained generation 1, pause true, revision 17/saved time `08:57:55.335142Z`, 19 connector records and two encrypted-secret records. Registrations, permits and AVGAR runs remained zero. No new model response was generated.

The UI still has an existing misleading `Reading your last 90 days…` label for unverified Instagram/TikTok/YouTube records. Those platforms are not counted as ready; this remains B08/frontend binding work, not a new verified background sync.

Post-deploy error/fatal scan since `09:13Z` returned zero entries; fresh drain inventory is empty. This is a bounded scan, not continuous monitoring sign-off. Previous matched Batch 23 app `dpl_3Luv3hHhwpf5vbyRMBY1CsVgnsrG` and worker image `9195d64f0e70e0c278d3debfb94429081b36705aefcba02ea3cf9612eb2f6529` are the schema-compatible previous release references; no rollback was performed.

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

The DELETE representation follows [Supabase's documented API](https://supabase.com/docs/reference/javascript/delete). Next.js guidance kept the change inside the existing server-handler boundary; Supabase guidance informed the service-role canary and transport verification. Vercel deployment guidance informed the clean-source candidate and promotion; browser guidance supplied signed-in UI readback. No migration or client privilege change was needed.

## Still required for B07 and safe unpause

This patch does **not** establish a full account-generation / initiating-owner / individual-attempt / connector-revision protocol. In particular:

1. Competing successful callbacks and callbacks after a reset/disconnect still need captured identity and atomic compare-and-swap completion.
2. Connector status/asset and encrypted secret success writes are still separate. Commit them atomically; an unavailable grant must never acquire a success status.
3. A failed older attempt can still affect another pending attempt. The new guard protects connected/disconnected rows, not every attempt transition.
4. Hosted-provider start still stores its pending provider pointer in the connector row. Separate pending-attempt state before claiming uninterrupted hosted reconnects. Those prototype providers are not enabled for the pilot.
5. Disconnect/revoke, asset selection, refresh-owner/shared-Google-grant handling and delayed first-read callbacks still need the same captured identity protocol and cross-process/provider acceptance.
6. Add operator-visible bounded retry/expiry alerts and prove real refresh/rotation/revocation behavior. No permanent-authorization promise.

The account hold and disabled publishing/messaging/ad/spend flags remain. n8n receiver reconciliation, supported independent execution-read access and the original country-specific pilot are separate pending gates; no Nguyen workflow change is required by this patch.
