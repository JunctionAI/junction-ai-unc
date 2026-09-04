import { describe, expect, it } from "vitest";
import { DeterministicDecisionProvider } from "@/lib/runtime/providers";
import type { DecideNode, Decision, DecisionProvider, RunContext } from "@/lib/runtime/types";
import { staticPresetSource } from "../presets";
import { numbersAreGrounded, RulesDecisionProvider, verdictCounts, type ReasoningWriter } from "../rules/decision";
import { evaluateAdsets } from "../rules/meta";

const NODE: DecideNode = {
  kind: "decide",
  id: "decide",
  question: "Which ad set gets a change today?",
  options: [
    { id: "scale", label: "Scale {{reads.spend.top_adset_name}} by one budget step", params: { actionId: "meta.adset.set_daily_budget", adsetId: "{{reads.spend.top_adset_id}}", changePct: 20 } },
    { id: "turn_off", label: "Turn off the loser", params: { actionId: "meta.adset.pause", adsetId: "{{reads.spend.worst_ad_id}}" } },
    { id: "hold", label: "Hold budgets as they are", terminal: true },
  ],
  rule: { kind: "threshold", metric: "reads.spend.top_adset_roas", op: "gte", value: 2.5, ifTrue: "scale", ifFalse: "hold" },
};

const ROWS = [
  { adset_id: "120210000000001", adset_name: "Winner", spend: 420, purchases: 12, purchase_value: 1302, roas: 3.1, frequency: 1.8, ctr: 1.9, age_hours: 96, days_since_change: 3, streak_days: 3, measurement_clean: true },
  { adset_id: "120210000000002", adset_name: "Loser", spend: 260, purchases: 2, purchase_value: 180, roas: 0.69, frequency: 2.1, ctr: 1.1, age_hours: 96, days_since_change: 3, streak_days: 3, measurement_clean: true },
];
const ADSETS = [
  { id: "120210000000001", name: "Winner", daily_budget: 60 },
  { id: "120210000000002", name: "Loser", daily_budget: 40 },
];

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-1",
    routineId: "D02-W01",
    version: 1,
    mode: "dry_run",
    startedAt: "2026-09-03T07:00:00.000Z",
    account: { accountId: "acct-1", currency: "NZD", budgetMonthly: 3000 },
    caps: { currency: "NZD", perDay: 200, perMonth: 6000 },
    triggeredBy: "manual",
    vars: {},
    reads: {
      spend: { rows: ROWS, metrics: { top_adset_id: "120210000000001", top_adset_name: "Winner", top_adset_roas: 3.1 }, fetchedAt: "2026-09-03T07:00:00.000Z" },
      adsets: { rows: ADSETS, metrics: {}, fetchedAt: "2026-09-03T07:00:00.000Z" },
    },
    checks: {},
    ...overrides,
  };
}

class Recording implements DecisionProvider {
  calls = 0;
  async decide(node: DecideNode, c: RunContext): Promise<Decision> {
    this.calls++;
    return new DeterministicDecisionProvider().decide(node, c);
  }
}

describe("RulesDecisionProvider", () => {
  it("turns off the loser first (money protection) with the action params the execute node reads", async () => {
    const inner = new Recording();
    const p = new RulesDecisionProvider(inner);
    const d = await p.decide(NODE, ctx());
    expect(inner.calls).toBe(0);
    expect(d.optionId).toBe("turn_off");
    expect(d.label).toBe("Turn off Loser");
    expect(d.terminal).toBeUndefined();
    expect(d.spend).toBeUndefined();
    expect(d.params).toMatchObject({ actionId: "meta.adset.pause", adsetId: "120210000000002", verdict: "turn_off", ruleId: "turn_off_cpa", reasonCode: "cpa_over_cap", nextAction: null, adsetName: "Loser", preset: "dtc_general", evaluated: 2, counts: { scale: 1, turn_off: 1, hold: 0, keep: 0, not_enough_data: 0 } });
    expect(d.reasoning).toBe("Loser: CPA 130.00 is over the 70.00 cap. Across 2 ad sets: 1 to scale, 1 to turn off.");
    const table = d.params!.table as { adsetId: string; verdict: string; reasonCode: string }[];
    expect(table.map((t) => [t.adsetId, t.verdict, t.reasonCode])).toEqual([["…000001", "scale", "at_or_below_cap"], ["…000002", "turn_off", "cpa_over_cap"]]);
  });

  it("scales the winner with the budget step as spend (the increase) once nothing needs turning off", async () => {
    const c = ctx();
    c.reads.spend.rows = [ROWS[0]];
    const d = await new RulesDecisionProvider(new Recording()).decide(NODE, c);
    expect(d.optionId).toBe("scale");
    expect(d.label).toBe("Scale Winner: NZD 60.00 → NZD 72.00/day (+20%)");
    expect(d.spend).toEqual({ amount: 12, currency: "NZD", period: "day" });
    expect(d.params).toMatchObject({ actionId: "meta.adset.set_daily_budget", adsetId: "120210000000001", dailyBudget: 72, currentDailyBudget: 60 });
  });

  it("fails closed on live-shaped Meta rows that do not carry reconciliation or learning evidence", async () => {
    const c = ctx();
    c.reads.spend.rows = [{ adset_id: "120210000000001", adset_name: "Winner", spend: 420, purchases: 12, purchase_value: 1302, roas: 3.1, frequency: 1.8, ctr: 1.9 }];
    const d = await new RulesDecisionProvider(new Recording()).decide(NODE, c);
    expect(d.optionId).toBe("hold");
    expect(d.terminal).toBe(true);
    expect(d.params).toMatchObject({ verdict: "keep", evaluated: 1 });
    expect(d.params!.actionId).toBeUndefined();
    const table = d.params!.table as { verdict: string; rule: string; reasonCode: string; nextAction: string }[];
    expect(table[0]).toMatchObject({ verdict: "not_enough_data", rule: "age_not_read", reasonCode: "insufficient_or_initial_evidence", nextAction: "GATHER_EVIDENCE" });
  });

  it("holds (terminal option) when nothing proposes an action, and says why", async () => {
    const c = ctx();
    c.reads.spend.rows = [{ ...ROWS[0], spend: 30 }];
    const d = await new RulesDecisionProvider(new Recording()).decide(NODE, c);
    expect(d.optionId).toBe("hold");
    expect(d.terminal).toBe(true);
    expect(d.reasoning).toBe("No ad set needs a change today. Across 1 ad set: 1 with too little spend.");
    expect(d.params).toMatchObject({ verdict: "keep", ruleId: null, evaluated: 1 });
    expect(d.params!.actionId).toBeUndefined();
  });

  it("uses the account's preset through the source, routine-scoped", async () => {
    const seen: unknown[] = [];
    const presets = { getPreset: async (...args: unknown[]) => { seen.push(args); return { maxCpa: 200, targetCpa: 150 }; } };
    const d = await new RulesDecisionProvider(new Recording(), { presets }).decide(NODE, ctx());
    expect(seen).toEqual([["acct-1", "meta", "D02-W01"]]);
    // Loser's CPA 130 is inside a 150–200 band (ROAS under floor → hold), so the winner scales.
    expect(d.optionId).toBe("scale");
    expect(d.params).toMatchObject({ actionId: "meta.adset.set_daily_budget", adsetId: "120210000000001" });
  });

  it("overlays only allowlisted finite nonnegative values from the promoted node policy", async () => {
    const node: DecideNode = {
      ...NODE,
      policy: {
        kind: "meta.adset",
        preset: { targetCpa: 150, maxCpa: 100, scaleStepPct: 50 },
      },
    };
    const c = ctx();
    c.reads.spend.rows = [ROWS[0]];
    const d = await new RulesDecisionProvider(new Recording(), { presets: staticPresetSource({ targetCpa: 40, maxCpa: 70 }) }).decide(node, c);
    // target 150 / max 100 is repaired to a coherent 150 / 150 band. The 50% policy step is
    // still bounded by the non-overridable account/default maxBudgetChangePct of 25%.
    expect(d.optionId).toBe("scale");
    expect(d.params).toMatchObject({ dailyBudget: 75 });
    expect(d.label).toContain("(+25%)");

    const malformed = {
      ...NODE,
      policy: { kind: "meta.adset", preset: { targetCpa: "150", maxCpa: -1, roasFloor: Number.POSITIVE_INFINITY, maxBudgetChangePct: 500 } },
    } as unknown as DecideNode;
    const rejected = await new RulesDecisionProvider(new Recording(), { presets: staticPresetSource({ targetCpa: 40, maxCpa: 70 }) }).decide(malformed, ctx());
    expect(rejected.optionId).toBe("turn_off");
  });

  it("a policy dailyBudgetCap tightens but can never widen the account cap", async () => {
    const c = ctx();
    c.reads.spend.rows = [ROWS[0]]; // 60/day -> 72/day
    const policyCap: DecideNode = { ...NODE, policy: { kind: "meta.adset", dailyBudgetCap: 70 } };
    const byPolicy = await new RulesDecisionProvider(new Recording()).decide(policyCap, c);
    expect(byPolicy.optionId).toBe("hold");
    expect((byPolicy.params!.table as { reasonCode: string }[])[0].reasonCode).toBe("account_daily_budget_ceiling");

    const widerPolicy: DecideNode = { ...NODE, policy: { kind: "meta.adset", dailyBudgetCap: 500 } };
    const byAccount = await new RulesDecisionProvider(new Recording()).decide(widerPolicy, ctx({ caps: { currency: "NZD", perDay: 70, perMonth: 3000 }, reads: c.reads }));
    expect(byAccount.optionId).toBe("hold");
  });

  it("caps.perDay is the account budget ceiling: a scale that breaks it becomes a hold", async () => {
    // Winner alone: 60/day now, 72/day proposed — over a 70/day account ceiling.
    const c = ctx({ caps: { currency: "NZD", perDay: 70, perMonth: 3000 } });
    c.reads.spend.rows = [ROWS[0]];
    const d = await new RulesDecisionProvider(new Recording(), { presets: staticPresetSource(null) }).decide(NODE, c);
    expect(d.optionId).toBe("hold");
    const table = d.params!.table as { reasonCode: string; nextAction: string }[];
    expect(table[0]).toMatchObject({ reasonCode: "account_daily_budget_ceiling", nextAction: "REVIEW_BUDGET_CEILING" });
  });

  it("delegates to the inner provider for unbound routines and for decide nodes without typed actions", async () => {
    const inner = new Recording();
    const p = new RulesDecisionProvider(inner);
    await p.decide(NODE, ctx({ routineId: "D05-W02" }));
    expect(inner.calls).toBe(1);
    const untyped: DecideNode = { ...NODE, options: [{ id: "scale", label: "Move 20%" }, { id: "hold", label: "Hold", terminal: true }] };
    await p.decide(untyped, ctx());
    expect(inner.calls).toBe(2);
  });

  it("the LLM only writes the line — accepted when grounded, replaced when it invents a number or fails", async () => {
    const c = ctx();
    const grounded: ReasoningWriter = { complete: async () => "Loser is costing NZD 130.00 per purchase against a 70.00 cap, so I turn it off today." };
    let d = await new RulesDecisionProvider(new Recording(), { writer: grounded }).decide(NODE, c);
    expect(d.reasoning).toBe("Loser is costing NZD 130.00 per purchase against a 70.00 cap, so I turn it off today.");
    expect(d.optionId).toBe("turn_off");
    const invented: ReasoningWriter = { complete: async () => "Loser is at NZD 145 CPA — off it goes." };
    d = await new RulesDecisionProvider(new Recording(), { writer: invented }).decide(NODE, c);
    expect(d.reasoning).toBe("Loser: CPA 130.00 is over the 70.00 cap. Across 2 ad sets: 1 to scale, 1 to turn off.");
    const failing: ReasoningWriter = { complete: async () => { throw new Error("boom"); } };
    d = await new RulesDecisionProvider(new Recording(), { writer: failing }).decide(NODE, c);
    expect(d.reasoning).toContain("Loser: CPA 130.00");
    const json: ReasoningWriter = { complete: async () => '{"optionId":"scale"}' };
    d = await new RulesDecisionProvider(new Recording(), { writer: json }).decide(NODE, c);
    expect(d.optionId).toBe("turn_off");
    expect(d.reasoning).toContain("Loser: CPA 130.00");
  });
});

describe("numbersAreGrounded", () => {
  it("accepts numbers present in the evidence in any common rounding", () => {
    const ev = { cpa: 130, spend: 260.5, counts: { scale: 1 }, adsetId: "120210000000002" };
    expect(numbersAreGrounded("CPA 130.00 on 260.50 spend, 1 to scale", ev)).toBe(true);
    expect(numbersAreGrounded("CPA 130 on 260.5 spend", ev)).toBe(true);
    expect(numbersAreGrounded("CPA 131 on 260.5 spend", ev)).toBe(false);
    expect(numbersAreGrounded("no numbers here", ev)).toBe(true);
  });
});

describe("verdictCounts", () => {
  it("renders the honest tally", () => {
    const a = evaluateAdsets([], {});
    expect(verdictCounts(a)).toBe("no ad sets");
  });
});
