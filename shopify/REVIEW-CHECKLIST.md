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
| **App Store install entry** (`application_url` → OAuth immediately) | `src/app/api/connectors/shopify/install/route.ts` + `…/install/resume/route.ts` → `src/lib/connectors/install.ts`; landing forward in `src/app/page.tsx` via `src/lib/connectors/installForward.ts` | `?shop=&hmac=&timestamp=&host=` on `/` is forwarded, query intact, to the install route: shop shape (400) → app creds (bounce) → HMAC (401) → timestamp ±5 min (401, replay) → no session: shop parked in a signed 10-minute httpOnly cookie + `/login?next=…/install/resume` (magic link honours `next`) → session: same `handleStart` as the card → 302 to the authorize URL. Merchant with no account yet gets one created (or their beta invite accepted) first. Built 2026-09-02. |
| Tests, no network | `src/lib/connectors/__tests__/` | Shopify start/callback/HMAC/webhook/revoke/**install** paths covered against the schema-checked fake (`install.test.ts`: fixed HMACs, stale/replayed timestamp, cookie tamper/expiry, both happy paths); landing forward pinned by `tests/e2e/landing.spec.ts`. |
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

### 2d. Install entry from the App Store — **built 2026-09-02** (was the spec for this pass)
`application_url` (`/` on getjunction.ai) forwards a request carrying `?shop=&hmac=` — every
param, because Shopify signs them all — to:

```
GET /api/connectors/shopify/install?shop=&hmac=&timestamp=&host=
```
(`src/app/api/connectors/shopify/install/route.ts` → `src/lib/connectors/install.ts`). What it does, in order:
1. `normaliseShopDomain(shop)` — 400 on anything else.
2. App credentials present, else 302 `/app?connect_error=shopify` (the HMAC can't be checked without the secret).
3. `verifyShopifyHmac(searchParams, SHOPIFY_CLIENT_SECRET)` — 401 `bad hmac`. `timestamp` must be within **±5 minutes** of our clock — 401 `stale timestamp` (replay; tighter than the 24 h first drafted here).
4. No keyring / no accounts DB → 302 `/app?connect_error=shopify` (never a stack trace).
5. **No session:** the shop is parked in `unc_shopify_install` — httpOnly, SameSite=Lax, path-scoped to the install routes, 10-minute Max-Age, value `<shop>.<expiresMs>.<hmac-sha256 under the app secret>` (re-validated and re-signed on the way back, so a tampered cookie can only fail) — and the merchant goes to `/login?next=/api/connectors/shopify/install/resume`. `/login` passes `next` into the magic link's `emailRedirectTo`; `/auth/callback` already honoured it; the proxy's signed-in `/login` redirect now honours it too. **Resume** (`…/install/resume/route.ts`) reads + clears the cookie and continues at 6. A merchant arriving straight from the magic link has no account yet: both routes run `requireAccountSession({ createAccount: true })` first — which accepts a beta invite (docs/BETA.md) before creating anything — so a membership exists.
6. **Session:** `handleStart(deps, "shopify", { shop })` — the Connectors card's own path — → 302 to the authorize URL (state row bound to the shop, connector row `connecting`). Shopify bounces back to `/api/connectors/shopify/callback` with a code and the existing callback finishes: HMAC, `shop` matches the state row, token exchange, sealed secret, `/app?connected=shopify`. Any fallback/403 → `/app?connect_error=shopify`.
7. Tests: `src/lib/connectors/__tests__/install.test.ts` (fixed HMACs: pass/fail/tamper/malformed, stale + future + missing timestamp, unconfigured, no-session cookie + redirect, session → authorize URL, resume happy/tamper/expiry/wrong-secret, landing forward) and `tests/e2e/landing.spec.ts` (`/?shop=&hmac=` redirects through the install route on the demo server).

Keep `application_url = https://getjunction.ai` in `shopify.app.toml` (the listing's app URL stays a page; the forward does the rest).

**Still not built:** `app/uninstalled` webhook (`[[webhooks.subscriptions]] topics = ["app/uninstalled"]` → `/api/webhooks/shopify/app_uninstalled`) for a same-day disconnect receipt; today the receipt arrives with `shop/redact` 48h later. Tom should also confirm the Supabase Auth redirect allow-list covers `https://getjunction.ai/auth/callback?next=*` (the `next` value now varies).

### 2e. Test-store walkthrough (record it; it is the screencast)
On the dev store, as a reviewer would: App Store-style install (Dev Dashboard → Test on development store → Install lands on `/` with the signed query → sign in via magic link → Shopify's grant screen) → grant screen shows exactly the three read scopes → land on `/app?connected=shopify` → Connectors card *Connected* with the shop domain → open a routine → run a dry run → receipts show Shopify reads → Approve gate on a proposed action → Disconnect → receipt "access revoked on Shopify's side" → reinstall works. Then: Settings → Apps → uninstall on the dev store → 48h later (or force via the Dev Dashboard webhook tester) `shop/redact` lands → connector `disconnected`, no `connector_secrets` row.

### 2f. Screencast + listing
3–5 min, the prep pack's template: sign-up → connect Shopify → data appears → Unc proposes → Approve gate → receipts. Upload with the listing (`LISTING.md`): screenshots 1–3, icon 1200×1200, support email, privacy URL, categories. Partner Dashboard → Apps → Junction — Unc → **Distribution** → *Shopify App Store* → **Create listing** → fill → **Submit for review**. Expect 1–2 weeks to first response, 1–2 revision cycles (pack §3 timeline).

### 2g. After approval
- Bump `[webhooks].api_version` and the revoke constant when a new quarterly version is current.
- Watch Shopify's email for the protected-data decision; until granted, customers sync without PII (the warehouse rows show masked fields) — the card copy must not promise segmentation by name/email before then.

## 3. Summary — outstanding list
1. Partner org verified as the legal entity; Dev Dashboard app created; client id/secret → Vercel env; `shopify app config link` + `deploy`. **Tom.**
2. Protected customer data request (name, email) + `read_all_orders` request. **Tom** (answers prepared above).
3. External-billing exemption request in writing, ticket id kept. **Tom.**
4. ~~`/api/connectors/shopify/install` entry + landing forward~~ **built 2026-09-02** (§2d). Optional `app/uninstalled` webhook still open.
5. Test-store walkthrough + screencast. **Tom** once 1 exists (4 is done).
6. Listing submitted. **Tom.**
