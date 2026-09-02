---
domain: analytics
title: Measurement truth audit — audit arrival, not configuration
tags: [analytics, measurement, ga4, tracking, reconciliation, ownership]
source: skills/MEASUREMENT-TRUTH-AUDIT.md
---
Never audit configuration — audit arrival. Tags, pixels and containers can all be present, published and well written while delivering nothing. The only proof a pipe works is querying the destination and finding the event there. Run this before any agent, report or spend decision trusts a channel.

Four questions, in order:
1. Who owns every account? List the actual login on each platform connection (store sales channels, tag manager, analytics admins, merchant centre users, ad-account admins, the cloud projects behind tokens). Name the human or organisation behind each. A working API token is not ownership; tokens outlive relationships.
2. Does the event actually arrive? Query the destination, not the config: is "purchase", "add_to_cart", "view_item" in the analytics event list at all? Platform conversion counts via their APIs. Pre-checkout events missing means the whole path is dead — a different diagnosis from purchase-only missing.
3. Does it reconcile against the store? Same window, orders and revenue: store orders vs each platform's claimed conversions vs the warehouse. Mismatch over about five percent is flagged; over about twenty percent the channel is treated as unmeasured.
4. Are conversions server-side? Web-only integrations break silently (ad blockers, consent, sandboxing, theme changes). Prefer platform-native server-side or order-webhook based measurement.

Non-obvious tells: store custom pixels can run in a sandboxed frame no tag container can hear; the billing check comes before the tracking check (an unpaid account produces the same "no data" symptom); two IDs for the same thing is an ownership fight — don't click transfer until you know which should win; copy what already works on the same store.

An audit is complete when all four have written answers with evidence and every consuming system knows which channels are trusted vs unmeasured. A channel is reclassified as trusted only when the probe shows the event arriving — never when a fix is merely deployed.
