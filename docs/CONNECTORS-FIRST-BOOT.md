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
  `shop/redact`) are **not built yet** — required before app review, tracked in the pack.

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
  account; otherwise null until a picker exists (not built).

### Google Analytics 4 (`ga4`) and Google Ads (`google_ads`)
- **From:** one Google Cloud project → APIs & Services → Credentials → OAuth client (Web).
  Add both redirect URIs. Consent screen: sensitive-scope verification (pack §2a).
- **Scopes:** GA4 `https://www.googleapis.com/auth/analytics.readonly`; Ads
  `https://www.googleapis.com/auth/adwords` (the only Ads scope — read-only is enforced
  app-side: no mutate methods, every call receipted).
- **Flow:** PKCE + `access_type=offline&prompt=consent` so a refresh token is always issued →
  `POST https://oauth2.googleapis.com/token`. Refreshed automatically.
- **`external_ref` is null after connecting** — a login has many GA4 properties / Ads
  customers. A property / customer picker is **not built**; until it exists
  `ConnectorCredentialProvider` returns null for these (an honest "couldn't ask"). Ads reads
  also need `GOOGLE_ADS_DEVELOPER_TOKEN` (pack §2b).

### Everything else (Instagram, TikTok, LinkedIn, YouTube, Search Console, HubSpot, Gmail, Gorgias, Xero, QuickBooks, Slack)
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

1. Env set (§0) and 0005 applied (§1). `npm run build` passes; `npx vitest run src/lib/connectors` green (57 tests, no network).
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

## 8. Not built (known gaps)

- GA4 property / Google Ads customer picker (external_ref stays null).
- Shopify mandatory GDPR webhooks; Meta ad-account picker for multi-account users.
- Disconnect / revoke (delete secret + revoke at the platform).
- A cron for `sweepOauthStates()` (10-minute TTL rows accumulate harmlessly until then).
- The worker still ships `FixtureCredentialProvider`; `ConnectorCredentialProvider` (tokens.ts)
  matches its interface and is the drop-in when live reads are switched on.
