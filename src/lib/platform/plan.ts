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
