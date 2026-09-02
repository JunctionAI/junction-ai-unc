# The real platform — guided experience spec (2026-09-02)

**Founder direction:** the design was an outline. The real product must be well guided, simple, and lead into the routines. No fake or placeholder data or information anywhere in a real account. Beautiful, in the design system.

## The spine (one path, every screen serves it)
| Step | Trigger | What the founder sees | What Unc does | Done when |
|---|---|---|---|---|
| 0 Meet Unc | first sign-in | onboarding welcome | — | — |
| 1 Agree the plan | steps 1–6 | the plan card (deterministic + narrative) | scans site/socials, extracts onboarding memories | `plans.agreed_at` set |
| 2 Connect your data | after agreeing | **"Connect your data" step**: only the platforms the plan's phase-1 channel needs (Content → website/IG handle; Email → Klaviyo + Shopify; Paid → Meta + Shopify; SEO → GA4/Search Console; Sales → HubSpot/calendar). Each card: OAuth when configured, else owner "connect with a token" | on connect: "Reading your last 90 days now…" → KPI snapshot → confirms numbers | ≥1 connector `connected` OR founder chose "later" (honest, no fake) |
| 3 First routine on | after step 2 | **one recommended routine** from phase 1 (draft-only, wave 1), explained in one line; "Turn it on" | dry-runs immediately (API), draft receipts appear in "What I drafted" within a minute | first `routine_runs` row done |
| 4 First review | draft lands | "What I drafted" card → open → Approve / Hold / Why | taste_event + memory; reply in his voice | first taste_event |
| 5 Daily rhythm | next morning | Today brief + needs-you list | brief job / manual generate | brief exists |

A **Getting set up** card on Home (accounts mode) shows these five with real states; it replaces the demo "Platforms connected 5 of 16 · History imported · Site & socials scanned · Numbers certified" strip and disappears when all five are done.

## Non-negotiables
- **Real only.** In accounts mode every number, list, count, status and example comes from the database or a certified read. Nothing from `derive.ts` demo constants may render for a real account. If there is no data: an empty state in Unc's voice with the one next action (never a spinner forever, never a placeholder card).
- **Demo sandbox** stays only for "Skip — explore with demo data" when not signed in, with a persistent top banner: *"Demo data — nothing here is yours. Sign in to start for real."*
- **Routines are the product.** Routines view (accounts mode): real enabled states, "Recommended first" from the plan, honest availability ("draft-only for now", "needs Klaviyo connected"), last run + last draft per routine, turning one on triggers a dry run now.
- **Unc's voice everywhere** (README §Voice): first person, proposes, numbers over adjectives, never hype; banned phrases per the eval rubric.
- **Design system** stays: tokens, pills, cards, chat-bubble grammar, amber only where a decision waits (≤2 per screen), cyan spent like money, jfloat/jpulse only.
- **Playbooks in the answers**: chat and decision prompts recall relevant playbooks so expertise is visible in real replies.

## Copy floor for empty states (accounts mode)
- Home, no approvals: "Nothing waiting on you right now — I'll bring the next decision here."
- Home, no drafts yet: "Turn on your first routine and I'll have a draft here within the hour." (link)
- Home, no KPI: "Connect Shopify and I'll read your last 90 days tonight." (link)
- The bar with no Junction benchmark: labelled "Industry reference — not yet from Junction accounts"; with no own value: "Not measured yet".
- Routines with nothing on: "Your plan starts with Content — this one first." (recommended card)
- Connectors, platform not configured: "Not switched on yet — I'll tell you the moment it is." Owner sees "Connect with a token" instead.

## Unc-first (founder direction, 2026-09-02)
**Unc is the product; the UI is his hands.** He guides every step on whatever channel the founder lives in — Telegram, WhatsApp, Slack, text, or the app — and it is **one conversation**: anything said on any channel is in the corner thread, and every decision (approve / hold / why) taken anywhere lands in the app with its receipt. The UI's job is to make the next step, the approval and the feedback tangible: never a second brain, never a second thread.
- First-run adds **"Where should I reach you?"** after the plan (Telegram / WhatsApp / Slack / Text / just the app).
- Proactive moments (morning brief, a draft landed, a decision waiting or expiring) go to the founder's channel with actions; quiet hours respected.
- Channel messages carry a small "via Telegram" chip in the app thread; app messages are the same thread with channel 'app'.
- See docs/CHANNELS.md once built.
