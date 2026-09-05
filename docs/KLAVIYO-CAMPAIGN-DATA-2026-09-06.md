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

## Matched production release

- Source `dc41bc459c0e5b91188be88fd0b38d266b04dbd2` pushed and independently
  matched with GitHub `ls-remote` on `codex/backend-foundation-20260905`.
  Clean release worktree `/private/tmp/unc-campaign-data-release.8wh07H` excludes
  the user's untracked `src/lib/runtime/context 2.ts`; no environment files copied.
- **URL:** https://junction-unc.vercel.app/app
  **Target/status:** production / READY. **Framework/build:** Next 16.3.4 / 34 seconds.
  Vercel `dpl_4ig4xyZC5xHufxALRZ6zLQk2qB2P`; candidate
  https://junction-ggg2t44ss-tom-junctionmedis-projects.vercel.app .
  Candidate health matched source, DB healthy; anonymous connectors GET returned
  401/no-store. Promoted only after the worker checks below passed.
- Worker **release 36**, existing sole Sydney machine `1857466fd76998`, image
  `sha256:dbecd419f0e04d2daf67224856ba1dde63901f6296b26508594ff27ead807cc3`,
  tag `deployment-01M1SBYG226H4VK46P2TF80GBD`; started, health passing.
- Deployed compiled verification **18:07:27.054 UTC**: campaign metadata/null
  semantics and legacy admission isolation pass using synthetic transport;
  pre-provider client isolation and whole-read deadline pass. Thirty real DB
  GETs confirm pause/context/dataset readiness; no provider/credential calls,
  real writes or live schedule tests. All five action flags are false. Existing
  sync/reader flags and both new Klaviyo admission settings are absent/off.
- Canonical health **18:07:58.642 UTC**: source `dc41bc459c0e`, DB healthy,
  worker heartbeat fresh (53 seconds), one tick, no last error. Signed-in AVGAR
  owner reload at **18:08 UTC** loads four work items/four historical shadow
  runs/zero enabled routines, with pause and external-action holds visible.
  SQL **18:08:14.691047 UTC** independently confirms generation 1, paused,
  zero enabled routines, four runs and four datasets.
- Migration recorded live as **20260905180349** under the same migration name.
  Post-change security advisors remain six WARN / sixteen INFO, unchanged.
- **Post-deploy observability:** bounded error/fatal scan from 18:06 UTC through
  approximately 18:08 UTC returned no entries. Drains: zero. Independent alert
  delivery/ongoing monitoring remain open; a short clean scan is not an SLA.

Rollback references: prior app `dpl_68UEr2NZLMxs2wNvBi4EjfWvKGWQ`, prior worker
release 35/image `e167bae69c7d21fb97df96657c1f6ad79a7a2fa0b996b3ea709cfd2196d46044`,
both at `d86b2f6b4f8466a3b2b03b9022939922556f3508`. The additive database function
remains compatible with that Meta-only caller. Preserve all holds on rollback.
No Nguyen workflow, provider credential, registration or revision pin was changed.
