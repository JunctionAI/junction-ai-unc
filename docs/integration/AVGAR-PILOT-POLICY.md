# AVGAR pilot business settings

Source: Tom's direct confirmation, 5 September 2026.

- Markets: United States (`US`), New Zealand (`NZ`), Australia (`AU`).
- CPA ceiling: **50% of the relevant product's price**.
- This sets a maximum CPA, not a new target CPA, ROAS target, account spend budget or authorization to scale/pause ads.
- Bind each recommendation to the actual promoted product/variant and current market-specific selling price. Do not substitute store-wide AOV, a different product, a compare-at price or a fixed dollar cap across currencies.
- Compare price and ad spend in the same currency. If conversion is required, retain the rate/source/time. Missing product mapping, currency or price means hold for clarification/data, not a zero cap.
- No keyword seed was explicitly selected in this reply. Codex may propose product-grounded seeds, but must identify them as proposed and bind the tested choice explicitly.
- The keyword pilot contract carries one location per request. US, NZ and AU require separately scoped requests/receipts, or a deliberately versioned multi-market contract—not three countries hidden behind one location code.
- Nguyen must validate the location codes/language supported by the actual DataForSEO endpoint. See [DataForSEO Labs locations/languages](https://docs.dataforseo.com/v3/dataforseo_labs_locations_and_languages/). Do not reuse the US test code for every market.

Implementation status: recorded decision for the Unc/Nguyen handoff. Not an assertion that product-to-ad mapping, currency normalization or production policy enforcement is complete. Existing code's product-cap policy combines scale/off thresholds; do not interpret this confirmation as approving automatic scaling or changing that policy without evidence/approval gates.

Codex checked the [current AVGAR storefront](https://avgarsport.com/) on September 5: it describes golf bags, travel cases and accessories. Proposed initial seed: **golf travel case** (product-grounded proposal, not a customer-approved seed or proven search opportunity). Use the verified public brand domain for SEO, while retaining the Shopify domain as the connector's technical store identifier. Do not infer every market's selling price from the NZ storefront price.
