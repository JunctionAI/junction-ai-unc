---
domain: email
title: Post-purchase and replenishment as one lifecycle
tags: [flows, post-purchase, replenishment, reviews, consumables, klaviyo]
source: skills/LIFECYCLE-FLOW-ARCHITECTURE-DIMOND-KLAVIYO.md
---
Post-purchase and replenishment are one forked lifecycle triggered by Placed Order, not two disconnected flows. Timing follows time-to-value, not calendar convenience.

Post-purchase arm:
1. Immediately — reinforce the decision. This is the highest open rate the brand will ever get; don't waste it on a receipt.
2. Day 2–3 — what to expect; a teaser of the education to come.
3. Just after estimated delivery — product education: how to use it, how to get the result. This email cuts returns and primes the reorder, and most brands skip it.
4. The value window — the review request, timed to when the customer has actually experienced the result, not when the box landed. One link, low friction.
5. Day 30 or later — loyalty, cross-sell, or "buy again", suppressing anyone who already re-bought.

Replenishment arm (consumables):
- First reminder = days of supply minus about five days, per pack size. A 30-day pack reminds around day 25. Better still, drive the delay off the platform's predicted next-order date, computed from the median inter-purchase interval (median, not average — subscription cohorts skew the average).
- Reminder 1 → reminder 2 (about three days later) → a post-depletion follow-up, which is the only place a discount belongs.
- Mandatory filter before every send: has NOT placed an order containing this product since entering the flow, plus no refund or cancellation. Scope it to the product, so buying something else doesn't wrongly suppress the reminder.

Splits: first-time buyer vs repeat buyer get different messages. Winback → sunset → suppress runs in that order, never sunset before a winback.

Failure modes to name: guessing the reorder window; discounting on reminder 1; a review ask before the result; treating the two arms as separate flows and double-sending.
