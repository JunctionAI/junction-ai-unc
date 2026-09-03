import { describe, expect, it } from "vitest";
import { adPause, adRotate, adsetPause, adsetSetDailyBudget, budgetGuards, campaignCreateFromBrief, creativeUploadImageFromUrl, readPerformance, resolveTargetBudget } from "../meta/actions";
import { withPresetDefaults } from "../presets";
import { ctx } from "./helpers";

const codes = (v: { code: string }[]) => v.map((x) => x.code);

describe("budget guards", () => {
  it("passes a bounded, in-cap step", () => {
    expect(budgetGuards(72, 60, ctx())).toEqual([]);
  });
  it("blocks over the per-day cap", () => {
    expect(codes(budgetGuards(120, 100, ctx()))).toEqual(["cap_per_day", "cap_per_month"]);
  });
  it("blocks over the per-month cap even when inside the day cap", () => {
    expect(codes(budgetGuards(90, 80, ctx({ caps: { currency: "NZD", perDay: 100, perMonth: 2000 } })))).toEqual(["cap_per_month"]);
  });
  it("blocks a step over the preset's change bound (25% default)", () => {
    const v = budgetGuards(80, 60, ctx());
    expect(codes(v)).toEqual(["step_limit"]);
    expect(v[0]).toMatchObject({ limit: 25, actual: 33.3 });
  });
  it("bounds cuts the same way", () => {
    expect(codes(budgetGuards(40, 60, ctx()))).toEqual(["step_limit"]);
    expect(budgetGuards(45, 60, ctx())).toEqual([]);
  });
  it("uses the account preset's bound", () => {
    const tight = withPresetDefaults({ maxBudgetChangePct: 10 });
    expect(codes(budgetGuards(72, 60, ctx({ preset: tight })))).toEqual(["step_limit"]);
    expect(budgetGuards(66, 60, ctx({ preset: tight }))).toEqual([]);
  });
  it("blocks an increase above the taste ceiling (delta, not the new budget)", () => {
    const v = budgetGuards(72, 60, ctx({ spendCeiling: 10 }));
    expect(codes(v)).toEqual(["taste_ceiling"]);
    expect(v[0].message).toContain("+NZD 12.00/day");
    expect(budgetGuards(72, 60, ctx({ spendCeiling: 12 }))).toEqual([]);
    expect(budgetGuards(50, 60, ctx({ spendCeiling: 1 }))).toEqual([]); // a cut never hits the ceiling
  });
  it("needs the current budget to bound the change", () => {
    expect(codes(budgetGuards(72, undefined, ctx()))).toEqual(["missing_param"]);
    expect(codes(budgetGuards(72, "", ctx()))).toEqual(["missing_param"]);
  });
  it("rejects nothing, zero and non-numbers", () => {
    expect(codes(budgetGuards(undefined, 60, ctx()))).toEqual(["missing_param"]);
    expect(codes(budgetGuards("abc", 60, ctx()))).toEqual(["missing_param"]);
    expect(codes(budgetGuards(0, 60, ctx()))).toContain("invalid_param");
  });
});

describe("resolveTargetBudget", () => {
  it("prefers an explicit dailyBudget, else applies changePct to the current budget", () => {
    expect(resolveTargetBudget({ dailyBudget: 72, changePct: 50, currentDailyBudget: 60 })).toBe(72);
    expect(resolveTargetBudget({ changePct: 20, currentDailyBudget: 60 })).toBe(72);
    expect(resolveTargetBudget({ changePct: -25, currentDailyBudget: 60 })).toBe(45);
    expect(resolveTargetBudget({ dailyBudget: "" as unknown as number, changePct: "" as unknown as number, currentDailyBudget: 60 })).toBeNull();
    expect(resolveTargetBudget({ changePct: 20, currentDailyBudget: 0 })).toBeNull();
  });
});

describe("meta.adset.set_daily_budget guards", () => {
  it("needs a Meta id and a bounded budget", () => {
    expect(codes(adsetSetDailyBudget.guards({ adsetId: "as-1", dailyBudget: 72, currentDailyBudget: 60 }, ctx()))).toEqual(["invalid_param"]);
    expect(codes(adsetSetDailyBudget.guards({ adsetId: "", dailyBudget: 72, currentDailyBudget: 60 }, ctx()))).toEqual(["missing_param"]);
    expect(adsetSetDailyBudget.guards({ adsetId: "120210000000001", dailyBudget: 72, currentDailyBudget: 60 }, ctx())).toEqual([]);
    expect(adsetSetDailyBudget.guards({ adsetId: "120210000000001", changePct: 20, currentDailyBudget: 60 }, ctx())).toEqual([]);
  });
});

describe("status guards", () => {
  it("pause/resume/rotate need Meta ids", () => {
    expect(codes(adsetPause.guards({}, ctx()))).toEqual(["missing_param"]);
    expect(codes(adPause.guards({ adId: "ad-9" }, ctx()))).toEqual(["invalid_param"]);
    expect(adPause.guards({ adId: "120210000000009" }, ctx())).toEqual([]);
    expect(codes(adRotate.guards({ pauseAdId: "120210000000009", resumeAdId: "120210000000009" }, ctx()))).toEqual(["invalid_param"]);
    expect(adRotate.guards({ pauseAdId: "120210000000009", resumeAdId: "120210000000010" }, ctx())).toEqual([]);
  });
});

describe("meta.campaign.create_from_brief guards", () => {
  const good = { name: "Creative test", objective: "OUTCOME_SALES" as const, dailyBudget: 30, audience: { countries: ["NZ", "AU"] }, creatives: [{ creativeId: "120210000000099" }], pixelId: "123456789012345" };
  it("passes a complete brief", () => {
    expect(campaignCreateFromBrief.guards(good, ctx())).toEqual([]);
  });
  it("flags every missing piece honestly", () => {
    const v = campaignCreateFromBrief.guards({ name: "", objective: "SALES" as never, dailyBudget: 0, audience: { countries: [] }, creatives: [] }, ctx());
    expect(codes(v)).toEqual(["missing_param", "invalid_param", "missing_param", "missing_param", "missing_param"]);
    expect(v.map((x) => x.param)).toEqual(["name", "objective", "dailyBudget", "audience.countries", "creatives"]);
  });
  it("blocks the budget by cap and ceiling", () => {
    expect(codes(campaignCreateFromBrief.guards({ ...good, dailyBudget: 150 }, ctx()))).toEqual(["cap_per_day"]);
    expect(codes(campaignCreateFromBrief.guards({ ...good, dailyBudget: 30 }, ctx({ spendCeiling: 20 })))).toEqual(["taste_ceiling"]);
  });
  it("sales without a pixel cannot optimise for conversions", () => {
    expect(codes(campaignCreateFromBrief.guards({ ...good, pixelId: undefined }, ctx()))).toEqual(["missing_param"]);
    expect(campaignCreateFromBrief.guards({ ...good, pixelId: undefined, optimizationGoal: "LINK_CLICKS" }, ctx())).toEqual([]);
    expect(campaignCreateFromBrief.guards({ ...good, objective: "OUTCOME_TRAFFIC", pixelId: undefined }, ctx())).toEqual([]);
  });
  it("accepts template-shaped inputs: countries as a string, creatives as reader rows or one ref", () => {
    expect(campaignCreateFromBrief.guards({ ...good, audience: { countries: "NZ, AU" as never } }, ctx())).toEqual([]);
    expect(campaignCreateFromBrief.guards({ ...good, creatives: [{ ad_id: "ad-9", creative_id: "cr-9" }] as never }, ctx())).toEqual([]);
    expect(campaignCreateFromBrief.guards({ ...good, creatives: { instagramMediaId: "17900000000000001" } as never }, ctx())).toEqual([]);
    expect(codes(campaignCreateFromBrief.guards({ ...good, audience: { countries: "nzl" as never } }, ctx()))).toEqual(["invalid_param"]);
    expect(codes(campaignCreateFromBrief.guards({ ...good, audience: { countries: ["NZ"], ageMin: 12 } }, ctx()))).toEqual(["invalid_param"]);
  });
});

describe("other guards", () => {
  it("upload needs an https URL", () => {
    expect(codes(creativeUploadImageFromUrl.guards({ imageUrl: "http://x.com/a.jpg" }, ctx()))).toEqual(["invalid_param"]);
    expect(codes(creativeUploadImageFromUrl.guards({ imageUrl: "not a url" }, ctx()))).toEqual(["invalid_param"]);
    expect(creativeUploadImageFromUrl.guards({ imageUrl: "https://x.com/a.jpg" }, ctx())).toEqual([]);
  });
  it("read_performance validates level, preset and dates", () => {
    expect(readPerformance.guards({}, ctx())).toEqual([]);
    expect(codes(readPerformance.guards({ level: "account" as never }, ctx()))).toEqual(["invalid_param"]);
    expect(codes(readPerformance.guards({ datePreset: "last_year" as never }, ctx()))).toEqual(["invalid_param"]);
    expect(codes(readPerformance.guards({ since: "2026-09-01" }, ctx()))).toEqual(["invalid_param"]);
    expect(codes(readPerformance.guards({ since: "1/9/2026", until: "2026-09-03" }, ctx()))).toEqual(["invalid_param"]);
  });
});
