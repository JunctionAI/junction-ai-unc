/* Golden-fixture regression for the goal math (src/lib/platform/goal.ts).

   Spec (design-reference/README.md §Interactions & Behavior):
     pace     = (current − baseline) / days elapsed
     needed   = gap / days left
     lands at = current + pace × days left
     status pill reacts to on/off track; divide-by-zero guarded; target = first number in the goal string.

   Demo clock (constants in goal.ts): today = 2026-08-31, start = 2026-08-12 → elapsed is ALWAYS 19 days.
   Every fixture below is an inline expected value — readable as documentation, not a vitest snapshot.
   Cases marked `it.fails` are REAL BUGS locked as expected-to-fail: the assertion states the correct
   behaviour; fixing the code makes the test error ("expected to fail"), which is the signal to drop `.fails`. */

import { describe, expect, it } from "vitest";
import { DEMO_DEFAULT_BASELINE, DEMO_DEFAULT_CURRENT, DEMO_START, DEMO_TODAY, currencySymbol, fmtMoney, goalMath, type GoalMathInput } from "../goal";
import { derive } from "../derive";
import { initialState } from "../state";

const DEMO: GoalMathInput = { goalTitle: "NZ$40,000 MRR", baselineNum: 28400, deadline: "2026-09-30", currency: "NZD" };

interface Golden {
  name: string;
  input: GoalMathInput;
  expect: {
    target: number;
    daysLeft: number;
    pace: number; // to 2 dp
    needed: number; // to 2 dp
    proj: number;
    gap: number;
    onTrack: boolean;
    pct: string;
    status: string; // the pill: "On track" | "Behind by <money>"
  };
}

const GOLDEN: Golden[] = [
  {
    name: "demo dataset (state.ts defaults, currentMRR omitted → demo current 31,650)",
    input: DEMO,
    expect: { target: 40000, daysLeft: 30, pace: 171.05, needed: 278.33, proj: 36782, gap: 3218, onTrack: false, pct: "28%", status: "Behind by NZ$3,218" },
  },
  {
    name: "demo dataset with the current MRR passed explicitly",
    input: { ...DEMO, currentMRR: 31650 },
    expect: { target: 40000, daysLeft: 30, pace: 171.05, needed: 278.33, proj: 36782, gap: 3218, onTrack: false, pct: "28%", status: "Behind by NZ$3,218" },
  },
  {
    name: "on track — pace lands well past the target",
    input: { ...DEMO, currentMRR: 36000 },
    expect: { target: 40000, daysLeft: 30, pace: 400, needed: 133.33, proj: 48000, gap: -8000, onTrack: true, pct: "66%", status: "On track" },
  },
  {
    name: "exactly on pace — projection hits the target to the dollar (gap 0 counts as on track)",
    input: { ...DEMO, currentMRR: 32898 },
    expect: { target: 40000, daysLeft: 30, pace: 236.74, needed: 236.73, proj: 40000, gap: 0, onTrack: true, pct: "39%", status: "On track" },
  },
  {
    name: "one dollar under the exact pace flips the pill to Behind by NZ$2",
    input: { ...DEMO, currentMRR: 32897 },
    expect: { target: 40000, daysLeft: 30, pace: 236.68, needed: 236.77, proj: 39998, gap: 2, onTrack: false, pct: "39%", status: "Behind by NZ$2" },
  },
  {
    name: "zero days left (deadline = demo today) — floored to 1 day so nothing divides by zero",
    input: { ...DEMO, deadline: "2026-08-31" },
    expect: { target: 40000, daysLeft: 1, pace: 171.05, needed: 8350, proj: 31821, gap: 8179, onTrack: false, pct: "28%", status: "Behind by NZ$8,179" },
  },
  {
    name: "deadline already passed — treated exactly like zero days left (floor at 1)",
    input: { ...DEMO, deadline: "2026-08-01" },
    expect: { target: 40000, daysLeft: 1, pace: 171.05, needed: 8350, proj: 31821, gap: 8179, onTrack: false, pct: "28%", status: "Behind by NZ$8,179" },
  },
  {
    name: "baseline == current — zero pace, projection stays flat, progress 0%",
    input: { ...DEMO, baselineNum: 30000, currentMRR: 30000 },
    expect: { target: 40000, daysLeft: 30, pace: 0, needed: 333.33, proj: 30000, gap: 10000, onTrack: false, pct: "0%", status: "Behind by NZ$10,000" },
  },
  {
    name: "non-demo baseline with currentMRR omitted → current defaults to the baseline (not to 31,650)",
    input: { ...DEMO, baselineNum: 30000 },
    expect: { target: 40000, daysLeft: 30, pace: 0, needed: 333.33, proj: 30000, gap: 10000, onTrack: false, pct: "0%", status: "Behind by NZ$10,000" },
  },
  {
    name: "negative pace — revenue fell since baseline; projection goes backwards, progress clamps at 0%",
    input: { ...DEMO, baselineNum: 30000, currentMRR: 27000 },
    expect: { target: 40000, daysLeft: 30, pace: -157.89, needed: 433.33, proj: 22263, gap: 17737, onTrack: false, pct: "0%", status: "Behind by NZ$17,737" },
  },
  {
    name: "target parsed from a non-money goal string: 'Grow to 1,200 subscribers' → 1200 (comma stripped)",
    input: { goalTitle: "Grow to 1,200 subscribers", baselineNum: 800, deadline: "2026-12-31", currency: "NZD", currentMRR: 950 },
    expect: { target: 1200, daysLeft: 122, pace: 7.89, needed: 2.05, proj: 1913, gap: -713, onTrack: true, pct: "38%", status: "On track" },
  },
  {
    name: "no number in the goal string ('Launch the AU market') → target falls back to 40,000",
    input: { ...DEMO, goalTitle: "Launch the AU market" },
    expect: { target: 40000, daysLeft: 30, pace: 171.05, needed: 278.33, proj: 36782, gap: 3218, onTrack: false, pct: "28%", status: "Behind by NZ$3,218" },
  },
  {
    name: "target below current (guard) — floored to current + 1, so the pill reads On track at 100%",
    input: { ...DEMO, goalTitle: "NZ$30,000 MRR", currentMRR: 31650 },
    expect: { target: 31651, daysLeft: 30, pace: 171.05, needed: 0.03, proj: 36782, gap: -5131, onTrack: true, pct: "100%", status: "On track" },
  },
  {
    name: "AUD — symbol follows the account currency, not the goal string",
    input: { ...DEMO, goalTitle: "A$50,000 MRR", currency: "AUD" },
    expect: { target: 50000, daysLeft: 30, pace: 171.05, needed: 611.67, proj: 36782, gap: 13218, onTrack: false, pct: "15%", status: "Behind by A$13,218" },
  },
  {
    name: "GBP symbol",
    input: { ...DEMO, goalTitle: "£40,000 MRR", currency: "GBP" },
    expect: { target: 40000, daysLeft: 30, pace: 171.05, needed: 278.33, proj: 36782, gap: 3218, onTrack: false, pct: "28%", status: "Behind by £3,218" },
  },
  {
    name: "EUR symbol",
    input: { ...DEMO, goalTitle: "€40,000 MRR", currency: "EUR" },
    expect: { target: 40000, daysLeft: 30, pace: 171.05, needed: 278.33, proj: 36782, gap: 3218, onTrack: false, pct: "28%", status: "Behind by €3,218" },
  },
  {
    name: "unknown currency code → falls back to NZ$",
    input: { ...DEMO, goalTitle: "40000", currency: "JPY" },
    expect: { target: 40000, daysLeft: 30, pace: 171.05, needed: 278.33, proj: 36782, gap: 3218, onTrack: false, pct: "28%", status: "Behind by NZ$3,218" },
  },
  {
    name: "baseline 0 is falsy → silently replaced by the demo baseline 28,400 (documented quirk of `||`)",
    input: { ...DEMO, baselineNum: 0 },
    expect: { target: 40000, daysLeft: 30, pace: 171.05, needed: 278.33, proj: 36782, gap: 3218, onTrack: false, pct: "28%", status: "Behind by NZ$3,218" },
  },
  {
    name: "far deadline (365 days) — small needed/day, on track",
    input: { ...DEMO, deadline: "2027-08-31" },
    expect: { target: 40000, daysLeft: 365, pace: 171.05, needed: 22.88, proj: 94084, gap: -54084, onTrack: true, pct: "28%", status: "On track" },
  },
];

describe("goalMath golden table", () => {
  for (const g of GOLDEN) {
    it(g.name, () => {
      const r = goalMath(g.input);
      expect(r.elapsed).toBe(19); // the demo clock — see "demo clock" below
      expect(r.target).toBe(g.expect.target);
      expect(r.daysLeftN).toBe(g.expect.daysLeft);
      expect(r.pace).toBeCloseTo(g.expect.pace, 2);
      expect(r.needed).toBeCloseTo(g.expect.needed, 2);
      expect(r.proj).toBe(g.expect.proj);
      expect(r.gap).toBe(g.expect.gap);
      expect(r.onTrack).toBe(g.expect.onTrack);
      expect(r.goalPct).toBe(g.expect.pct);
      expect(r.onTrack ? "On track" : `Behind by ${r.fmt(r.gap)}`).toBe(g.expect.status);
    });
  }
});

describe("the demo lock", () => {
  it("derive() with the state.ts demo dataset shows the pill 'Behind by NZ$3,218'", () => {
    const d = derive(initialState, () => {});
    expect(d.statusLabel).toBe("Behind by NZ$3,218");
    expect(d.nowFmt).toBe("NZ$31,650");
    expect(d.paceFmt).toBe("NZ$171");
    expect(d.neededFmt).toBe("NZ$278");
    expect(d.projFmt).toBe("NZ$36,782");
    expect(d.homePlain).toBe("You need NZ$8,350 more by the deadline. You’re a little behind — the plan below closes the gap. Your part is below.");
  });

  it("the demo constants are what the README math assumes", () => {
    expect(DEMO_TODAY).toBe("2026-08-31T00:00:00");
    expect(DEMO_START).toBe("2026-08-12T00:00:00");
    expect(DEMO_DEFAULT_CURRENT).toBe(31650);
    expect(DEMO_DEFAULT_BASELINE).toBe(28400);
    expect(initialState.baselineNum).toBe(DEMO_DEFAULT_BASELINE);
    expect(initialState.goalTitle).toBe("NZ$40,000 MRR");
    expect(initialState.deadline).toBe("2026-09-30");
  });
});

describe("demo clock (what cannot be exercised)", () => {
  /* "zero days elapsed" is untestable through goalMath: today and start are module constants,
     so elapsed is 19 for every input. The floor `Math.max(1, …)` exists in the code (goal.ts:57)
     but no input reaches it. When the clock becomes real, this test is the reminder to add
     the elapsed=0 / start-after-today fixtures. */
  it("elapsed is a constant 19 days regardless of input", () => {
    for (const g of GOLDEN) expect(goalMath(g.input).elapsed).toBe(19);
  });
});

describe("target parser — what it actually does", () => {
  // baseline/current of 1 so the current+1 floor (see the guard tests) never masks what the regex read.
  const parse = (goalTitle: string, baselineNum = 1, currentMRR = 1) => goalMath({ goalTitle, baselineNum, deadline: "2026-12-31", currency: "NZD", currentMRR }).target;

  it("reads the first digit run, commas stripped", () => {
    expect(parse("NZ$40,000 MRR")).toBe(40000);
    expect(parse("Grow to 1,200 subscribers")).toBe(1200);
    expect(parse("40 qualified leads/mo")).toBe(40);
    expect(parse("22% repeat purchase rate")).toBe(22);
  });

  it("reads decimals — '$40,000.50' rounds to 40001", () => {
    expect(parse("$40,000.50 MRR")).toBe(40001);
  });

  it("ignores currency symbols and words before the number", () => {
    expect(parse("Reach US$12,500 in monthly revenue")).toBe(12500);
    expect(parse("£9,999")).toBe(9999);
  });

  /* BUG goal.ts:52–53 — the `\d[\d,]*` digit-run regex has no notion of M/k suffixes or decimals, so "$1.2M revenue"
     reads as 1, which the guard then floors to current + 1 → the founder is told they're On track at 100%.
     Inherited verbatim from design-reference/platform-v2-logic.js:121–122. Expected: 1,200,000. */
  it("KNOWN BUG: '$1.2M revenue' should read 1,200,000 (currently reads 1 → floored to current + 1)", () => {
    expect(parse("$1.2M revenue", 800000, 900000)).toBe(1200000);
  });

  it("'$1.2M' reads 1,200,000 after the parser fix", () => {
    const r = goalMath({ goalTitle: "$1.2M revenue", baselineNum: 800000, deadline: "2027-06-30", currency: "USD", currentMRR: 900000 });
    expect(r.target).toBe(1200000);
    expect(r.onTrack).toBe(true); // 100k gained over the demo's 19 elapsed days projects well past 1.2M by mid-2027
    expect(r.goalPct).toBe("25%"); // (900k − 800k) / (1.2M − 800k)
  });

  /* BUG goal.ts:52–53 — the demo's own brand goal text "25k engaged followers" (state.ts goalTexts.brand)
     reads as 25 and is floored to current + 1. Expected: 25,000. */
  it("KNOWN BUG: '25k engaged followers' should read 25,000 (currently reads 25)", () => {
    expect(parse("25k engaged followers", 12000, 14000)).toBe(25000);
  });

  it("'25k' reads 25,000 after the parser fix", () => {
    expect(parse("25k engaged followers", 12000, 14000)).toBe(25000);
  });

  it("consequence: every non-revenue demo goal text collapses to current + 1 under the demo MRR", () => {
    for (const t of ["63% blended margin", "25k engaged followers", "40 qualified leads/mo", "22% repeat purchase rate"]) {
      expect(goalMath({ ...DEMO, goalTitle: t }).target).toBe(31651);
    }
  });
});

describe("divide-by-zero and bad input guards", () => {
  it("days left is floored at 1 even when the deadline is years in the past", () => {
    expect(goalMath({ ...DEMO, deadline: "2000-01-01" }).daysLeftN).toBe(1);
  });

  it("target − baseline is never 0 (target floored to current + 1 keeps goalPct finite)", () => {
    const r = goalMath({ ...DEMO, goalTitle: "NZ$28,400 MRR", baselineNum: 28400, currentMRR: 28400 });
    expect(r.target).toBe(28401);
    expect(r.goalPct).toBe("0%");
  });

  /* BUG goal.ts:56–62 — an unparseable deadline yields NaN days-left; `Math.max(1, NaN)` is NaN, so
     needed/proj/gap are NaN and the pill renders "Behind by NZ$NaN". The UI's date input makes this
     hard to reach today, but the guard is documented as guarding division by zero and it doesn't
     guard this. Expected: finite numbers (e.g. treat as 1 day left). */
  it("KNOWN BUG: an unparseable deadline should not produce NaN money", () => {
    const r = goalMath({ ...DEMO, deadline: "not-a-date" });
    expect(Number.isFinite(r.gap)).toBe(true);
  });

  it("an unparseable deadline falls back to 30 days — never NaN", () => {
    const r = goalMath({ ...DEMO, deadline: "not-a-date" });
    expect(r.daysLeftN).toBe(30);
    expect(Number.isFinite(r.gap)).toBe(true);
    expect(r.fmt(r.gap)).not.toContain("NaN");
  });
});

describe("money formatting", () => {
  it("currencySymbol maps the five supported codes and falls back to NZ$", () => {
    expect(currencySymbol("NZD")).toBe("NZ$");
    expect(currencySymbol("AUD")).toBe("A$");
    expect(currencySymbol("USD")).toBe("US$");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("JPY")).toBe("NZ$");
    expect(currencySymbol("")).toBe("NZ$");
  });

  it("fmtMoney rounds to whole units with en-NZ thousands separators", () => {
    expect(fmtMoney("NZ$", 171.0526)).toBe("NZ$171");
    expect(fmtMoney("NZ$", 3218)).toBe("NZ$3,218");
    expect(fmtMoney("US$", 1594736.4)).toBe("US$1,594,736");
    expect(fmtMoney("£", 0.49)).toBe("£0");
    expect(fmtMoney("NZ$", -8000)).toBe("NZ$-8,000"); // sign lands after the symbol; only ever shown when behind (positive)
  });
});
