---
domain: email
title: Flow QA before activation
tags: [flows, qa, klaviyo, unsubscribe, deliverability]
source: skills/KLAVIYO-FLOW-QA.md
---
No flow goes live until it has been tested without sending a single customer email. The platform API gives everything needed: pull the flow definition, pull every template, render each with a controlled context, and scan the rendered and raw HTML against a fixed checklist.

The seven steps:
1. Pull the flow skeleton — every step type, delay, template id, subject, preview text, sender, smart-sending flag, and every conditional split's metric.
2. Validate the logic against the design — trigger and filters right, both branches of every split go somewhere sensible, reorder guards exist, cumulative timing is sane, smart sending is on unless there is a deliberate reason. Check trigger scope: "order contains X" fires for mixed carts too; if the brief means single-product orders, the filter needs an item-count condition in a separate AND group.
3. Render every template with a representative context (first name, brand, a product). A render that errors is a template syntax bug — fix first.
4. Scan each rendered email: surviving template tags, dead or placeholder links, placeholder copy (TODO, lorem, Figma node names), images off the approved host, subject and preheader present, alt text on every image.
5. Verify the unsubscribe link on the RAW template — the render preview shows it blank even when correct. Only the platform's own unsubscribe tokens are valid; other-platform tokens silently fail and the flow becomes a compliance breach.
6. Fix safe issues (bad unsubscribe token, dead link, missing alt text, typos) changing only the offending token; flag the rest (timing, branch structure, brand judgement) for a human.
7. Report a per-template matrix plus a prioritised fix list.

Variant-aware timing: a branch that looks "compressed" may be a smaller pack size correctly reminding sooner. Resolve every variant to a real product and size before calling a delay a bug.

Decision rule: clear to activate only when every template renders, every email has a valid unsubscribe, zero dead links, images on an approved host, trigger scope matches the brief, branch logic and reorder guards verified, and smart sending is on or off by explicit decision.
