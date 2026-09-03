/* Default RoutineSpec for every one of the 35 catalog routines.

   Classification
     wave 1  — launch wave, draft-only: the chain ends gate → receipt, handing a
               draft to the founder. No execute node, ever.
     wave 2  — everything else. `mutates` marks the ones with an execute node
               (budget moves, publishes, flow changes); each sits behind a gate.

   Read descriptors name the real platform resource + window so a connector
   adapter can implement them literally. Where the catalog has no connector
   for a source (web, llm_search, calendar) the read is a research read and
   the routine stays draft-only.

   Wave-1 chains PRODUCE: trigger → optional reads → produce (the skill card in
   ./skills) → gate → receipt. Their reads are `optional` — a founder with only
   a site profile still gets a draft; the skill's `minimum` (copied onto the spec)
   says what it truly needs, and a run that lacks it ends waiting_input with an
   honest ask instead of "Nothing worth drafting today". */

import { ALL_SYSTEMS } from "../platform/catalog";
import { SKILL_BY_ID } from "./skills";
import type {
  CheckNode,
  DecideNode,
  DecisionOption,
  ExecuteNode,
  GateNode,
  KpiContract,
  Node,
  Platform,
  Predicate,
  ProduceNode,
  ReadNode,
  ReadQuery,
  ReceiptNode,
  RoutineId,
  RoutineSpec,
  SelectionRule,
  SpendDescriptor,
  TriggerNode,
  Wave,
} from "./types";

// ---------- cadences ----------

export const CADENCE = {
  /** Daily at 07:00, after certified metrics refresh. */
  DAILY_0700: "0 7 * * *",
  /** Weekly on Monday 08:00. */
  WEEKLY_MON: "0 8 * * 1",
  /** Every 6 hours during active campaigns. */
  EVERY_6H: "0 */6 * * *",
  /** Hourly. */
  HOURLY: "0 * * * *",
  MANUAL: "manual",
} as const;

// ---------- node builders ----------

const trigger = (cadence: string, dedupKey?: string): TriggerNode => ({ kind: "trigger", id: "trigger", cadence, ...(dedupKey ? { dedupKey } : {}) });

const read = (as: string, source: Platform, resource: string, query: Omit<ReadQuery, "resource"> = {}, freshnessMinutes?: number): ReadNode => ({
  kind: "read",
  id: `read_${as}`,
  as,
  source,
  query: { resource, ...query },
  ...(freshnessMinutes ? { freshnessMinutes } : {}),
});

/** An optional read: unavailable → empty result + a receipt, the chain carries on. */
const optRead = (as: string, source: Platform, resource: string, query: Omit<ReadQuery, "resource"> = {}): ReadNode => ({ ...read(as, source, resource, query), optional: true });

/** The produce step: the routine's skill card (skills/<routine>.ts) makes the artifact. */
const produce = (skill: string, maxItems?: number): ProduceNode => ({ kind: "produce", id: "produce", skill, ...(maxItems ? { maxItems } : {}) });

const check = (id: string, predicate: Predicate, reason?: string, onFail: "skip" | "fail" = "skip"): CheckNode => ({ kind: "check", id, predicate, onFail, ...(reason ? { reason } : {}) });

const decide = (question: string, options: DecisionOption[], rule: SelectionRule): DecideNode => ({ kind: "decide", id: "decide", question, options, rule });

const gate = (title: string, opts: Partial<Omit<GateNode, "kind" | "id" | "title">> = {}): GateNode => ({ kind: "gate", id: "gate", title, expiryHours: 48, ...opts });

const execute = (platform: Platform, action: string, opts: { target?: Record<string, unknown>; params?: Record<string, unknown>; spend?: SpendDescriptor; rollback?: string } = {}): ExecuteNode => ({
  kind: "execute",
  id: "execute",
  platform,
  mutation: { action, ...(opts.target ? { target: opts.target } : {}), ...(opts.params ? { params: opts.params } : {}) },
  ...(opts.spend ? { spend: opts.spend } : {}),
  rollback: opts.rollback ?? "prepared per action",
  idempotencyKey: "{{routine.id}}:{{run.id}}",
});

const receipt = (summary: string, measurementWindowDays = 14): ReceiptNode => ({ kind: "receipt", id: "receipt", summary, measurementWindowDays });

/** Common draft decision: proceed with the draft or, when nothing qualifies, stop. */
const draftOrNothing = (question: string, proceedLabel: string, metric: string, minimum: number): DecideNode =>
  decide(
    question,
    [
      { id: "draft", label: proceedLabel },
      { id: "nothing", label: "Nothing worth drafting today", terminal: true },
    ],
    { kind: "threshold", metric, op: "gte", value: minimum, ifTrue: "draft", ifFalse: "nothing" },
  );

const NAME_BY_ID = new Map(ALL_SYSTEMS.map((s) => [s.id, s.name]));

// ---------- KPI contracts (outcome telemetry) ----------

/* Every routine promises one measurable thing. Two source kinds:
     read  — a certified platform read (the same reader the routine uses), so the actual
             is the platform's number, not ours. Only platforms with a shipped reader
             (shopify, klaviyo, meta_ads, google_ads, ga4) can answer today; the rest
             measure as "couldn't ask" until their reader lands — never a made-up actual.
     runs  — the routine's own ledger (completed runs / draft receipts / approvals) —
             the honest measure for draft-only routines whose output IS the draft.
   Three keys double as benchmark metric_keys for "The bar" (src/lib/telemetry/benchmarks.ts):
   content_drafts_per_week, repeat_purchase_pct, lead_response_hours. */
const kpi = (key: string, label: string, target: number, op: KpiContract["op"], windowDays: number, unit: string, source: KpiContract["source"]): KpiContract => ({ key, label, target, op, windowDays, unit, source });
const runsKpi = (key: string, label: string, target: number, windowDays: number, unit: string, metric: Extract<KpiContract["source"], { kind: "runs" }>["metric"] = "draft_receipts"): KpiContract =>
  kpi(key, label, target, "gte", windowDays, unit, { kind: "runs", metric });

export const KPI_CONTRACTS: Record<RoutineId, KpiContract> = {
  // D01 Content
  "D01-W01": runsKpi("content_drafts_per_week", "Founder drafts handed over", 5, 7, "drafts / week"),
  "D01-W02": runsKpi("hook_briefs_per_week", "Hook briefs delivered", 1, 7, "briefs / week"),
  "D01-W03": runsKpi("question_digests_per_week", "Customer-question digests", 1, 7, "digests / week"),
  "D01-W04": runsKpi("creator_shortlists_per_month", "Creator shortlists delivered", 1, 28, "shortlists / 28d"),
  "D01-W05": runsKpi("repurpose_packs_per_week", "Repurposing packs delivered", 1, 7, "packs / week"),
  "D01-W06": runsKpi("winning_elements_per_month", "Winning-element entries", 1, 28, "entries / 28d"),
  "D01-W07": runsKpi("trend_alerts_per_week", "Trend alerts delivered", 1, 7, "alerts / week"),
  "D01-W08": runsKpi("performance_reads_per_week", "Performance readouts", 1, 7, "readouts / week"),
  // D02 Paid ads
  "D02-W01": kpi("blended_roas_7d", "Blended ROAS (7d)", 2.5, "gte", 7, "×", { kind: "read", platform: "meta_ads", resource: "insights", metric: "roas", query: { filter: { level: "adset" } } }),
  "D02-W02": runsKpi("creative_tests_per_month", "Creative tests proposed", 4, 28, "tests / 28d"),
  "D02-W03": runsKpi("hook_rotations_per_month", "Hook rotations proposed", 2, 28, "rotations / 28d"),
  "D02-W04": kpi("worst_ad_frequency_7d", "Worst ad frequency (7d)", 3.5, "lte", 7, "×", { kind: "read", platform: "meta_ads", resource: "insights", metric: "worst_frequency", query: { filter: { level: "ad" } } }),
  "D02-W05": runsKpi("whitelist_proposals_per_month", "Whitelisting proposals", 1, 28, "proposals / 28d"),
  "D02-W06": runsKpi("test_plans_per_month", "Test plans delivered", 1, 28, "plans / 28d"),
  "D02-W07": kpi("daily_spend_vs_budget_pct", "Daily spend vs budget", 105, "lte", 1, "%", { kind: "read", platform: "meta_ads", resource: "insights", metric: "spend", per: "daily_budget_total", scale: 100, query: { filter: { level: "account" } } }),
  "D02-W08": runsKpi("organic_promotions_per_month", "Organic-to-paid candidates", 2, 28, "candidates / 28d"),
  // D03 SEO
  "D03-W01": runsKpi("keyword_briefs_per_week", "Keyword briefs delivered", 1, 7, "briefs / week"),
  "D03-W02": runsKpi("gap_reports_per_month", "Content-gap reports", 1, 28, "reports / 28d"),
  "D03-W03": runsKpi("ai_visibility_reads_per_month", "AI-search visibility reads", 1, 28, "reads / 28d"),
  "D03-W04": kpi("pages_missing_meta", "Pages missing meta", 0, "lte", 28, "pages", { kind: "read", platform: "shopify", resource: "pages", metric: "missing_meta_count" }),
  "D03-W05": runsKpi("serp_reads_per_week", "SERP position reads", 1, 7, "reads / week"),
  "D03-W06": runsKpi("competitor_watches_per_week", "Competitor gap watches", 1, 7, "watches / week"),
  // D04 Sales
  "D04-W01": runsKpi("lead_scoring_runs_per_week", "Lead scoring runs", 5, 7, "runs / week", "completed_runs"),
  "D04-W02": runsKpi("outbound_drafts_per_week", "Outbound drafts handed over", 5, 7, "drafts / week"),
  "D04-W03": runsKpi("meeting_briefs_per_week", "Meeting briefs delivered", 3, 7, "briefs / week"),
  "D04-W04": kpi("lead_response_hours", "Time to first reply on open deals", 4, "lte", 7, "h", { kind: "read", platform: "hubspot", resource: "deals", metric: "median_response_hours" }),
  "D04-W05": runsKpi("win_loss_captures_per_month", "Win/loss captures", 2, 28, "captures / 28d"),
  "D04-W06": runsKpi("pipeline_hygiene_runs_per_week", "Pipeline hygiene runs", 1, 7, "runs / week", "completed_runs"),
  // D05 Email & SMS
  "D05-W01": kpi("repeat_purchase_pct", "Repeat purchase rate (90d)", 22, "gte", 90, "%", { kind: "read", platform: "shopify", resource: "customers", metric: "repeat_count", per: "count", scale: 100 }),
  "D05-W02": kpi("abandoned_checkout_value_7d", "Abandoned checkout value (7d)", 500, "lte", 7, "$", { kind: "read", platform: "shopify", resource: "checkouts", metric: "total_value", query: { filter: { abandoned: true } } }),
  "D05-W03": runsKpi("segment_refreshes_per_month", "Segment refreshes proposed", 1, 28, "refreshes / 28d"),
  "D05-W04": kpi("winback_revenue_28d", "Winback campaign revenue (28d)", 500, "gte", 28, "$", { kind: "read", platform: "klaviyo", resource: "campaigns", metric: "revenue", query: { filter: { tag: "winback" } } }),
  "D05-W05": runsKpi("post_purchase_drafts_per_month", "Post-purchase drafts", 1, 28, "drafts / 28d"),
  "D05-W06": runsKpi("review_timing_proposals_per_month", "Review-timing proposals", 1, 28, "proposals / 28d"),
  "D05-W07": runsKpi("calendars_per_month", "Campaign calendars delivered", 1, 28, "calendars / 28d"),
};

// ---------- hours saved per completed run ----------

/* Conservative founder-hours one completed run stands in for: the time it takes a founder
   to do the same read + draft by hand, NOT the value of the output. Per category, with a
   few overrides for the heavier drafting routines. Sums into the Home automation strip's
   "hours saved / week" in DB mode (demo mode keeps the prototype's 2.5 h × routines-on). */
const HOURS_BY_CATEGORY: Record<string, number> = { Content: 0.75, "Paid ads": 0.25, SEO: 0.5, Sales: 0.5, "Email & SMS": 0.75 };
const HOURS_OVERRIDES: Record<RoutineId, number> = {
  "D01-W01": 1.5, // 3 founder-voice posts drafted from customer questions
  "D01-W05": 1.0, // one post → five formats
  "D03-W02": 1.5, // content-gap analysis across competitor crawls
  "D04-W01": 1.0, // researching + scoring a day's leads
  "D04-W02": 1.0, // supervised outbound drafts
  "D04-W03": 0.75, // a meeting brief per external meeting
  "D05-W04": 1.5, // winback campaign prepared end to end
  "D05-W07": 2.0, // a 90-day campaign calendar
};
const CAT_BY_ID = new Map(ALL_SYSTEMS.map((s) => [s.id, s.cat]));
export const HOURS_SAVED_PER_RUN: Record<RoutineId, number> = Object.fromEntries(ALL_SYSTEMS.map((s) => [s.id, HOURS_OVERRIDES[s.id] ?? HOURS_BY_CATEGORY[s.cat] ?? 0.5]));

export function hoursSavedPerRun(id: RoutineId): number {
  return HOURS_SAVED_PER_RUN[id] ?? HOURS_BY_CATEGORY[CAT_BY_ID.get(id) ?? ""] ?? 0.5;
}

function spec(id: RoutineId, wave: Wave, nodes: Node[]): RoutineSpec {
  const name = NAME_BY_ID.get(id);
  if (!name) throw new Error(`unknown catalog routine ${id}`);
  const contract = KPI_CONTRACTS[id];
  const skill = SKILL_BY_ID[id];
  return { id, version: 1, name, wave, mutates: nodes.some((n) => n.kind === "execute"), nodes, ...(contract ? { kpi: contract } : {}), hoursSavedPerRun: hoursSavedPerRun(id), ...(skill ? { minimum: skill.minimum } : {}) };
}

// ---------- D01 Content ----------

const D01: RoutineSpec[] = [
  // Founder content engine — wave 1, draft
  spec("D01-W01", 1, [
    trigger(CADENCE.DAILY_0700),
    optRead("questions", "gorgias", "tickets", { window: "7d", fields: ["subject", "body", "tags"], limit: 200 }),
    optRead("posts", "linkedin", "posts", { window: "28d", fields: ["text", "impressions", "reactions", "comments"] }),
    optRead("products", "shopify", "products", { fields: ["title", "body_html", "tags"], limit: 50 }),
    produce("D01-W01", 3),
    gate("{{artifact.title}} — for your voice check", {
      detail: "Three posts in your voice, drafted from what I know about the business and what customers ask. Nothing publishes until you post it.",
      before: "No posts queued",
      after: "3 drafts in your queue, ready to copy or edit",
    }),
    receipt("Founder content engine: {{artifact.title}} handed over."),
  ]),
  // Viral hook mining — wave 2, draft (research only)
  spec("D01-W02", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("niche", "tiktok", "videos", { window: "7d", filter: { niche: "{{vars.niche}}", minViews: 100000 }, fields: ["caption", "views", "likes", "hook_transcript"], limit: 100 }),
    read("ig", "instagram", "hashtag_search", { window: "7d", filter: { hashtags: "{{vars.hashtags}}" }, fields: ["caption", "plays", "likes"], limit: 100 }),
    check("enough_signal", { metric: "reads.niche.count", op: "gte", value: 10 }, "Fewer than 10 breakout videos found this week — no hook library update."),
    draftOrNothing("Which hooks from this week's breakouts fit the brand?", "Add the top hooks to the library", "reads.niche.count", 10),
    gate("{{reads.niche.count}} niche breakouts mined — hook shortlist ready", { detail: "Hook patterns with view counts, ready to adapt.", after: "Hook library updated with this week's winners" }),
    receipt("Viral hook mining: shortlist delivered."),
  ]),
  // Customer-question mining — wave 1, draft
  spec("D01-W03", 1, [
    trigger(CADENCE.WEEKLY_MON),
    optRead("tickets", "gorgias", "tickets", { window: "14d", fields: ["subject", "body"], limit: 500 }),
    optRead("reviews", "shopify", "products", { fields: ["title", "reviews"], limit: 50 }),
    optRead("comments", "instagram", "media", { window: "14d", fields: ["comments"], limit: 50 }),
    produce("D01-W03", 10),
    gate("{{artifact.title}}", { detail: "Ranked by how often customers ask (or how central to buying, when the material is your site). Each idea has a suggested format.", after: "Idea bank refreshed" }),
    receipt("Customer-question mining: {{artifact.title}} drafted."),
  ]),
  // UGC creator pipeline — wave 2, draft (outreach never sent by Unc)
  spec("D01-W04", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("creators", "instagram", "hashtag_search", { window: "28d", filter: { hashtags: "{{vars.hashtags}}", minFollowers: 2000, maxFollowers: 50000 }, fields: ["username", "followers", "engagement_rate"], limit: 100 }),
    read("customers", "shopify", "customers", { window: "90d", filter: { ordersCount: { gte: 2 } }, fields: ["email", "orders_count"], limit: 200 }),
    check("has_candidates", { metric: "reads.creators.count", op: "gte", value: 5 }, "Not enough creator candidates found."),
    draftOrNothing("Which creators fit the brand well enough to brief?", "Shortlist creators and draft outreach", "reads.creators.count", 5),
    gate("{{reads.creators.count}} creator candidates shortlisted — outreach drafts ready", { detail: "Scored on fit and engagement. Drafts are for you to send.", after: "Creator shortlist + outreach drafts in your queue" }),
    receipt("UGC creator pipeline: shortlist drafted."),
  ]),
  // Social repurposing — wave 1, draft
  spec("D01-W05", 1, [
    trigger(CADENCE.DAILY_0700),
    optRead("ig", "instagram", "media", { window: "7d", fields: ["caption", "media_type", "plays", "likes", "saves"], limit: 30 }),
    optRead("li", "linkedin", "posts", { window: "7d", fields: ["text", "impressions", "reactions"] }),
    optRead("yt", "youtube", "videos", { window: "28d", fields: ["title", "views", "transcript"], limit: 10 }),
    produce("D01-W05", 5),
    gate("{{artifact.title}}", { detail: "Reel script, carousel, LinkedIn post, email blurb, X thread — all drafted from one source post.", after: "5 drafts ready to publish where you choose" }),
    receipt("Social repurposing: {{artifact.title}} handed over."),
  ]),
  // Winning elements library — wave 2, draft
  spec("D01-W06", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("ads", "meta_ads", "insights", { window: "28d", filter: { level: "ad" }, fields: ["ad_name", "spend", "purchases", "ctr", "thumbstop"], limit: 200 }),
    read("organic", "instagram", "media", { window: "28d", fields: ["caption", "media_type", "plays", "saves"], limit: 100 }),
    check("has_data", { metric: "reads.ads.count", op: "gte", value: 5 }, "Fewer than 5 ads with data in the window."),
    draftOrNothing("Which hooks, formats and offers are consistently winning?", "Update the winning elements library", "reads.ads.count", 5),
    gate("Winning elements updated from {{reads.ads.count}} ads", { detail: "Hooks, formats and offers that beat account average, with the numbers.", after: "Library entries added — reusable in briefs" }),
    receipt("Winning elements library: entries drafted."),
  ]),
  // Trend watch — wave 2, draft
  spec("D01-W07", 2, [
    trigger(CADENCE.DAILY_0700),
    read("trends", "tiktok", "trends", { window: "24h", filter: { region: "{{vars.region}}", category: "{{vars.niche}}" }, fields: ["name", "growth_rate", "video_count"], limit: 50 }),
    read("sounds", "tiktok", "trends", { window: "24h", filter: { type: "sound" }, fields: ["name", "growth_rate"], limit: 20 }),
    check("rising", { metric: "reads.trends.count", op: "gte", value: 1 }, "No rising trends in your category today."),
    draftOrNothing("Which rising trends can the brand ride credibly?", "Draft trend-jack post ideas", "reads.trends.count", 1),
    gate("{{reads.trends.count}} rising trends — post ideas drafted", { detail: "Only trends still rising, with a brand angle for each.", after: "Trend ideas in your queue", expiryHours: 24 }),
    receipt("Trend watch: ideas drafted.", 7),
  ]),
  // Content performance learning — wave 2, draft
  spec("D01-W08", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("ig", "instagram", "insights", { window: "28d", fields: ["reach", "plays", "saves", "follows"], limit: 100 }),
    read("li", "linkedin", "posts", { window: "28d", fields: ["impressions", "reactions", "comments"] }),
    read("ga", "ga4", "report", { window: "28d", fields: ["sessions", "conversions"], groupBy: ["sessionSource", "sessionMedium"], filter: { sessionMedium: "social" } }),
    check("has_posts", { metric: "reads.ig.count", op: "gte", value: 4 }, "Fewer than 4 posts in the window — not enough to learn from."),
    draftOrNothing("What should we double down on next week?", "Write the weekly content learning note", "reads.ig.count", 4),
    gate("Weekly content learning: what to double down on", { detail: "Formats and topics that moved reach and saves, and what to drop.", after: "Next week's content plan adjusted" }),
    receipt("Content performance learning: note delivered."),
  ]),
];

// ---------- D02 Paid ads ----------

const D02: RoutineSpec[] = [
  // Daily paid decisioning — wave 2, MUTATES (budget moves)
  spec("D02-W01", 2, [
    trigger(CADENCE.DAILY_0700),
    read("spend", "meta_ads", "insights", { window: "7d", filter: { level: "adset" }, fields: ["adset_id", "adset_name", "spend", "purchases", "purchase_value", "roas", "frequency", "ctr", "daily_budget"], limit: 100 }, 60),
    read("adsets", "meta_ads", "adsets", { fields: ["id", "name", "status", "effective_status", "campaign_id", "daily_budget"], limit: 200 }),
    read("orders", "shopify", "orders", { window: "7d", fields: ["id", "total_price", "landing_site", "referring_site"] }, 60),
    optRead("ga", "ga4", "report", { window: "7d", fields: ["sessions", "conversions", "purchaseRevenue"], groupBy: ["sessionCampaignName"], filter: { sessionSource: "facebook" } }),
    check("spend_present", { metric: "reads.spend.spend", op: "gt", value: 0, window: "7d" }, "No paid spend in the last 7 days — nothing to rebalance."),
    /* Do not gate on reconciliation_pct here: the live Meta reader leaves it null (warehouse
       view, not a Graph field). `between` on null always fails, so this check bricked every
       real run. Measurement holds belong in rules/meta.ts when we actually have the %. */
    /* DECIDE is rule-bound (src/lib/actions/rules): the worker's RulesDecisionProvider evaluates
       every ad set against the account's Meta preset (target CPA / max CPA / ROAS floor /
       fatigue / hold days) and picks scale | turn_off | hold deterministically; the LLM only
       writes the reasoning line. The threshold rule below is the honest fallback when no rules
       provider is wired (demo / tests): ROAS ≥ 2.5 on the best ad set → one +20% step. */
    decide(
      "Which ad set gets a change today — scale the winner, turn off a loser, or hold?",
      [
        { id: "scale", label: "Scale {{reads.spend.top_adset_name}} by one budget step", spend: { amountMetric: "reads.spend.top_adset_daily_budget", multiplier: 0.2, period: "day" }, params: { actionId: "meta.adset.set_daily_budget", adsetId: "{{reads.spend.top_adset_id}}", currentDailyBudget: "{{reads.spend.top_adset_daily_budget}}", changePct: 20 } },
        { id: "turn_off", label: "Turn off {{reads.spend.worst_ad_name}}", params: { actionId: "meta.adset.pause", adsetId: "{{reads.spend.worst_ad_id}}" } },
        { id: "hold", label: "Hold budgets as they are", terminal: true },
      ],
      { kind: "threshold", metric: "reads.spend.top_adset_roas", op: "gte", value: 2.5, ifTrue: "scale", ifFalse: "hold" },
    ),
    gate("{{decision.label}}", {
      detail: "7-day read on {{account.currency}} {{reads.spend.spend}} spend, reconciled against Shopify. Verdict by your preset ({{decision.params.preset}}): {{decision.params.verdict}}.",
      before: "{{reads.spend.top_adset_name}} at {{account.currency}} {{reads.spend.top_adset_daily_budget}}/day",
      after: "{{decision.label}} — inside your cap of {{account.currency}} {{caps.perDay}}/day",
      expiryHours: 24,
    }),
    execute("meta_ads", "{{decision.params.actionId}}", {
      target: { adsetId: "{{decision.params.adsetId}}" },
      params: { dailyBudget: "{{decision.params.dailyBudget}}", changePct: "{{decision.params.changePct}}", currentDailyBudget: "{{decision.params.currentDailyBudget}}", reason: "{{decision.params.reason}}" },
      rollback: "the inverse action: restore the previous daily budget / resume the ad set",
    }),
    receipt("Daily paid decisioning: {{decision.label}} — read back and receipted.", 7),
  ]),
  // Creative testing sprints — wave 2, MUTATES (launch test ad set)
  spec("D02-W02", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("ads", "meta_ads", "insights", { window: "14d", filter: { level: "ad" }, fields: ["ad_id", "ad_name", "spend", "purchases", "ctr", "cpa"], limit: 200 }),
    read("creatives", "meta_ads", "ads", { filter: { status: "PAUSED", tag: "unc-test-ready" }, fields: ["ad_id", "creative_id", "name"], limit: 20 }),
    check("has_candidates", { metric: "reads.creatives.count", op: "gte", value: 3 }, "Fewer than 3 approved creatives waiting to test."),
    decide(
      "Which creatives go into this week's test cell?",
      [
        { id: "launch", label: "Launch a 3-creative test at the sprint budget", spend: { amount: 30, period: "day" }, params: { creativeIds: "{{reads.creatives.rows}}" } },
        { id: "wait", label: "Wait — test cell still running", terminal: true },
      ],
      { kind: "threshold", metric: "reads.ads.active_tests", op: "lt", value: 2, ifTrue: "launch", ifFalse: "wait" },
    ),
    gate("Launch this week's creative test ({{reads.creatives.count}} creatives, {{account.currency}} {{decision.spend.amount}}/day)", {
      detail: "Testing 10+ concepts a month is what keeps CPA falling. Runs 7 days, then the winner is promoted by the decisioning routine.",
      before: "No test cell live",
      after: "1 test ad set live at {{account.currency}} {{decision.spend.amount}}/day",
    }),
    execute("meta_ads", "meta.campaign.create_from_brief", {
      params: { name: "Creative test — {{today}}", objective: "OUTCOME_SALES", dailyBudget: "{{decision.spend.amount}}", audience: { countries: "{{vars.countries}}" }, creatives: "{{decision.params.creativeIds}}", pixelId: "{{vars.metaPixelId}}", pageId: "{{vars.metaPageId}}", durationDays: 7 },
      rollback: "everything is created PAUSED; switch it off in Ads Manager",
    }),
    receipt("Creative testing sprint launched.", 7),
  ]),
  // Hook rotation engine — wave 2, MUTATES (swap creative on fatigued ad)
  spec("D02-W03", 2, [
    trigger(CADENCE.EVERY_6H),
    read("ads", "meta_ads", "insights", { window: "14d", filter: { level: "ad" }, fields: ["ad_id", "ad_name", "frequency", "ctr", "ctr_trend", "days_live"], limit: 200 }),
    read("hooks", "meta_ads", "ads", { filter: { status: "PAUSED", tag: "unc-hook-variant" }, fields: ["ad_id", "creative_id"], limit: 20 }),
    check("fatigue_seen", { metric: "reads.ads.fatigued_count", op: "gte", value: 1 }, "No ad past its two-week hook life yet."),
    decide(
      "Rotate a fresh hook into the fatigued ad?",
      [
        { id: "rotate", label: "Swap in the next hook variant", params: { actionId: "meta.ad.rotate", adId: "{{reads.ads.most_fatigued_ad_id}}", nextAdId: "{{reads.hooks.next_ad_id}}", creativeId: "{{reads.hooks.next_creative_id}}" } },
        { id: "none_ready", label: "No fresh hook ready — flag for the content engine", terminal: true },
      ],
      { kind: "threshold", metric: "reads.hooks.count", op: "gte", value: 1, ifTrue: "rotate", ifFalse: "none_ready" },
    ),
    gate("Rotate a fresh hook into {{reads.ads.most_fatigued_ad_name}}", { detail: "Frequency {{reads.ads.most_fatigued_frequency}}, CTR down {{reads.ads.most_fatigued_ctr_drop}}% since launch.", before: "Current hook running", after: "Next hook variant live, old one paused", expiryHours: 24 }),
    execute("meta_ads", "meta.ad.rotate", { params: { pauseAdId: "{{decision.params.adId}}", resumeAdId: "{{decision.params.nextAdId}}", reason: "hook fatigue" }, rollback: "meta.ad.rotate the other way (pause the new, resume the old)" }),
    receipt("Hook rotation: {{decision.label}}.", 7),
  ]),
  // Ad fatigue watch — wave 2, MUTATES (pause tired ad)
  spec("D02-W04", 2, [
    trigger(CADENCE.EVERY_6H),
    read("ads", "meta_ads", "insights", { window: "7d", filter: { level: "ad" }, fields: ["ad_id", "ad_name", "spend", "frequency", "cpa", "cpa_trend"], limit: 200 }, 90),
    check("tired_ad", { all: [{ metric: "reads.ads.worst_frequency", op: "gte", value: 4 }, { metric: "reads.ads.worst_cpa_vs_target_pct", op: "gte", value: 40 }] }, "No ad is both saturated and over CPA target."),
    decide(
      "Pause the tired ad?",
      [
        { id: "pause", label: "Pause {{reads.ads.worst_ad_name}}", params: { actionId: "meta.ad.pause", adId: "{{reads.ads.worst_ad_id}}" } },
        { id: "keep", label: "Keep running — spend too small to matter", terminal: true },
      ],
      { kind: "threshold", metric: "reads.ads.worst_spend", op: "gte", value: 50, ifTrue: "pause", ifFalse: "keep" },
    ),
    gate("Pause {{reads.ads.worst_ad_name}} — frequency {{reads.ads.worst_frequency}}, CPA {{reads.ads.worst_cpa_vs_target_pct}}% over target", { before: "Ad active, {{account.currency}} {{reads.ads.worst_spend}} spent in 7d", after: "Ad paused; budget flows to the rest of the ad set", expiryHours: 12 }),
    execute("meta_ads", "meta.ad.pause", { target: { adId: "{{decision.params.adId}}" }, params: { reason: "frequency {{reads.ads.worst_frequency}}, CPA {{reads.ads.worst_cpa_vs_target_pct}}% over target" }, rollback: "meta.ad.resume" }),
    receipt("Ad fatigue watch: {{decision.label}}.", 7),
  ]),
  // Creator whitelisting — wave 2, draft (needs the creator's permission — outside Unc's hands)
  spec("D02-W05", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("creators", "instagram", "media", { window: "28d", filter: { tagged: true }, fields: ["username", "plays", "saves", "permalink"], limit: 50 }),
    read("ads", "meta_ads", "insights", { window: "28d", filter: { level: "ad", creative_type: "partnership" }, fields: ["ad_name", "cpa", "ctr"], limit: 50 }),
    check("has_creator_content", { metric: "reads.creators.count", op: "gte", value: 1 }, "No creator content tagged the brand this month."),
    draftOrNothing("Which creator posts are worth running as whitelisted ads?", "Draft whitelisting requests for the top creator posts", "reads.creators.count", 1),
    gate("{{reads.creators.count}} creator posts worth whitelisting — permission requests drafted", { detail: "Partnership-ad permission requests written for you to send. Ads only run after the creator accepts.", after: "Requests in your queue" }),
    receipt("Creator whitelisting: requests drafted."),
  ]),
  // Creative test planner — wave 2, draft
  spec("D02-W06", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("ads", "meta_ads", "insights", { window: "28d", filter: { level: "ad" }, fields: ["ad_name", "hook", "format", "offer", "cpa", "spend"], limit: 200 }),
    read("library", "instagram", "media", { window: "28d", fields: ["caption", "media_type", "saves"], limit: 50 }),
    check("has_history", { metric: "reads.ads.count", op: "gte", value: 5 }, "Fewer than 5 ads with results to plan from."),
    draftOrNothing("What should next month's test matrix look like?", "Draft the test matrix (hooks × formats × offers)", "reads.ads.count", 5),
    gate("Next test matrix drafted: {{reads.ads.count}} results analysed", { detail: "Untested combinations ranked by expected lift. Briefs attached per cell.", after: "Test plan ready for the content engine" }),
    receipt("Creative test planner: matrix drafted."),
  ]),
  // Budget pacing guard — wave 2, MUTATES (cut budget when pacing over cap)
  spec("D02-W07", 2, [
    trigger(CADENCE.EVERY_6H),
    read("meta", "meta_ads", "insights", { window: "1d", filter: { level: "account" }, fields: ["spend", "daily_budget_total"] }, 60),
    read("google", "google_ads", "campaigns", { window: "1d", fields: ["campaign_id", "cost", "budget_amount", "status"] }, 60),
    read("mtd", "meta_ads", "insights", { window: "28d", filter: { level: "account" }, fields: ["spend"] }, 60),
    read("adsets", "meta_ads", "adsets", { fields: ["id", "name", "status", "effective_status", "daily_budget"], limit: 200 }),
    check("over_pace", { any: [{ metric: "reads.meta.projected_daily_spend", op: "gt", value: { ref: "caps.perDay" } }, { metric: "reads.google.projected_daily_spend", op: "gt", value: { ref: "caps.perDay" } }] }, "Pacing inside the {{account.currency}} {{caps.perDay}}/day cap."),
    decide(
      "Is the account pacing over its hard cap?",
      [
        { id: "cut", label: "Cut {{reads.adsets.largest_adset_name}} by 25% to pull pacing back under the cap", params: { actionId: "meta.adset.set_daily_budget", adsetId: "{{reads.adsets.largest_adset_id}}", currentDailyBudget: "{{reads.adsets.largest_daily_budget}}", changePct: -25, reduceTo: "{{caps.perDay}}" } },
        { id: "fine", label: "Pacing inside the cap", terminal: true },
      ],
      { kind: "threshold", metric: "reads.meta.projected_daily_spend", op: "gt", value: { ref: "caps.perDay" }, ifTrue: "cut", ifFalse: "fine" },
    ),
    gate("Spend pacing at {{account.currency}} {{reads.meta.projected_daily_spend}}/day vs cap {{account.currency}} {{caps.perDay}} — cut budgets?", { before: "Budgets total {{account.currency}} {{reads.meta.daily_budget_total}}/day", after: "Budgets reduced to {{account.currency}} {{caps.perDay}}/day total", expiryHours: 6 }),
    execute("meta_ads", "meta.adset.set_daily_budget", { target: { adsetId: "{{decision.params.adsetId}}" }, params: { changePct: "{{decision.params.changePct}}", currentDailyBudget: "{{decision.params.currentDailyBudget}}", reason: "pacing {{reads.meta.projected_daily_spend}}/day over the {{caps.perDay}}/day cap" }, rollback: "restore the previous daily budget" }),
    receipt("Budget pacing guard: {{decision.label}}.", 1),
  ]),
  // Organic-to-paid promotion — wave 2, MUTATES (create ad from proven post)
  spec("D02-W08", 2, [
    trigger(CADENCE.DAILY_0700),
    read("posts", "instagram", "insights", { window: "7d", fields: ["media_id", "caption", "reach", "plays", "likes", "saves", "shares"], limit: 50 }),
    read("ga", "ga4", "report", { window: "7d", fields: ["sessions", "conversions"], filter: { sessionSource: "instagram" } }),
    check("demand_not_just_reach", { all: [{ metric: "reads.posts.top_post_reach", op: "gte", value: 5000 }, { metric: "reads.posts.top_post_like_rate_pct", op: "gte", value: 1 }] }, "Best post either lacks reach or its like-rate is under 1% — reach is not demand."),
    decide(
      "Promote the proven post as a paid test?",
      [
        { id: "promote", label: "Run {{reads.posts.top_post_caption}} as a paid test", spend: { amount: 20, period: "day" }, params: { actionId: "meta.campaign.create_from_brief", mediaId: "{{reads.posts.top_post_id}}" } },
        { id: "skip", label: "Not yet — wait for conversions from it", terminal: true },
      ],
      { kind: "threshold", metric: "reads.ga.conversions", op: "gte", value: 1, ifTrue: "promote", ifFalse: "skip" },
    ),
    gate("Promote your top post as a {{account.currency}} {{decision.spend.amount}}/day ad test", { detail: "Reach {{reads.posts.top_post_reach}}, like-rate {{reads.posts.top_post_like_rate_pct}}%, {{reads.ga.conversions}} conversions from Instagram this week.", before: "Organic only", after: "Boosted as a 7-day paid test" }),
    execute("meta_ads", "meta.campaign.create_from_brief", {
      params: { name: "Organic-to-paid test — {{today}}", objective: "OUTCOME_TRAFFIC", optimizationGoal: "LANDING_PAGE_VIEWS", dailyBudget: "{{decision.spend.amount}}", audience: { countries: "{{vars.countries}}" }, creatives: { instagramMediaId: "{{decision.params.mediaId}}" }, pageId: "{{vars.metaPageId}}", durationDays: 7 },
      rollback: "everything is created PAUSED; switch it off in Ads Manager",
    }),
    receipt("Organic-to-paid: {{decision.label}}.", 7),
  ]),
];

// ---------- D03 SEO ----------

const D03: RoutineSpec[] = [
  // Keyword opportunity scan — wave 1, draft
  spec("D03-W01", 1, [
    trigger(CADENCE.WEEKLY_MON),
    optRead("gsc", "search_console", "search_analytics", { window: "28d", groupBy: ["query", "page"], fields: ["clicks", "impressions", "ctr", "position"], filter: { positionBetween: [8, 30] }, limit: 500 }),
    optRead("pages", "shopify", "pages", { fields: ["handle", "title", "body_summary"], limit: 200 }),
    produce("D03-W01", 15),
    gate("{{artifact.title}}", { detail: "Searches you can plausibly win with pages you already have — each with the page that should own it and the move. Hypotheses until Search Console confirms them.", after: "Opportunity list in your queue" }),
    receipt("Keyword opportunity scan: {{artifact.title}} drafted.", 28),
  ]),
  // Content gap analysis — wave 1, draft
  spec("D03-W02", 1, [
    trigger(CADENCE.WEEKLY_MON),
    optRead("gsc", "search_console", "search_analytics", { window: "90d", groupBy: ["query"], fields: ["impressions", "clicks", "position"], limit: 1000 }),
    optRead("competitors", "web", "crawl", { filter: { domains: "{{vars.competitorDomains}}" }, fields: ["url", "title", "h1", "topic"], limit: 300 }),
    optRead("own", "web", "crawl", { filter: { domains: "{{vars.website}}" }, fields: ["url", "title", "h1", "topic"], limit: 300 }),
    produce("D03-W02", 10),
    gate("{{artifact.title}}", { detail: "The pages a business in your category is expected to have, against what your site has. One brief per gap, ranked by buying proximity.", after: "Gap briefs ready for the content engine" }),
    receipt("Content gap analysis: {{artifact.title}} drafted.", 28),
  ]),
  // AI search visibility — wave 2, draft (research read; no connector)
  spec("D03-W03", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("llm", "llm_search", "prompts", { filter: { prompts: "{{vars.buyerPrompts}}", engines: ["chatgpt", "perplexity", "gemini"] }, fields: ["prompt", "engine", "mentioned", "cited_url", "competitors_mentioned"], limit: 100 }),
    read("pages", "shopify", "pages", { fields: ["handle", "title"], limit: 200 }),
    check("has_prompts", { metric: "reads.llm.count", op: "gte", value: 5 }, "Fewer than 5 buyer prompts tested."),
    draftOrNothing("Where are AI assistants recommending competitors instead of you?", "Draft the AI visibility fixes", "reads.llm.count", 5),
    gate("AI search: mentioned in {{reads.llm.mentioned_pct}}% of buyer prompts — fixes drafted", { detail: "Which prompts name competitors, which pages need entity and FAQ structure.", after: "Fix list in your queue" }),
    receipt("AI search visibility: fixes drafted.", 28),
  ]),
  // On-page SEO fixes — wave 2, MUTATES (updates page meta on Shopify)
  spec("D03-W04", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("gsc", "search_console", "search_analytics", { window: "28d", groupBy: ["page"], fields: ["clicks", "impressions", "ctr", "position"], limit: 300 }),
    read("pages", "shopify", "pages", { fields: ["id", "handle", "title", "meta_title", "meta_description", "h1"], limit: 300 }),
    check("has_fixable", { metric: "reads.pages.missing_meta_count", op: "gte", value: 1 }, "Every indexed page already has a title and description."),
    decide(
      "Which on-page fix is worth making this week?",
      [
        { id: "fix", label: "Fix meta title + description on {{reads.pages.worst_page_handle}}", params: { pageId: "{{reads.pages.worst_page_id}}" } },
        { id: "none", label: "No fix with meaningful impressions", terminal: true },
      ],
      { kind: "threshold", metric: "reads.gsc.worst_page_impressions", op: "gte", value: 200, ifTrue: "fix", ifFalse: "none" },
    ),
    gate("Rewrite the meta title + description on /{{reads.pages.worst_page_handle}}", { detail: "{{reads.gsc.worst_page_impressions}} impressions at {{reads.gsc.worst_page_ctr}}% CTR. New copy attached.", before: "Current: {{reads.pages.worst_page_meta_title}}", after: "Proposed: {{decision.params.newTitle}}" }),
    execute("shopify", "update_page_seo", { target: { pageId: "{{decision.params.pageId}}" }, params: { metaTitle: "{{decision.params.newTitle}}", metaDescription: "{{decision.params.newDescription}}" }, rollback: "restore previous meta fields" }),
    receipt("On-page SEO fix applied: {{decision.label}}.", 28),
  ]),
  // SERP position watch — wave 2, draft (notify only)
  spec("D03-W05", 2, [
    trigger(CADENCE.DAILY_0700),
    read("gsc", "search_console", "search_analytics", { window: "7d", groupBy: ["query"], fields: ["position", "position_change_7d", "clicks"], filter: { tracked: true }, limit: 200 }),
    check("movement", { any: [{ metric: "reads.gsc.biggest_drop", op: "lte", value: -3 }, { metric: "reads.gsc.biggest_gain", op: "gte", value: 3 }] }, "No tracked keyword moved more than 3 positions."),
    draftOrNothing("Which ranking moves need a response?", "Draft the ranking-movement note", "reads.gsc.count", 1),
    gate("Rankings moved: {{reads.gsc.movers_count}} tracked keywords shifted 3+ positions", { detail: "Biggest drop {{reads.gsc.biggest_drop}}, biggest gain {{reads.gsc.biggest_gain}}. Suggested responses attached.", after: "Movement note in your queue", expiryHours: 24 }),
    receipt("SERP position watch: note delivered.", 7),
  ]),
  // Competitor gap watch — wave 2, draft
  spec("D03-W06", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("competitors", "web", "crawl", { window: "7d", filter: { domains: "{{vars.competitorDomains}}", changedOnly: true }, fields: ["url", "title", "published_at", "topic"], limit: 100 }),
    read("gsc", "search_console", "search_analytics", { window: "28d", groupBy: ["query"], fields: ["position", "position_change_28d"], limit: 300 }),
    check("moves_seen", { metric: "reads.competitors.count", op: "gte", value: 1 }, "No new competitor pages this week."),
    draftOrNothing("Which competitor moves threaten a ranking you hold?", "Draft the competitor move report", "reads.competitors.count", 1),
    gate("{{reads.competitors.count}} new competitor pages this week — threats ranked", { detail: "Which of your rankings each new page targets, and the counter-move.", after: "Report in your queue" }),
    receipt("Competitor gap watch: report delivered.", 28),
  ]),
];

// ---------- D04 Sales ----------

const D04: RoutineSpec[] = [
  // Lead research & scoring — wave 1, draft
  spec("D04-W01", 1, [
    trigger(CADENCE.DAILY_0700),
    optRead("leads", "hubspot", "contacts", { window: "1d", filter: { lifecycleStage: "lead", scored: false }, fields: ["id", "email", "company", "website", "title"], limit: 100 }),
    produce("D04-W01", 8),
    gate("{{artifact.title}}", { detail: "Your ICP, a scoring rubric and the research checklist — plus provisional scores when there are real leads to score. Scores are suggestions until you accept.", after: "Lead brief ready for outreach drafts", expiryHours: 24 }),
    receipt("Lead research & scoring: {{artifact.title}} handed over.", 7),
  ]),
  // Supervised outbound drafts — wave 1, draft (never sends)
  spec("D04-W02", 1, [
    trigger(CADENCE.DAILY_0700),
    optRead("leads", "hubspot", "contacts", { window: "7d", filter: { lifecycleStage: "lead", fitScore: { gte: 70 }, contacted: false }, fields: ["id", "email", "firstname", "company", "fit_reason"], limit: 20 }),
    optRead("threads", "gmail", "threads", { window: "28d", filter: { label: "sent", to: "{{reads.leads.emails}}" }, fields: ["to", "subject", "snippet"], limit: 50 }),
    produce("D04-W02", 3),
    gate("{{artifact.title}} — you send", { detail: "First-touch emails personalised from the lead brief. Copy them into your mail client; Unc never sends.", after: "Drafts ready to send", expiryHours: 24 }),
    receipt("Supervised outbound: {{artifact.title}} handed over.", 7),
  ]),
  // Meeting brief builder — wave 1, draft
  spec("D04-W03", 1, [
    trigger(CADENCE.DAILY_0700),
    optRead("meetings", "calendar", "events", { window: "1d", filter: { external: true }, fields: ["id", "title", "start", "attendees"], limit: 20 }),
    optRead("contacts", "hubspot", "contacts", { filter: { emails: "{{reads.meetings.attendee_emails}}" }, fields: ["id", "company", "lifecycleStage", "deal_stage", "notes"], limit: 50 }),
    optRead("threads", "gmail", "threads", { window: "90d", filter: { with: "{{reads.meetings.attendee_emails}}" }, fields: ["subject", "snippet", "date"], limit: 50 }),
    produce("D04-W03", 5),
    gate("{{artifact.title}}", { detail: "Who they are, where the deal sits, the last threads, and the question to open with.", after: "Briefs in your queue", expiryHours: 12 }),
    receipt("Meeting brief builder: {{artifact.title}} delivered.", 1),
  ]),
  // Follow-up cadence — wave 2, draft (drafts, never sends)
  spec("D04-W04", 2, [
    trigger(CADENCE.DAILY_0700),
    read("deals", "hubspot", "deals", { filter: { stage: "open", lastActivityOlderThanDays: 5 }, fields: ["id", "name", "contact_email", "stage", "last_activity"], limit: 50 }),
    read("threads", "gmail", "threads", { window: "28d", filter: { with: "{{reads.deals.contact_emails}}" }, fields: ["subject", "snippet", "date", "replied"], limit: 100 }),
    check("stale_deals", { metric: "reads.deals.count", op: "gte", value: 1 }, "Every open deal has activity in the last 5 days."),
    draftOrNothing("Which deals need a nudge?", "Draft follow-ups for stale deals", "reads.deals.count", 1),
    gate("{{reads.deals.count}} deals gone quiet — follow-ups drafted", { detail: "Each draft picks up the last thread. Nothing sends without you.", after: "Follow-up drafts in Gmail", expiryHours: 24 }),
    receipt("Follow-up cadence: drafts handed over.", 7),
  ]),
  // Win/loss capture — wave 2, MUTATES (writes the reason to the CRM deal)
  spec("D04-W05", 2, [
    trigger(CADENCE.DAILY_0700),
    read("closed", "hubspot", "deals", { window: "1d", filter: { stage: ["closedwon", "closedlost"], winLossCaptured: false }, fields: ["id", "name", "amount", "stage", "contact_email"], limit: 20 }),
    read("threads", "gmail", "threads", { window: "90d", filter: { with: "{{reads.closed.contact_emails}}" }, fields: ["subject", "snippet", "date"], limit: 100 }),
    check("new_closes", { metric: "reads.closed.count", op: "gte", value: 1 }, "No deals closed since yesterday."),
    decide(
      "What is the honest reason each deal closed or died?",
      [
        { id: "capture", label: "Write the win/loss reason to {{reads.closed.count}} deals", params: { dealIds: "{{reads.closed.ids}}", reasons: "{{reads.closed.inferred_reasons}}" } },
        { id: "unclear", label: "Reason unclear — ask you instead", terminal: true },
      ],
      { kind: "threshold", metric: "reads.threads.count", op: "gte", value: 1, ifTrue: "capture", ifFalse: "unclear" },
    ),
    gate("Record win/loss reasons on {{reads.closed.count}} closed deals", { detail: "Inferred from the email trail. Edit any reason before it lands in HubSpot.", before: "Deals closed, no reason recorded", after: "Reason + evidence stored on each deal" }),
    execute("hubspot", "update_deal_properties", { target: { dealIds: "{{decision.params.dealIds}}" }, params: { win_loss_reason: "{{decision.params.reasons}}" }, rollback: "clear the win_loss_reason property" }),
    receipt("Win/loss capture: {{decision.label}}.", 28),
  ]),
  // Pipeline hygiene — wave 2, MUTATES (closes dead deals / fixes stages)
  spec("D04-W06", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("deals", "hubspot", "deals", { filter: { stage: "open" }, fields: ["id", "name", "stage", "amount", "close_date", "last_activity", "days_stale"], limit: 500 }),
    check("dead_deals", { metric: "reads.deals.stale_over_30d_count", op: "gte", value: 1 }, "Nothing stale — pipeline is clean."),
    decide(
      "Which deals are actually dead?",
      [
        { id: "close", label: "Mark {{reads.deals.stale_over_30d_count}} deals closed-lost (no activity 30+ days)", params: { dealIds: "{{reads.deals.stale_over_30d_ids}}" } },
        { id: "review", label: "Too many to auto-close — hand you the list", terminal: true },
      ],
      { kind: "threshold", metric: "reads.deals.stale_over_30d_count", op: "lte", value: 15, ifTrue: "close", ifFalse: "review" },
    ),
    gate("Close {{reads.deals.stale_over_30d_count}} dead deals ({{account.currency}} {{reads.deals.stale_over_30d_amount}} of phantom pipeline)", { before: "{{reads.deals.count}} open deals", after: "Pipeline reflects reality; closed deals stay searchable", reasoning: "No activity for 30+ days and no close date in the future." }),
    execute("hubspot", "update_deal_stage", { target: { dealIds: "{{decision.params.dealIds}}" }, params: { stage: "closedlost", reason: "no activity 30+ days (Unc pipeline hygiene)" }, rollback: "reopen the deals at their previous stage" }),
    receipt("Pipeline hygiene: {{decision.label}}.", 28),
  ]),
];

// ---------- D05 Email & SMS ----------

const D05: RoutineSpec[] = [
  // Welcome flow tuning — wave 2, MUTATES (updates a flow message)
  spec("D05-W01", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("flow", "klaviyo", "flows", { filter: { name: "Welcome Series" }, fields: ["id", "status", "messages"] }),
    read("perf", "klaviyo", "metrics", { window: "28d", filter: { flowName: "Welcome Series" }, groupBy: ["message_id"], fields: ["sends", "opens", "clicks", "placed_orders", "revenue"] }),
    read("orders", "shopify", "orders", { window: "28d", filter: { firstOrder: true }, fields: ["id", "total_price", "customer_id"] }),
    check("enough_sends", { metric: "reads.perf.sends", op: "gte", value: 200, window: "28d" }, "Fewer than 200 welcome sends this month — not enough to tune on."),
    decide(
      "Which welcome message is underperforming, and what replaces it?",
      [
        { id: "swap", label: "Replace the weakest message with the drafted variant", params: { messageId: "{{reads.perf.weakest_message_id}}" } },
        { id: "keep", label: "All messages within range — keep", terminal: true },
      ],
      { kind: "threshold", metric: "reads.perf.weakest_ctor_pct", op: "lt", value: 8, ifTrue: "swap", ifFalse: "keep" },
    ),
    gate("Replace welcome message {{reads.perf.weakest_message_position}} (CTOR {{reads.perf.weakest_ctor_pct}}%)", { detail: "New subject, preview and body drafted in your voice. Previous version kept for rollback.", before: "CTOR {{reads.perf.weakest_ctor_pct}}% on {{reads.perf.sends}} sends", after: "New variant live; measured over 14 days" }),
    execute("klaviyo", "update_flow_message", { target: { messageId: "{{decision.params.messageId}}" }, params: { subject: "{{decision.params.subject}}", previewText: "{{decision.params.preview}}", body: "{{decision.params.body}}" }, rollback: "restore the previous message content" }),
    receipt("Welcome flow tuning: {{decision.label}}.", 14),
  ]),
  // Abandoned cart recovery — wave 1, draft
  spec("D05-W02", 1, [
    trigger(CADENCE.DAILY_0700),
    read("checkouts", "shopify", "checkouts", { window: "7d", filter: { abandoned: true }, fields: ["id", "email", "total_price", "line_items", "abandoned_at"], limit: 500 }),
    optRead("flow", "klaviyo", "flows", { filter: { name: "Abandoned Cart" }, fields: ["id", "status", "messages"] }),
    optRead("perf", "klaviyo", "metrics", { window: "28d", filter: { flowName: "Abandoned Cart" }, fields: ["sends", "clicks", "placed_orders", "revenue"] }),
    produce("D05-W02", 3),
    gate("{{artifact.title}} — from {{reads.checkouts.count}} carts abandoned this week", { detail: "Three messages with subject, preview and body, drafted from what people leave in their carts — for you to paste into Klaviyo.", after: "Recovery drafts in your queue" }),
    receipt("Abandoned cart recovery: {{artifact.title}} handed over.", 14),
  ]),
  // Segmentation refresh — wave 2, MUTATES (updates segment definitions)
  spec("D05-W03", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("customers", "shopify", "customers", { window: "365d", fields: ["id", "email", "orders_count", "total_spent", "last_order_at"], limit: 5000 }),
    read("segments", "klaviyo", "segments", { fields: ["id", "name", "definition", "profile_count"] }),
    check("drift", { metric: "reads.segments.drift_pct", op: "gte", value: 10 }, "Segments still match the customer base (drift under 10%)."),
    decide(
      "Which segment definitions have drifted from the customer base?",
      [
        { id: "refresh", label: "Refresh {{reads.segments.drifted_count}} segment definitions", params: { segmentIds: "{{reads.segments.drifted_ids}}", definitions: "{{reads.segments.proposed_definitions}}" } },
        { id: "hold", label: "Drift too broad to auto-refresh — review with you", terminal: true },
      ],
      { kind: "threshold", metric: "reads.segments.drifted_count", op: "lte", value: 5, ifTrue: "refresh", ifFalse: "hold" },
    ),
    gate("Refresh {{reads.segments.drifted_count}} Klaviyo segments (drift {{reads.segments.drift_pct}}%)", { before: "Definitions from {{reads.segments.oldest_definition_date}}", after: "Thresholds re-fitted to this year's purchase behaviour" }),
    execute("klaviyo", "update_segment_definitions", { target: { segmentIds: "{{decision.params.segmentIds}}" }, params: { definitions: "{{decision.params.definitions}}" }, rollback: "restore previous definitions" }),
    receipt("Segmentation refresh: {{decision.label}}.", 28),
  ]),
  // Winback campaign prep — wave 2, draft
  spec("D05-W04", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("lapsed", "shopify", "customers", { window: "365d", filter: { lastOrderOlderThanDays: 90, ordersCount: { gte: 1 } }, fields: ["id", "email", "orders_count", "total_spent", "last_order_at"], limit: 5000 }),
    read("history", "klaviyo", "campaigns", { window: "180d", filter: { tag: "winback" }, fields: ["id", "subject", "sends", "clicks", "revenue"] }),
    check("lapsed_present", { metric: "reads.lapsed.count", op: "gte", value: 50 }, "Fewer than 50 lapsed customers — not worth a campaign yet."),
    draftOrNothing("What offer and angle brings lapsed customers back?", "Draft the winback campaign", "reads.lapsed.count", 50),
    gate("Winback campaign drafted for {{reads.lapsed.count}} lapsed customers", { detail: "Segment, subject lines, body and the offer rule. Nothing schedules until you approve it in Klaviyo.", after: "Campaign draft in your queue" }),
    receipt("Winback campaign prep: draft handed over.", 28),
  ]),
  // Post-purchase education — wave 2, MUTATES (adds/updates a flow message)
  spec("D05-W05", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("orders", "shopify", "orders", { window: "28d", fields: ["id", "line_items", "customer_id", "created_at"] }),
    read("tickets", "gorgias", "tickets", { window: "28d", filter: { tag: "how-to" }, fields: ["subject", "product"], limit: 200 }),
    read("flow", "klaviyo", "flows", { filter: { name: "Post-Purchase" }, fields: ["id", "status", "messages"] }),
    check("has_questions", { metric: "reads.tickets.count", op: "gte", value: 5 }, "Fewer than 5 how-to questions this month."),
    decide(
      "Which product question should the post-purchase flow answer next?",
      [
        { id: "add", label: "Add an education message about {{reads.tickets.top_product}}", params: { flowId: "{{reads.flow.id}}", product: "{{reads.tickets.top_product}}" } },
        { id: "covered", label: "Already covered in the flow", terminal: true },
      ],
      { kind: "threshold", metric: "reads.flow.covers_top_product", op: "eq", value: false, ifTrue: "add", ifFalse: "covered" },
    ),
    gate("Add a post-purchase education email about {{reads.tickets.top_product}}", { detail: "{{reads.tickets.count}} how-to tickets this month; {{reads.tickets.top_product_share_pct}}% about this product. Copy drafted.", before: "Flow has {{reads.flow.message_count}} messages", after: "One more message, day 3 after delivery" }),
    execute("klaviyo", "add_flow_message", { target: { flowId: "{{decision.params.flowId}}" }, params: { position: "after_delivery_day_3", subject: "{{decision.params.subject}}", body: "{{decision.params.body}}" }, rollback: "remove the added message" }),
    receipt("Post-purchase education: {{decision.label}}.", 28),
  ]),
  // Review request timing — wave 2, MUTATES (changes flow delay)
  spec("D05-W06", 2, [
    trigger(CADENCE.WEEKLY_MON),
    read("orders", "shopify", "orders", { window: "90d", fields: ["id", "created_at", "delivered_at", "customer_id"] }),
    read("reviews", "klaviyo", "metrics", { window: "90d", filter: { metric: "Submitted Review" }, groupBy: ["days_since_delivery"], fields: ["count"] }),
    read("flow", "klaviyo", "flows", { filter: { name: "Review Request" }, fields: ["id", "status", "delay_days"] }),
    read("tickets", "gorgias", "tickets", { window: "7d", filter: { status: "open" }, fields: ["customer_email"], limit: 500 }),
    check("enough_reviews", { metric: "reads.reviews.count", op: "gte", value: 30 }, "Fewer than 30 reviews in 90 days — timing signal too weak."),
    decide(
      "When do customers actually leave reviews?",
      [
        { id: "retime", label: "Move the request to day {{reads.reviews.peak_day}} after delivery", params: { flowId: "{{reads.flow.id}}", delayDays: "{{reads.reviews.peak_day}}" } },
        { id: "keep", label: "Current timing already matches the peak", terminal: true },
      ],
      { kind: "threshold", metric: "reads.reviews.peak_day_delta", op: "gte", value: 2, ifTrue: "retime", ifFalse: "keep" },
    ),
    gate("Move review requests from day {{reads.flow.delay_days}} to day {{reads.reviews.peak_day}} after delivery", { detail: "Reviews peak {{reads.reviews.peak_day}} days post-delivery. Customers with open tickets stay suppressed.", before: "Day {{reads.flow.delay_days}}", after: "Day {{reads.reviews.peak_day}}, suppressed for open tickets" }),
    execute("klaviyo", "update_flow_delay", { target: { flowId: "{{decision.params.flowId}}" }, params: { delayDays: "{{decision.params.delayDays}}", suppressIf: "open_support_ticket" }, rollback: "restore previous delay" }),
    receipt("Review request timing: {{decision.label}}.", 28),
  ]),
  // Campaign calendar prep — wave 1, draft
  spec("D05-W07", 1, [
    trigger(CADENCE.WEEKLY_MON),
    optRead("orders", "shopify", "orders", { window: "365d", groupBy: ["week"], fields: ["count", "revenue"] }),
    optRead("campaigns", "klaviyo", "campaigns", { window: "90d", fields: ["id", "subject", "send_time", "revenue", "unsubscribes"] }),
    optRead("products", "shopify", "products", { filter: { launchingWithinDays: 60 }, fields: ["title", "launch_date"], limit: 20 }),
    produce("D05-W07", 6),
    gate("{{artifact.title}}", { detail: "Sequenced from your goal, the plan and the anchors I know about (events, launches, seasonality when there is order history). Each week has a theme and a working subject.", after: "Calendar in your queue" }),
    receipt("Campaign calendar prep: {{artifact.title}} handed over.", 42),
  ]),
];

// ---------- exports ----------

export const CATALOG_SPECS: RoutineSpec[] = [...D01, ...D02, ...D03, ...D04, ...D05];

export const CATALOG_SPEC_BY_ID: Record<RoutineId, RoutineSpec> = Object.fromEntries(CATALOG_SPECS.map((s) => [s.id, s]));

export function catalogSpec(id: RoutineId): RoutineSpec {
  const s = CATALOG_SPEC_BY_ID[id];
  if (!s) throw new Error(`no catalog spec for ${id}`);
  return s;
}

/** The launch-wave routines (draft-only) in catalog order. */
export const WAVE_1_IDS: RoutineId[] = CATALOG_SPECS.filter((s) => s.wave === 1).map((s) => s.id);
