# Unc — first boot for the real Connect flows (Phase 4)

Phase 4 wires the Connectors grid to real OAuth per platform, an encrypted secret store, and
a per-tenant sync-provisioning interface (Airbyte). It is built and unit-tested with fixed
fake keys and a stubbed `fetch` — **no platform app, token, or Airbyte account existed when it
was written.** Until the env below is set the product is byte-identical to demo mode: with no
Supabase, Connect flips the card client-side as the prototype did; with Supabase but no
platform credentials, the card says *"Not switched on yet — I'll tell you the moment it is."*

Read alongside `docs/FIRST-BOOT.md` (accounts) and the legal/OAuth prep pack:
`clients/junction-ai/product/unc-growth-agent-design-2026-09-01/legal-and-oauth/OAUTH-PREP-PACK.md`
(Drive) — it has the per-platform review process, scope justifications and the *Tom personally*
checklist. This file is only the wiring.

## 0. What is env-gated

| Var | Where | Purpose |
|---|---|---|
| `APP_URL` | Vercel env (server) | Public base URL the callbacks are registered under, e.g. `https://app.getjunction.ai`. Falls back to the request origin (fine locally). Must match the registered redirect URIs **exactly**. |
| `CONNECTOR_SECRET_KEY` | Vercel env (server) only | base64 of 32 random bytes — the AES-256-GCM key for `connector_secrets`. Nothing stores a token without it. |
| `CONNECTOR_SECRET_KEY_VERSION` | server | int, default `1`; bump on rotation (see §6). |
| `CONNECTOR_SECRET_KEY_PREVIOUS` | server | the previous key during a rotation; delete once every row is re-sealed. |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Already listed in FIRST-BOOT; the connect routes need it (the secret tables are service-role only). Accounts + service role together = `dbConfigured` for connectors. |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | server | Shopify Partner app API key / secret |
| `KLAVIYO_CLIENT_ID` / `KLAVIYO_CLIENT_SECRET` | server | Klaviyo developer-portal OAuth app |
| `META_APP_ID` / `META_APP_SECRET` | server | Meta developer app |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | server | One Google Cloud OAuth client, shared by GA4 and Google Ads |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | server | From the product MCC's API Center (prep pack §2b); needed for Ads *reads*, not for the OAuth screen |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | server | Optional; the MCC id when reading through a manager account |
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` | server | HubSpot developer-account app (public app) — the Sales routines' CRM reads |
| `AIRBYTE_API_KEY` / `AIRBYTE_WORKSPACE_ID` | server | Airbyte Cloud API. Both absent → `NoopProvisioner` (every sync reads `error:sync_not_configured`). |
| `AIRBYTE_DESTINATION_ID` | server | Recommended: a warehouse destination created once in the Airbyte UI and shared by all tenants (each tenant's rows go to schema `t_<accountId>` via the connection's namespace). |
| `WAREHOUSE_PG_HOST` / `_PORT` / `_DATABASE` / `_USER` / `_PASSWORD` / `_SSL_MODE` | server | Only if `AIRBYTE_DESTINATION_ID` is unset: the provisioner creates a postgres destination per tenant from these. |
| `AIRBYTE_SYNC_CRON` | server | Airbyte cron, default `0 0 2 * * ?` (02:00 UTC nightly). |
| `AIRBYTE_START_DATE` | server | First-sync window start `YYYY-MM-DD`, default 12 months back. |

`isPlatformConfigured(id)` (src/lib/connectors/registry.ts) is true iff the platform's pair is
set. `isSecretStoreConfigured()` (crypto.ts) is true iff `CONNECTOR_SECRET_KEY` decodes to 32
bytes. The app reads `process.env` only. Never commit any of these.

Generate the secret key:

```bash
openssl rand -base64 32        # → CONNECTOR_SECRET_KEY
```

## 1. Apply migration 0005

```bash
cd ~/junction-unc
npx supabase db push           # applies 0005_connector_secrets.sql after 0001–0004
```

or paste `supabase/migrations/0005_connector_secrets.sql` into the SQL editor. Verify:

- Table editor shows `connector_secrets` and `oauth_states`, both with RLS enabled and **no
  permissive policies** (only the restrictive `deny_clients*`); `connectors` has `sync_ref`.
- As the anon key: `select * from connector_secrets` returns zero rows / permission denied.
  As the service role: it works. That asymmetry is the whole point — never add a member policy.

## 2. Redirect URIs to register (one per platform, exact)

```
https://<APP_URL>/api/connectors/shopify/callback
https://<APP_URL>/api/connectors/klaviyo/callback
https://<APP_URL>/api/connectors/meta_ads/callback
https://<APP_URL>/api/connectors/ga4/callback
https://<APP_URL>/api/connectors/google_ads/callback
https://<APP_URL>/api/connectors/hubspot/callback
```

Locally: `http://localhost:3400/api/connectors/<platform>/callback` (Meta and Shopify require
https in production apps; both accept localhost http on a dev app / dev store).

## 3. Per platform

Scopes below are the registry's launch sets (`CONNECTOR_REGISTRY`); the founder sees them
before approving. All read-only. Phase-2 write scopes are deliberately absent — see the pack.

### Shopify (`shopify`)
- **Where the credentials come from:** Shopify Partners → Apps → *Create app* (public app;
  see the pack §3 for the **billing-rail decision Tom must make first**). Client ID / secret
  are on the app's Configuration page. Register the redirect URI there under *Allowed
  redirection URL(s)*.
- **Scopes:** `read_orders,read_products,read_customers`. `read_all_orders` (orders > 60 days)
  is a separate Partner Dashboard request — add it to the registry entry once granted. The
  *protected customer data* request must be approved before customers sync with PII.
- **Flow:** the founder types `their-store.myshopify.com` (validated: only that domain
  shape builds a URL) → per-shop authorize URL with a nonce `state` → callback verifies the
  HMAC over the query with the client secret and that `shop` matches the state row →
  `POST https://<shop>/admin/oauth/access_token` → offline token (no expiry) sealed.
  `external_ref` = shop domain.
- **Mandatory compliance webhooks** (`customers/data_request`, `customers/redact`,
  `shop/redact`) — built, see §8; register the three URLs before app review.

### Klaviyo (`klaviyo`)
- **From:** Klaviyo developer portal → OAuth app (pack §4). Client ID / secret on the app page;
  add the redirect URI.
- **Scopes:** `accounts:read campaigns:read flows:read lists:read segments:read metrics:read events:read profiles:read`.
- **Flow:** PKCE (S256) → `POST https://a.klaviyo.com/oauth/token` with **Basic** client auth →
  access + refresh token; refreshed automatically inside 5 min of expiry by `getAccessToken`.
  `external_ref` = the Klaviyo account id (from `GET /api/accounts/`, best-effort).

### Meta Ads (`meta_ads`)
- **From:** developers.facebook.com → the app under the legal entity's Business Manager →
  App settings → Basic: App ID / App secret. Facebook Login → Valid OAuth Redirect URIs.
- **Scopes:** `ads_read,read_insights,business_management`. Works immediately for users with
  a role on the app (Standard Access); Advanced Access needs App Review (pack §1).
- **Flow:** code → `GET /v21.0/oauth/access_token` → swapped for a ~60-day long-lived token.
  Meta cannot be refreshed server-side: near expiry the card shows **Reconnect**
  (`error:token_expired`). `external_ref` = `act_<id>` when the user manages exactly one ad
  account; otherwise null and the card asks **"Which one should I read?"** (the post-connect
  picker: `GET /api/connectors/meta_ads/options` lists `/me/adaccounts`, `POST …/select`
  stores the choice; status label reads *Choose account* until then).

### Google Analytics 4 (`ga4`) and Google Ads (`google_ads`)
- **From:** one Google Cloud project → APIs & Services → Credentials → OAuth client (Web).
  Add both redirect URIs. Consent screen: sensitive-scope verification (pack §2a).
- **Scopes:** GA4 `https://www.googleapis.com/auth/analytics.readonly`; Ads
  `https://www.googleapis.com/auth/adwords` (the only Ads scope — read-only is enforced
  app-side: no mutate methods, every call receipted).
- **Flow:** PKCE + `access_type=offline&prompt=consent` so a refresh token is always issued →
  `POST https://oauth2.googleapis.com/token`. Refreshed automatically.
- **`external_ref` is null after connecting** — a login has many GA4 properties / Ads
  customers. The Connected card then shows the **post-connect picker** ("Which one should I
  read?"): `GET /api/connectors/ga4/options` lists the login's properties through the Admin
  API (`accountSummaries`, paged); `GET /api/connectors/google_ads/options` lists
  `customers:listAccessibleCustomers` (needs `GOOGLE_ADS_DEVELOPER_TOKEN`, else the card says
  "Not switched on yet"); `POST …/select { externalRef }` stores it (validated for shape:
  numeric property id / 10-digit customer id) and receipts the choice. Until chosen the status
  pill reads *Choose account* (cyan, not amber — it is a step, not a decision) and
  `ConnectorCredentialProvider` returns null for the platform (an honest "couldn't ask").
  Google Ads *reads* stay fixture-only in the worker (GAQL reader is Wave 2) — the customer id
  is what the Airbyte source needs. The Ads API version the picker calls is one constant
  (`GOOGLE_ADS_API_VERSION`, `src/lib/connectors/options.ts`) — bump it when the first live
  list answers 404 (Google sunsets versions ~yearly).

### HubSpot (`hubspot`)
- **From:** HubSpot developer account → Apps → public app. Client ID / secret on the app's
  Auth tab; add the redirect URI there and select exactly the scopes below (HubSpot refuses
  a consent screen whose scopes don't match the app's).
- **Scopes:** `crm.objects.deals.read crm.objects.contacts.read crm.objects.owners.read`.
  Read-only; the D04-W05/W06 mutations (`update_deal_properties` / `update_deal_stage`) would
  need `crm.objects.deals.write` — Wave 2, not requested.
- **Flow:** standard code grant (no PKCE) → `POST https://api.hubapi.com/oauth/v1/token`
  (client id + secret in the body) → 30-minute access token + refresh token; refreshed
  automatically. `external_ref` = portal id (`GET /account-info/v3/details`, best-effort).
- **Reads (worker):** `src/worker/readers/hubspot.ts` — CRM v3 `contacts/search`,
  `deals/search` + `emails/search` (the response-time KPI). See the worker README.

### Everything else (Instagram, TikTok, LinkedIn, YouTube, Search Console, Gmail, Gorgias, Xero, QuickBooks, Slack)
Catalogued in the registry with `flow: "none"` → the button answers "Not switched on yet".

## 4. Airbyte (per-tenant sync)

1. Airbyte Cloud → workspace → *Settings → Applications* → create an application; use its
   access token as `AIRBYTE_API_KEY` (the provisioner sends it as a bearer). Workspace id is in
   the URL → `AIRBYTE_WORKSPACE_ID`.
2. Create ONE Postgres destination pointing at the Unc warehouse (never the agency
   warehouse) → `AIRBYTE_DESTINATION_ID`. Tenant isolation is the connection's namespace:
   `custom_format` = `t_<accountId>` (hyphens → underscores), stream prefix `<platform>_`.
3. Sources are created per connector with the OAuth tokens in the source configuration
   (Airbyte encrypts them on its side); handles land on `connectors.sync_ref` so ensure* is
   idempotent and a token rotation PATCHes the existing source.

**Only verifiable live:** the source-definition field names for `shopify`, `klaviyo`,
`facebook-marketing`, `google-analytics-data-api`, `google-ads` match the connector versions
of the day (check the first real tenant in the Airbyte UI); and whether Airbyte's Klaviyo
source accepts an OAuth bearer token in `api_key` (its spec names a private key). If it
doesn't, the Klaviyo path needs Airbyte's OAuth-backed source or a direct reader on the worker.

## 5. Sync provenance (the ledger vocabulary)

`connectors.last_sync_result` is always one of `ok` | `empty` | `error:<code>`:
"couldn't ask" is never recorded as "nothing happened". `recordSyncResult()` writes it;
`error:auth*` also flips the card to Reconnect. Codes in use: `error:oauth` (callback failed),
`error:token_expired`, `error:token_refresh_<http_400|network|timeout>`, `error:no_secret`,
`error:secret_<open_failed|unknown_key_version>`, `error:airbyte_<http_NNN|network|timeout|not_configured>`,
`error:sync_failed`, `error:sync_cancelled`, `error:no_sync_yet`, `error:sync_not_configured`.

## 6. Key rotation

```
CONNECTOR_SECRET_KEY_PREVIOUS = <old key>
CONNECTOR_SECRET_KEY          = <new key>   (openssl rand -base64 32)
CONNECTOR_SECRET_KEY_VERSION  = <old version + 1>
```

Rows sealed under the old version open via PREVIOUS and are re-sealed under the new key the
next time `getAccessToken` reads them. Once `select count(*) from connector_secrets where
key_version < <new>` is 0, delete PREVIOUS. A row under a version the keyring no longer holds
fails closed → card shows Reconnect.

## 7. Smoke checklist (first real connection)

1. Env set (§0) and 0005 applied (§1). `npm run build` passes; `npx vitest run src/lib/connectors` green (91 tests, no network).
2. Sign in, open Connectors. A platform whose pair is **not** set → "Not switched on yet".
3. Klaviyo → Connect → the Klaviyo consent screen lists exactly the 8 read scopes → approve →
   lands on `/app?connected=klaviyo`, card shows **Connected**, URL is cleaned.
4. DB: `connectors` row `status=connected`, `external_ref` = account id;
   `connector_secrets` row exists with `key_version=1`; `oauth_states` is empty;
   nothing token-shaped in `connectors` or in the Vercel logs (only `[connectors] …` codes).
5. Deny the consent screen → `/app?connect_error=klaviyo`, card shows **Reconnect**,
   `last_sync_result=error:oauth`.
6. Shopify: type a dev store domain → Shopify's grant screen shows the 3 read scopes → back
   with Connected; tamper with the `hmac` in the callback URL → connect_error, no secret row.
7. Airbyte: with `AIRBYTE_*` set, provision the Klaviyo connector (`provisionConnector`) → a
   source + connection appear in the workspace, first job runs into `t_<accountId>`;
   `getStatus` maps it to `ok`/`empty`; `last_sync_result` reflects it.
8. Rotate the key (§6) → an existing connector still reads; its `key_version` bumps.
9. GA4: connect → the card shows **Choose account** + "Which one should I read?" listing the
   login's properties → pick one → receipt "Google Analytics 4: reading property … from now
   on.", `external_ref` set, the pill flips to Connected.
10. Disconnect (Klaviyo) → receipt says *access revoked on Klaviyo's side*; Klaviyo's
    connected-apps page no longer lists Unc; `connector_secrets` row gone; with `AIRBYTE_*`
    set the source + connection are gone from the workspace.

## 8. Shopify compliance webhooks (mandatory for app review)

Three HMAC-verified endpoints (`src/app/api/webhooks/shopify/[topic]/route.ts`, logic in
`src/lib/connectors/webhooks.ts`). Register them in the Dev Dashboard → your app → **Compliance
webhooks**, exactly:

| Topic | URL |
|---|---|
| `customers/data_request` | `https://<APP_URL>/api/webhooks/shopify/customers_data_request` |
| `customers/redact` | `https://<APP_URL>/api/webhooks/shopify/customers_redact` |
| `shop/redact` | `https://<APP_URL>/api/webhooks/shopify/shop_redact` |

Signature = `X-Shopify-Hmac-Sha256` over the **raw** body with `SHOPIFY_CLIENT_SECRET`
(timing-safe). Bad signature → 401 before the body is parsed (this is what the reviewer's
probe checks); unknown topic → 404; Shopify not configured → 503. A verified delivery writes
one `receipts` row (kind `notification`, `run_id` null, ids + counts only — never emails) on
every account holding that shop; `shop/redact` also tears the shop's warehouse sync down
(`SyncProvisioner.purgeTenant` — the Airbyte connection + source; the receipt says what
happened), flips the connector to `disconnected` and deletes its `connector_secrets` row. No
platform-side revoke there: the app is already uninstalled. A shop we don't hold answers 200
`recorded:false` (nothing to retry).

## 9. Disconnect

`POST /api/connectors/<platform>/disconnect` (session-bound, same gates as start), in order:

1. **Platform-side revoke** (`src/lib/connectors/revoke.ts`) while we still hold the token:
   Google `POST oauth2/revoke` (refresh token → the whole grant), Shopify
   `DELETE /admin/api/<ver>/api_permissions/current.json`, Klaviyo `POST /oauth/revoke`
   (Basic client auth), Meta `DELETE /me/permissions`, HubSpot
   `DELETE /oauth/v1/refresh-tokens/<refresh>` (HubSpot's own shape — the receipt names it
   redacted). Best-effort: 10 s timeout, a 404 / Google's `invalid_token` 400 count as done.
2. **Warehouse sync teardown** — `provisioner.purgeTenant(accountId, platform)`: Airbyte
   `DELETE /connections/<id>` then `DELETE /sources/<id>` (the source holds the token), the
   handles are cleared from `sync_ref`; the Noop says `sync_not_configured`.
3. Delete the sealed token, set the row `disconnected`.
4. Receipt: what was revoked and torn down. A revoke that failed gets a **second receipt**
   naming the code ("Couldn't revoke Klaviyo's access on their side (http_500) — … revoke the
   app from Klaviyo's connected-apps page too") so the founder knows. Nothing in 1–2 can
   block 3.

The Connected card shows a "Disconnect" link in accounts mode only.

**What purgeTenant does not do:** drop the rows already synced into the warehouse schema
`t_<accountId>` (Airbyte leaves destination data in place when a connection is deleted, and
the app holds no warehouse Postgres client). That is an ops step on the warehouse:

```sql
-- one platform's streams for a tenant (Disconnect)
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 't_<accountId>' and tablename like '<platform>\_%' escape '\'
  loop execute format('drop table %I.%I', 't_<accountId>', r.tablename); end loop; end $$;
-- the whole tenant (shop/redact for a single-connector account, or account deletion)
drop schema "t_<accountId>" cascade;
```

The receipt's `sync_purge` payload says whether the Airbyte side is gone; `customers/redact`
(one customer) is a `delete … where customer_id = …` on the same schema — also ops today.

## 10. Worker credentials

The worker and the API routes pick their adapters in `src/worker/wiring.ts`: with the DB
(service role) **and** `CONNECTOR_SECRET_KEY` present, readers get `ConnectorCredentialProvider`
(live tokens from `connector_secrets`, refreshed + re-sealed as needed) and accounts come from
`DbAccountsSource` (every account with ≥ 1 enabled routine); otherwise fixtures + the static
`demo` account. The worker's startup log line reports `credentials: connectors|fixture` and
`accounts: db|static`. With the DB the loop also sweeps expired `oauth_states` rows once an
hour (`sweepOauthStates`, heartbeat `lastSweepAt`) and runs the telemetry jobs at their UTC
slots (`src/worker/jobs.ts`).

## 11. Built since the first draft, and what is still open

Built (each with tests, no network):

- GA4 property / Google Ads customer / Meta ad-account **pickers** (§3) — `…/options` + `…/select`.
- **HubSpot** OAuth + reader (§3).
- **Platform-side revoke** on Disconnect, and a **warehouse sync teardown** (`purgeTenant`)
  on Disconnect + `shop/redact` (§9).
- **`sweepOauthStates()`** runs hourly inside the worker loop (§10).

Still open — none of it buildable without a founder / infra decision:

- **Warehouse rows** in `t_<accountId>` after Disconnect / `shop/redact` / `customers/redact`:
  the SQL in §9, run by ops until the warehouse gets a service role the app may hold.
- **Live-only verifications:** the Airbyte source field names (§4), the Google Ads API
  version constant (§3), HubSpot's `account-info` answer shape, and whether Airbyte's Klaviyo
  source accepts an OAuth bearer in `api_key`.
- **Platform apps + review:** every client id / secret in §0, Shopify's protected-customer-data
  and `read_all_orders` requests, Meta Advanced Access, Google sensitive-scope verification —
  the prep pack's *Tom personally* checklist.
- Google Ads **live reads** in the worker (GAQL `searchStream`) — the picker gives the
  customer id; the reader is Wave 2 with the rest of the live-mode work.

## 12. Connect with a token (the owner path)

`POST /api/connectors/<platform>/manual` — session-bound, **owner role only**, needs the DB +
`CONNECTOR_SECRET_KEY`. The Connectors card shows "Connect with a token" to the owner: a
quiet link under Connect when the platform's OAuth app is configured, the only action when it
isn't (a member never sees it). The form is the platform's fields (`src/lib/connectors/manualFields.ts`),
the key input is masked, "Test & connect" runs ONE cheap read against the platform (10 s
timeout) and only a key that answered is sealed into `connector_secrets`.

| Platform | Body | Validation read | `external_ref` |
|---|---|---|---|
| `shopify` | `{ token: <Admin API access token>, extra: { shop: "x.myshopify.com" } }` | `GET /admin/api/2026-07/shop.json` | the shop domain |
| `klaviyo` | `{ token: <private key pk_…> }` | `GET /api/accounts/` | the account id |
| `meta_ads` | `{ token: <system-user / long-lived token>, external_ref: "act_…", extra?: { expires_at } }` | `GET /<act_id>?fields=name,account_status,currency` | the ad account |
| `ga4` | `{ token: <OAuth refresh token>, external_ref: <property id> }` | refresh grant (needs `GOOGLE_CLIENT_ID/SECRET`) → `GET analyticsadmin/v1beta/properties/<id>` | the property |
| `google_ads` | `{ token: <OAuth refresh token>, external_ref: "123-456-7890" }` | refresh grant → with `GOOGLE_ADS_DEVELOPER_TOKEN`, `customers:listAccessibleCustomers` must list it | the customer id |
| `hubspot` | `{ token: <private app token pat-…> }` | `GET /account-info/v3/details` | the portal id |

Answers: `200 { ok, platform, externalRef, label, reading }`; `400 { error: "<Platform> said: …", code }`
carries the platform's own refusal (token-shaped strings stripped); `403 owner_only`; `503` when
the secret store / DB isn't configured. GA4 service-account JSON is **not** accepted (refresh
token only). A receipt records the connect (never the key); the client autosave keeps the card
in step. `docs/PRODUCT-EXPERIENCE.md` copy floor: "Paste the key and I'll test it before I keep it."

## 13. On connect → read now ("Reading your last 90 days")

Every path that makes a row readable — the OAuth callback (Shopify / Klaviyo / HubSpot / Meta
with one ad account), a picker choice (GA4 property, Ads customer, Meta ad account), a pasted
key — fires `HandlerDeps.onConnected`, which the routes run after the response (`next/server`
`after`): `src/lib/connectors/firstRead.ts` writes a "Reading your last 90 days from X now…"
receipt, runs `snapshotKpis` for THAT platform only (the same reader + fixed KPI set as the
nightly job — `src/lib/brain/kpi.ts`), then sets `connectors.last_sync_at` / `last_sync_result`
(`ok` | `empty` | `error:first_read` | `error:no_reader`) and, best-effort, `last_read_metrics`
(**migration 0011** — apply it or the card shows "Read ✓" without the count). Platforms outside
the KPI set (HubSpot, Google Ads) get one probe read instead. The card polls
`GET /api/connectors/state` every 3 s (2 min cap): "Reading…" → "Read ✓ · N metrics" / "Couldn't
read: <reason> — Reconnect". A failure is a receipt + `error:first_read`, never a zero.

```bash
npx supabase db push   # applies 0011_first_read.sql (connectors.last_read_metrics)
```

## 14. Connect Google (one consent for GA4 · Google Ads · Search Console)

`google` is an umbrella entry in the registry (not a card): its authorize URL asks for the union
of the three read-only scopes (`analytics.readonly`, `adwords`, `webmasters.readonly`) with
`access_type=offline` + `include_granted_scopes=true`, so an earlier per-platform grant is kept.
Register **one more redirect URI**: `https://<APP_URL>/api/connectors/google/callback`. The
callback exchanges one code and fans the sealed token out to the three child rows (`ga4`,
`google_ads`, `search_console` → `connected`; a property / customer chosen earlier is kept,
otherwise the existing pickers ask). No `google` row is ever written. In the grid the Google
card sits first with "Connect Google"; the three cards show "via Connect Google ↑" instead of
their own Connect and keep their own status / read line. The per-platform Google entries keep
working (Search Console is now a real Google entry with `webmasters.readonly`; its reader is
Wave 2, so after a connect its row reads `error:no_reader` — "key sealed, reads come in wave 2").
Disconnecting one child revokes the Google grant for all three (Google revokes the whole refresh
token) — the others flip to `needs_reconnect` on their next read.

**Beta: add founders as test users.** Until the Google OAuth app passes verification it runs in
*Testing* mode: only e-mails listed under *OAuth consent screen → Test users* (max 100) can
complete the flow, refresh tokens expire after 7 days, and everyone sees Google's "This app
isn't verified" interstitial (Advanced → Go to Junction (unsafe)). Nothing to code — add each
founder's Google account as a test user before their session, tell them the warning is
expected, and expect a re-connect a week later until the app is verified (sensitive-scope
verification needs the privacy policy + a demo video — prep pack §2).

## 15. The founder's 30-second check: `--probe`

```bash
npx tsc -p tsconfig.worker.json
node dist/worker/worker/main.js --probe shopify --account <account uuid>            # orders, last 7d
node dist/worker/worker/main.js --probe klaviyo --account <uuid> --resource flows   # any reader resource
node dist/worker/worker/main.js --probe meta_ads --account <uuid> --window 28d
```

Runs one read through the same credential provider + reader the routines use (the real sealed
token when the DB + `CONNECTOR_SECRET_KEY` are configured) and prints the shaped result:
credential kind (never the value), metrics, the columns, two sample rows with e-mails / names /
long strings / anything token-shaped redacted, provenance — or the honest "couldn't ask"
reason. Exit 1 on failure. Defaults per platform are in `src/worker/probe.ts`.

## 16. Only verifiable with a real token

Request shaping follows the current docs but no live account was used: Shopify 2026-07
`orders.json` paging via the Link header and `current_total_price`; Klaviyo `2025-07-15`
revision, `GET /api/metrics` name match (Shopify integration preferred), `metric-aggregates`
`by: ["$attributed_channel"]`, `flow-values-reports` statistics names; Meta `v23.0`
`time_range`, `purchase_roas` / `omni_purchase` action types, cursor paging, budgets in minor
units; GA4 `runReport` `rowCount`; HubSpot `account-info/v3/details`. `--probe` is how each is
confirmed on the first real connection; bump the constants in the readers if a platform answers
400/404.
