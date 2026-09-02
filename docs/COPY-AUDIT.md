# Copy audit — demo strings vs. real state (2026-09-02)

Scope: every string or number that reaches a founder's screen from a demo constant, a hardcoded example or the
prototype's seeded state (`src/lib/platform/derive.ts` demo furniture, `src/lib/platform/state.ts` `initialState`,
`src/lib/platform/catalog.ts` connector / routine defaults) and could render in **accounts mode**. Rule under audit:
docs/PRODUCT-EXPERIENCE.md "Real only" — nothing from `derive.ts` demo constants may render for a real account.

Legend — **Status**: `fixed` = replaced with real state in this pass (agent C files) · `open` = still renders demo for
a real account in the other agent's file (audit only, no edit) · `demo-only` = only reachable in the demo sandbox or is
an example / product copy, not a claim about the founder's business · `guarded` = already gated behind `accountMode` /
live data by its owner.

## Agent C surfaces (this pass)

| View | Demo string / source | Rendered where | Real-state replacement | Status |
|---|---|---|---|---|
| Strategy | `agreed 12 Aug · reviewed monthly · persists until superseded` (literal) | header right | `agreed <plans.agreed_at> · persists until superseded` or `draft — not agreed yet`; `reading your plan…` while loading | fixed |
| Strategy | `postureDefs[*].why` → "Chosen with you on 12 Aug…" + `V.postureWhy` (demo profile strings) | "Why this is yours" card | `accountWhy()`: posture label + `resource_profiles` budget/hours/skills (via the hydrated `obBudgetLabel` / `obHoursLabel` / skills) + agreed date or "stays a draft until you agree it" | fixed |
| Strategy | `postureDefs[*].fit` ("Fits: low budget · strong voice…") | posture cards | `po.match` ("Matches N of your picks" / "Outside your current picks", from the founder's real strengths + platforms) | fixed |
| Strategy | phase pills `ACTIVE / NOW / GATED · repeat ≥ 18% / GATED · NZ$40k MRR` (`postureDefs` phases, persisted verbatim into `plans.phases[].status`) | build-out cards | `ACTIVE` when any routine in the phase is enabled (`routine_states`), `START HERE` for phase 1, else `READY WHEN YOU ARE`; no gated pill until a real evidence gate exists | fixed |
| Strategy | `{ph.count} routines` (phase routine list length) | build-out cards | `{on} of {total} routines on` from `routine_states.enabled` | fixed |
| Strategy | `— unlocks on evidence, not optimism` | build-out subtitle | `— one phase at a time, on your say-so` | fixed |
| Strategy | data-buddy "We agree the strategy once — then the routines carry it…" | corner-buddy bubble | `N routines on under this play…` / `Nothing is on yet. Agree the play, turn on the first routine…` | fixed |
| Sidebar | `V.libTotal` (35) as the Routines nav count | nav | `{enabled} on` from `routine_states` | fixed |
| Sidebar | `V.connSummary` = "5 connected · 1 needs attention · 10 available" — `CONNECTOR_DEFS[].st` demo defaults leak through `S.connState[d.name] \|\| d.st` for every platform the account never touched | bottom line | `connectorSummary(facts)` from `connectors` rows: "2 connected · Klaviyo needs attention" / "Nothing connected yet" / "Reading your connections…" | fixed |
| Sidebar | "No live connectors or outward actions." (demo footer) under a signed-in account | account footer | "Nothing sends or spends without your okay." | fixed |
| Sidebar | "Demonstration data. / No live connectors or outward actions." | demo footer | unchanged — demo-only; the demo banner now sits above the whole app | demo-only |
| Corner buddy | seeded corner thread (`initialState.messages`: "Morning Tom… NZ$40/day budget shift with 3.1× expected ROAS", "Why shift budget away from Prospecting-B?", "Prospecting-B's 7-day ROAS fell to 1.4×…") — also written to `chat_messages` when an account is seeded from the demo state | chat panel | real `chat_messages` history with the demo seed stripped; empty thread → "I'm in your corner. Ask me anything about your numbers or your plan." The seed is also stripped from the history sent to `/api/unc/chat` | fixed |
| Corner buddy | seeded human thread (`initialState.humanThread`: "Kia ora — Sam…", "the welcome-flow voiceover is your biggest open lever") + the canned Sam reply in `derive.ts send()` | Human support lane | real human thread (seed stripped); composer disabled with "A real person reads this lane — email support@getjunction.ai…" (no live desk yet — never a fake reply) | fixed |
| Corner buddy | scroll-spy bubbles from every view's `data-buddy` (Home: "Only you can clear these. Three taps…", "This is what winning actually takes — benchmarked…", "Every routine you switch on makes the machine more OP…", "I queue the next builds myself…"; Connectors: "…Each connection unlocks more of the library."; Routines) | bubble | per-view real facts: Home "3 routines on · 1 decision waiting · 2 drafts this week." / "Nothing running yet — turn on your first routine…"; Routines "3 of 35 routines on. Turn another on and I dry-run it now…"; Connectors `connectorSummary` + "Each connection unlocks…"; Strategy passes its own real text | fixed |
| Corner buddy | header sub "In your corner · knows your numbers" / "Real people who know your setup · reply within hours" | chat header | AI lane unchanged (product copy); human lane → "Real people who know your setup · by email for now" | fixed |
| Unc chat context (`src/lib/unc/context.ts`) | `AP_DATA` / `AP_WHY_TEXTS` (3 demo approvals), `SIGNAL_DEFS` ("NZ$54/day", "3.1%", "48.2k/wk", "9% of total"), `LEVER_DEFS` ("+NZ$2,900/mo"…), `COMPLETED_DEFS` ("Receipt R-4482"…), `DEMO_TODAY`, catalog connector / routine defaults, `postureDefs.why` "Chosen with you on 12 Aug" | the ACCOUNT CONTEXT Unc quotes numbers from | `buildUncContext(S, { mode: "account", facts })`: approvals/receipts from the account's rows, signals & levers empty until a certified read exists, today = real date, connectors "disconnected" unless the account connected them, routines only when enabled, `accountStrategyWhy()` + `strategy.agreedAt` | fixed |
| Unc chat context (server) | `buildServerContext()` in `src/lib/unc/respond.ts` built the demo context for a real account (channels replies) | Telegram / WhatsApp / Slack replies | `buildUncContext(state, { mode: "account" })` | fixed |
| Paywall | `PLAN_COPY` (price, trial badge, checklist), `HEADLINE` | paywall | product copy from the pricing module, resolved per locale — not demo data | demo-only |
| Model settings | none — everything from `/api/settings/models` | dialog | — | guarded |
| What Unc knows | none — everything from `/api/brain/*`; group empty-state lines are Unc's voice | dialog | — | guarded |
| Demo banner | — | top bar, demo mode only | "Demo data — nothing here is yours. Sign in to start for real." + Sign in pill | fixed |
| Login / landing | no placeholders found (`[NZBN]` etc. — Terms use `COMPANY` constants: company number 7879076, NZBN 9429047921313); footer links `/privacy`, `/terms`, `mailto:support@getjunction.ai` resolve | — | — | ok |

## Other agents' surfaces (audit only — for their follow-up)

| View | Owner | Demo string / source | Rendered where | Real-state replacement | Status |
|---|---|---|---|---|---|
| Home | A | `V.homeSetup` strip: "Platforms connected 5 of 16 — connect more", "History imported · orders, spend, sends — in one warehouse", "Site & socials scanned · your voice, offers and market — read", "Numbers certified · cross-checked against your sources nightly" (done flags hardcoded true/false) | goal card footer | the "Getting set up" card (spine steps 0–5 with real states); `GettingSetUp.tsx` exists in the tree | open (in progress) |
| Home | A | `V.homePlain` / `V.statusLabel` / `V.goalPct` / `daysLeftLabel` — `goalMath` on `DEMO_TODAY` (31 Aug) and `DEMO_START` | goal card | real clock; NULL baseline already → `BASELINE_NOT_SET_COPY` | partly guarded (baseline) / open (demo clock) |
| Home | A | `V.homePlan` week spans from `weekSplit()` anchored on `DEMO_WEEK_ANCHOR` (1 Sep) | "The plan" timeline | anchor on `plans.agreed_at` / created_at | open |
| Home | A | `V.homeAdsLine` "Ad spend starts at NZ$120/day and only grows from wins…" — `hasPaid` is `\|\| true` (always) | under "The plan" | only when the plan has a paid phase; real `budget_monthly` | open |
| Home | A | `V.homeBar` ("5 posts / week — you're at 3", "22% of customers — you're at 14%", "< 4 h to leads — You're already there.") | "The bar" | `barCards(telemetry)` (published benchmarks / "Industry reference — not yet from Junction accounts" / "Not measured yet") | guarded (renders only when telemetry is absent → demo) |
| Home | A | `V.gamOnCount` / `gamPct` / `gamRank` ("Operator", "Builder"…) / `gamCats` dots / `gamHireLine` — `isOn` falls back to the catalog's `state === "Active"` demo flags | "Automation level" | `enabledRoutineIds` (added to `V` this pass by A) / `routine_states` | open |
| Home | A | `hrsLabel` → `V.gamHrs` (`onCount * 2.5`) when telemetry absent | "Automation level" | `hoursSavedLabel(telemetry)` | guarded (telemetry) / open (fallback) |
| Home | A | `V.proposals` ("Welcome flow tuning — Your welcome flow converts 2.1%; tuned flows… 6%+", "Review request timing — Reviews lift repeat purchase ~9%…", "PDP conversion review…") + `propStatus` ready/blocked/building | "Setting up next" | the plan's recommended-first routine + real availability ("draft-only for now", "needs Klaviyo connected") | open |
| Home | A | `V.completed` (`COMPLETED_DEFS`: "Weekly operating brief delivered… Receipt R-4482", "4 founder posts drafted… R-4483", "18 leads researched… R-4485") | "What I did" | live receipts (`live.receipts`) | guarded (`isLive`) — but renders the demo rows while the live list is loading/failed unless `accountMode` gates it |
| Home | A | `V.approvals` (`AP_DATA`) + `V.allClear` / `V.needsCount` | "Needs you" | `useLiveApprovals` | guarded (`showDemoCards`) |
| Home | A | `V.klaviyoDown` (`S.connState["Klaviyo"] \|\| "expired"` — the demo default makes every fresh account read "Klaviyo needs reconnecting") + "Reconnect Klaviyo" card | "Needs you" count + card | real `connectors.klaviyo.status` | open |
| Home | A | `V.readChips` / `readThread` canned replies ("Fair. The organic-first call rests on two numbers: CVR 3.1% and NZ$54/day headroom…", "Tell me the new number and I'll re-rank the paths tonight…") | "Today's read" chat | live Unc reply (`useUncChat`) or drop the chips | open (if still rendered) |
| Home | A | `V.strategicRead` ("…I weighed 14 moves against your NZ$54/day budget headroom… repeat purchase is (14% vs a 22% norm)…"), `V.signals`, `V.levers`, `V.focus` (D05 routines) | "Today's read" panel | the daily brief (`TodayBrief`) + KPI deltas | guarded if the panel is accounts-gated; open otherwise |
| Home | A | `V.simpleRead` ("Running N of 35 core routines…", "it needs one thing only you can do") — `routineCount` = phase routine list length, not enabled states | Home intro | enabled count + live pending count | open |
| Home | A | section copy "Only you can clear these. Three taps and the machine keeps moving…", "I set up the work; you keep the bar", "I queue the next builds myself — the constraint tells me what to set up. Turn one on and I dry-run it tonight." (`data-buddy` + headings) | section headers / buddy | accounts-mode buddy now overrides the bubble (this pass); the on-page headings stay — "dry-run it tonight" should read "dry-run it now" per the spine | open (copy) |
| Today brief | A | none — `/api/unc/brief`, renders nothing in demo | brief card | — | guarded |
| Onboarding | A | `obGoalCats` examples ("NZ$40k MRR", "63% blended margin", "25k engaged followers", "40 qualified leads/mo", "22% repeat rate", "enter AU by November") | goal chips | example placeholders, labelled as such | demo-only (examples) |
| Onboarding | A | `initialState` defaults pre-fill a real founder's form: goal "NZ$40,000 MRR", baseline 28,400, deadline 2026-09-30, budget NZ$3,600/mo, 6 h/wk, strengths Writing + Product, Instagram, margin 30% | steps 1–5 | empty / null defaults for a new account (baseline already NULL-safe) | open |
| Onboarding | A | `obVolume` maths ("about N posts a week across M platforms", "NZ$X/day supports about N creative tests a month") and `obPlanShort` | step 6 | derived from the founder's inputs — real, but the "creative tests a month" divisor (900) is an assumption | demo-only (derived) |
| Onboarding | A | `obPaceLine` "Steady it is — I'll only ever ask for a few minutes of your day" | step 6 | product copy | demo-only |
| Routines | B | `channelRows[].saves` = `2 + (id.charCodeAt(5) % 3)` h/wk ("saves ~3 h/wk") | routine rows | `HOURS_SAVED_PER_RUN` × real runs, or drop | open |
| Routines | B | `catCards[].onLabel` "N of M on" — `routineOn[name] ?? state === "Active"` demo fallback | category cards | `routine_states.enabled` only (`useRoutinesState.ts` exists in the tree) | open (in progress) |
| Routines | B | `catalog.ts` `STATES` cycle ("Active", "Draft mode", "Available", "Dry run", "Approval gated") shown as each routine's state pill; `MODES` / `CADENCES` / `KPIS` cycled by index | list + detail | real enabled state + availability ("draft-only for now", "needs Klaviyo connected") + last run / last draft | open |
| Routine detail | B | `wfDefs` READ node "Shopify · GA4 · Meta" / "Freshness limit 60 min", DECIDE `Skill version v12`, GATE "Named approver · Tom", `wfVersion` "v12 · active", `wfDraftMsg` "Validation passed on demonstration data…" | node chain + inspector | the routine's `live_spec` / `draft_spec`, real approver from `team_members`, real version from `routine_states.version` | open |
| Routine detail | B | `setupDefs` ("Connect the sources this system reads: Shopify ok · GA4 ok · Klaviyo — reconnect", "Currency · NZD / Timezone · Pacific/Auckland / Attribution · last non-direct", "Owner · Tom", "3 examples in your voice", "Guardrail · ≤ 2 emails/wk", "Dry run tonight") + `setupProgress` | setup wizard | real connector states, `accounts.currency`, real owner; "Dry run now" | open |
| Routine detail | B | `selSteps` five-step explainer ("Resolve identity and goal…", "Read certified inputs…") | how it runs | product copy | demo-only |
| Run now | B | "runs vanish when the server restarts" (MemoryStore note) | panel | shown only when `persisted=false` | guarded |
| Connectors | B | `V.connectors[].ok/expired/off` — `CONNECTOR_DEFS[].st` demo defaults (Shopify/GA4/Meta/Instagram/Slack "ok", Klaviyo "expired") for platforms the account never touched | connector cards | `connectors` rows only; untouched → disconnected (`useConnectorsState.ts` / `/api/connectors/state` exist in the tree) | open (in progress) |
| Connectors | B | `V.connSummary` (same demo fallback) | header line | `connectorSummary(facts)` (available from `src/lib/unc/accountFacts.ts`) | open |
| Connectors | B | `unlocks N routines` per card (`CONNECTOR_DEFS[].unlocks`) | cards | catalog metadata — a product claim, not account data | demo-only |
| Billing banner | — | "Your last payment didn't go through…" | top | real `past_due` state | guarded |

## Counts

| View | Demo strings found | Fixed (this pass) | Open (owner) | Demo-only / guarded |
|---|---|---|---|---|
| Strategy | 7 | 7 | 0 | 0 |
| Sidebar | 4 | 3 | 0 | 1 |
| Corner buddy | 4 | 4 | 0 | 0 |
| Unc chat context (client + server) | 2 | 2 | 0 | 0 |
| Paywall / Models / What Unc knows / Demo banner / Login / Landing | 6 | 1 | 0 | 5 |
| Home (A) | 16 | 0 | 11 | 5 |
| Onboarding / Today brief (A) | 5 | 0 | 1 | 4 |
| Routines / Routine detail / Run now (B) | 7 | 0 | 5 | 2 |
| Connectors (B) | 3 | 0 | 2 | 1 |
| Billing banner | 1 | 0 | 0 | 1 |
| **Total** | **55** | **17** | **19** | **19** |

Shared root causes behind most "open" rows (both in `src/lib/platform/derive.ts`, agent A):
`effConn = S.connState[name] || d.st` (connector demo defaults) and `isOn = S.routineOn[name] ?? state === "Active"`
(routine demo defaults). In accounts mode both should read the DB projection only — `V.enabledRoutineIds` (added by A)
is the right shape for routines; `src/lib/unc/accountFacts.ts` (this pass) gives the same for connectors.
