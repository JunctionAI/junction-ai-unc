/* The routines catalog + connector definitions — ported verbatim from
   design-reference/platform-v2-logic.js (the authoritative prototype logic).
   All strings are deliberate copy: do not edit. */

export type CategoryName = "Content" | "Paid ads" | "SEO" | "Sales" | "Email & SMS";
export type RoutineState = "Active" | "Draft mode" | "Available" | "Dry run" | "Approval gated";

export interface CategoryDef {
  id: string;
  name: CategoryName;
  systems: string[];
}

export interface RoutineDef {
  id: string;
  name: string;
  cat: CategoryName;
  state: RoutineState;
  mode: string;
  cadence: string;
  kpi: string;
  purpose: string;
  benefit: string;
}

export interface ConnectorDef {
  name: string;
  cat: string;
  unlocks: number;
  st: "ok" | "off" | "expired";
  note: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "D01", name: "Content", systems: ["Founder content engine", "Viral hook mining", "Customer-question mining", "UGC creator pipeline", "Social repurposing", "Winning elements library", "Trend watch", "Content performance learning"] },
  { id: "D02", name: "Paid ads", systems: ["Daily paid decisioning", "Creative testing sprints", "Hook rotation engine", "Ad fatigue watch", "Creator whitelisting", "Creative test planner", "Budget pacing guard", "Organic-to-paid promotion"] },
  { id: "D03", name: "SEO", systems: ["Keyword opportunity scan", "Content gap analysis", "AI search visibility", "On-page SEO fixes", "SERP position watch", "Competitor gap watch"] },
  { id: "D04", name: "Sales", systems: ["Lead research & scoring", "Supervised outbound drafts", "Meeting brief builder", "Follow-up cadence", "Win/loss capture", "Pipeline hygiene"] },
  { id: "D05", name: "Email & SMS", systems: ["Welcome flow tuning", "Abandoned cart recovery", "Segmentation refresh", "Winback campaign prep", "Post-purchase education", "Review request timing", "Campaign calendar prep", "Newsletter draft production"] },
];

export const BENEFITS: Record<string, string> = {
  "Founder content engine": "Posts in your voice, drafted for you",
  "Customer-question mining": "Never run out of content ideas",
  "Social repurposing": "One post becomes five",
  "Content performance learning": "Double down on what works",
  "Daily paid decisioning": "Budget moves to winners every morning",
  "Creative test planner": "Find winning ads faster",
  "Budget pacing guard": "Catch pacing before it crosses your cap",
  "Organic-to-paid promotion": "Turn proven posts into ads",
  "Keyword opportunity scan": "Find searches you can win",
  "Content gap analysis": "Know exactly what to write next",
  "On-page SEO fixes": "Fix what holds rankings back",
  "SERP position watch": "Know the moment rankings move",
  "Lead research & scoring": "Only talk to right-fit leads",
  "Supervised outbound drafts": "Outreach written — you just approve",
  "Follow-up cadence": "Never drop a deal",
  "Pipeline hygiene": "A clean pipeline, always",
  "Viral hook mining": "Steal what’s already working in your niche",
  "UGC creator pipeline": "A steady stream of real-people content",
  "Winning elements library": "Every win becomes a reusable recipe",
  "Trend watch": "Catch trends while they’re rising",
  "Creative testing sprints": "Test 10+ ad concepts a month — brands that do pay ~31% less per sale",
  "Hook rotation engine": "Fresh hooks before ads go stale (they fatigue in ~2 weeks)",
  "Ad fatigue watch": "Kill tired ads before they waste spend",
  "Creator whitelisting": "Run ads from real people’s handles — trust you can’t buy",
  "AI search visibility": "Get recommended by ChatGPT & friends",
  "Competitor gap watch": "Spot their moves before rankings shift",
  "Meeting brief builder": "Walk into every call prepared",
  "Win/loss capture": "Learn why deals close or die",
  "Segmentation refresh": "Right message, right person, every time",
  "Post-purchase education": "Turn buyers into believers",
  "Welcome flow tuning": "Turn first orders into second orders",
  "Abandoned cart recovery": "Win back the almost-buyers",
  "Winback campaign prep": "Revive lapsed customers",
  "Review request timing": "More reviews, asked at the right moment",
  "Campaign calendar prep": "Campaigns planned ahead, not scrambled",
  "Newsletter draft production": "Turn your real brief into a review-ready email",
};

export const CAT_TAGLINES: Record<string, string> = {
  Content: "Get seen consistently",
  "Paid ads": "Make every dollar work harder",
  SEO: "Get found on Google",
  Sales: "Fill your calendar with right-fit buyers",
  "Email & SMS": "Keep customers coming back",
};

const STATES: RoutineState[] = ["Active", "Active", "Draft mode", "Available", "Available", "Dry run", "Available", "Approval gated"];
const MODES = [
  "Approval gated — prepares the exact mutation and waits for a named approver.",
  "Draft — prepares work but never changes the destination.",
  "Read only — inspects and recommends.",
  "Bounded auto — reversible actions inside published policy, read back and receipted.",
];
const CADENCES = [
  "Daily at 07:00, after certified metrics refresh.",
  "Weekly on Monday, or on demand from conversation.",
  "On new data arriving from connected sources.",
  "Every 6 hours during active campaigns.",
];
const KPIS = ["Goal movement per run", "Approval acceptance rate", "Time-to-decision", "Reconciled accuracy"];

const PURPOSE_OVERRIDES: Record<string, string> = {
  "D01-W01": "Turns real customer questions into founder-voice posts, staged for one-tap approval.",
  "D02-W01": "Reads certified spend and revenue each morning and proposes the day’s budget moves.",
  "D02-W04": "Finds organic winners and prepares them as paid creative tests.",
  "D04-W01": "Researches and scores leads against your ICP before any outreach is drafted.",
  "D03-W01": "Finds search demand you can win with content you already have authority for.",
};

/** All executable routines — generated from the category inventory. */
export const ALL_SYSTEMS: RoutineDef[] = CATEGORIES.flatMap((c) =>
  c.systems.map((n, i) => ({ id: `${c.id}-W${String(i + 1).padStart(2, "0")}`, name: n, cat: c.name }))
).map((s, i) => {
  const base: RoutineDef = {
    ...s,
    state: STATES[i % STATES.length],
    mode: MODES[i % MODES.length],
    cadence: CADENCES[i % CADENCES.length],
    kpi: KPIS[i % 4],
    purpose: PURPOSE_OVERRIDES[s.id] ?? `Runs ${s.name.toLowerCase()} inside agreed limits, with certified inputs and a full receipt.`,
    benefit: "",
  };
  base.benefit = BENEFITS[s.name] || base.purpose;
  return base;
});

export const CONNECTOR_DEFS: ConnectorDef[] = [
  { name: "Shopify", cat: "Commerce", unlocks: 12, st: "ok", note: "orders · products · customers" },
  { name: "Google Analytics 4", cat: "Analytics", unlocks: 10, st: "ok", note: "sessions · conversion · attribution" },
  { name: "Meta Ads", cat: "Paid", unlocks: 4, st: "ok", note: "campaigns · spend · creative" },
  { name: "Google Ads", cat: "Paid", unlocks: 4, st: "off", note: "search & shopping campaigns" },
  { name: "Klaviyo", cat: "Email & SMS", unlocks: 5, st: "expired", note: "lists · flows · campaigns" },
  { name: "Instagram", cat: "Social", unlocks: 4, st: "ok", note: "posts · reels · engagement" },
  { name: "TikTok", cat: "Social", unlocks: 3, st: "off", note: "posts · views · trends" },
  { name: "LinkedIn", cat: "Social", unlocks: 4, st: "off", note: "founder posts · engagement" },
  { name: "YouTube", cat: "Social", unlocks: 2, st: "off", note: "videos · watch time" },
  { name: "Google Search Console", cat: "SEO", unlocks: 4, st: "off", note: "queries · positions · indexing" },
  { name: "HubSpot", cat: "Sales", unlocks: 4, st: "off", note: "contacts · deals · pipeline" },
  { name: "Gmail", cat: "Sales", unlocks: 3, st: "off", note: "supervised outreach drafts" },
  { name: "Gorgias", cat: "Support", unlocks: 2, st: "off", note: "tickets · customer questions" },
  { name: "Xero", cat: "Accounting", unlocks: 6, st: "off", note: "real profit · margins · cash cover" },
  { name: "QuickBooks", cat: "Accounting", unlocks: 6, st: "off", note: "real profit · margins · cash cover" },
  { name: "Slack", cat: "Workspace", unlocks: 21, st: "ok", note: "decisions · approvals · alerts" },
];
