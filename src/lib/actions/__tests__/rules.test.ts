/* The hold / scale / turn-off table. Every case: metrics + preset → verdict, rule, reason code,
   next action, proposal. Deterministic, so the whole table is one data structure. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { catalogSpec } from "@/lib/runtime/catalog-specs";
import { getRoutinePreset, presetSource, setAccountPreset, setPresetDbForTests, setRoutineParams, toActionsMetaPreset } from "@/lib/runtime/presets/store";
import { DEFAULT_META_PRESET, INDUSTRY_META_PRESETS, resolveMetaPreset, withPresetDefaults, type MetaPreset } from "../presets";
import { adsetMetricsFromRow, cpaCaps, ctrDropPct, evaluateAdset, evaluateAdsets, scaledBudget, type AdsetMetrics, type NextAction, type ReasonCode, type Verdict } from "../rules/meta";

const base: AdsetMetrics = { adsetId: "120210000000001", adsetName: "Prospecting NZ", spend: 420, purchases: 12, purchaseValue: 1302, cpa: 35, roas: 3.1, frequency: 1.8, ctr: 1.9, dailyBudget: 60 };
const m = (o: Partial<AdsetMetrics>): AdsetMetrics => ({ ...base, ...o });
const P = DEFAULT_META_PRESET; // target 40, max 70, roas floor 2, min spend 100, fatigue 4 / 30%, step 20 (max 25), hold 3d, price cap 50%, age 48h, streak 3d

interface Case {
  name: string;
  metrics: AdsetMetrics;
  preset?: Partial<MetaPreset>;
  verdict: Verdict;
  rule: string;
  code: ReasonCode;
  next: NextAction | null;
  action?: { actionId: string; params: Record<string, unknown> } | null;
}

const CASES: Case[] = [
  // evidence gates
  { name: "spend under the minimum → not enough data", metrics: m({ spend: 60, purchases: 1, cpa: 60 }), verdict: "not_enough_data", rule: "not_enough_spend", code: "insufficient_or_initial_evidence", next: "GATHER_EVIDENCE", action: null },
  { name: "exactly the minimum spend is judged", metrics: m({ spend: 100, purchases: 3, cpa: 33.33 }), verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
  { name: "younger than 48h → not enough data (even with great numbers)", metrics: m({ ageHours: 20 }), verdict: "not_enough_data", rule: "too_young", code: "insufficient_or_initial_evidence", next: "GATHER_EVIDENCE", action: null },
  { name: "age gate off in the preset → judged", metrics: m({ ageHours: 20 }), preset: { minAgeHours: 0 }, verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
  { name: "price policy applies but the price is unmapped → hold pending_product_price", metrics: m({ productPrice: null }), verdict: "hold", rule: "pending_product_price", code: "pending_product_price", next: "RESOLVE_PRODUCT_PRICE_MAPPING", action: null },
  { name: "price policy switched off → unmapped price is ignored", metrics: m({ productPrice: null }), preset: { cpaCapFromProductPricePct: 0 }, verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
  // money protection
  { name: "no purchases past the cap → turn off", metrics: m({ spend: 150, purchases: 0, purchaseValue: 0, cpa: null, roas: 0 }), verdict: "turn_off", rule: "turn_off_no_results", code: "no_results_over_cap", next: null, action: { actionId: "meta.adset.pause", params: { adsetId: "120210000000001", reason: "no purchases past the CPA cap" } } },
  { name: "no purchases but spend still under the cap → not judged as off (in band)", metrics: m({ spend: 100, purchases: 0, purchaseValue: 0, cpa: null, roas: 0 }), preset: { roasFloor: 0, maxCpa: 150 }, verdict: "keep", rule: "keep_in_band", code: "in_band", next: null, action: null },
  { name: "CPA over max → turn off", metrics: m({ purchases: 5, cpa: 84, roas: 1.5 }), verdict: "turn_off", rule: "turn_off_cpa", code: "cpa_over_cap", next: null, action: { actionId: "meta.adset.pause", params: { adsetId: "120210000000001", reason: "CPA over the cap" } } },
  { name: "CPA exactly at max is not over", metrics: m({ purchases: 6, cpa: 70, roas: 2.2 }), verdict: "keep", rule: "keep_in_band", code: "in_band", next: null, action: null },
  { name: "ROAS under floor with CPA over target → turn off", metrics: m({ purchases: 8, cpa: 52.5, roas: 1.6 }), verdict: "turn_off", rule: "turn_off_roas", code: "roas_under_floor", next: null, action: { actionId: "meta.adset.pause", params: { adsetId: "120210000000001", reason: "ROAS under floor and CPA over target" } } },
  { name: "ROAS under floor but CPA under target → hold, mixed signal", metrics: m({ cpa: 35, roas: 1.6 }), verdict: "hold", rule: "hold_roas_under_floor", code: "roas_under_floor", next: "GATHER_EVIDENCE", action: null },
  { name: "would be OFF but measurement is unclean → soft OFF blocked", metrics: m({ purchases: 5, cpa: 84, roas: 1.5, measurementClean: false }), verdict: "hold", rule: "soft_off_blocked", code: "soft_off_blocked_unclean_measurement", next: "REPAIR_MEASUREMENT", action: null },
  { name: "unclean measurement never blocks a scale", metrics: m({ measurementClean: false }), verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
  { name: "product price 120 → cap 60: CPA 62 is off", metrics: m({ purchases: 5, cpa: 62, roas: 2.5, productPrice: 120 }), verdict: "turn_off", rule: "turn_off_cpa", code: "cpa_over_cap", next: null },
  { name: "product price 120 → cap 60: CPA 58 scales (target from preset would have held)", metrics: m({ purchases: 5, cpa: 58, roas: 2.5, productPrice: 120 }), verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
  // reasons not to scale
  { name: "frequency at the fatigue line → hold, refresh creative", metrics: m({ frequency: 4.0 }), verdict: "hold", rule: "hold_fatigue_frequency", code: "fatigue_frequency", next: "REFRESH_CREATIVE", action: null },
  { name: "CTR down 30% from baseline → hold, refresh creative", metrics: m({ ctr: 1.4, ctrBaseline: 2.0 }), verdict: "hold", rule: "hold_fatigue_ctr", code: "fatigue_ctr", next: "REFRESH_CREATIVE", action: null },
  { name: "CTR down 20% is not fatigue", metrics: m({ ctr: 1.6, ctrBaseline: 2.0 }), verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
  { name: "changed 2 days ago → learning hold", metrics: m({ daysSinceLastChange: 2 }), verdict: "hold", rule: "hold_recent_change", code: "learning_hold", next: "GATHER_EVIDENCE", action: null },
  { name: "changed 3 days ago → out of the learning hold", metrics: m({ daysSinceLastChange: 3 }), verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
  { name: "at/under cap for only 2 of 3 days → pending streak", metrics: m({ daysAtOrBelowCapStreak: 2 }), verdict: "hold", rule: "hold_pending_streak", code: "pending_3d_scale_streak", next: "GATHER_EVIDENCE", action: null },
  { name: "3-day streak → scale", metrics: m({ daysAtOrBelowCapStreak: 3 }), verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
  { name: "streak not measured → scale on the window (says so)", metrics: m({}), verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null, action: { actionId: "meta.adset.set_daily_budget", params: { adsetId: "120210000000001", dailyBudget: 72, currentDailyBudget: 60, reason: "CPA 35.00 at/under the 40.00 line" } } },
  { name: "under target but budget not read → hold, read budget", metrics: m({ dailyBudget: null }), verdict: "hold", rule: "scale_no_budget", code: "budget_not_read", next: "READ_BUDGET", action: null },
  { name: "between target and max → keep", metrics: m({ purchases: 8, cpa: 52.5, roas: 2.4 }), verdict: "keep", rule: "keep_in_band", code: "in_band", next: null, action: null },
  { name: "premium preset: CPA 150 is under a 120 target? no — in band up to 220", metrics: m({ spend: 900, purchases: 6, cpa: 150, roas: 2.8 }), preset: INDUSTRY_META_PRESETS.dtc_premium, verdict: "keep", rule: "keep_in_band", code: "in_band", next: null },
  { name: "premium preset: 15% step bounded by its 20% max", metrics: m({ spend: 900, purchases: 9, cpa: 100, roas: 3.2, dailyBudget: 100 }), preset: INDUSTRY_META_PRESETS.dtc_premium, verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null, action: { actionId: "meta.adset.set_daily_budget", params: { adsetId: "120210000000001", dailyBudget: 115, currentDailyBudget: 100, reason: "CPA 100.00 at/under the 120.00 line" } } },
  { name: "lead-gen preset (no ROAS floor): CPA under target scales with ROAS 0", metrics: m({ purchases: 20, cpa: 21, roas: 0, purchaseValue: 0 }), preset: INDUSTRY_META_PRESETS.lead_gen_services, verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
  { name: "stringy reader numbers are coerced", metrics: m({ spend: "420" as unknown as number, purchases: "12" as unknown as number, cpa: undefined as unknown as null, roas: "3.1" as unknown as number }), verdict: "scale", rule: "scale", code: "at_or_below_cap", next: null },
];

describe("evaluateAdset table", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const e = evaluateAdset(c.metrics, c.preset ?? P);
      expect({ verdict: e.verdict, rule: e.ruleId, code: e.reasonCode, next: e.nextAction }).toEqual({ verdict: c.verdict, rule: c.rule, code: c.code, next: c.next });
      if (c.action !== undefined) expect(e.proposedAction).toEqual(c.action);
      if (c.verdict === "scale") expect(e.proposedAction?.actionId).toBe("meta.adset.set_daily_budget");
      if (c.verdict === "turn_off") expect(e.proposedAction?.actionId).toBe("meta.adset.pause");
      if (c.verdict === "hold" || c.verdict === "keep" || c.verdict === "not_enough_data") expect(e.proposedAction).toBeNull();
      expect(e.reason.length).toBeGreaterThan(10);
      expect(e.evidence.scaleLine).toBe(e.caps.scaleLine);
    });
  }
  it("covers at least 20 cases and every reason code", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    const codes = new Set(CASES.map((c) => c.code));
    for (const code of ["insufficient_or_initial_evidence", "pending_3d_scale_streak", "pending_product_price", "soft_off_blocked_unclean_measurement", "cpa_over_cap", "no_results_over_cap", "roas_under_floor", "fatigue_frequency", "fatigue_ctr", "learning_hold", "budget_not_read", "at_or_below_cap", "in_band"]) expect(codes.has(code as ReasonCode), code).toBe(true);
  });
  it("is deterministic", () => {
    const a = evaluateAdset(base, P);
    const b = evaluateAdset({ ...base }, { ...P });
    expect(a).toEqual(b);
  });
});

describe("helpers", () => {
  it("scaledBudget steps by the preset, bounded, to cents", () => {
    expect(scaledBudget(60, P)).toBe(72);
    expect(scaledBudget(33.33, withPresetDefaults({ scaleStepPct: 30 }))).toBe(41.66); // bounded to 25%
    expect(scaledBudget(100, INDUSTRY_META_PRESETS.dtc_premium)).toBe(115);
  });
  it("cpaCaps: product price wins when mapped and the policy is on", () => {
    expect(cpaCaps(base, P)).toEqual({ scaleLine: 40, offLine: 70, source: "preset" });
    expect(cpaCaps({ ...base, productPrice: 120 }, P)).toEqual({ scaleLine: 60, offLine: 60, source: "product_price" });
    expect(cpaCaps({ ...base, productPrice: 120 }, withPresetDefaults({ cpaCapFromProductPricePct: 0 })).source).toBe("preset");
    expect(cpaCaps({ ...base, productPrice: 0 }, P).source).toBe("preset");
  });
  it("ctrDropPct needs a baseline", () => {
    expect(ctrDropPct(base)).toBeNull();
    expect(ctrDropPct({ ...base, ctr: 1.5, ctrBaseline: 2 })).toBe(25);
  });
  it("adsetMetricsFromRow reads reader rows, budgets and the evidence fields", () => {
    const budgets = new Map([["120210000000001", 80]]);
    const r = adsetMetricsFromRow({ adset_id: "120210000000001", adset_name: "P", spend: "420", purchases: 12, purchase_value: "1302", roas: 3.1, frequency: "1.8", ctr: 1.9, age_hours: 96, streak_days: 3, measurement_clean: true, product_price: 120 }, budgets);
    expect(r).toMatchObject({ adsetId: "120210000000001", adsetName: "P", spend: 420, purchases: 12, purchaseValue: 1302, cpa: 35, roas: 3.1, frequency: 1.8, ctr: 1.9, dailyBudget: 80, ageHours: 96, daysAtOrBelowCapStreak: 3, measurementClean: true, productPrice: 120 });
    const camel = adsetMetricsFromRow({ id: "1", name: "x", spend: 10, purchases: 0, roas: 0, dailyBudget: 25 });
    expect(camel).toMatchObject({ adsetId: "1", cpa: null, dailyBudget: 25, ageHours: null, daysAtOrBelowCapStreak: null, measurementClean: null });
    expect("productPrice" in camel).toBe(false);
  });
});

describe("evaluateAdsets — the account pick", () => {
  const winner = m({ adsetId: "120210000000001", adsetName: "Winner", spend: 300 });
  const loser = m({ adsetId: "120210000000002", adsetName: "Loser", spend: 200, purchases: 2, cpa: 100, roas: 0.8, dailyBudget: 40 });
  const bigLoser = m({ adsetId: "120210000000003", adsetName: "Big loser", spend: 500, purchases: 4, cpa: 125, roas: 0.7, dailyBudget: 90 });
  it("protects money first: the largest-spend turn_off beats a scale", () => {
    const a = evaluateAdsets([winner, loser, bigLoser], P);
    expect(a.counts).toEqual({ scale: 1, turn_off: 2, hold: 0, keep: 0, not_enough_data: 0 });
    expect(a.pick?.metrics.adsetName).toBe("Big loser");
    expect(a.pick?.proposedAction?.actionId).toBe("meta.adset.pause");
    expect(a.totalDailyBudget).toBe(190);
  });
  it("scales the winner when nothing needs turning off", () => {
    const a = evaluateAdsets([winner, m({ adsetId: "120210000000009", spend: 50 })], P);
    expect(a.pick?.metrics.adsetName).toBe("Winner");
    expect(a.pick?.proposedAction).toEqual({ actionId: "meta.adset.set_daily_budget", params: { adsetId: "120210000000001", dailyBudget: 72, currentDailyBudget: 60, reason: "CPA 35.00 at/under the 40.00 line" } });
  });
  it("account daily budget ceiling turns a scale into a hold with its own code", () => {
    const a = evaluateAdsets([winner, m({ adsetId: "120210000000005", spend: 80, dailyBudget: 50 })], P, { accountDailyBudgetCap: 120 });
    expect(a.totalDailyBudget).toBe(110);
    expect(a.pick).toBeNull();
    const w = a.evaluations[0];
    expect(w).toMatchObject({ verdict: "hold", ruleId: "account_budget_ceiling", reasonCode: "account_daily_budget_ceiling", nextAction: "REVIEW_BUDGET_CEILING", proposedAction: null });
    expect(w.reason).toContain("over the 120.00/day ceiling");
    expect(w.evidence).toMatchObject({ accountDailyBudgetCap: 120, totalDailyBudget: 110, proposedTotal: 122 });
    // a ceiling with room lets it through
    expect(evaluateAdsets([winner], P, { accountDailyBudgetCap: 200 }).pick?.verdict).toBe("scale");
  });
  it("nothing actionable → null pick with honest counts", () => {
    const a = evaluateAdsets([m({ spend: 20 }), m({ adsetId: "2", frequency: 5 })], P);
    expect(a.pick).toBeNull();
    expect(a.counts).toEqual({ scale: 0, turn_off: 0, hold: 1, keep: 0, not_enough_data: 1 });
  });
});

describe("presets", () => {
  it("defaults + coherence repairs", () => {
    expect(withPresetDefaults(null)).toEqual(DEFAULT_META_PRESET);
    expect(withPresetDefaults({ industry: "dtc_fashion" }).targetCpa).toBe(35);
    expect(withPresetDefaults({ targetCpa: 90, maxCpa: 50 })).toMatchObject({ targetCpa: 90, maxCpa: 90 });
    expect(withPresetDefaults({ scaleStepPct: 40 })).toMatchObject({ scaleStepPct: 25, maxBudgetChangePct: 25 });
    expect(withPresetDefaults({ targetCpa: -1, minAgeHours: 24 })).toMatchObject({ targetCpa: 40, minAgeHours: 24 });
    expect(withPresetDefaults({ industry: "nope" as never }).industry).toBe("dtc_general");
  });
  it("resolveMetaPreset survives a throwing or empty source", async () => {
    expect(await resolveMetaPreset("a", null)).toEqual(DEFAULT_META_PRESET);
    expect(await resolveMetaPreset("a", { getPreset: async () => { throw new Error("db down"); } })).toEqual(DEFAULT_META_PRESET);
    const seen: unknown[] = [];
    expect((await resolveMetaPreset("a", { getPreset: async (...args) => { seen.push(args); return { targetCpa: 33 }; } }, "D02-W01")).targetCpa).toBe(33);
    expect(seen).toEqual([["a", "meta", "D02-W01"]]);
  });
});

describe("a stored preset reaches the rules (src/lib/runtime/presets store)", () => {
  const ACCT = "00000000-0000-4000-8000-00000000acc1";
  let db: FakeSupabase;
  beforeEach(() => {
    db = new FakeSupabase();
    db.now = () => "2026-09-03T09:00:00.000Z";
    db.seed("accounts", [{ id: ACCT, name: "Deep Blue", currency: "NZD" }]);
    db.seed("business_profiles", [{ account_id: ACCT, profile: { name: "Deep Blue Health", category: "Natural supplements", businessType: "ecommerce", sells: "products", storefront: "shopify", products: ["Green lipped mussel"] } }]);
    db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 3000, gross_margin_pct: 60 }]);
  });
  afterEach(() => setPresetDbForTests(undefined));

  it("account_presets targetCpa flows through presetSource(db) into evaluateAdset", async () => {
    // Under the library default (target 40) CPA 35 scales; the founder's account preset says target 30 → it does not.
    await setAccountPreset(db, ACCT, "paid", { targetCpa: 30, maxCpa: 70 });
    const preset = await resolveMetaPreset(ACCT, presetSource(db), "D02-W01");
    expect(preset.targetCpa).toBe(30);
    expect(evaluateAdset(base, preset).verdict).not.toBe("scale");
    expect(evaluateAdset(base, DEFAULT_META_PRESET).verdict).toBe("scale");
  });

  it("routine_params targetCpa layers over the account and reaches evaluateAdset", async () => {
    await setAccountPreset(db, ACCT, "paid", { targetCpa: 30, maxCpa: 70 });
    const spec = catalogSpec("D02-W01");
    await setRoutineParams(db, ACCT, spec, { params: { targetCpa: 45 } });
    const view = (await getRoutinePreset(db, ACCT, spec))!;
    const routineScoped = withPresetDefaults(toActionsMetaPreset(view.set));
    expect(routineScoped.targetCpa).toBe(45);
    const e = evaluateAdset(m({ purchases: 10, cpa: 42, roas: 3 }), routineScoped);
    expect(e.verdict).toBe("scale");
    expect(e.caps.scaleLine).toBe(45);
    // the account-level source alone still says 30
    expect((await resolveMetaPreset(ACCT, presetSource(db), "D02-W01")).targetCpa).toBe(30);
  });
});
