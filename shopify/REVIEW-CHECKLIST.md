# Junction — Unc · Shopify app-review checklist

What the code already satisfies (with the file that does it), what is outstanding, and the
exact clicks for Tom. Companion to `shopify.app.toml`, `LISTING.md` and
`docs/SHOPIFY-APP.md`. Prep-pack context: OAUTH-PREP-PACK.md §3 (Drive).

> Dashboard note: Shopify moved app configuration to the **Dev Dashboard**
> (dev.shopify.com/dashboard) in 2025; the **Partner Dashboard** (partners.shopify.com) still
> owns the organisation, the App Store *listing*, distribution and the review submission.
> Click paths below say which one. Menu labels are as of mid-2026 — *verify on the day*.

## 1. Already satisfied — cite these in the submission

| Requirement | Where | Notes |
|---|---|---|
| OAuth authorization-code grant, per-shop authorize URL, nonce `state` | `src/lib/connectors/registry.ts` (`FLOWS.shopify.authorizeUrl`, `tokenEndpoint`), `src/lib/connectors/handlers.ts` (`handleStart`, `handleCallback`), `src/lib/connectors/oauth.ts` (`exchangeCode`) | `state` is single-use (`consumeOauthState`, `src/lib/connectors/store.ts`), 10-minute TTL, bound to the account + session that started it. |
| Shop domain validated before any URL is built | `registry.ts` `normaliseShopDomain` | Only `*.myshopify.com` shapes; callback `shop` must equal the one the flow started with (`shop_mismatch`). |
| **Callback HMAC verification** (query, hex, timing-safe) | `oauth.ts` `verifyShopifyHmac`; called in `handlers.ts` `handleCallback` before the code exchange | Bad HMAC → `/app?connect_error=shopify`, no token stored. |
| Offline token stored encrypted, never logged | `handlers.ts` (`seal` → `putSecret`), `src/lib/connectors/crypto.ts` (AES-256-GCM, key from `CONNECTOR_SECRET_KEY`) | `connector_secrets` is service-role-only (migration `0005`). |
| Scopes = least privilege, read-only | `registry.ts` `FLOWS.shopify.scopes` = `read_orders,read_products,read_customers` | Shown to the founder on the card before Connect. |
| **Mandatory compliance webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`) | `src/app/api/webhooks/shopify/[topic]/route.ts` → `src/lib/connectors/webhooks.ts` | Raw-body HMAC (base64, timing-safe) → 401 before parsing; unknown topic 404; not configured 503; one receipt per affected account; `shop/redact` deletes the token, disconnects, purges the warehouse sync. Reviewer's automated probe = the 401 path. |
| **Uninstall handling** | `webhooks.ts` `redactShop` (via `shop/redact`) | Token dead on Shopify's side at uninstall; 48h later `shop/redact` clears ours + tears down the tenant sync (`SyncProvisioner.purgeTenant`, `src/lib/connectors/provisioning.ts`). |
| Merchant-initiated disconnect revokes on Shopify's side | `src/lib/connectors/revoke.ts` (`DELETE /admin/api/<ver>/api_permissions/current.json`), `handlers.ts` `handleDisconnect` | Best-effort, receipted either way. |
| Rate-limit-respectful sync | Airbyte source per tenant (`provisioning.ts`), nightly cron | Reviewers test with large dev stores; the app itself makes no bulk Admin API calls. |
| Tests, no network | `src/lib/connectors/__tests__/` | Shopify start/callback/HMAC/webhook/revoke paths covered against the schema-checked fake. |
| Privacy policy + terms live | `src/app/privacy`, `src/app/terms` (another agent's lane) | URLs in `LISTING.md`. |

## 2. Outstanding — Tom, in order

### 2a. Create the app + credentials into env
1. **Partner Dashboard** → confirm the Partner organisation is the legal entity (`[PLACEHOLDER: company legal name]`, matching verification docs) and that Tom is Owner.
2. **Dev Dashboard** → *Apps* → **Create app** → *Create app manually* (not a template) → name **Junction — Unc**.
3. App → **Settings** (or *Configuration*): copy **Client ID** and **Client secret**.
4. Vercel → project for getjunction.ai → *Settings → Environment Variables* (Production + Preview): `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and confirm `APP_URL=https://getjunction.ai`, `CONNECTOR_SECRET_KEY` set (docs/CONNECTORS-FIRST-BOOT.md §0). Redeploy.
5. Locally: `shopify app config link` inside `shopify/` → pick the new app → the CLI writes `client_id` into `shopify.app.toml` → `shopify app deploy` (docs/SHOPIFY-APP.md). Then in the Dev Dashboard verify: *Versions* shows the release; *Configuration* shows `application_url`, the one redirect URL, scopes, three compliance webhook URLs, embedded = off.
6. Dev Dashboard → App → **Test on development store** → create a dev store (put its domain in `[build].dev_store_url`) → **Install**. Watch the flow land on `/app?connected=shopify` and a `connectors` row with `external_ref = <store>.myshopify.com`.

### 2b. Protected customer data (required before `read_customers` returns PII)
Dev Dashboard → App → **API access** → *Protected customer data access* → **Request access**:
- Data-use reasons: tick **analytics** and **marketing** ("performance dashboard and AI-drafted marketing recommendations for this merchant only").
- Level 2 fields — request only **name** and **email** (justification: customer segmentation for email routines; address/phone NOT requested).
- Declarations (answers come from the privacy policy / DPA drafts): encryption at rest (AES-256-GCM secret store; warehouse per-tenant schema), retention = until disconnect/uninstall, deletion = `shop/redact` + ops SQL (CONNECTORS-FIRST-BOOT §9), no sale/sharing, staff access logged.
- Same screen → **Read all orders** (`read_all_orders`, orders > 60 days): justify as "12+ month revenue-trend analysis for the merchant's own dashboard". Once granted: add `read_all_orders` to `[access_scopes].scopes` here and to `FLOWS.shopify.scopes` in `registry.ts`, redeploy, and existing merchants re-authorise (the card shows Reconnect).

### 2c. External-billing exemption (before submission — the pack's "big one")
Partner Dashboard → **Support** → *Contact support* → topic *App review / billing* (or the "Request an exemption from the Billing API" form if the App Store submission page shows one). Paste the pricing section of `LISTING.md` verbatim: Shopify is one of several optional integrations of an external platform; sign-up and billing live entirely off-Shopify; a merchant can pay Junction with no Shopify store. Ask for written confirmation and keep the ticket id in the submission notes. **If refused:** the fallback is Shopify Billing (`appSubscriptionCreate`, US$100/mo) for App-Store-installed merchants — a Wave-2 build in `src/lib/billing/` (another agent's lane), not this pass.

### 2d. Install entry from the App Store — **code spec for the next code pass (no `src/` edits here)**
Today the only way in is the Connectors card: the founder types `their-store.myshopify.com`,
`POST /api/connectors/shopify/start` builds the authorize URL. The App Store **Install** button
does not go through that card: Shopify sends the merchant to `application_url` with
`?shop=<domain>&hmac=<hex>&timestamp=<unix>&host=<b64>` (and, with managed installation, the
scopes already granted). The landing page ignores those params, so the reviewer's "OAuth must
complete immediately after install" check would fail. Required:

```
GET /api/connectors/shopify/install?shop=&hmac=&timestamp=&host=
```
1. `normaliseShopDomain(shop)` — 400 on anything else.
2. `verifyShopifyHmac(searchParams, SHOPIFY_CLIENT_SECRET)` (`src/lib/connectors/oauth.ts` — same rule: every param except `hmac`/`signature`, sorted, hex) — 401 on failure. Reject `timestamp` older than 24h (replay).
3. Not configured (`!isPlatformConfigured("shopify")` / no keyring / no DB) → 302 `/app?connect_error=shopify` (never a stack trace).
4. **No session:** set an httpOnly, SameSite=Lax cookie `unc_shopify_install=<shop>` (10-min TTL, value already validated) and 302 to `/login?next=/api/connectors/shopify/install/resume` (magic-link sign-up/sign-in). The auth callback honours `next`; on resume, read the cookie, clear it, and continue at step 5. New users go through `ensureAccount()` first (and `accept_beta_invites()` — docs/BETA.md) so a membership exists.
5. **Session present:** `handleStart(deps, "shopify", { shop })` (`src/lib/connectors/handlers.ts`) → 302 to `body.url`. Fallback bodies → `/app?connect_error=shopify`. Shopify then bounces straight back to `/api/connectors/shopify/callback` with a code (consent already granted under managed installation) and the existing callback finishes: HMAC, `shop` matches the state row, token exchange, sealed secret, `/app?connected=shopify`.
6. `application_url` itself (`/` on getjunction.ai) must forward: when `?shop=` + `?hmac=` are present on `/`, 302 to `/api/connectors/shopify/install` with the same query — a tiny check in the landing route or `middleware`. (Alternative: set `application_url` to `https://getjunction.ai/api/connectors/shopify/install` directly. That is simpler, but the listing's "app URL" then isn't a page — decide with the landing-page owner.)
7. Tests: HMAC pass/fail, no-session cookie + redirect, session → authorize URL, replayed timestamp, unknown shop shape — against the fake, no network.

Also worth adding in the same pass: `app/uninstalled` webhook (`[[webhooks.subscriptions]] topics = ["app/uninstalled"]` → `/api/webhooks/shopify/app_uninstalled`) for a same-day disconnect receipt; today the receipt arrives with `shop/redact` 48h later.

### 2e. Test-store walkthrough (record it; it is the screencast)
On the dev store, as a reviewer would: App Store-style install (once 2d exists — until then, from the Connectors card) → grant screen shows exactly the three read scopes → land on `/app?connected=shopify` → Connectors card *Connected* with the shop domain → open a routine → run a dry run → receipts show Shopify reads → Approve gate on a proposed action → Disconnect → receipt "access revoked on Shopify's side" → reinstall works. Then: Settings → Apps → uninstall on the dev store → 48h later (or force via the Dev Dashboard webhook tester) `shop/redact` lands → connector `disconnected`, no `connector_secrets` row.

### 2f. Screencast + listing
3–5 min, the prep pack's template: sign-up → connect Shopify → data appears → Unc proposes → Approve gate → receipts. Upload with the listing (`LISTING.md`): screenshots 1–3, icon 1200×1200, support email, privacy URL, categories. Partner Dashboard → Apps → Junction — Unc → **Distribution** → *Shopify App Store* → **Create listing** → fill → **Submit for review**. Expect 1–2 weeks to first response, 1–2 revision cycles (pack §3 timeline).

### 2g. After approval
- Bump `[webhooks].api_version` and the revoke constant when a new quarterly version is current.
- Watch Shopify's email for the protected-data decision; until granted, customers sync without PII (the warehouse rows show masked fields) — the card copy must not promise segmentation by name/email before then.

## 3. Summary — outstanding list
1. Partner org verified as the legal entity; Dev Dashboard app created; client id/secret → Vercel env; `shopify app config link` + `deploy`. **Tom.**
2. Protected customer data request (name, email) + `read_all_orders` request. **Tom** (answers prepared above).
3. External-billing exemption request in writing, ticket id kept. **Tom.**
4. `/api/connectors/shopify/install` entry (+ landing forward, + optional `app/uninstalled`). **Next code pass** (spec §2d).
5. Test-store walkthrough + screencast. **Tom** once 1 and 4 exist.
6. Listing submitted. **Tom.**
