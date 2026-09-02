---
domain: paid
title: Performance Max and Merchant Center feed hygiene
tags: [google-ads, pmax, shopping, merchant-center, feed]
source: skills/GOOGLE-ADS-HIGHAOV-RHODES-ZATO.md · skills/AI-SEARCH-VISIBILITY-SOLIS.md · skills/MEASUREMENT-TRUTH-AUDIT.md
---
Performance Max deserves budget only after three preconditions, in order: the account is billing cleanly, conversions arrive server-side at the destination, and the Merchant Center feed is approved and owned by the right account. Restarting PMax without them is feed-less, conversion-blind spend.

Feed hygiene checklist:
- Products approved, not just submitted. Zero approved means Shopping has no inventory and PMax defaults to display placements.
- One Merchant Center, one verified and claimed domain, owned by the business — not a former agency. Two IDs for the same store is an ownership fight waiting to happen; don't click "transfer" until you know which should win.
- Three-way consistency: feed = product page = structured data, exactly (price, availability, naming). Engines cross-check; disagreement kills trust and citations.
- Attributes beyond the minimum, units normalised, so products compare cleanly.

PMax operating rules:
- Read asset-group and channel splits from a script or warehouse pull, never the UI summary. Know how much of "PMax" is actually Search vs Shopping vs Display/YouTube.
- Exclude brand terms from PMax (or run brand separately) so brand cannibalisation isn't counted as PMax success.
- Judge on three-to-four-week windows; small accounts rarely exit learning and shouldn't chase it with budget thrash.

How Unc sequences it: any PMax proposal is gated on the three preconditions; if one is red the proposal says which and what fixes it, rather than asking for budget.
