/* Golden-fixture regression for the plan generator (src/lib/platform/plan.ts) and the
   phase titles/week spans derive.ts builds from it.

   Spec (design-reference/README.md §Interactions & Behavior):
     channel score = posture weight × strength multiplier × budget gate (paid needs ≥ ~50/day);
     top channel = phase 1, second = phase 2, rest = phase 3;
     weeks split ~30/30/40 with minimums so no "Weeks 1–1"; deadline < 4 weeks clamps to 4.

   Week maths anchors on the demo clock's month start (DEMO_WEEK_ANCHOR = 2026-09-01):
     weeksLeft = max(4, round(days / 7)); w1 = max(2, round(0.3 × weeksLeft));
     w2end = min(weeksLeft − 1, w1 + max(2, round(0.3 × weeksLeft))).

   Every expected value is inline. The founder profiles read as documentation of what the
   scorer does with each posture/strength/budget combination — including the surprising ones. */

import { describe, expect, it } from "vitest";
import { DEMO_WEEK_ANCHOR, POSTURE_WEIGHTS, scoreChannels, span, weekSplit, type ChannelKey, type Posture } from "../plan";
import { derive } from "../derive";
import { initialState, type PlatformState } from "../state";

interface FounderFixture {
  name: string;
  posture: Posture;
  strengths: string[];
  budgetMo: number;
  deadline: string;
  /** Best-first channel order with the score each one gets (3 dp). */
  ranking: [ChannelKey, number][];
  /** The three home-plan phases exactly as derive() renders them: [week span, title]. */
  phases: [string, string][];
}

const FOUNDERS: FounderFixture[] = [
  {
    name: "demo: brand-led, Writing + Product, NZ$3,600/mo (NZ$120/day), 30 Sep 2026 (≈4 weeks)",
    posture: "brand",
    strengths: ["Writing", "Product"],
    budgetMo: 3600,
    deadline: "2026-09-30",
    ranking: [["Content", 5], ["Email & SMS", 1.56], ["SEO", 0.77], ["Paid ads", 0.72], ["Sales", 0.36]],
    phases: [["Weeks 1–2", "Content — your strength, running first"], ["Week 3", "Add email & sms"], ["Week 4+", "SEO + Paid ads + Sales"]],
  },
  {
    name: "brand-led, Writing + Video — the content multiplier is any-of (2×), not additive",
    posture: "brand",
    strengths: ["Writing", "Video"],
    budgetMo: 3600,
    deadline: "2026-12-31",
    ranking: [["Content", 5], ["Email & SMS", 1.56], ["SEO", 0.77], ["Paid ads", 0.72], ["Sales", 0.36]],
    phases: [["Weeks 1–5", "Content — your strength, running first"], ["Weeks 6–10", "Add email & sms"], ["Weeks 11–17+", "SEO + Paid ads + Sales"]],
  },
  {
    name: "brand-led, no strengths at all — posture weight alone still puts Content first",
    posture: "brand",
    strengths: [],
    budgetMo: 3600,
    deadline: "2026-11-24",
    ranking: [["Content", 2.5], ["Email & SMS", 1.56], ["SEO", 0.77], ["Paid ads", 0.72], ["Sales", 0.36]],
    phases: [["Weeks 1–4", "Content — your strength, running first"], ["Weeks 5–8", "Add email & sms"], ["Weeks 9–12+", "SEO + Paid ads + Sales"]],
  },
  {
    name: "brand-led, no strengths, zero budget — the paid gate (×0.3) drops Paid ads to last, below Sales",
    posture: "brand",
    strengths: [],
    budgetMo: 0,
    deadline: "2026-11-24",
    ranking: [["Content", 2.5], ["Email & SMS", 1.56], ["SEO", 0.77], ["Sales", 0.36], ["Paid ads", 0.216]],
    phases: [["Weeks 1–4", "Content — your strength, running first"], ["Weeks 5–8", "Add email & sms"], ["Weeks 9–12+", "SEO + Sales + Paid ads"]],
  },
  {
    name: "brand-led with SEO as a strength — SEO becomes phase 2 ahead of email",
    posture: "brand",
    strengths: ["SEO"],
    budgetMo: 3600,
    deadline: "2026-10-06",
    ranking: [["Content", 2.5], ["SEO", 1.98], ["Email & SMS", 1.56], ["Paid ads", 0.72], ["Sales", 0.36]],
    phases: [["Weeks 1–2", "Content — your strength, running first"], ["Weeks 3–4", "Add seo"], ["Week 5+", "Email & SMS + Paid ads + Sales"]],
  },
  {
    name: "brand-led, Community strength, zero budget",
    posture: "brand",
    strengths: ["Community"],
    budgetMo: 0,
    deadline: "2026-09-22",
    ranking: [["Content", 5], ["Email & SMS", 1.56], ["SEO", 0.77], ["Sales", 0.36], ["Paid ads", 0.216]],
    phases: [["Weeks 1–2", "Content — your strength, running first"], ["Week 3", "Add email & sms"], ["Week 4+", "SEO + Sales + Paid ads"]],
  },
  {
    name: "sales-led with Cold calls — Sales scores 6.25, four times anything else",
    posture: "sales",
    strengths: ["Cold calls"],
    budgetMo: 3600,
    deadline: "2026-09-30",
    ranking: [["Sales", 6.25], ["Email & SMS", 1.44], ["Content", 1], ["Paid ads", 0.72], ["SEO", 0.42]],
    phases: [["Weeks 1–2", "Sales — your strength, running first"], ["Week 3", "Add email & sms"], ["Week 4+", "Content + Paid ads + SEO"]],
  },
  {
    name: "sales-led with DMs & outreach, NZ$1,500/mo — identical ranking to cold calls (same multiplier)",
    posture: "sales",
    strengths: ["DMs & outreach"],
    budgetMo: 1500,
    deadline: "2026-09-30",
    ranking: [["Sales", 6.25], ["Email & SMS", 1.44], ["Content", 1], ["Paid ads", 0.72], ["SEO", 0.42]],
    phases: [["Weeks 1–2", "Sales — your strength, running first"], ["Week 3", "Add email & sms"], ["Week 4+", "Content + Paid ads + SEO"]],
  },
  {
    name: "sales-led, no strengths — Sales (2.5 × 0.6 = 1.5) only just beats Email & SMS (1.44)",
    posture: "sales",
    strengths: [],
    budgetMo: 3600,
    deadline: "2026-09-30",
    ranking: [["Sales", 1.5], ["Email & SMS", 1.44], ["Content", 1], ["Paid ads", 0.72], ["SEO", 0.42]],
    phases: [["Weeks 1–2", "Sales — your strength, running first"], ["Week 3", "Add email & sms"], ["Week 4+", "Content + Paid ads + SEO"]],
  },
  {
    name: "sales-led with Cold calls + Writing — Content (2) edges Email (1.44) into phase 2",
    posture: "sales",
    strengths: ["Cold calls", "Writing"],
    budgetMo: 3600,
    deadline: "2026-10-13",
    ranking: [["Sales", 6.25], ["Content", 2], ["Email & SMS", 1.44], ["Paid ads", 0.72], ["SEO", 0.42]],
    phases: [["Weeks 1–2", "Sales — your strength, running first"], ["Weeks 3–4", "Add content"], ["Weeks 5–6+", "Email & SMS + Paid ads + SEO"]],
  },
  {
    name: "sales-led founder whose strengths are Writing + Paid media — posture does NOT guarantee Sales runs first (Content 2 > Paid 1.6 > Sales 1.5)",
    posture: "sales",
    strengths: ["Writing", "Paid media"],
    budgetMo: 6000,
    deadline: "2026-09-30",
    ranking: [["Content", 2], ["Paid ads", 1.6], ["Sales", 1.5], ["Email & SMS", 1.44], ["SEO", 0.42]],
    phases: [["Weeks 1–2", "Content — your strength, running first"], ["Week 3", "Add paid ads"], ["Week 4+", "Sales + Email & SMS + SEO"]],
  },
  {
    name: "paid-led with Paid media, NZ$1,500/mo = NZ$50/day — gate open, Paid ads 5.0 runs first",
    posture: "paid",
    strengths: ["Paid media"],
    budgetMo: 1500,
    deadline: "2026-09-30",
    ranking: [["Paid ads", 5], ["Email & SMS", 1.44], ["Content", 1.1], ["SEO", 0.49], ["Sales", 0.42]],
    phases: [["Weeks 1–2", "Paid ads — your strength, running first"], ["Week 3", "Add email & sms"], ["Week 4+", "Content + SEO + Sales"]],
  },
  {
    name: "paid-led with Paid media, NZ$1,484/mo (NZ$49/day) — gate closes (×0.3) but 1.5 still beats Email 1.44, so paid stays phase 1",
    posture: "paid",
    strengths: ["Paid media"],
    budgetMo: 1484,
    deadline: "2026-09-30",
    ranking: [["Paid ads", 1.5], ["Email & SMS", 1.44], ["Content", 1.1], ["SEO", 0.49], ["Sales", 0.42]],
    phases: [["Weeks 1–2", "Paid ads — your strength, running first"], ["Week 3", "Add email & sms"], ["Week 4+", "Content + SEO + Sales"]],
  },
  {
    name: "paid-led, no strengths, NZ$3,000/mo — gate open, Paid ads 2.25 first",
    posture: "paid",
    strengths: [],
    budgetMo: 3000,
    deadline: "2026-09-30",
    ranking: [["Paid ads", 2.25], ["Email & SMS", 1.44], ["Content", 1.1], ["SEO", 0.49], ["Sales", 0.42]],
    phases: [["Weeks 1–2", "Paid ads — your strength, running first"], ["Week 3", "Add email & sms"], ["Week 4+", "Content + SEO + Sales"]],
  },
  {
    name: "paid-led, no strengths, NZ$600/mo (NZ$20/day) — paid GATED OUT of phases 1–2: Email & SMS runs first, Content second",
    posture: "paid",
    strengths: [],
    budgetMo: 600,
    deadline: "2026-09-30",
    ranking: [["Email & SMS", 1.44], ["Content", 1.1], ["Paid ads", 0.675], ["SEO", 0.49], ["Sales", 0.42]],
    phases: [["Weeks 1–2", "Email & SMS — your strength, running first"], ["Week 3", "Add content"], ["Week 4+", "Paid ads + SEO + Sales"]],
  },
  {
    name: "paid-led with SEO strength, NZ$3,000/mo — SEO climbs to third",
    posture: "paid",
    strengths: ["SEO"],
    budgetMo: 3000,
    deadline: "2027-08-31",
    ranking: [["Paid ads", 2.25], ["Email & SMS", 1.44], ["SEO", 1.26], ["Content", 1.1], ["Sales", 0.42]],
    phases: [["Weeks 1–16", "Paid ads — your strength, running first"], ["Weeks 17–32", "Add email & sms"], ["Weeks 33–52+", "SEO + Content + Sales"]],
  },
];

function stateFor(f: FounderFixture): PlatformState {
  return { ...initialState, posture: f.posture, obStrengths: f.strengths, budgetMo: f.budgetMo, deadline: f.deadline };
}

describe("founder profiles — channel ranking", () => {
  for (const f of FOUNDERS) {
    it(f.name, () => {
      const got = scoreChannels(f.posture, f.strengths, f.budgetMo).map((c) => [c.k, +c.fit.toFixed(3)]);
      expect(got).toEqual(f.ranking);
    });
  }
});

describe("founder profiles — phases as derive() renders them (title + week span)", () => {
  for (const f of FOUNDERS) {
    it(f.name, () => {
      const d = derive(stateFor(f), () => {});
      const got = d.homePlan.map((p) => [p.weeks, p.title]);
      expect(got).toEqual(f.phases);
      expect(d.homePlan.map((p) => p.st)).toEqual(["Now", "Next", "Later"]);
      // The onboarding narrative request carries the same channels and spans (phase 3 comma-joined there).
      const nr = d.obNarrativeRequest.plan.phases;
      expect(nr.map((p) => p.channel)).toEqual([f.ranking[0][0], f.ranking[1][0], f.ranking.slice(2).map((r) => r[0]).join(", ")]);
      expect(nr[0].spanLabel).toBe(f.phases[0][0]);
      expect(nr[1].spanLabel).toBe(f.phases[1][0]);
      expect(nr[2].spanLabel).toBe(f.phases[2][0].replace(/\+$/, " and beyond"));
    });
  }
});

describe("the paid budget gate", () => {
  it("is ≥ NZ$50/day after rounding — NZ$1,485/mo (49.5/day → 50) passes, NZ$1,484/mo (49.47 → 49) does not", () => {
    const fit = (b: number) => scoreChannels("paid", ["Paid media"], b).find((c) => c.k === "Paid ads")!.fit;
    expect(fit(1500)).toBe(5);
    expect(fit(1485)).toBe(5);
    expect(fit(1484)).toBeCloseTo(1.5, 6);
    expect(fit(0)).toBeCloseTo(1.5, 6);
  });

  it("is a ×0.3 multiplier, not a hard exclusion — Paid ads is always still in the list", () => {
    for (const p of ["brand", "sales", "paid"] as Posture[]) {
      const ks = scoreChannels(p, [], 0).map((c) => c.k);
      expect(ks).toHaveLength(5);
      expect(ks).toContain("Paid ads");
    }
  });
});

describe("posture weights (the table the scorer reads)", () => {
  it("each posture's own channel carries the 2.5 weight", () => {
    expect(POSTURE_WEIGHTS.brand.Content).toBe(2.5);
    expect(POSTURE_WEIGHTS.sales.Sales).toBe(2.5);
    expect(POSTURE_WEIGHTS.paid["Paid ads"]).toBe(2.5);
  });

  it("all three postures rank all five channels, best first, with no ties in the demo budget band", () => {
    for (const p of ["brand", "sales", "paid"] as Posture[]) {
      const r = scoreChannels(p, [], 3000);
      expect(r.map((c) => c.k).sort()).toEqual(["Content", "Email & SMS", "Paid ads", "SEO", "Sales"]);
      for (let i = 1; i < r.length; i++) expect(r[i - 1].fit).toBeGreaterThan(r[i].fit);
      for (const c of r) expect(c.why.length).toBeGreaterThan(10);
    }
  });
});

describe("week split", () => {
  const cases: [string, string, { weeksLeft: number; w1: number; w2end: number }, [string, string, string]][] = [
    ["deadline 3 weeks out clamps to 4", "2026-09-22", { weeksLeft: 4, w1: 2, w2end: 3 }, ["Weeks 1–2", "Week 3", "Week 4+"]],
    ["deadline in the past clamps to 4", "2026-08-01", { weeksLeft: 4, w1: 2, w2end: 3 }, ["Weeks 1–2", "Week 3", "Week 4+"]],
    ["demo deadline 30 Sep (29 days → 4 weeks)", "2026-09-30", { weeksLeft: 4, w1: 2, w2end: 3 }, ["Weeks 1–2", "Week 3", "Week 4+"]],
    ["5 weeks — minimum-width phases, single weeks render as 'Week N' never 'Weeks N–N'", "2026-10-06", { weeksLeft: 5, w1: 2, w2end: 4 }, ["Weeks 1–2", "Weeks 3–4", "Week 5+"]],
    ["6 weeks — 2/2/2", "2026-10-13", { weeksLeft: 6, w1: 2, w2end: 4 }, ["Weeks 1–2", "Weeks 3–4", "Weeks 5–6+"]],
    ["7 weeks — 2/2/3", "2026-10-20", { weeksLeft: 7, w1: 2, w2end: 4 }, ["Weeks 1–2", "Weeks 3–4", "Weeks 5–7+"]],
    ["12 weeks — 4/4/4", "2026-11-24", { weeksLeft: 12, w1: 4, w2end: 8 }, ["Weeks 1–4", "Weeks 5–8", "Weeks 9–12+"]],
    ["17 weeks (31 Dec) — 5/5/7", "2026-12-31", { weeksLeft: 17, w1: 5, w2end: 10 }, ["Weeks 1–5", "Weeks 6–10", "Weeks 11–17+"]],
    ["26 weeks — 8/8/10", "2027-03-02", { weeksLeft: 26, w1: 8, w2end: 16 }, ["Weeks 1–8", "Weeks 9–16", "Weeks 17–26+"]],
    ["52 weeks — 16/16/20, the ~30/30/40 split", "2027-08-31", { weeksLeft: 52, w1: 16, w2end: 32 }, ["Weeks 1–16", "Weeks 17–32", "Weeks 33–52+"]],
  ];
  for (const [name, deadline, split, labels] of cases) {
    it(name, () => {
      const w = weekSplit(deadline);
      expect(w).toEqual(split);
      expect([span(1, w.w1), span(w.w1 + 1, w.w2end), `${span(w.w2end + 1, w.weeksLeft)}+`]).toEqual(labels);
    });
  }

  it("anchors on 1 Sep 2026 (one day AFTER the goal math's demo today of 31 Aug — two demo clocks)", () => {
    expect(DEMO_WEEK_ANCHOR).toBe("2026-09-01T00:00:00");
  });

  it("invariant: for every horizon 4–104 weeks all three phases are non-empty and in order", () => {
    const anchor = new Date(DEMO_WEEK_ANCHOR).getTime();
    for (let n = 4; n <= 104; n++) {
      const deadline = new Date(anchor + n * 7 * 864e5).toISOString().slice(0, 10);
      const { weeksLeft, w1, w2end } = weekSplit(deadline);
      expect(weeksLeft).toBe(n);
      expect(w1).toBeGreaterThanOrEqual(2);
      expect(w2end).toBeGreaterThan(w1);
      expect(weeksLeft).toBeGreaterThan(w2end);
      // 30/30/40-ish: phase 1 and 2 are each within one week of 30% once the minimums stop binding
      if (n >= 10) {
        expect(Math.abs(w1 - n * 0.3)).toBeLessThanOrEqual(1);
        expect(Math.abs(w2end - w1 - n * 0.3)).toBeLessThanOrEqual(1);
      }
      for (const label of [span(1, w1), span(w1 + 1, w2end), span(w2end + 1, weeksLeft)]) expect(label).not.toMatch(/Weeks (\d+)–\1$/);
    }
  });
});

describe("span()", () => {
  it("renders a range with an en dash and a single week without the plural", () => {
    expect(span(1, 2)).toBe("Weeks 1–2");
    expect(span(3, 3)).toBe("Week 3");
    expect(span(17, 32)).toBe("Weeks 17–32");
  });

  it("an inverted range degrades to the start week rather than 'Weeks 5–4'", () => {
    expect(span(5, 4)).toBe("Week 5");
  });
});
