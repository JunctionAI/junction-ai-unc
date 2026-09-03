# Unc — hosted auth providers (Composio, Nango, Paragon, Pipedream Connect)

*Evaluated 2026-09-03 against the live docs and pricing pages (links inline). Prototype adapter is
on branch `build/action-library`, env-gated and mocked-fetch tested only — no account was created,
no OAuth was performed, nothing here has talked to a provider.*

## The question

> "Composio and stuff — the tool we could use to collect all the auth details from the client so
> our agents can just run. Is that correct?"

## Verdict

**Half right.** These products are a *hosted connect screen + token vault + refresh loop + (optionally)
an API proxy and a catalogue of pre-built actions*. They do collect the founder's auth once and keep
it warm, and the agent layer never has to touch a refresh token. What they are **not** is a way round
platform app review for our core five: **none of the four gives us a production-ready, reviewed OAuth
app for Meta Ads, Shopify or Klaviyo** — we register our own Meta Business app (App Review for
`ads_management`/`ads_read`), our own Shopify Partner app, and Klaviyo is a private key or our own
app whichever way we go. Provider-owned apps exist only for GA4 (Composio, Nango test creds), Google
Ads (Composio — but we still supply our own developer token) and HubSpot (Composio's, still "awaiting
HubSpot approval", so the founder sees an *unverified app* warning). On every provider-owned app the
consent screen says **"Composio / Nango / Pipedream wants to access your account"**, not Junction, and
the resulting token is **locked in that vault** (unexportable). We already have the layer they sell —
`registry.ts` + `oauth.ts` + `crypto.ts` + `tokens.ts`, six flows, sealed store, refresh, tested — so
for the core platforms a provider buys us nothing except a second vault, a per-connection fee and a
new breach surface (Composio's May-2026 incident exfiltrated ~10K third-party tokens). Where a
provider *does* earn its keep is the **long tail** (Gorgias, Xero, QuickBooks, Slack, LinkedIn,
TikTok, YouTube…) — every OAuth flow we would otherwise hand-write. Recommended split: **own apps for
the six we have; Nango (self-hosted, free tier of the ELv2 build, or cloud at $0.29/connection) for
the long tail, behind the `CONNECTOR_AUTH_PROVIDER_<PLATFORM>` flag**. Not Composio for auth (tokens
masked on managed apps, per-tool-call billing, the breach); not Pipedream (Workday-owned since Dec
2025, us-east-1 only, three Meta actions); not Paragon (sales-led, five figures a year, no token
read-back).

## Comparison

| | **Composio** | **Nango** | **Paragon** | **Pipedream Connect** |
|---|---|---|---|---|
| End-user auth | Hosted Connect Link: `POST /api/v3.1/connected_accounts/link` → `redirect_url`; Composio redirects to our `callback_url?status=success&connected_account_id=…` ([docs](https://docs.composio.dev/docs/authenticating-tools)) | Connect session: `POST /connect/sessions` → `{token, connect_link}` (30 min); hosted Connect UI or embedded; success via frontend event / auth webhook ([docs](https://nango.dev/docs/reference/api/connect/sessions/create)) | RS256 user JWT we mint + `paragon.connect()` SDK; **no server-side connect link** ([docs](https://docs.useparagon.com/getting-started/installing-the-connect-sdk)) | `POST /v1/connect/{project}/tokens` → `connect_link_url` (single-use, 4 h) ([docs](https://pipedream.com/docs/connect/api-reference/create-connect-token.md)) |
| Their reviewed app — **Meta Ads** | **No** ("Composio Managed App Available? No") ([toolkit](https://docs.composio.dev/toolkits/metaads)) | **No** test app; own Business app, `ads_read` + App Review ([guide](https://nango.dev/docs/api-integrations/meta-marketing-api/how-to-register-your-own-meta-marketing-api-oauth-app)) | Dev keys **test only**; own app for prod ([docs](https://docs.useparagon.com/resources/integrations/facebook-ads)) | Pipedream's client usable for proxy/actions, consent says "Pipedream", **no token read-back** ([docs](https://pipedream.com/docs/connect/managed-auth/oauth-clients)) |
| — **Google Ads** | Yes, managed — but **our own developer token** on the auth config ([toolkit](https://docs.composio.dev/toolkits/googleads)) | **No** test app; own client + dev token ([guide](https://nango.dev/docs/api-integrations/google-ads/how-to-register-your-own-google-ads-api-oauth-app)) | Own client + own dev token; dev keys test only | Pipedream client routed via their dev-token endpoint (undocumented, uncertain) |
| — **GA4** | Yes, managed ([toolkit](https://docs.composio.dev/toolkits/google_analytics)) | Yes, **test credentials** ("activate in the dashboard"); own app for prod | Own client; dev keys test only | Pipedream client |
| — **Shopify** | **No**; store subdomain entered at connect ([toolkit](https://docs.composio.dev/toolkits/shopify)) | Own Partner app ([docs](https://nango.dev/docs/api-integrations/shopify)) | Own app, **no dev keys** | Pipedream client / own |
| — **Klaviyo** | **No** (API key / OAuth2) | API-key provider (founder pastes a private key into *Nango's* UI) | Private API key | Pipedream client / own |
| — **HubSpot** | Composio's app, **"awaiting HubSpot approval" → unverified-app warning** ([toolkit](https://docs.composio.dev/toolkits/hubspot)) | Own app | Own app | Pipedream client |
| Consent screen on their app | "Composio wants to access…"; scopes fixed; quota shared across all Composio customers; "use your own app for production" ([docs](https://docs.composio.dev/docs/custom-app-vs-managed-app)) | "Nango"; fixed scopes; test only ([docs](https://nango.dev/docs/guides/auth/auth-guide)) | Paragon (dev keys) / ours (prod) | "Pipedream", their broad scope set |
| Token storage / who reads it | AES-256, decrypted in their execution layer. **Masked (`REDACTED`) for managed auth configs — always, since 2026-04**; readable for our-own-app auth configs only if the project setting is off ([docs](https://docs.composio.dev/docs/auth-configuration/connected-accounts)) | AES-256-GCM, Aurora in private VPC; **raw `access_token`/`refresh_token` readable** via `GET /connections/{id}` (scoped key) ([security](https://nango.dev/docs/guides/platform/security)) | AES-256, separate vault per key; **never readable via API** ([security](https://www.useparagon.com/security)) | AES-256-GCM, keys in KMS "accessible to specific members of our team"; readable **only** on our own OAuth client ([docs](https://pipedream.com/docs/connect/api-reference/retrieve-account.md)) |
| Proxy (call on the founder's behalf) | `POST /api/v3.1/tools/execute/proxy` `{endpoint, method, connected_account_id, body, parameters}` | Any verb `/proxy/<path>` + `Connection-Id`, `Provider-Config-Key` headers | `proxy.useparagon.com/projects/<id>/sdk/proxy/<integration>/<path>` | `POST /proxy/<b64 url>?external_user_id&account_id` |
| Ready-made actions — Meta pause ad set / set budget | 56 Meta tools (`METAADS_CREATE_AD_SET`, `_GET_INSIGHTS`, `_UPDATE_CAMPAIGN`…) — **no update-ad-set / pause / budget tool → proxy** | **"No pre-built syncs or actions available yet"** for Meta Marketing → proxy only | `FACEBOOK_ADS_UPDATE_AD_SET` (params unverified) | 3 actions (custom audiences only) → proxy |
| — Shopify read orders | `SHOPIFY_LIST_ORDERS`, `_GRAPH_QL_ADMIN_EXECUTE` (~407 tools) | `orders` sync + ~180 actions | `SHOPIFY_GET_ORDERS(_GRAPHQL)` | `search-orders` |
| Pricing (unit) | **Per tool call** (+ **$0.10/managed connection/mo**): Free 100K calls (only 20K on managed apps), Pro $29 incl. credit, $0.0003/call over ([pricing](https://composio.dev/pricing)) — Aug-2026 restructure reported, re-check the dashboard | **Per connection**: Free 10 connections; PAYG $50/mo min, $0.29/connection/mo; Enterprise "as low as $0.01" ([pricing](https://nango.dev/pricing)) | **Per connected user, sales-led**; "annual agreements start at five figures" ([Nango's writeup](https://nango.dev/blog/paragon-pricing/)) | **Per external user + credits**: Connect $99/mo (annual) = 100 users + 10K credits, **$2/extra user**; proxy calls burn credits ([pricing](https://pipedream.com/docs/pricing.md)) |
| Residency / compliance | SOC 2 II + ISO 27001; no EU cloud; residency only via Enterprise self-host ([enterprise](https://composio.dev/enterprise)) | SOC 2 II, GDPR DPA, HIPAA BAA; AWS (region unstated); Enterprise BYOC | SOC 2 II, HIPAA, GDPR; **US or EU** cloud; self-host on K8s | SOC 2 II; **us-east-1 only**, no self-host |
| Self-host / licence | Enterprise only; images closed; OSS repo = SDKs (MIT) | **Free docker-compose: auth + proxy + Connect UI** under **Elastic License 2.0**; functions/webhooks/RBAC = Enterprise ([self-hosting](https://nango.dev/docs/guides/platform/self-hosting)) | Enterprise only | None |
| Lock-in / exit | Managed-app tokens never exportable; own-app tokens readable if masking off; every founder re-authorises on exit | Export = loop `GET /connections` + `GET /connections/{id}?refresh_token=true`; on our own apps tokens survive leaving; bulk import endpoint exists both ways | No export; founders re-authorise | Export only on our own OAuth client |
| Company / incidents | $25M Series A (2025). **May-2026 breach**: employee Gmail token → ~5.2K API keys + ~5K GitHub tokens + Gmail/Slack/HubSpot/Notion tokens exfiltrated ([status](https://status.composio.dev), [analysis](https://material.security/resources/the-composio-breach-one-token-10242-doors)) | $7.5M seed (Apr 2026), cashflow positive; no breach on record; API renames (`/connection`→`/connections` Jan 2026, `end_user`→`tags`) | ~$21M raised, independent; a few sub-3h outages in 2026 | **Acquired by Workday (closed 4 Dec 2025)**; roadmap tilting to Workday agents |

## Fit against our design

| Design rule | Own apps (today) | With a provider |
|---|---|---|
| Founder authenticates once | Yes (Connectors grid → `/start` → platform → `/callback`) | Yes — same button, `/start` returns the provider's hosted link instead |
| Tokens sealed, never reach n8n | Sealed in `connector_secrets` (AES-256-GCM, service-role only); n8n only ever sees our read proxy | Token at rest is in **their** vault; we fetch it per read (`tokens.ts` provider branch) — still server-memory only, still never n8n. A provider *proxy* would let n8n call platforms tokenless, but that bypasses receipts → keep n8n on our read proxy |
| Every read/write receipted | Readers/executor receipt each call | Unchanged — we still make (or proxy) the call ourselves, so the receipt sits in the same place. Actions run *inside* the provider (Composio tools, Nango functions) would not be receipted by us → wrap, never call direct |
| Approvals gate mutations | Executor checks the approval before any write | Unchanged — the gate is upstream of `proxyRequest` |
| Warehouse (Airbyte) needs the raw token in the source config | Yes, from the sealed bundle | **Only if the provider hands the raw token out**: Nango yes; Composio only on our-own-app auth configs; Pipedream only on our own client; Paragon never. On a masked token the nightly sync is dead — proxy-only providers cannot feed Airbyte |
| Reconnect semantics ("couldn't ask" ≠ "nothing happened") | `tokens.ts` flips the row to `needs_reconnect` with a code | Same: provider errors map to `error:provider_<code>`; Meta's 60-day expiry is unchanged whoever holds the token ("Facebook tokens expire after 60 days and cannot be refreshed" — Nango's own guide) |
| App review for strangers | Meta App Review, Google verification (sensitive scopes, several weeks), Shopify app review, Klaviyo/HubSpot public-app checks | **Not removed** for Meta/Shopify/Klaviyo on any provider. Removed for GA4 / Google Ads / HubSpot only by using *their* app, with *their* name on the consent screen and their quota — wrong for a premium, founder-facing product |
| Cost per founder at $100/mo | ~$0 marginal (engineering time) | Nango cloud 4 × $0.29 = **$1.16 (1.2%)**; Composio managed 4 × $0.10 + calls; Pipedream $2/user beyond 100 (2%); Paragon ≥$1.70 even at 500 founders, $140+ at 6 |

**What breaks if we moved the core five to a provider:** the Airbyte data path on any masked-token
provider; brand on the consent screen; token portability; and we inherit their outage + breach
surface on the single most sensitive asset we hold. **What we gain:** nothing on the core five that
`tokens.ts` doesn't already do.

## Cost model

Assumptions: ~4 connections per founder (Shopify, Klaviyo, Meta, Google — GA4 + Ads count as two at
most providers; call it 4–5), nightly sync + ~50 platform calls per connection per day when proxied,
NZ$120/h engineering, Tom's time included. Own-app "build" is what is *left* — the six flows, the
secret store and refresh already exist and are tested on `main`.

| Founders | Connections | **Own apps** (remaining build + maintenance) | **Nango** | **Composio** | **Pipedream Connect** | **Paragon** |
|---|---|---|---|---|---|---|
| 6 | ~24 | Reviews: Meta App Review ~15 h + 1–3 wk wait; Google verification ~10 h + weeks; Shopify app review ~10 h; HubSpot/Klaviyo unlisted-app checks ~4 h → **~40 h once (~NZ$4.8K)**. Maintenance ~4 h/mo (~NZ$480/mo) across the six | Cloud: **$50/mo** (24 × $0.29 = $7 under the minimum) — or **$0 self-host** (+ ~NZ$60/mo VM/Postgres + ~2 h/mo ops) | Free tier covers it (unlimited accounts; 20K managed-app calls) → **$0–29/mo**, but Meta/Shopify/Klaviyo still need our apps *and* the reviews above | **$99/mo** (annual) | **~NZ$1.4K–4K/mo** (five figures/yr amortised) |
| 50 | ~200 | Same one-off; maintenance ~5 h/mo | Cloud **$58/mo** · self-host **$0 + ~NZ$100/mo infra** | ~300K proxied calls/mo → ~$60 over free + $20 managed connections → **~$80–110/mo** | **$99/mo** (100 users incl.) + credit overage on proxied calls | **~NZ$1.4K–4K/mo** |
| 500 | ~2,000 | Same one-off; maintenance ~8 h/mo (~NZ$960/mo); Google/Meta quota work | Cloud **$580/mo** (Enterprise quote "as low as $0.01" → ~$20) · self-host **~NZ$300/mo infra + 4 h/mo** | ~3M calls/mo → **~$900+/mo** + $200 managed connections; per-call unit grows with every routine we add | **$99 + 400 × $2 = $899/mo** + credits (3M proxied calls ≫ 10K plan credits — uncosted, likely the largest line) | **~NZ$1.4K–4K/mo** + per-user tiers |
| **Per founder at 500** | | **~NZ$2/mo** | $1.16 cloud · ~$0.60 self-host | ~$2.20 | ~$1.80 + credits | ≥$3–8 |

Reading it: the provider fees are affordable at every scale (1–2% of revenue) — cost is not the
reason to say no. The reason is that **for the core five the provider does not remove the ~40 h of
reviews, and adds a vault we don't control**. The reason to say yes for the long tail is the other
side of the same coin: each *new* platform is ~8–16 h to hand-write (flow + revoke + picker + tests)
versus ~1 h to switch on at Nango.

## What Tom must decide

1. **Core five stay on our apps** (recommended) — accept the review calendar: Meta App Review,
   Google verification, Shopify app review. Nothing else unblocks strangers.
2. **Long tail via Nango, and which deployment**: cloud ($50/mo, tokens readable, they hold the vault)
   *or* self-host (free ELv2 build on a small VM: auth + proxy + Connect UI; we hold
   `NANGO_ENCRYPTION_KEY`; no functions/webhooks — we don't need them). Self-host keeps every token
   under our keys, which is the whole point of the sealed-store rule.
3. **Whether to use any provider-owned app at all** — I'd say no: brand on the consent screen +
   locked-in tokens. If Tom wants GA4 live *this week* for a tester before Google verification lands,
   Nango's GA4 test credentials are the one acceptable stop-gap (test only, reconnect later).
4. **Composio as a tool catalogue** (not auth) is a separate question for the actions work — its
   56 Meta / 407 Shopify tools could seed our action library, but every call must go through our
   receipts + approvals, and it must run on *our* auth configs.

## Next steps for the chosen path (own apps + Nango for the long tail)

Nothing below is done; all of it is Tom-only (accounts, credentials, sends).

1. **Reviews (unblock strangers on the core five)** — follow the prep pack
   (`clients/junction-ai/product/unc-growth-agent-design-2026-09-01/legal-and-oauth/OAUTH-PREP-PACK.md`):
   Meta App Review for `ads_read`/`read_insights`/`business_management`; Google OAuth verification for
   `analytics.readonly` + `adwords` (sensitive, not restricted → no CASA); Shopify app review with the
   three read scopes; confirm HubSpot/Klaviyo unlisted-app rules.
2. **Nango** — create the account (or `docker compose` the self-host build with
   `FLAG_SERVE_CONNECT_UI=true` and a 32-byte `NANGO_ENCRYPTION_KEY`), one environment (`prod`),
   a secret key scoped to `environment:connections:read_credentials` + connect sessions. Add an
   integration per long-tail platform in the dashboard with **our** client id/secret (register
   `https://api.nango.dev/oauth/callback` — or the self-host equivalent — as the redirect URI on that
   platform); note each integration's *unique key*.
3. **Env (server only)** —
   `CONNECTOR_AUTH_PROVIDER_<PLATFORM>=nango` per platform we route there (never the global flag while
   the core five have their own apps — the registry ignores it for configured platforms anyway),
   `NANGO_SECRET_KEY`, `NANGO_HOST` (self-host base, else default `https://api.nango.dev`),
   `NANGO_CONNECT_URL` (self-host Connect UI base, else `https://connect.nango.dev`),
   `NANGO_INTEGRATION_<PLATFORM>=<unique key>` (or `NANGO_INTEGRATION_DEFAULTS=1` to accept the
   provider slugs). Restart; `/api/connectors/state` shows `authProvider: "nango"` on those cards.
4. **First real connect on a Junction-owned test account** — click Connect, finish Nango's UI, land on
   `/api/connectors/provider/nango/callback?platform=…&state=…` (or call it as "check now"), watch the
   row flip and the receipt land. This is the moment the ⚠ shapes in `nango.ts` get verified.
5. **Then** add a reader for the platform (owned by the actions work) — the credential arrives through
   the same `ConnectorCredentialProvider`, so readers don't know a provider is involved.

If Tom picks Composio instead: `CONNECTOR_AUTH_PROVIDER_<PLATFORM>=composio`, `COMPOSIO_API_KEY`,
`COMPOSIO_AUTH_CONFIG_<PLATFORM>=ac_…` (an auth config **on our own developer credentials**, masking
off in project settings, else `getAccessToken` fails with `provider_no_token` and only `proxyRequest`
works — which starves Airbyte); register `https://backend.composio.dev/api/v3/toolkits/auth/callback`
on each platform app; our callback is `https://<APP_URL>/api/connectors/provider/composio/callback`.

## What is prototyped (this branch)

| File | What |
|---|---|
| `src/lib/connectors/providers/interface.ts` | `AuthProvider` seam: `supports`, `connectUrl`, `handleCallback`, `getAccessToken`, `proxyRequest?`, `deleteConnection`; `AuthProviderError` codes; the row pointer (`sync_ref.auth_provider` / `provider_connection_id` / `provider_integration` — ids only) |
| `src/lib/connectors/composio.ts` · `nango.ts` | Adapters against the documented REST shapes (v3.1 link/proxy, `/connections`, tags) — ⚠ marks the unverified bits (Shopify `connection_data` key, whether Nango's Connect Link redirects back). Composio masked tokens are refused as `no_token` |
| `src/lib/connectors/providers/index.ts` | `authProviderFor(platform)` → own / provider / provider-but-unusable (no key, no integration) |
| `src/lib/connectors/registry.ts` (+) | `authProviderMode(platform, env)`: `CONNECTOR_AUTH_PROVIDER[_<PLATFORM>]=own\|composio\|nango`; **our app wins whenever its client id + secret are set**; Google umbrella and catalogued-only platforms never route to a provider |
| `src/lib/connectors/providers/connect.ts` | `startViaProvider` (same gates as `/start`, writes the state row + a `connecting` row with the pointer), `callbackViaProvider` (consumes the state, asks the provider, flips the row, receipts, fires the first read), `revokeViaProvider` |
| `src/lib/connectors/handlers.ts` (+) | `/start` routes to the provider when `authProviderMode !== "own"` (the UI follows `{ url }` unchanged); disconnect deletes the connection at the provider instead of revoking a sealed token |
| `src/lib/connectors/tokens.ts` (+) | Provider-held rows fetch the live token per call; never sealed; expired/masked/errored → `needs_reconnect` + `error:provider_<code>`; `ConnectorCredentialProvider` unchanged for readers |
| `src/lib/connectors/state.ts` (+) | `oauthConfigured` true when a usable provider covers the platform; `authProvider` marker on the card |
| `src/app/api/connectors/provider/[provider]/callback/route.ts` | The provider return / "check now" URL |
| Tests | `providers/__tests__/{flag,composio,nango,connect}.test.ts` — 37 tests, schema-checked fake DB + stubbed fetch; the first assertion in `connect.test.ts` is that with the flag unset nothing changes |

## Caveats

- **Nothing has been run live.** Every REST shape is from the docs as of 2026-09-03; the adapters parse
  defensively and the ⚠ comments mark what a first real connect must confirm (Composio's Shopify
  `connection_data` key; whether Nango's hosted Connect Link can redirect back — if not, the founder
  returns to the grid and the card's poll should call the callback URL as "check now"; that UI hook is
  not wired).
- **No provider webhooks.** Nango posts `auth` webhooks (creation, refresh failures) signed with
  `X-Nango-Hmac-Sha256`; we detect failures at read time instead, which is the existing contract.
- **Composio pricing is in flux** (an Aug-2026 restructure with per-1K overage was reported by a third
  party; the live page still shows the per-call grid) — re-read the dashboard before quoting it.
- **API churn**: Nango removed `/connection` (Jan 2026) and deprecated `end_user` → `tags`; Composio
  retired `initiate()` for managed auth (Jul 2026) and v1/v2 endpoints. Pin what the first live
  connect proves and add a contract test against a recorded response.
- **Pre-existing red on this tree**: `fakeSupabase.test.ts` (table count — another agent's
  `0015_presets.sql` is in the same working tree) and four approvals-expiry tests (fixture dated
  2026-09-02 vs the real clock). Neither touches the connector suites.
