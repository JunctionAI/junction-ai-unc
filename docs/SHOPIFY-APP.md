# Unc — Shopify public app (Decision 7, 2026-09-02: "run it")

One-page index. The app itself is the connector code that already exists; this folder is the
Shopify-side packaging around it.

| File | What it is |
|---|---|
| `shopify/shopify.app.toml` | Shopify CLI config: name, `application_url`, redirect URL, scopes, three compliance webhooks, `embedded = false`, dev-store placeholder, `api_version`. Mirrors `src/lib/connectors/registry.ts` + `src/app/api/webhooks/shopify/[topic]/route.ts` — change the code first, then this. |
| `shopify/LISTING.md` | App Store listing draft: name, tagline, descriptions, 3 benefits, external-billing pricing text + exemption rationale, screenshot list, support/privacy, categories. |
| `shopify/REVIEW-CHECKLIST.md` | What review already gets from the code (with file cites), what's outstanding, Tom's exact dashboard clicks, and how the **App Store install entry** (`/api/connectors/shopify/install`, built 2026-09-02) works. |
| `docs/CONNECTORS-FIRST-BOOT.md` | Env, migration 0005, per-platform flow, webhook registration, disconnect/purge — the wiring this sits on. |
| OAUTH-PREP-PACK.md §3 (Drive) | Review process, scope justifications, billing gotcha, timeline. |

## Decisions baked in
- **Non-embedded app.** Merchants are redirected to getjunction.ai; no App Bridge. Listing category allows it.
- **Scopes:** `read_orders,read_products,read_customers` — read-only, exactly what the warehouse syncs. `read_all_orders` waits on the protected-data / read-all-orders request.
- **Billing:** external, US$100/mo via Junction (Stripe). Exemption requested in writing before submission; Shopify Billing is the fallback, not the default.
- **APP_URL = https://getjunction.ai**, exactly, or the callback fails.
- **api_version 2026-07** — assumed current stable as of 2026-09; verify and bump quarterly.

## Commands (once the app exists in the Dev Dashboard)

Shopify CLI is not a repo dependency — use it globally or via `npx` (no `package.json` change):

```bash
npm i -g @shopify/cli@latest          # or prefix every command with: npx @shopify/cli@latest
cd ~/junction-unc/shopify

shopify auth login                    # Partner account (Tom)
shopify app config link               # pick "Junction — Unc" → writes client_id into shopify.app.toml
shopify app deploy                    # pushes scopes, URLs, compliance webhooks as a new app version
shopify app versions list             # confirm the release
shopify app config use shopify.app.toml   # if the CLI asks which config is active
```

Do **not** run `shopify app dev` against production config — `automatically_update_urls_on_dev = false`
protects the registered redirect URL, but a dev tunnel is still the wrong place for a
non-embedded app whose callback is served by Vercel. Test on the dev store against the deployed
app (REVIEW-CHECKLIST §2e).

After `deploy`, in Vercel: `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` from the Dev Dashboard
(never from this file — the secret is not in the toml), redeploy, then the Connectors card's
Shopify button stops answering "Not switched on yet".

## Outstanding (short form — detail in REVIEW-CHECKLIST.md §3)
1. Partner org + Dev Dashboard app + env + `config link`/`deploy` — Tom.
2. Protected customer data (name, email) + `read_all_orders` requests — Tom.
3. External-billing exemption in writing — Tom.
4. ~~`/api/connectors/shopify/install` entry + landing forward~~ — built 2026-09-02 (`src/lib/connectors/install.ts`; `app/uninstalled` webhook still optional/open).
5. Dev-store walkthrough + screencast — Tom.
6. Listing submission — Tom.
