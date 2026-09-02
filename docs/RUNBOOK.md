# Unc — Runbook (from repo to running product)

Everything below is env-gated: with none of these variables set, the app runs in **demo mode** (client-side state, canned Unc replies, no accounts, no billing). Each layer switches on independently.

## Order of operations (one sitting — see PHASE-0-DECISION-BRIEF.md in the Drive folder)
1. **Database** — `docs/FIRST-BOOT.md`: create the Supabase project, run migrations `supabase/migrations/0001…0005` in order, enable Email (magic link), set Site URL + redirect.
2. **Secrets** — generate `CONNECTOR_SECRET_KEY` (`openssl rand -base64 32`), set the Anthropic key.
3. **Hosting** — Vercel project for the app (env vars below), Fly.io for the worker (`deploy/worker/`), domain `unc.getjunction.ai`.
4. **Billing** — `docs/BILLING-FIRST-BOOT.md`: Stripe product/price, Tax, portal, webhook.
5. **Connectors** — `docs/CONNECTORS-FIRST-BOOT.md`: per-platform client ids, redirect URIs, Airbyte.
6. **Smoke** — the checklists at the end of each doc; then Junction itself as account #1.

## Environment variables (never committed)
| Layer | Variables |
|---|---|
| Unc (LLM) | `ANTHROPIC_API_KEY` |
| App URL | `NEXT_PUBLIC_APP_URL`, `APP_URL` |
| Database | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server + worker) |
| Secret store | `CONNECTOR_SECRET_KEY` (+ `CONNECTOR_SECRET_KEY_VERSION`, `CONNECTOR_SECRET_KEY_PREVIOUS` for rotation) |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` |
| Connectors | `SHOPIFY_CLIENT_ID/SECRET`, `KLAVIYO_CLIENT_ID/SECRET`, `META_APP_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` |
| Sync | `AIRBYTE_API_KEY`, `AIRBYTE_WORKSPACE_ID`, `AIRBYTE_DESTINATION_ID` (or `WAREHOUSE_PG_*`), `AIRBYTE_SYNC_CRON`, `AIRBYTE_START_DATE` |

## Commands
| | |
|---|---|
| Dev server (with Junction env) | `PORT=3400 ./scripts/dev.sh` |
| Unit tests | `npm test` |
| E2E + visual parity | `npm run e2e` · `npm run e2e:parity` (report: `design-reference/parity/REPORT.md`) |
| Typecheck / build | `npx tsc --noEmit` · `npm run build` |
| Worker (local, once) | `npx tsc -p tsconfig.worker.json && node dist/worker/worker/main.js --once` |

## Hard product rules encoded in code
- No external mutation without an approved, unexpired gate belonging to the run (`src/lib/runtime/engine.ts`).
- Spend caps from the founder's budget fail closed (per-day and per-month).
- `LIVE_MODE_ENABLED = false` in `src/worker/service.ts` — flipping it is a founder decision (Wave 2).
- Unc may only say numbers that exist in the context he was given (`src/lib/unc/prompt.ts`, `narrative.ts` validator).
- Every read, draft, decision and mutation writes a receipt.
