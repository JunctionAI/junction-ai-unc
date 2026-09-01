# Handoff: Junction — Growth Operating Agent

## Overview
Junction is a growth operating agent product for small business founders. The user meets **Unc** (the mascot/agent character), agrees a goal and strategy in a friendly 7-step onboarding, connects their platforms, and lands in a control centre where Unc runs growth "routines" (agentic workflows for Content, Paid ads, SEO, Sales, Email & SMS) and the founder's only job is taste + approvals. The package contains the full product prototype, the marketing landing page, and the brand guidelines.

## About the Design Files
The files in this bundle are **design references created in HTML** — interactive prototypes showing intended look, copy and behavior. They are NOT production code to copy directly. The task is to **recreate these designs in the target codebase's environment** (e.g. Next.js/React at `localhost:3000/junction`) using its established patterns and libraries — or, if no environment exists yet, choose the most appropriate stack (a React SPA/Next.js app is the natural fit; the prototypes are componentized React-style already).

The `.dc.html` files are self-contained: open them in a browser to click through everything. The design logic lives in a `class Component` script inside each file — read it for exact state transitions, derived-value math, and copy strings.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy and interactions are final intent. Recreate pixel-perfectly. All copy strings are deliberate (voice matters — see Brand page) and should be carried over verbatim.

## Files
| File | What it is |
|---|---|
| `Junction Platform v2.dc.html` | **The product — CURRENT/canonical build.** Onboarding (7 steps) + control centre (Home, Strategy, Routines, Connectors) + corner chat. |
| `Junction Platform.dc.html` | Earlier product build. Reference only — v2 supersedes it. |
| `Junction Landing.dc.html` | Marketing landing page. |
| `Junction Brand.dc.html` | Brand guidelines: mark, colour, type, voice, components. |
| `mascot.png` / `mascot-small.png` | Unc. Large = hero/welcome uses; small = chrome/avatar/chat uses. |
| `tom.png` | Founder photo used in the landing page "backed by real experts" section. |
| `image-slot.js` | Drag-drop image placeholder web component used on the landing page (`<image-slot>`). Replace with a plain `<img>` in production. |
| `support.js` | Prototype runtime. Ignore — not part of the design. |

## Design Tokens
All colors are OKLCH (works in all modern browsers; hex fallbacks in parens are approximate).

- **Junction Navy** `oklch(0.27 0.055 262)` (~#1e2a4a) — the agent's colour: sidebar, primary buttons, his chat bubbles, hero surfaces
- **Signal Cyan** `oklch(0.78 0.13 220)` (~#5bc8e8) — anything live/running/primary-action; gets a glow (`box-shadow: 0 0 12px` at ~40–60% alpha) when it matters
- **Cream** `oklch(0.976 0.006 90)` (~#f9f7f2) — page background, calm by default
- **Decision Amber** `oklch(0.75 0.14 75)` (~#e8a33d) — ONLY where a human decision waits; wash `oklch(0.93 0.05 80)`, text `oklch(0.45 0.11 70)`
- **Cyan Wash** `oklch(0.94 0.03 225)` — tint for chips/pills/hints; text on it `oklch(0.45 0.1 240)`
- **Ink** `oklch(0.27 0.05 262)` body text; **Muted** `oklch(0.52 0.03 260)`; **Faint** `oklch(0.62 0.05 250)` (on navy)
- **Card border** `oklch(0.91 0.01 260)`; hairline `oklch(0.93 0.008 260)`
- **Ratio rule (from brand page):** cream dominates, navy structures, cyan is spent like money, amber appears only where a decision waits — never more than 2 amber elements per screen.

### Type
- **Space Grotesk** (Google Fonts), weights 400/500/600/700. One family everywhere.
- Display 700, tracking −0.02em to −0.035em (hero 56px, section 32px, page titles 26–28px)
- Body 400, 13–15px, line-height 1.55–1.65
- Labels: 10–11px, uppercase, letter-spacing 0.12–0.16em, weight 600 — the "quiet machine voice"
- Numbers are content: weight 600–700, never colored decoratively

### Shape
- Pills (999px) for all buttons, chips, status, toggles
- Cards 13–16px radius; hero surfaces 18–22px
- Chat bubbles: 14px with a 4px corner on the speaker's side (Unc: top-left tight `4px 14px 14px 14px`; user: bottom-right tight)
- Shadows only under floating things (corner buddy, popovers) + cyan glows

## Screens / Views — `Junction Platform v2.dc.html`

### A. Onboarding (7 steps, centered card ~680px, progress dots on top)
State machine: `obStep` 0–6; dots animate width (active 26px, else 10px, filled = cyan).
Every step: label `Step N · <name>` (cyan wash label style), h2 question 26px/600, Back/Continue row (steps 1–5).
Unc appears top-right as a speech-bubble comment above the question on most steps.

1. **Step 0 — Welcome.** Big mascot (jfloat animation: translateY 0→−8/−10px, 5s ease-in-out infinite), "I'm Unc." 32px/700, one-paragraph pitch, cyan "Let's go →", ghost "Skip — explore with demo data" (skip = jump straight to control centre with demo data).
2. **Step 1 — The goal.** Multi-select goal-category cards (3-col grid): Revenue, Profit & margin, Brand & audience, Leads, Customer retention, A new product — each with an "e.g." line. First selected = **Governing** goal, others = **Checkpoint** (tag column, 110px). Each selected category gets an editable goal line (borderless input, 21px/600, bottom border). Below: "Where it is now" baseline input + date picker. Unc bubble explains the levers for the chosen category and that other goals become checkpoints. Currency select (NZD/USD/AUD/GBP/EUR…) sets the symbol account-wide.
3. **Step 2 — Your data.** Tap-to-connect pill grid of platforms (Shopify, GA4, Meta Ads, Google Ads, Klaviyo, Instagram, TikTok, LinkedIn, YouTube, Search Console…). Selected = cyan-wash pill with ✓. Count line: "N connected — each one unlocks more of the routine library."
4. **Step 3 — Your resources.** (a) **Budget slider** 0–20k/mo, step 250, live label `<cur>3,600/mo` + note "≈ <cur>120/day — becomes the hard spend guardrail"; subhead: "Just what you'd spend on new growth — ads, content, tools, extra hands. Not your existing team or running costs." (b) **Hours slider** 0–100 h/wk — "Your hours invested into sales/marketing growth per week"; note changes by range (<4: approvals only; 4–10: "Time spent on taste and approvals."; >10: own a channel). (c) **Reinvestment picker** — 3 cards: Steady (20–30%), Balanced (30–50%), All-in (50–70%) "of new profit" with a plain-language note per pick; gross-margin % input feeds the cash math. (d) **Team list** — rows of name input + role dropdown (Founder, Marketing, Sales, Content creator, Designer, Developer, Ops & support, Agency/contractor) + who approves what; "+ Add person".
5. **Step 4 — Your strengths.** Two chip groups: **Skills** (Writing, Video, Design, Cold calls, DMs & outreach, Email, Paid media, SEO, Community, Product) and **Platforms you know** (Instagram, TikTok, LinkedIn, Facebook, YouTube, Google, X, Pinterest…). Multi-select. Then "Where can I learn about your business?" — website + socials inputs; "I'll scan these to understand your business, voice and market."
6. **Step 5 — Your way.** Growth-belief cards (multi-select): Brand-led organic / Sales-led outbound / Paid-led scale, each with a one-line thesis. Breadth toggle: Focused vs Broad.
7. **Step 6 — Agree the plan.** "Unc's plan for you": ONE white card from Unc (bubble-cornered, 4px top-left) containing: title (posture blend), one-line math ("Your goal needs <gap> of new ground by <date>. With <cur>X/day and Y h/wk of you…"), then a numbered 3-phase, **time-bound** plan derived from a strength/posture/budget scoring model (see logic: channel `fit` weights × strengths × budget gates; weeks split ~30/30/40 with sane minimums, last phase "Weeks N–M and beyond"). Footnote: "I do the work — you bring taste and okays. I'll scan your site and socials tonight and sharpen this." Chat input below for pushback (canned reply logic in prototype; production = real agent). CTA: cyan "Agree the plan →".

### B. Control centre — sidebar (236px, navy, sticky)
Logo (mascot-small + "Junction" + "GROWTH AGENT"), nav: Home, Strategy, Routines (with count), Connectors — active item = lighter navy bg + cyan dot. Bottom: connector summary line ("9 connected · 1 needs attention…") linking to Connectors, and a demo-data disclaimer. **Corner buddy** (fixed bottom-right, all views): mascot pill button "In your corner / Ask me anything" + contextual speech bubble that swaps per scroll section (`data-buddy` attributes); clicking opens the **chat popover** (372×480): header with **Junction AI | Human support** sliding toggle — AI mode = Unc with full account context; Human mode = real team with account visibility (goal/strategy/receipts, never credentials), reply-within-hours promise.

### C. Home
1. **Goal header**: "Goal" label, goal title (inline-editable input), "by <date picker> · N days left", status pill right (On track cyan-wash / Behind by X amber-wash). Slim cyan progress bar + one stats line "now · pace/day · lands at".
2. **One plain sentence** under the bar: "You need <gap> more by the deadline…" 
3. **Unc's review bubble** + **"needs you" list**: approval cards as chat-style bubbles from Unc (routine tag, title, detail, before → after, expiry) with Approve (navy pill) / Hold (ghost) / Why? (opens reasoning bubble); blocked-connector card with Reconnect. Approve/Hold produce user-side confirmation bubbles + Unc receipts.
4. **"The plan"**: the agreed 3-phase timeline as rows — week span, phase title ("Content — your strength, running first"), focus + what's needed from them, Now/Next/Later pill; current phase cyan-bordered. Ads-scaling line beneath if paid is in the plan ("Ad spend starts at <cur>X/day and only grows from wins: ~40% of new profit rolls back in").
5. **"The bar"**: 3 benchmark cards (what winning takes, from businesses that did it) — e.g. Content output 5 posts/wk vs your 3; Repeat purchase 22% vs 14%; Response speed <4h ✓. Behind-cards carry a fix button jumping to the relevant routines.
6. **Gamified progress strip**: automation level, routines on/off counts, hours saved/wk.

### D. Strategy
Posture cards (Brand-led organic / Sales-led / Paid-led; multi-select, selected = cyan border + YOURS tag). Unc "Why this is yours" card citing their actual budget/hours/strengths. **Build-out**: 4 phase cards (number circle, name, status pill: ACTIVE/NOW cyan-wash, GATED amber-wash with evidence gate like "repeat ≥ 18%") each showing "N routines · manage" link and "From you: …" line. Note at bottom re: growing into agents + human hires.

### E. Routines
Role-first: 5 big cards (Content "Get seen consistently", Paid ads "Make every dollar work harder", SEO "Get found on Google", Sales "Fill your calendar with right-fit buyers", Email & SMS "Keep customers coming back") each with on-count. Inside a role: **toggle rows** — iOS-style switch (40×23, knob 18px, cyan when on), benefit-first title, routine name subtitle, "How it works →". 
**Routine detail**: header (id · category, name, status pill), purpose line, 3 contract cards (Trigger & cadence / Write mode / KPI), **n8n-style workflow canvas** (dot-grid bg, node chain TRIGGER→READ→CHECK→DECIDE→GATE→EXECUTE→RECEIPT, arrows between; click node = cyan border + inspector below with editable params; edits create a draft version → "Run dry-run validation" → "Promote to production", version pill v12→v13). **Setup wizard** (4 steps: sources → definitions → what Unc needs from you → dry run tonight). 35 routines total — full list with benefit titles is in the logic class (`benefits` map).

### F. Connectors
Grid of 14 connector cards: name, category, what it reads ("orders · products · customers"), "unlocks N routines", status (Connected cyan dot / Reconnect amber / Connect navy). Copy: least-privilege scopes, credentials in secret store, all reads certified & receipted.

## Screens — `Junction Landing.dc.html`
Nav (logo + "Meet Unc" CTA) → **Hero**: live-agent badge, "Your whole growth department. One agent, in your corner." 56px, sub, cyan CTA "Agree your first goal →", stats row (35 routines / 24/7 / 100% receipted), mascot right with radial cyan glow + float. → **Physics** section (navy): goal / constraint / routines 3-up. → **How it works** 4 steps (step 4 amber = "Okay what matters"). → **Routines**: category chips with counts + "Viral content creator" example card with mini TRIGGER→DRAFT→YOUR OKAY→RECEIPT pipeline. → **Routine examples** per channel. → **Backed by real experts**: Tom Hall-Taylor quote card (photo `tom.png`), "We built Junction AI with 10+ years of marketing expertise, and $10s of millions in online revenue," + reach-him-on logos (SMS, Telegram, Slack…). → **In your corner**: chat mock (AI + human toggle) + copy. → **Pricing**: $99 USD/mo, 14-day free trial. → **Navy closer**: mascot, "He's a workaholic with one goal: to grow your business.", "Meet Unc →".

## Interactions & Behavior (key ones)
- All state is client-side in the prototype; production should persist per-account (goal, currency, budget, hours, strengths, posture, routines on/off, approvals, chat threads).
- Currency: single account-level setting; every money string derives from it.
- Goal math: `pace = (current − baseline) / days elapsed`; `needed = gap / days left`; `lands at = current + pace × days left`; status pill + copy react to on/off-track. Guard divide-by-zero; target parses from the goal string's first number.
- Plan generator: channel scores = posture weight × strength multipliers × budget gate (paid needs ≥ ~50/day); top channel = phase 1, second = phase 2, rest = phase 3; weeks split ~30/30/40, minimums so no "Weeks 1–1"; deadline < 4 weeks clamps to 4.
- Approvals: three states (pending/approved/held) with distinct visual treatments; "Why?" toggles a reasoning bubble.
- Corner buddy: scroll-spy over `data-buddy` attributes (topmost section whose rect crosses 55% viewport height wins); bubble hidden while chat is open.
- Animations: `jfloat` (mascot), `jpulse` (live dots, 1.6–2s), toggle knob 0.25s, phase-dot transitions 0.3s. Nothing else moves.

## Voice (from Brand page — copy is part of the design)
First person, present tense, numbers over adjectives. He proposes, shows working, never commands. Says: "I weighed 14 moves against your budget. Here's the one I'd make." Never: "Fully autonomous AI employee", "10x overnight", "set and forget". Tagline register: **In your corner.**

## Assets
- `mascot.png` (hero) / `mascot-small.png` (chrome) — Unc, always whole, facing the reader, never cropped/rotated/recolored, one appearance per view.
- `tom.png` — founder photo, landing page.
- Fonts: Space Grotesk via Google Fonts.
