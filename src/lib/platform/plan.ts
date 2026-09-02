/* Plan generator — ported verbatim from design-reference/platform-v2-logic.js.
   Channel score = posture weight × strength multiplier × budget gate (paid needs ≥ ~NZ$50/day).
   Top channel = phase 1, second = phase 2, rest = phase 3.
   Weeks split ~30/30/40 with minimums so no "Weeks 1–1"; deadline < 4 weeks clamps to 4. */

export type Posture = "brand" | "sales" | "paid";
export type ChannelKey = "Content" | "Sales" | "Paid ads" | "Email & SMS" | "SEO";

export interface ScoredChannel {
  k: ChannelKey;
  fit: number;
  why: string;
}

export const POSTURE_WEIGHTS: Record<Posture, Partial<Record<ChannelKey, number>>> = {
  brand: { Content: 2.5, "Email & SMS": 1.3, SEO: 1.1, "Paid ads": 0.8, Sales: 0.6 },
  sales: { Sales: 2.5, "Email & SMS": 1.2, Content: 1, "Paid ads": 0.8, SEO: 0.6 },
  paid: { "Paid ads": 2.5, Content: 1.1, "Email & SMS": 1.2, SEO: 0.7, Sales: 0.7 },
};

/** Score every channel for this founder and return them sorted best-first. */
export function scoreChannels(posture: Posture, strengths: string[], budgetMo: number): ScoredChannel[] {
  const has = (...xs: string[]) => xs.some((x) => strengths.includes(x));
  const dayBudget = Math.round(budgetMo / 30);
  const pw = POSTURE_WEIGHTS[posture] || {};
  const chans: ScoredChannel[] = ([
    { k: "Content", fit: (pw["Content"] || 1) * (has("Writing", "Video", "Design", "Community") ? 2 : 1), why: "organic compounds and costs hours, not dollars" },
    { k: "Sales", fit: (pw["Sales"] || 1) * (has("Cold calls", "DMs & outreach") ? 2.5 : 0.6), why: "conversations are your highest-leverage hours" },
    { k: "Paid ads", fit: (pw["Paid ads"] || 1) * (has("Paid media") ? 2 : 0.9) * (dayBudget >= 50 ? 1 : 0.3), why: "you have budget to buy learning fast" },
    { k: "Email & SMS", fit: (pw["Email & SMS"] || 1) * 1.2, why: "the cheapest revenue is the customers you already have" },
    { k: "SEO", fit: (pw["SEO"] || 1) * (has("SEO") ? 1.8 : 0.7), why: "slow but compounding — plant it once the engine runs" },
  ] as ScoredChannel[]).sort((a, b) => b.fit - a.fit);
  return chans;
}

/* The prototype anchors "weeks left" on its demo clock's month start. */
export const DEMO_WEEK_ANCHOR = "2026-09-01T00:00:00";

export interface WeekSplit {
  weeksLeft: number;
  w1: number;
  w2end: number;
}

/** ~30/30/40 week split with sane minimums; < 4 weeks clamps to 4. */
export function weekSplit(deadline: string): WeekSplit {
  const weeksLeft = Math.max(4, Math.round((new Date(deadline + "T00:00:00").getTime() - new Date(DEMO_WEEK_ANCHOR).getTime()) / 6048e5));
  const w1 = Math.max(2, Math.round(weeksLeft * 0.3));
  const w2end = Math.min(weeksLeft - 1, w1 + Math.max(2, Math.round(weeksLeft * 0.3)));
  return { weeksLeft, w1, w2end };
}

export const span = (a: number, b: number): string => (a >= b ? `Week ${a}` : `Weeks ${a}–${b}`);

/* ------------------------------------------------------------------ */
/* Reasoning (2026-09-03, additive)                                    */
/* ------------------------------------------------------------------ */
/* The founder's first-run note on the plan: "impressive … but a little oversimplified". The
   phases and weeks above are untouched; this block writes the judgement UNDER them — per phase:
   why this order, the evidence gate (what number flips to the next phase), the risk (what most
   likely makes the phase fail) and what Unc does weekly — plus one "what I'd push back on" line
   when the founder's chosen posture and the evidence disagree.

   Deterministic from the scoring inputs (posture, strengths, budget, hours, business type) with
   playbook-informed defaults per channel (content/playbooks/**: concepts not variants, kill and
   keep on spend allocation, welcome flow first, one channel proven before two, evidence gates not
   calendar gates). The only numbers in the prose are the founder's own inputs, counts of 12 or
   under, and the paid gate this file already applies (NZ$50/day) — no invented thresholds.
   StrategyView renders it; src/lib/unc/narrative.ts may polish the words but never the numbers. */

export type ReasoningChannel = ChannelKey | "org";

export interface PhaseReasoning {
  channel: ReasoningChannel;
  /** Why this channel sits at this position. */
  whyThisOrder: string;
  /** The number or signal that flips the plan to the next phase — never a week number. */
  evidenceGate: string;
  /** The thing most likely to make this phase fail. */
  risk: string;
  /** What Unc does, week in, week out, while the phase runs. */
  whatIDoWeekly: string;
}

export type ReasoningBusinessType = "ecommerce" | "services" | "saas" | "local" | "creator" | "b2b" | "other";

export interface ReasoningInput {
  posture: Posture;
  strengths: string[];
  budgetMo: number;
  /** null = not set yet (the prose leaves hours out). */
  hoursWk: number | null;
  businessType?: ReasoningBusinessType | null;
  /** Defaults to NZ$ — the scorer's own currency. */
  currencySymbol?: string;
}

export interface PlanReasoning {
  /** The three scored phases in order (phase 3 carries the "rest" channels — its reasoning is the first of them). */
  phases: PhaseReasoning[];
  /** Every channel's reasoning at the position the scorer gave it — StrategyView looks phases up by channel. */
  byChannel: Record<ChannelKey, PhaseReasoning>;
  /** One line, or null when posture and evidence agree. Ends with "Your call." */
  pushback: string | null;
}

/** The paid gate scoreChannels applies (× 0.3 under it): the one threshold the prose may name. */
export const PAID_GATE_PER_DAY = 50;

const CONTENT_STRENGTHS = ["Writing", "Video", "Design", "Community"];
const OUTREACH_STRENGTHS = ["Cold calls", "DMs & outreach"];

const hasAny = (strengths: string[], xs: string[]) => xs.some((x) => strengths.includes(x));
const lower = (k: ReasoningChannel) => (k === "org" ? "the organization" : k.toLowerCase());

/** Sells things, or sells time — it changes which number the gate watches. */
function demand(bt: ReasoningBusinessType | null | undefined): { unit: string; repeat: string } {
  if (bt === "services" || bt === "local" || bt === "b2b" || bt === "saas") return { unit: "booked conversation", repeat: "replies and rebookings" };
  return { unit: "order", repeat: "repeat rate" };
}

function firstReason(k: ChannelKey, r: ReasoningInput, dayBudget: number, cur: string): string {
  const s = r.strengths;
  switch (k) {
    case "Content":
      return hasAny(s, CONTENT_STRENGTHS)
        ? `Content first because ${CONTENT_STRENGTHS.filter((x) => s.includes(x)).join(" and ")} is your strength and organic costs hours, not dollars. One channel proven before two.`
        : `Content first because the play is brand-led and organic costs hours, not dollars — it builds the audience every later phase sells to. One channel proven before two.`;
    case "Sales":
      return hasAny(s, OUTREACH_STRENGTHS)
        ? `Sales first because conversations are your highest-leverage hours — ${OUTREACH_STRENGTHS.filter((x) => s.includes(x)).join(" and ")} is your strength, and close rate is the truest variable in the business. One channel proven before two.`
        : `Sales first because the play is sales-led: distribution and close rate before anything else. One channel proven before two.`;
    case "Paid ads":
      return dayBudget >= PAID_GATE_PER_DAY
        ? `Paid first because ${cur}${dayBudget}/day is enough to buy learning fast${s.includes("Paid media") ? " and paid media is your strength" : ""}. One channel proven before two.`
        : `Paid first because the play is paid-led — though ${cur}${dayBudget}/day sits under the ${cur}${PAID_GATE_PER_DAY}/day the platforms need to learn, so I run it as a probe, not a scale.`;
    case "Email & SMS":
      return `Email first because the cheapest revenue is the customers you already have${s.includes("Email") ? " and email is your strength" : ""}. One channel proven before two.`;
    case "SEO":
      return `SEO first because it's your strength and it compounds — every page keeps paying after the hours are spent. One channel proven before two.`;
  }
}

function secondReason(k: ChannelKey, prev: ChannelKey | null): string {
  const p = prev ? lower(prev) : "phase 1";
  switch (k) {
    case "Email & SMS":
      return `Email second because it's owned and it turns the attention ${p} earns into repeat buyers — the cheapest revenue is the customers you already have.`;
    case "Paid ads":
      return `Paid second because it amplifies what ${p} proves — a winning hook or offer — never guesses. Compounding beats campaigns; paid scales a winner, it doesn't find one.`;
    case "Sales":
      return `Sales second because conversations close the demand ${p} warms — close rate is the truest variable, and it only moves once there's something to close.`;
    case "Content":
      return `Content second because it feeds ${p} with hooks and proof it can't make on its own, and it compounds while ${p} spends.`;
    case "SEO":
      return `SEO second because it plants what ${p} already makes — the questions customers ask become pages that keep answering them.`;
  }
}

function laterReason(k: ChannelKey, r: ReasoningInput, dayBudget: number, cur: string): string {
  switch (k) {
    case "Paid ads":
      return dayBudget < PAID_GATE_PER_DAY
        ? `Paid later because ${cur}${dayBudget}/day is under the ${cur}${PAID_GATE_PER_DAY}/day the platforms need to leave learning — spend below that buys noise. It switches on from proven winners, when the budget does.`
        : `Paid later because it should only scale creative already proven organically — spending before that buys the second-best idea at full price.`;
    case "SEO":
      return `SEO later because it's slow and compounding — it needs the pages and questions the earlier phases produce before it has anything to rank.`;
    case "Sales":
      return `Sales later because outbound runs on your hours${r.hoursWk !== null ? ` and ${r.hoursWk} h/wk is spoken for by the engine first` : ""} — it earns its place when there's warm demand to close.`;
    case "Content":
      return `Content later because the play leads elsewhere — it joins once the engine runs, to feed it hooks and proof.`;
    case "Email & SMS":
      return `Email later only because the list has to exist first — it joins the moment the earlier phases bring subscribers in.`;
  }
}

function gate(k: ChannelKey, r: ReasoningInput, dayBudget: number, cur: string): string {
  const d = demand(r.businessType);
  switch (k) {
    case "Content":
      return `Posts shipping on cadence for 4 weeks and one hook whose reach beats your median 2 weeks running — that's what flips this, not the week number.`;
    case "Email & SMS":
      return `The welcome and cart flows live and email's share of revenue rising 2 weeks running, with ${d.repeat} moving the same way — not the calendar.`;
    case "Paid ads":
      return `One creative concept holding cost per ${d.unit} under your allowable for 2 weeks at ${cur}${dayBudget}/day — before any budget rise. Concepts, not variants; kill and keep on where the spend goes.`;
    case "SEO":
      return `The target pages indexed and non-brand clicks rising 3 months running — the slowest gate, and the one most often abandoned early.`;
    case "Sales":
      return `A steady weekly count of researched leads turning into booked conversations, and a close rate measured on 12 of them — not a hope.`;
  }
}

function risk(k: ChannelKey, r: ReasoningInput, dayBudget: number, cur: string): string {
  const h = r.hoursWk;
  switch (k) {
    case "Content":
      return h !== null ? `Your hours: at ${h} h/wk the engine stalls the week the clips don't get recorded — I can draft, I can't be your face.` : `Your hours: the engine stalls the week the clips don't get recorded — I can draft, I can't be your face.`;
    case "Email & SMS":
      return `A small or unengaged list — flows only compound on the subscribers phase 1 brings in, and blasting the whole list costs deliverability for the buyers who matter.`;
    case "Paid ads":
      return dayBudget < PAID_GATE_PER_DAY
        ? `${cur}${dayBudget}/day is testing money, not scaling money — under ${cur}${PAID_GATE_PER_DAY}/day the platforms never leave learning, so spend buys noise.`
        : `Scaling before a proven winner — the second-best creative eats ${cur}${dayBudget}/day and reports it as reach.`;
    case "SEO":
      return `Slow to show — nothing moves for months, so it's the easiest phase to abandon, and it starves without the pages content makes.`;
    case "Sales":
      return h !== null ? `The pipeline runs on your conversations, and ${h} h/wk is the cap — more leads than you can talk to is waste, not growth.` : `The pipeline runs on your conversations — more leads than you can talk to is waste, not growth.`;
  }
}

function weekly(k: ChannelKey, r: ReasoningInput): string {
  const d = demand(r.businessType);
  switch (k) {
    case "Content":
      return `I mine customer questions, draft the week's posts and hooks, and bring you the clips to record and the hooks to approve.`;
    case "Email & SMS":
      return `I tune the welcome and abandoned-cart flows, segment to the engaged, and draft each campaign for your okay before anything sends.`;
    case "Paid ads":
      return `I test concepts not variants, read the numbers daily, kill and keep on spend allocation, and stage every budget move for your okay.`;
    case "SEO":
      return `I scan keyword and citation gaps, fix on-page issues, and brief articles from the questions customers already ask.`;
    case "Sales":
      return `I research and score leads, draft outreach and follow-ups for your okay, and brief every ${d.unit} before you take it.`;
  }
}

/** One channel's reasoning at a given position (1 = first, 2 = second, 3+ = later). */
export function reasonChannel(k: ChannelKey, input: ReasoningInput, position: number, prev: ChannelKey | null = null): PhaseReasoning {
  const cur = input.currencySymbol ?? "NZ$";
  const dayBudget = Math.round(input.budgetMo / 30);
  const whyThisOrder = position <= 1 ? firstReason(k, input, dayBudget, cur) : position === 2 ? secondReason(k, prev) : laterReason(k, input, dayBudget, cur);
  return { channel: k, whyThisOrder, evidenceGate: gate(k, input, dayBudget, cur), risk: risk(k, input, dayBudget, cur), whatIDoWeekly: weekly(k, input) };
}

/** The "Scale the organization" phase every posture ends on: specialists and people, paid for by the phases before. */
export function reasonOrganization(): PhaseReasoning {
  return {
    channel: "org",
    whyThisOrder: `Last because the phases before it pay for it — a specialist or a hire is a cost until a channel is proven, then it's leverage.`,
    evidenceGate: `The goal number, with the routines running steadily and one channel the numbers say a person could take further than I can.`,
    risk: `Hiring ahead of proof — a person on payroll before the channel they'd run has earned it.`,
    whatIDoWeekly: `Nothing yet. I track what the routines can't do and tell you the week a specialist agent or a hire earns its place.`,
  };
}

/** One line when the chosen posture and the evidence disagree; null when they agree. Ends with "Your call." */
export function postureDisagreement(input: ReasoningInput): string | null {
  const cur = input.currencySymbol ?? "NZ$";
  const dayBudget = Math.round(input.budgetMo / 30);
  const s = input.strengths;
  const ranked = scoreChannels(input.posture, s, input.budgetMo);
  const bestNot = (k: ChannelKey) => ranked.find((c) => c.k !== k)?.k ?? "Content";
  if (input.posture === "paid" && dayBudget < PAID_GATE_PER_DAY) {
    return `Paid-led on ${cur}${dayBudget}/day: under ${cur}${PAID_GATE_PER_DAY}/day the platforms never leave learning, so the spend buys noise. I'd start on ${lower(bestNot("Paid ads"))} and stage a paid probe once it has something proven to amplify. Your call.`;
  }
  if (input.posture === "paid" && !s.includes("Paid media")) {
    return `Paid-led without paid media among your strengths: the budget is there, the winners aren't. I'd run ${lower(bestNot("Paid ads"))} first to find the hook, then put ${cur}${dayBudget}/day behind what wins. Your call.`;
  }
  if (input.posture === "sales" && !hasAny(s, OUTREACH_STRENGTHS)) {
    return `Sales-led without calls or DMs among your strengths: the pipeline runs on your hours. I'd run ${lower(bestNot("Sales"))} first and keep outbound to the conversations you can take. Your call.`;
  }
  if (input.posture === "brand" && input.hoursWk !== null && input.hoursWk < 3) {
    return `Brand-led on ${input.hoursWk} h/wk: organic costs hours, and that many starves it. I'd lean on email & sms first and keep content to what you can record. Your call.`;
  }
  if (input.posture === "brand" && s.includes("Paid media") && dayBudget >= PAID_GATE_PER_DAY && !hasAny(s, CONTENT_STRENGTHS)) {
    return `Brand-led, but paid media is your strength and ${cur}${dayBudget}/day is enough to test: I'd run content and a paid probe side by side, and let the numbers pick. Your call.`;
  }
  return null;
}

/** The judgement under the deterministic plan: per-phase reasoning + the pushback line. Pure. */
export function planReasoning(input: ReasoningInput): PlanReasoning {
  const ranked = scoreChannels(input.posture, input.strengths, input.budgetMo);
  const byChannel = {} as Record<ChannelKey, PhaseReasoning>;
  ranked.forEach((c, i) => {
    byChannel[c.k] = reasonChannel(c.k, input, i + 1, i === 0 ? null : ranked[i - 1].k);
  });
  return { phases: ranked.slice(0, 3).map((c) => byChannel[c.k]), byChannel, pushback: postureDisagreement(input) };
}
