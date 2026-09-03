# Industry parameter presets (2026-09-03)

**Founder intent:** "There are parameters — target CPA, max CPA, what you hold, scale, turn off — based on industry levels. They don't need to be over-complicated. The optional workflows just need to be simple to turn on and off, and adjust the skill there. Research the business up front and adjust each workflow accordingly."

So: every routine runs on a **small set of named numbers**. Unc researches the business once (the niche brief), picks the nearest **industry band**, and starts every routine on that band's defaults. The founder changes a number in one screen ("Adjust this routine"); the change becomes a draft version, dry-runs, and is promoted through the versioning that already exists. Nothing is over-complicated: five domains, 3–6 fields per routine, bands not decimals, and every number says where it came from.

## Where it lives

| Piece | File |
|---|---|
| The fields per domain, ranges, validation | `src/lib/runtime/presets/types.ts` |
| The seven bands with provenance; `pickBand`, `resolvePreset` | `src/lib/runtime/presets/industry.ts` |
| Routine ↔ domain, the 3–6 relevant fields, optional steps, spec bindings | `src/lib/runtime/presets/routines.ts` |
| Storage + resolution (`account_presets`, `routine_params`), the actions library's `PresetSource` | `src/lib/runtime/presets/store.ts` |
| Tables | `supabase/migrations/0015_presets.sql` |
| API | `GET / PATCH / POST /api/routines/params` (`src/app/api/routines/params/route.ts`) |
| The niche brief (market read) | `src/lib/brain/nicheBrief.ts` · `POST/GET /api/unc/niche-brief` · LLM task `niche_brief` |
| The inspector | `src/components/platform/RoutineInspector.tsx` (mounted by `RoutineDetail.tsx` in accounts mode) |
| "How I read your market" on Home | `src/components/platform/MarketRead.tsx` |
| Tests | `src/lib/runtime/presets/__tests__/*` · `src/lib/brain/__tests__/nicheBrief.test.ts` · `src/components/platform/__tests__/routineInspector.test.ts` |

## The fields

Each field carries a label, a one-line helper in Unc's voice, a unit, a range (a founder value outside it is **refused, never clamped**), and a `source`: `industry` (the band), `founder` (the inspector / API), `unc` (a self-review adjustment — nothing writes this yet). Values are numbers, one of a short list, or **null = "I don't have what I need to set this"** — never a guess.

| Domain | Field | Unit | Range | What it does |
|---|---|---|---|---|
| paid | `targetCpa` | money | 1–5000 | What I aim to pay for one first order. Below it I lean in. |
| paid | `maxCpa` | money | 1–10000 | The line. An ad past this for a full window gets paused, not defended. |
| paid | `roasFloor` | × | 1–10 | Return I need on ad spend before I move budget toward a winner. |
| paid | `minSpendBeforeJudging` | money | 10–5000 | I don't call an ad good or bad before it has spent this much. |
| paid | `fatigueFrequency` | × | 2–8 | Average times one person has seen an ad. Past this I call it tired. |
| paid | `fatigueCtrDropPct` | % | 5–60 | How far click-through can fall from its best week before I rotate the creative. |
| paid | `scaleStepPct` | % | 5–50 | How much I raise a winner's budget in one move. Never doublings. |
| paid | `holdDays` | days | 1–28 | Days I leave a budget alone after a change so the platform can settle. |
| paid | `dailyBudgetCap` | money | 1–100000 | Hard rail. Nothing I propose takes the day past this. |
| email | `sendCadencePerWeek` | per week | 0–7 | Sends to the engaged segment. Consistency beats bursts. |
| email | `welcomeFlowLength` | emails | 1–8 | Emails in the welcome series. |
| email | `winbackWindowDays` | days | 30–365 | Days since the last order before I call a customer lapsed. |
| email | `discountCeilingPct` | % | 0–50 | The most I will ever put in an offer, and only at the last step. 0 = never. |
| content | `postsPerWeek` | per week | 1–14 | A steady three every week beats seven then silence. |
| content | `formatsMix` | choice | education_led · proof_led · founder_led · entertainment_led | Which jobs the posts do. Product posts stay under a fifth. |
| content | `hookStyle` | choice | proof · story · contrarian · how_to · question | The default opening move; I test three to five hooks against one skeleton. |
| seo | `targetKeywordsPerMonth` | per month | 1–30 | Tier-1 buyer terms I put pages against each month. |
| seo | `minSearchVolume` | searches / month | 0–5000 | Below this I don't chase a term unless the intent is clearly buying. |
| sales | `followUpCadenceDays` | days | 1–30 | Days a deal can sit quiet before I draft the nudge. |
| sales | `maxTouches` | touches | 1–12 | Follow-ups per lead before I stop drafting and call it cold. |
| sales | `leadScoreThreshold` | score (0–10) | 0–10 | Score a lead needs before I draft outreach for it. |

Money fields render in the account currency (`accounts.currency`).

## The bands

Seven bands, picked from the business profile (`business_profiles.profile`: `businessType` · `sells` · `storefront` · `category`) and, once written, the niche brief's own band (which wins). Unknown model ⇒ **no band**, conservative middle-of-the-road defaults, and the inspector says so.

| Band | Picked when |
|---|---|
| `dtc_supplements` | a store whose category reads as supplements / consumables (supplement, vitamin, collagen, skincare, coffee, pet, …) |
| `dtc_apparel` | any other store (apparel, accessories, homeware — the general DTC band) |
| `local_services` | `businessType: local` |
| `b2b_services` | `businessType: services` or `b2b` (a wholesaler sells products; it is not a DTC store) |
| `saas` | `businessType: saas` |
| `creator` | `businessType: creator` |
| `fitness_gym` | a local / services / creator business whose category reads as fitness (gym, crossfit, pilates, yoga, personal training, …) |

### Band table (value · low–high) with provenance

Provenance is on every cell in code (`BAND_TABLES[domain][band][field].provenance`). Summary:

**Paid** (shared across bands unless noted)

| Field | Value | Range | Provenance |
|---|---|---|---|
| `scaleStepPct` | 20 (creator 15) | 10–30 | `content/playbooks/paid/meta-consolidated-structure.md` — "plus twenty percent steps every few days, never doublings"; `meta-creative-testing-and-scaling.md` — "raise budget by about twenty percent" |
| `holdDays` | 3 (fitness 7 · local/SaaS 14 · B2B 21) | 2–7 / up to 28 | same card ("every few days"); the longer holds from `google-ads-thin-volume.md` — "kill or keep on three-to-four-week windows" |
| `fatigueFrequency` | 4 | 3–5 | `src/lib/runtime/catalog-specs.ts` D02-W04 (worst frequency ≥ 4; KPI ≤ 3.5) |
| `fatigueCtrDropPct` | 25 | 15–40 | `meta-creative-testing-and-scaling.md` says "click-through sliding" — the percentage is a **reasoned default** |
| `roasFloor` | supplements 2.5 · apparel 3 · local 3 · B2B 3 · SaaS 2 · creator 1.5 · fitness 3 | per band | catalog D02-W01 (scale at 7-day ROAS ≥ 2.5; KPI blended ROAS 2.5); the per-band shifts are **reasoned** (repeat purchase carries a supplement's first order; returns and one-off buys need more on apparel; subscriptions pay back over months) |
| `minSpendBeforeJudging` | 50 | 30–100 | `src/lib/platform/plan.ts` NZ$50/day learning gate · catalog D02-W04 (pause only past 50 spend) |
| `targetCpa` / `maxCpa` | derived | derived | allowable cost per first order = AOV (`kpi_snapshots aov_28d`) × gross margin (`resource_profiles.gross_margin_pct`) — `drop-and-scarcity-paid.md`'s "allowable CPA"; each band takes a share of it: supplements target 60–90% / max 90–120% (the second order pays for the first), apparel 40–70% / 70–100%, local 40–70% / 70–100%, B2B 10–30% / 30–50% (a lead is not a deal), SaaS 20–50% / 50–80%, creator 20–50% / 50–80%, fitness 50–80% / 80–120%. **Null until AOV and margin are known.** |
| `dailyBudgetCap` | derived | — | `resource_profiles.budget_monthly` ÷ 30 (the runtime's SpendCaps); source `founder` |

**Email**

| Field | supplements | apparel | local | B2B | SaaS | creator | fitness | Provenance |
|---|---|---|---|---|---|---|---|---|
| `sendCadencePerWeek` | 3 (2–4) | 3 (2–4) | 1 (1–2) | 1 (1–2) | 1 (1–2) | 1 (1–3) | 2 (1–3) | `campaign-cadence-and-mix.md` — three to five a week to the engaged segment, one or two to the broader list |
| `welcomeFlowLength` | 7 (5–7) | 6 (4–7) | 3 (2–4) | 3 (2–4) | 5 (4–7) | 3 (2–5) | 4 (3–5) | `welcome-flow-that-converts.md` — seven emails, day 0–14; shortened flows are **reasoned** |
| `winbackWindowDays` | 60 (45–90) | 90 (60–120) | 90 (60–180) | 120 (90–180) | 45 (30–90) | 90 (60–120) | 45 (30–90) | `winback-sunset-cascade.md` (lapsed 60–90+ days) · `segmentation-and-list-health.md` (lapsed = 90–180); supplements shortened per `post-purchase-and-replenishment-flow.md` (a 30-day pack reminds around day 25) |
| `discountCeilingPct` | 10 (0–15) | 15 (0–20) | 0 (0–10) | 0 | 0 (0–20) | 0 (0–20) | 10 (0–20) | the cards say a discount belongs only at the last step; the percentage is a **reasoned default** |

**Content**

| Field | supplements | apparel | local | B2B | SaaS | creator | fitness | Provenance |
|---|---|---|---|---|---|---|---|---|
| `postsPerWeek` | 3 (3–5) | 4 (3–7) | 3 (2–4) | 2 (2–3) | 3 (2–4) | 5 (4–7) | 4 (3–5) | `organic-social-operating-system.md` — "a steady three posts a week"; creator / B2B cadence **reasoned** |
| `formatsMix` | education_led | founder_led | proof_led | education_led | education_led | entertainment_led | proof_led | `organic-social-operating-system.md` pillars (education ~30 · product ~20 · proof ~20 · behind the scenes ~15 · lifestyle ~15) · `media-company-content-system.md` |
| `hookStyle` | proof | story | proof | contrarian | how_to | story | proof | `hook-writing-and-viral-pattern-extraction.md` angle buckets |

**SEO**

| Field | supplements | apparel | local | B2B | SaaS | creator | fitness | Provenance |
|---|---|---|---|---|---|---|---|---|
| `targetKeywordsPerMonth` | 4 (2–6) | 4 (2–6) | 2 (1–3) | 3 (2–4) | 8 (4–12) | 2 (1–4) | 2 (1–3) | `keyword-tiers-and-content-velocity.md` — one primary keyword per article, velocity is the lever; the counts are **reasoned** |
| `minSearchVolume` | 50 (20–200) | 50 (20–200) | 20 (10–100) | 30 (10–100) | 50 (20–300) | 100 (20–300) | 20 (10–100) | `ai-search-visibility-geo.md` — "volume vanity never"; the floors are **reasoned** |

**Sales**

| Field | supplements / apparel | local | B2B | SaaS | creator | fitness | Provenance |
|---|---|---|---|---|---|---|---|
| `followUpCadenceDays` | 3 (2–5) | 2 (1–3) | 3 (3–7) | 3 (2–5) | 5 (3–7) | 2 (1–3) | `crm-hygiene-and-stage-discipline.md` — chase in about three days, reply within two, give a proposal a week · `b2b-pipeline-operating-rhythm.md` (stalled at 7 / 14 / 30 days) |
| `maxTouches` | 3 (2–5) | 3 (2–4) | 5 (3–6) | 4 (3–6) | 3 (2–4) | 3 (2–5) | **reasoned default** |
| `leadScoreThreshold` | 6 (5–8) | 5 (4–7) | 7 (6–8) | 6 (5–8) | 6 (5–8) | 5 (4–7) | `src/lib/runtime/skills/leadResearch.ts` scores 0–10; the threshold is **reasoned** |

Unknown model: paid `roasFloor` 3, `holdDays` 7; email 1 send/week, 4-email welcome, winback 90, discount 0; content 3 posts, education-led, proof; SEO 2 keywords, volume 50; sales 3 / 3 / 6.

## How Unc applies them

1. **Research up front.** On "Agree the plan" the client fires `POST /api/unc/niche-brief` with the scan's profile. One model call (task `niche_brief`, balanced tier) over the profile + the nearest band's ranges + the playbook cards that match produces a short structured read: category band, buying triggers, seasonality, channels that work, benchmarks, what to avoid. **Numbers only from the material:** a line with a number that isn't in the profile / band ranges / playbook cards is dropped; a benchmark from nowhere is dropped; no benchmark left ⇒ `null`, and the card says "No benchmark numbers for this market in my playbooks yet — I won't invent any." Without a model provider the deterministic half still lands (the band and why). The brief is stored as memories (kind `fact`, source `scan`, tags `niche` …, one `source_ref` per account so a re-scan replaces) and shown once on Home as **"How I read your market"** (open first time, collapsed after, never blocking).
2. **Resolve.** `getPreset(db, accountId, domain)` = `account_presets` override → the band (profile + the brief's band memory) → unknown-model defaults. Money fields derive from the account's own AOV, margin and budget, else stay null.
3. **Run on them.** Paid routines' hold / scale / turn-off rules read the paid set through the actions library's `PresetSource` (`presetSource(db)` in `store.ts` → `Partial<MetaPreset>`, mapped onto `src/lib/actions/presets.ts` keys; null money fields are left out so their industry default stands). Bound fields also land in the spec itself (`PARAM_BINDINGS`): D02-W01 `roasFloor` → the decide threshold, `scaleStepPct` → the scale option's multiplier and `changePct`; D02-W04 `fatigueFrequency` → the tired-ad check, `minSpendBeforeJudging` → the pause threshold; D02-W07 `dailyBudgetCap` → the pacing check; D05-W04 `winbackWindowDays` → the lapsed read; D04-W04 `followUpCadenceDays` → the stale-deal read. Fields without a binding steer the skill card and the preset getter.
4. **Optional steps.** Nodes the spec marks `optional: true` (today: the wave-1 optional reads) are toggle rows — "Include: Gorgias tickets · 7d". Switched off ⇒ the node leaves the draft chain.

## How a founder changes one

In the routine's detail page (accounts mode) the **"Adjust this routine"** panel shows the routine's 3–6 relevant fields with the industry line under each — *Industry: NZ$36–54 · yours: NZ$48* — the band and why on top, and one toggle row per optional step. Save → `PATCH /api/routines/params { routineId, params, steps }`:

- out-of-range ⇒ 400 with the issues, nothing written;
- in range ⇒ `routine_params` row (values + `disabled_steps`), and when the values change the chain, a **draft version** (live + 1) through `saveDraft` — the existing versioning;
- then **Run dry-run validation** (`POST { action: "validate" }` → `validateDraft` with the worker's adapters) and **Promote to production** (`POST { action: "promote" }` — refused with 409 until a dry run of exactly that draft passed), or **Discard draft**.

Nothing runs on a new number until the draft passes a dry run and the founder promotes it. Demo mode keeps the prototype's inspector untouched.

Account-wide overrides (`account_presets`) have a store API (`setAccountPreset`) but no screen yet — the routine panel is the one screen the founder needs today.

## Not yet

- Unc's own adjustments (`source: unc`) from the weekly self-review — the column exists, nothing writes it.
- An account-wide presets screen.
- Bindings for content / SEO skills (they read the values through the produce step's context in a later pass).
