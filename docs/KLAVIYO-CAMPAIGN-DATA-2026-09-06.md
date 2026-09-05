# Klaviyo campaign shared data — Batch 59

6 September NZ / 5 September UTC. B09/B11 integration progress, not Email launch acceptance.

## What changed

Unc now has a shared-data path for the existing D05-W07 calendar's Klaviyo campaign
query, using the same tenant/selected-asset/query/day identities, leases, source
freshness and atomic completion fence as Meta. Independent reader recreation and
an authenticated n8n run-token read reuse the stored snapshot without unsealing a
credential or calling a provider. Unsupported resources/filters are not admitted
to this path. A missing Meta connection no longer blocks an admitted Klaviyo
connection on the same account. One actual refresh query per tick remains the bound.

Admission is explicit and separate:

- `UNC_KLAVIYO_CAMPAIGN_SYNC_ACCOUNTS`: exact comma-separated account IDs; also
  requires `UNC_DATA_SYNC_ENABLED=true`, enabled routine demand and an unpaused
  account. This is refresh authority, not execution/send authority.
- `UNC_KLAVIYO_CAMPAIGN_STORED_ACCOUNTS`: separate exact account list for routing
  supported campaign reads to storage. This never authorizes a refresh.
- Existing `UNC_DATA_SYNC_ACCOUNTS` / `UNC_STORED_DATA_ACCOUNTS` remain Meta-only.
  No deployed setting was changed to admit Klaviyo in this batch.

The new `unc.klaviyo-campaign-history.v1` reader uses the existing pinned revision
and credential provider, GET /api/campaigns only. It requires complete pagination,
refuses foreign/path-changed/looping links and a still-paginated fifth page, excludes
draft/scheduled records, windows by actual send time, sorts deterministically and
then applies a requested limit. Campaign names are not subject lines; subject,
revenue, opens, clicks, sends and unsubscribes remain null because listing metadata
does not provide these observations. Unexpected raw attributes/recipient details
are not retained. Unsupported tags/grouping/fields/windows fail explicitly rather
than silently returning different data. Future/malformed sent dates fail closed.

Sources: [Klaviyo pinned campaign listing API](https://developers.klaviyo.com/en/v2025-07-15/reference/get_campaigns),
[Supabase SELECT](https://supabase.com/docs/reference/javascript/select).
The campaign query requires `campaigns:read`; native n8n credential ownership is
not transferred by implementing this reader.

## Evidence

- 223 files / **2,927 tests pass**. App/worker typechecks and focused lint pass.
  New tests cover complete/windowed reads, query denial, unsafe/partial pagination,
  null semantics, independent admissions, exact-query reuse, pause/all-off, expiry,
  asset rebind, required vs optional scheduled dependencies and authenticated
  n8n proxy reuse without credentials; foreign run identity is denied.
- Real isolated PostgreSQL: **36 Klaviyo checks and 31 Meta regression checks**
  through `scripts/verify-dataset-sync-fence.mjs /tmp/unc-manual-pg.x8Y6jR klaviyo`
  (or `meta_ads`). Actual role denial, concurrent completion, pause/generation/
  connector races, expiry after observed lock waits, successor leases and replay
  are tested. Provider transports in application tests are synthetic; none of
  these tests is a fresh Klaviyo observation.
- Migration `20260905180145_klaviyo_campaign_dataset_completion.sql` applied by
  name `klaviyo_campaign_dataset_completion`. Live function body MD5 at
  **18:04:22.278020 UTC** is `82a1cbc03029cf9d7cf8c67f5afe601b`, matching the file.
  Security invoker / empty search path / anon=false / authenticated=false /
  service_role=true remain unchanged. Four existing datasets remain. No schema
  grant expansion, credential/account edit or new dataset insertion occurred.
- Pre-change security advisors: six warnings and sixteen informational notices,
  including intentional server-only tables with no client policies. Not a clean
  security sign-off; no policy was broadened to silence notices.

## Exact remaining integration gate

Live metadata inspection at approximately 18:03 UTC found **zero AVGAR Klaviyo
connector rows in Unc**. Nguyen's existing native credential and saved n8n tests
are a separate setup. This path cannot consume that credential by inference.
Before any cutover, either verify a consented Unc-owned connection or implement
an authorized n8n-owned ingestion contract with independent receipts. Never copy
the key or invent an asset ID to bridge that boundary. Then perform a specifically
authorized read/refresh, verify persisted provenance and switch the reader only
after data is warm. AVGAR remains paused, no routines enabled, actions off.

Only campaign metadata is covered, not Klaviyo flow performance/segments/events,
Shopify reconciliation, historical backfills or final five-lane callable adapters.
The customer Connections data panel still explicitly reports required Meta reads
only; the internal operator inspection includes campaign history. Optional calendar
reads remain optional and are not falsely advertised as required readiness.

App/worker release and runtime verification are recorded below once completed.
