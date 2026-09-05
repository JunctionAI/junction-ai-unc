import { describe, expect, it } from "vitest";
import { META_BUDGET_CONTRACT, metaBudgetMetrics, metaBudgetMinorUnits } from "../metaBudgets";

const active = (id: string, daily_budget: unknown = 10, extra = {}) => ({ id, name: id, status: "ACTIVE", effective_status: "ACTIVE", daily_budget, lifetime_budget: 0, ...extra });

describe("Meta budget contract v2", () => {
  it("excludes paused/campaign-paused/issues budgets and the old ineligible largest target", () => {
    const rows = [active("paused", 73.17, { status: "PAUSED", effective_status: "PAUSED" }),
      active("parent-paused", 62.89, { effective_status: "CAMPAIGN_PAUSED" }),
      active("issues", 5, { status: "PAUSED", effective_status: "WITH_ISSUES" }), active("a", 10), active("b", 22.61)];
    expect(metaBudgetMetrics("adsets", rows)).toMatchObject({ budget_metric_contract: META_BUDGET_CONTRACT,
      budget_scope: "active_adset_daily_configurations", active_count: 2, active_daily_budget_count: 2,
      active_daily_budget_total: 32.61, daily_budget_total: null, projected_daily_spend: null,
      largest_adset_id: "b", largest_daily_budget: 22.61 });
  });
  it("keeps lifetime allocations separate rather than inventing a daily conversion", () => {
    expect(metaBudgetMetrics("campaigns", [active("daily", 100), active("lifetime", 0, { lifetime_budget: 2500 })])).toMatchObject({
      budget_scope: "active_campaign_daily_configurations", active_daily_budget_total: 100,
      active_daily_budget_count: 1, active_lifetime_budget_count: 1, active_unknown_budget_count: 0, daily_budget_total: null });
  });
  it("does not assume an absent or zero ad-set allocation means zero account spend", () => {
    for (const daily of [undefined, 0]) expect(metaBudgetMetrics("adsets", [{ ...active("owned-elsewhere"), daily_budget: daily }])).toMatchObject({
      active_unknown_budget_count: 1, active_daily_budget_total: null, largest_adset_id: null, largest_daily_budget: null });
  });
  it.each([null, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER, "20", true, {}])("keeps malformed normalized amount %j unknown", value => {
    expect(metaBudgetMetrics("adsets", [active("bad", value), active("good", 10)])).toMatchObject({
      active_daily_budget_total: null, active_unknown_budget_count: 1, largest_adset_id: null });
  });
  it("refuses an aggregate beyond safe minor-unit precision", () => {
    expect(metaBudgetMetrics("adsets", [active("a", 50_000_000_000_000), active("b", 50_000_000_000_000)])).toMatchObject({ active_daily_budget_total: null, largest_adset_id: null });
  });
  it("does not choose a target when budget mode conflicts", () => {
    expect(metaBudgetMetrics("adsets", [active("both", 10, { lifetime_budget: 300 })])).toMatchObject({ active_daily_budget_total: null, largest_adset_id: null });
  });
  it.each([undefined, "UNKNOWN", "FUTURE_STATUS"])("does not infer activity from configured ACTIVE with effective status %j", effective_status => {
    expect(metaBudgetMetrics("adsets", [active("a", 10, { effective_status })])).toMatchObject({ unknown_status_count: 1, active_daily_budget_total: null, largest_adset_id: null });
  });
  it("refuses conflicting configured/effective state", () => {
    expect(metaBudgetMetrics("adsets", [active("a", 10, { status: "PAUSED" })])).toMatchObject({ unknown_status_count: 1, largest_adset_id: null });
  });
  it("does not double-count duplicate or unidentified objects", () => {
    for (const row of [active("a"), active("")]) expect(metaBudgetMetrics("adsets", [active("a"), row])).toMatchObject({ identity_issue_count: 1, active_daily_budget_total: null, largest_adset_id: null });
  });
  it("represents an empty complete listing without inventing an action target", () => {
    expect(metaBudgetMetrics("adsets", [])).toMatchObject({ active_daily_budget_total: 0, count: 0, largest_adset_id: null, daily_budget_total: null });
  });
  it("has stable tie-breaking independent of provider order", () => {
    expect(metaBudgetMetrics("adsets", [active("b"), active("a")]).largest_adset_id).toBe("a");
    expect(metaBudgetMetrics("adsets", [active("a"), active("b")]).largest_adset_id).toBe("a");
  });
});

describe("raw minor unit validation", () => {
  it.each([["2261", 22.61], [1000, 10], ["0", 0]])("converts %j once", (input, output) => expect(metaBudgetMinorUnits(input)).toBe(output));
  it.each([null, undefined, "", "bad", "1.5", "-1", "1e3", "0x10", " 100 ", true, {}, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("does not convert malformed %j to zero", input => expect(metaBudgetMinorUnits(input)).toBeNull());
});
