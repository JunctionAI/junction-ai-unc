---
domain: email
title: Abandoned cart and browse recovery
tags: [flows, cart, browse, recovery, klaviyo]
source: skills/EMAIL-MARKETING.md · skills/LIFECYCLE-FLOW-ARCHITECTURE-DIMOND-KLAVIYO.md
---
Recovery flows are the always-on revenue floor: they run while the founder sleeps and they are usually the highest revenue-per-recipient emails in the account.

Abandoned cart (trigger: checkout or cart started, no order):
- Three emails beat one. Send 1 at about one hour — a reminder with the product shown, no discount. Send 2 at about 24 hours — proof: a review or the answer to the most common objection. Send 3 at about 48–72 hours — the only nudge, and only if the brand allows an incentive at all.
- The exit filter is the whole game: "has not placed order since starting this flow", re-checked before every send. Never remind someone who already bought.
- Premium brands: no discount in the sequence. Lead with the object, the proof and the reassurance (shipping, returns, care).

Abandoned browse (trigger: product viewed, no cart, about four hours):
- One or two emails, lighter touch. Show the product viewed and one related item. Suppress anyone already in the cart flow.

Hygiene:
- Smart sending on so overlapping flows don't hit the same person the same day.
- Every link resolves, every image is on the sending platform's CDN, the unsubscribe token is the platform's own (see the flow QA playbook).

Measure recovery rate (orders ÷ flow entries) and revenue per recipient. If the flow "works" on opens but not on recovery, the problem is the offer or the proof, not the subject line.
