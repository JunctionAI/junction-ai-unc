/* buildUncContext (src/lib/unc/context.ts) — the ONLY source of numbers Unc may use in chat.

   Locks three properties:
     - lists are capped at 10 (team, recent approvals, receipts; `routines.active` at 40);
     - the output is pure data — no functions, nothing JSON cannot carry;
     - the key set is stable: GOLDEN_KEYS is every key path the context exposes. Adding a field
       (or leaking one from derive/state) fails this test on purpose — context growth is a
       prompt-size and a "what does Unc know" decision, so it must be made explicitly. */

import { describe, expect, it } from "vitest";
import { accountInitialState, initialState, type PlatformState } from "@/lib/platform/state";
import { buildUncContext } from "../context";

/** Every key path in the context, sorted; array elements contribute their first item's keys under "[]". */
function keyPaths(v: unknown, prefix = "", out: string[] = []): string[] {
  if (Array.isArray(v)) {
    if (v.length) keyPaths(v[0], `${prefix}[]`, out);
    return out;
  }
  if (v && typeof v === "object") {
    for (const k of Object.keys(v as object).sort()) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.push(p);
      keyPaths((v as Record<string, unknown>)[k], p, out);
    }
  }
  return out;
}

const GOLDEN_KEYS = [
  "approvalsPending",
  "approvalsPending[].after",
  "approvalsPending[].before",
  "approvalsPending[].detail",
  "approvalsPending[].expiry",
  "approvalsPending[].reasoning",
  "approvalsPending[].routine",
  "approvalsPending[].status",
  "approvalsPending[].title",
  "approvalsRecent",
  "approvalsRecent[].after",
  "approvalsRecent[].before",
  "approvalsRecent[].detail",
  "approvalsRecent[].expiry",
  "approvalsRecent[].reasoning",
  "approvalsRecent[].routine",
  "approvalsRecent[].status",
  "approvalsRecent[].title",
  "automation",
  "automation.actionsEnabled",
  "automation.paused",
  "business",
  "business.profile",
  "business.website",
  "connectors",
  "connectors[].name",
  "connectors[].reads",
  "connectors[].status",
  "founder",
  "founder.adBudgetPerDay",
  "founder.adBudgetPerMonth",
  "founder.breadth",
  "founder.hoursPerWeek",
  "founder.marginPct",
  "founder.pace",
  "founder.platforms",
  "founder.profile",
  "founder.profile.belief",
  "founder.profile.budget",
  "founder.profile.strength",
  "founder.profile.time",
  "founder.reinvest",
  "founder.strengths",
  "founder.team",
  "founder.team[].approvalAreas",
  "founder.team[].name",
  "founder.team[].role",
  "goal",
  "goal.baseline",
  "goal.currency",
  "goal.current",
  "goal.daysLeft",
  "goal.deadline",
  "goal.gapAtDeadline",
  "goal.neededPerDay",
  "goal.onTrack",
  "goal.otherGoals",
  "goal.pacePerDay",
  "goal.progress",
  "goal.projectedAtDeadline",
  "goal.target",
  "goal.title",
  "levers",
  "levers[].cost",
  "levers[].impact",
  "levers[].name",
  "levers[].status",
  "onboarded",
  "recentReceipts",
  "recentReceipts[].receipt",
  "recentReceipts[].text",
  "routines",
  "routines.active",
  "routines.activeCount",
  "routines.categories",
  "routines.categories[].name",
  "routines.categories[].on",
  "routines.categories[].total",
  "routines.libraryTotal",
  "signals",
  "signals[].label",
  "signals[].note",
  "signals[].value",
  "strategy",
  "strategy.agreedAt",
  "strategy.channelRanking",
  "strategy.channelRanking[].channel",
  "strategy.channelRanking[].why",
  "strategy.phases",
  "strategy.phases[].founderPart",
  "strategy.phases[].name",
  "strategy.phases[].phase",
  "strategy.phases[].routines",
  "strategy.phases[].status",
  "strategy.posture",
  "strategy.postureLabel",
  "strategy.rolloutWeeks",
  "strategy.rolloutWeeks.phase1",
  "strategy.rolloutWeeks.phase2",
  "strategy.rolloutWeeks.phase3",
  "strategy.rolloutWeeks.total",
  "strategy.thesis",
  "strategy.why",
  "today",
];

/** A state where every capped list has more than 10 entries and an approval has been actioned. */
function bigState(): PlatformState {
  return {
    ...initialState,
    team: Array.from({ length: 15 }, (_, i) => ({ name: `Person ${i + 1}`, role: "Ops", areas: ["Content"] })),
    apStatus: ["approved", "held", "pending"],
    obCats: ["revenue", "brand", "leads"],
  };
}

function walk(v: unknown, path: string, visit: (path: string, v: unknown) => void) {
  visit(path, v);
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, visit));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as object)) walk(x, path ? `${path}.${k}` : k, visit);
}

describe("stable key set", () => {
  it("the demo context exposes exactly GOLDEN_KEYS (with an actioned approval so approvalsRecent has shape)", () => {
    expect(keyPaths(buildUncContext(bigState()))).toEqual(GOLDEN_KEYS);
  });

  it("the plain demo state exposes the same keys minus the empty approvalsRecent item shape", () => {
    const got = keyPaths(buildUncContext(initialState));
    expect(got).toEqual(GOLDEN_KEYS.filter((k) => !k.startsWith("approvalsRecent[]")));
  });
});

describe("pure data", () => {
  it("an empty account has unknown targets, margins and time horizons, not demo math", () => {
    const ctx = buildUncContext(accountInitialState("NZD"), { mode: "account" });
    expect(ctx.goal).toMatchObject({ title: "", target: null, baseline: null, current: null, daysLeft: null, progress: null });
    expect(ctx.founder).toMatchObject({ adBudgetPerMonth: null, hoursPerWeek: null, marginPct: null, team: [] });
    expect(ctx.strategy.rolloutWeeks).toEqual({ total: null, phase1: null, phase2: null, phase3: null });
    expect(JSON.stringify(ctx)).not.toMatch(/NaN|31650|28400|40000/);
  });

  it("preserves an explicitly stated zero baseline without inventing current progress", () => {
    const ctx = buildUncContext({ ...accountInitialState("AUD"), obAnswered: { target: true, budget: true, hours: true }, goalTitle: "A$10,000 revenue", baselineNum: 0, deadline: "2026-09-30" }, { mode: "account", now: new Date("2026-09-05T00:00:00Z") });
    expect(ctx.goal).toMatchObject({ target: 10000, baseline: 0, current: null, daysLeft: 25, pacePerDay: null, projectedAtDeadline: null });
    expect(ctx.founder.adBudgetPerMonth).toBe(0);
  });
  it("contains no functions, undefineds, Dates or class instances — a JSON round-trip is lossless", () => {
    const ctx = buildUncContext(bigState());
    const bad: string[] = [];
    walk(ctx, "", (p, v) => {
      if (typeof v === "function" || v === undefined || typeof v === "symbol" || typeof v === "bigint" || v instanceof Date) bad.push(p);
      if (v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) bad.push(`${p} (prototype)`);
    });
    expect(bad).toEqual([]);
    expect(JSON.parse(JSON.stringify(ctx))).toEqual(ctx);
  });

  it("no styling or UI plumbing leaks (derive()'s oklch colours, click handlers, setters)", () => {
    const s = JSON.stringify(buildUncContext(bigState()));
    expect(s).not.toMatch(/oklch\(/);
    expect(s).not.toMatch(/"(go|pick|approve|hold|next|toggle|set)":/); // "why" is a legitimate data key (channel rationale)
  });
});

describe("caps", () => {
  it("team is capped at 10 of 15", () => {
    const ctx = buildUncContext(bigState());
    expect(ctx.founder.team).toHaveLength(10);
    expect(ctx.founder.team[9].name).toBe("Person 10");
  });

  it("every list in the context is ≤ 10 items, except routines.active (≤ 40)", () => {
    const ctx = buildUncContext(bigState());
    const over: string[] = [];
    walk(ctx, "", (p, v) => {
      if (!Array.isArray(v)) return;
      const cap = p === "routines.active" ? 40 : p === "connectors" ? 16 : 10;
      if (v.length > cap) over.push(`${p}=${v.length}`);
    });
    expect(over).toEqual([]);
  });

  it("routines.activeCount is the true count even when routines.active is truncated", () => {
    const routineOn: Record<string, boolean> = {};
    const ctx0 = buildUncContext(initialState);
    // switch on the whole library
    for (let i = 0; i < ctx0.routines.libraryTotal; i++) routineOn[`__unknown_${i}`] = true;
    const ctx = buildUncContext({ ...initialState, routineOn });
    expect(ctx.routines.activeCount).toBeLessThanOrEqual(ctx.routines.libraryTotal);
    expect(ctx.routines.active.length).toBeLessThanOrEqual(40);
  });

  it("the serialised demo context stays under 12 KB (it is ~7 KB today; growth is a prompt-cost decision)", () => {
    expect(JSON.stringify(buildUncContext(initialState)).length).toBeLessThan(12_000);
  });
});

describe("the numbers Unc is allowed to quote come from goalMath", () => {
  it("demo goal block", () => {
    expect(buildUncContext(initialState).goal).toEqual({
      title: "NZ$40,000 MRR",
      currency: "NZD",
      target: 40000,
      baseline: 28400,
      current: 31650,
      deadline: "2026-09-30",
      daysLeft: 30,
      pacePerDay: 171,
      neededPerDay: 278,
      projectedAtDeadline: 36782,
      gapAtDeadline: 3218,
      onTrack: false,
      progress: "28%",
      otherGoals: [],
    });
  });

  it("today is the demo clock and the rollout weeks match the plan generator", () => {
    const ctx = buildUncContext(initialState);
    expect(ctx.today).toBe("2026-08-31");
    expect(ctx.strategy.rolloutWeeks).toEqual({ total: 4, phase1: "Weeks 1–2", phase2: "Week 3", phase3: "Week 4+" });
    expect(ctx.strategy.channelRanking.map((c) => c.channel)).toEqual(["Content", "Email & SMS", "SEO", "Paid ads", "Sales"]);
  });

  it("otherGoals are the goal texts for every category after the first", () => {
    expect(buildUncContext(bigState()).goal.otherGoals).toEqual(["25k engaged followers", "40 qualified leads/mo"]);
  });

  it("approval status splits pending from actioned", () => {
    const ctx = buildUncContext(bigState());
    expect(ctx.approvalsPending.map((a) => a.status)).toEqual(["pending"]);
    expect(ctx.approvalsRecent.map((a) => a.status)).toEqual(["approved", "held"]);
  });

  it("routineEdits override a phase's routine list", () => {
    const ctx = buildUncContext({ ...initialState, routineEdits: { "brand.0": ["Only this one"] } });
    expect(ctx.strategy.phases[0].routines).toEqual(["Only this one"]);
    expect(ctx.strategy.phases[1].routines.length).toBeGreaterThan(0);
  });
});
