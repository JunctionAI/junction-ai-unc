# Existing-client routine adoption — 6 September 2026

## Why this exists

An existing agent title is not a routine contract. This reconciliation maps only
capabilities that were read from the current authenticated native configuration.
It prevents migration by name, workflow duplication for every switch combination
and accidental activation of provider writes.

Each Unc routine remains an independent per-account switch in `routine_states`.
Shared data is resolved once through account/source grants and may be reused only
when tenant, asset, query and freshness identity match. Turning on two of seven
routines means two ordinary enabled routine rows; it does not select a bespoke
“2/7” n8n workflow.

## Home1nvasion

Authenticated read-only inspection at `2026-09-06T01:28Z` confirms native agent
`cmsy916yd05w707adv5m542qh` is currently a supervised newsletter-production
service for Zac. It carries one Slack thread forward, asks whether the email is a
plain founder letter or visual drop, preserves the founder's supplied meaning,
and prepares exact copy, asset/link requirements and a review state. Its native
provider-draft step is separately approval-gated; it explicitly does not choose
an audience, test-send, schedule or send.

This capability was absent from the executable Unc catalog. It is now represented
by **D05-W08 Newsletter draft production**, a manual, wave-one, draft-only routine.
The built-in contract requires `newsletter_mode`, `newsletter_brief` and approved
business context, optionally reads stored 90-day campaign history and Shopify
products, creates one email artifact, and stops at a review gate. It never claims
or creates a Klaviyo draft. H1's protected template IDs, footer, Zac voice and
approval identities remain account-specific facts; they do not belong in the
generic skill.

The active native daily source-and-learning review is a separate continuity job.
It reports source freshness and promotes only approved learning. It is not a
customer-facing Email & SMS switch and is not mapped to D05-W08 or D05-W07.

**Adoption status:** implemented in code, not enabled or run for H1. Required
before cutover: approved H1 profile/memory projection, exact current Slack channel
identity, owner/authorized-sender binding, a real Zac/Tom brief, useful-output
acceptance and a separate contract if native Klaviyo draft creation is retained.

## Deep Blue Health

Authenticated read-only inspection at `2026-09-06T01:28Z` confirms native agent
`cmsy91p0d04mw07adgg777f3n` owns DBH lifecycle-email planning and QA. Its observed
working job is a decision-ready **four-week** calendar plus a Roie-ready production
brief, grounded in DBH campaign cohorts and current product/compliance truth. It
has no schedule and Live mode is off. Current integrations are DBH Contacts Read,
DBH Email Campaigns Read and Slack.

The closest Unc routine is **D05-W07 Campaign calendar prep**, but the current
generic/n8n contract is six weeks and does not yet require DBH's production-copy,
mobile module, evidence-tier, approval-owner and 72-hour/seven-day review fields.
The mapping is therefore `contract_mismatch`, not adopted. Implement an
account-specific four-week promoted spec or a versioned generic horizon/output
contract and validate it before enabling DBH.

## Boundary and next acceptance

No native prompt, model, schedule, integration, agent autonomy, Slack invocation,
provider object or Unc routine state changed during discovery. D05-W08 is code and
contract progress, not proof that H1 is migrated. The first acceptance remains:
authorized client/thread → correct enabled routine → source-grounded draft →
durable artifact/receipt → same thread → reload/retry/switch-off, with the old
service retained until that passes.
