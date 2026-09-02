# Pricing by country — research + recommendation (2026-09-02)

**Founder decision 6:** USD base, different prices per country, landing branding/comms per country. First design was intuition; this is the research pass. *Provisional — Tom's call on final points.*

## What Stripe can and can't do
- One product can carry **multiple prices, one per currency**; combined with IP-country detection we show the local price and pass the matching `STRIPE_PRICE_ID_<CUR>` to Checkout (built: `src/lib/locale/`).
- **India is the hard case.** Stripe India only onboards **Indian-registered entities**, and recurring card charges from Indian cards to a foreign merchant hit RBI e-mandate/auto-debit rules (frequent failures on renewals). Options, best first:
  1. **Merchant of record for India** (Paddle / Lemon Squeezy): they are the seller, handle GST, UPI, e-mandates, local cards. Cost ~5% + fees. Recommended for launch.
  2. **Prepaid plans in INR via MoR** (quarterly/annual) to sidestep recurring-mandate friction.
  3. Stripe in USD to Indian cards — works for one-off, unreliable for subscriptions. Not recommended.
- NZ/AU/GB/US: Stripe with local-currency prices; Stripe Tax handles GST/VAT.

## Price points (purchasing-power adjusted, floored by our cost)
Cost floor per account ≈ US$5–15/mo in model tokens at launch cadence (mechanics on fast tiers — see `docs/MODELS.md`) + ~US$1–3 infra. Never price below ~US$25-equivalent.

| Country | Currency | Price | ≈USD | Rationale |
|---|---|---|---|---|
| US (default) | USD | **$100** | 100 | Design anchor |
| NZ | NZD | **NZ$149** | ~90 | Proof base; slight PPP + GST-inclusive display |
| AU | AUD | **A$149** | ~98 | Growth market, near-US parity |
| UK | GBP | **£79** | ~100 | Parity |
| India | INR | **₹4,900** intro (~US$59) → test **₹2,999** (~US$36) | 36–59 | PPP ≈ 20% of US would be ~$20 — below cost floor; ₹2,999 is the lowest defensible with fast-tier routing |

SaaS that PPP-adjusts sees ~4–5× emerging-market conversion (industry reports) — but only above the cost floor.

## Comms/branding per country (mechanism built, content to write)
`src/lib/locale/countries.ts` carries copy overrides per country (hero subline, waitlist helper, pricing label). Suggested first variants: **NZ/AU** — founder-led, "no marketing hire" frame; **India** — cost-of-hire vs agent frame, UPI/annual prepaid emphasis, WhatsApp support lane; **US/UK** — speed + receipts/trust frame.

## Decisions for Tom
1. India: MoR (recommended) vs wait. 2. Confirm the five price points. 3. Whether NZ shows GST-inclusive. 4. India launch cadence: routines on fast tiers by default (cost) — quality gate = the eval harness.

Sources: Stripe geographic pricing guide, Stripe pricing, PPP-for-SaaS 2026 guides (fungies.io, rocket.new), Stripe multi-currency docs.
