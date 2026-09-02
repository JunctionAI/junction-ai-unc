# Junction — Unc · Shopify App Store listing (draft)

*Draft for Tom's sign-off before it goes into the Partner Dashboard listing form. Every claim
below is something the code does today (`src/lib/connectors/`, `src/lib/runtime/`); nothing
here promises a write action. Placeholders are marked.*

## App name
**Junction — Unc**

## Tagline (≤ 62 chars)
`Reads your store, drafts the work, waits for your approval.`  (59 chars)

Alternates: `Reads your store. Drafts the work. You approve.` (47) ·
`AI growth agent. Reads your store, drafts the work, you approve.` (64 — too long)

## Short description
Junction connects your Shopify store (orders, products, customers) to Unc, an AI growth agent
that turns your real numbers into marketing work — content, email, paid and SEO routines — and
holds every action until you click Approve. Every read is receipted.

## Full description
**What it is.** Junction is a subscription AI growth agent for founder-led businesses. You
sign up at getjunction.ai, set one governing goal, and connect the platforms you already use —
Shopify, Klaviyo, Meta Ads, Google Ads, GA4. Unc reads them, works out where the goal is
leaking, and runs growth routines against it.

**What it reads from Shopify.** Orders, products and customers — read-only. That is the whole
scope. The data syncs into a private, per-store warehouse (no two stores share a schema), and
it is used for one thing: growth work for *your* store. We never modify your store, your
theme, your products or your orders through this app.

**Nothing goes out without you.** Every routine that would publish, send or spend prepares
the exact change, shows you before/after and the reasoning, and waits. You approve it, hold
it, or ask why. Spend caps come from the budget you typed and are enforced server-side.

**Every read is receipted.** Each time Unc reads your data or proposes a change it writes a
receipt you can open: what was read, when, for which routine. There is no hidden activity.

**What happens when you leave.** Disconnect from the Junction app revokes our access on
Shopify's side, deletes the stored token and tears down the sync. Uninstalling the app does
the same through Shopify's compliance webhooks (`shop/redact`); customer data requests and
redactions are honoured through the other two.

**Where you work.** Junction is not embedded in Shopify admin. After install you're sent to
getjunction.ai, where your goal, plan, routines, approvals and receipts live alongside your
other connected platforms.

## Key benefits (3)
1. **Real numbers, not guesses.** Routines run on your certified orders, products and customer data — synced nightly, receipted every time.
2. **You stay in charge.** Nothing publishes, sends or spends without your explicit Approve. Held decisions expire; nothing sneaks through.
3. **One department, not five tools.** Content, email, paid and SEO routines share one goal, one plan and one ledger — Shopify is one of the platforms it reads, not the only one.

## Pricing (external billing)
**US$100 / month, billed by Junction (Stripe) at getjunction.ai. No charge is made through
Shopify.** Free to install; the subscription is to Junction, and covers every connected
platform, not just Shopify.

*Exemption rationale (for the review team — from the OAuth prep pack §3):* Junction is a
broader platform where Shopify is one of several optional integrations (Klaviyo, Meta Ads,
Google Ads, GA4, HubSpot are connected the same way). Sign-up, onboarding and billing happen
entirely outside Shopify, before and independently of any Shopify install; a merchant can be a
paying Junction customer with no Shopify store at all. This is the "Shopify is one of many
integrations of an external platform" case the external-billing exemption exists for. We are
requesting the exemption in writing before submission (REVIEW-CHECKLIST.md); if it is refused,
the fallback is Shopify Billing for App-Store-installed merchants at the same price.

## Demo screenshots to capture (from the app, accounts mode, a seeded test store)
1. **Home with approvals** — the Today view with one pending decision card open: title, before → after, the *Why?* bubble, Approve / Hold. Shows the gate.
2. **Connectors card** — Shopify *Connected* (shop domain shown as the external ref), the three read scopes listed, Disconnect link; Klaviyo / Meta / Google cards beside it to show Shopify is one of several.
3. **Routine detail with receipts** — a routine (e.g. *Winback campaign prep*, D05-W04) opened to its node chain, and the receipts ledger beneath it: read receipts naming Shopify, timestamps, counts — no customer PII visible.
4. *(optional)* **Strategy view** — the governing goal, baseline and the current play, to show where the Shopify data goes.
5. *(optional)* **Shopify grant screen** — the consent page listing exactly `read_orders, read_products, read_customers`.

Capture at 1600×900 or larger, light theme, no demo-mode banners, real (test-store) data only.

## Support & legal
- Support: **support@getjunction.ai**
- Privacy policy: **https://getjunction.ai/privacy**
- Terms: https://getjunction.ai/terms
- Developer: Junction AI *(legal entity name = [PLACEHOLDER: company legal name] — must match the Partner organisation's verification documents)*

## Categories
- Primary: **Marketing** → Marketing analytics *(or "Marketing automation" if the form offers it — the app proposes work, it doesn't send)*
- Secondary: **Store management** → Analytics / Reports
- Works with: Klaviyo, Meta Ads, Google Ads, Google Analytics 4, HubSpot
- Languages: English
- Installs on: Online Store (non-embedded; opens at getjunction.ai)

## Search terms (5 max)
`ai marketing`, `growth agent`, `marketing automation`, `email marketing`, `analytics`
