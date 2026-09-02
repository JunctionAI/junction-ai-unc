---
domain: email
title: Segmentation and list health
tags: [segments, deliverability, list, suppression]
source: skills/EMAIL-MARKETING.md · skills/DTC-LIFECYCLE-EMAIL-DIMOND.md
---
Never blast the whole list. Segment to the engaged, tag every behaviour, and keep the list clean — an engaged list beats a large list every time.

Minimum viable segments:
- Engaged — opened or clicked in the last 30 days.
- Active customers — purchased in the last 90 days.
- Lapsed — purchased 90–180 days ago.
- At risk — no purchase in 180+ days but still opening.
- VIP — top ten percent by lifetime value or order count.
- New subscribers — joined in the last 30 days, no purchase.
- Never purchased — on the list 60+ days, no order.

Build over time: product-specific purchasers (for cross-sell), channel-acquired cohorts, AOV tiers, geography (for shipping offers).

Deliverability is part of the architecture, not a bolt-on:
- Domain authenticated (SPF, DKIM, DMARC). New sending domains warmed gradually.
- Smart sending on so a person doesn't get two flows and a campaign the same day.
- Suppress unengaged after about 120 days of no opens — but run a winback first, then sunset, then suppress, in that order. Sunset on multi-signal disengagement, not naive "no opens".
- Never buy lists. Never send to unconfirmed contacts.
- Watch bounce rate, spam-complaint rate and unsubscribe rate on every send; a rising trend is a warning before it is a problem.

How Unc runs it: the Segmentation refresh routine rebuilds the core segments on a schedule and reports which segment each campaign went to, so "who got this" is never a guess.
