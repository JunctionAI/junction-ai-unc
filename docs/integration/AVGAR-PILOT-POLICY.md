# AVGAR pilot business settings

Source: Tom's direct confirmation, 5 September 2026.

- Markets: United States (`US`), New Zealand (`NZ`), Australia (`AU`).
- CPA ceiling: **50% of the relevant product's price**.
- This sets a maximum CPA, not a new target CPA, ROAS target, account spend budget or authorization to scale/pause ads.
- Bind each recommendation to the actual promoted product/variant and current market-specific selling price. Do not substitute store-wide AOV, a different product, a compare-at price or a fixed dollar cap across currencies.
- Compare price and ad spend in the same currency. If conversion is required, retain the rate/source/time. Missing product mapping, currency or price means hold for clarification/data, not a zero cap.
- **Approved discovery seed: `golf travel bag`**, separately in US, NZ and AU. Tom explicitly confirmed this during the keyword-wrapper handoff. It is relevant to AVGAR's UFORIA Travel Case and has commercial category intent, but is not a claimed winner. Country-level demand, competition and SERP fit require testing before page optimisation. Related variants may be discovered; do not substitute them as the approved seed without recording that choice.
- The keyword pilot contract carries one location per request. US, NZ and AU require separately scoped requests/receipts, or a deliberately versioned multi-market contract—not three countries hidden behind one location code.
- Nguyen must validate the location codes/language supported by the actual DataForSEO endpoint. See [DataForSEO Labs locations/languages](https://docs.dataforseo.com/v3/dataforseo_labs_locations_and_languages/). Do not reuse the US test code for every market.

Implementation status: the seed decision is persisted in live AVGAR context, not only this document. At `2026-09-05T04:49:17.900988Z`, decision memory `e9f8979b-0a89-4f7b-945e-3eb5f01e51a6` superseded the old no-seed-approved memory, and the profile note was updated. Independent database readback and the signed-in **What Unc knows** panel confirmed the approved seed and market separation. Account revision is 15; context generation remains 1 and automation remains paused. The bounded script `scripts/record-avgar-keyword-seed.sql` has already been committed to the database once and must not be replayed. Full release/readback evidence: [runtime context release](../RUNTIME-CONTEXT-RELEASE-2026-09-05.md).

This is not an assertion that product-to-ad mapping, currency normalization or production policy enforcement is complete. Existing code's product-cap policy combines scale/off thresholds; do not interpret this confirmation as approving automatic scaling or changing that policy without evidence/approval gates.

Codex checked the [current AVGAR storefront](https://avgarsport.com/) on September 5: it describes golf bags, travel cases and accessories. The earlier proposed seed `golf travel case` is superseded by Tom's explicit `golf travel bag` choice. Use the verified public brand domain for SEO, while retaining the Shopify domain as the connector's technical store identifier. Do not infer every market's selling price from the NZ storefront price.
