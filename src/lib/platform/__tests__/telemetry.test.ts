/* Home ← telemetry mapping: DB mode reads published benchmarks / honest references and
   real hours; demo mode is untouched (derive()'s demo bar + 2.5 h × routines-on). */

import { describe, expect, it } from "vitest";
import { derive } from "../derive";
import { initialState } from "../state";
import { barCard, barCards, hoursSavedLabel, INDUSTRY_REFERENCE_NOTE, REFERENCE_BAR, weekLabel, type HomeTelemetry } from "../telemetry";

const tele = (over: Partial<HomeTelemetry> = {}): HomeTelemetry => ({
  review: null,
  segment: "all",
  bar: [
    { metricKey: "content_drafts_per_week", benchmark: null, own: null },
    { metricKey: "repeat_purchase_pct", benchmark: null, own: null },
    { metricKey: "lead_response_hours", benchmark: null, own: null },
  ],
  automation: { hoursSavedWk: 0, runsThisWeek: 0, routinesOn: 0 },
  ...over,
});

describe("demo mode (derive) is untouched", () => {
  it("the bar and the hours line carry the prototype's exact copy and numbers", () => {
    const V = derive(initialState, () => {});
    expect(V.homeBar.map((b) => [b.what, b.bar, b.status, b.fixLabel])).toEqual([
      ["Content output", "5 posts / week", "Below the bar", "Queue 2 more drafts / week"],
      ["Repeat purchase", "22% of customers", "Below the bar", "Switch on the flows"],
      ["Response speed", "< 4 h to leads", "At the bar ✓", undefined],
    ]);
    expect(V.homeBar[0].proof).toBe("What DTC brands at your target ship — you’re at 3. I’ll draft the extra two; you just okay them.");
    expect(V.gamHrs).toBe(Math.round(V.gamOnCount * 2.5));
    expect(typeof V.openCategory).toBe("function");
  });
});

describe("barCard (DB mode)", () => {
  it("a published Junction benchmark (n ≥ 5): the bar is the top quartile, proof cites n + median, status from the account's own value", () => {
    const c = barCard({ metricKey: "repeat_purchase_pct", benchmark: { p50: 15, p75: 19, n: 7, segment: "all", computedAt: "x" }, own: 14 });
    expect(c).toMatchObject({ what: "Repeat purchase", bar: "19% of customers", status: "Below the bar", behind: true, fixLabel: "Switch on the flows", fixCategory: "Email & SMS", source: "junction" });
    expect(c.proof).toBe("What the top quarter of 7 Junction accounts do — the median is 15%. You’re at 14%.");
    const ok = barCard({ metricKey: "repeat_purchase_pct", benchmark: { p50: 15, p75: 19, n: 7, segment: "shopify", computedAt: "x" }, own: 24 });
    expect(ok).toMatchObject({ status: "At the bar ✓", behind: false, fixLabel: undefined });
    expect(ok.proof).toContain("7 Junction accounts like yours (shopify)");
  });
  it("no benchmark yet: the industry reference number, labelled as such, never a demo 'you're at' number", () => {
    const c = barCard({ metricKey: "content_drafts_per_week", benchmark: null, own: null });
    expect(c).toMatchObject({ bar: "5 drafts / week", status: "Not measured yet", behind: false, fixLabel: undefined, source: "reference" });
    expect(c.proof).toBe(`${INDUSTRY_REFERENCE_NOTE} I haven’t measured yours yet.`);
    expect(c.proof).not.toMatch(/you’re at 3/i);
    const measured = barCard({ metricKey: "content_drafts_per_week", benchmark: null, own: 3 });
    expect(measured).toMatchObject({ status: "Below the bar", behind: true, fixLabel: "Queue more drafts / week", fixCategory: "Content" });
    expect(measured.proof).toBe(`${INDUSTRY_REFERENCE_NOTE} You’re at 3 drafts / week.`);
  });
  it("a benchmark under the floor is treated as absent (defence in depth)", () => {
    const c = barCard({ metricKey: "lead_response_hours", benchmark: { p50: 3, p75: 5, n: 4, segment: "all", computedAt: "x" }, own: 2.5 });
    expect(c).toMatchObject({ bar: "< 4 h to leads", source: "reference", status: "At the bar ✓" }); // lte: 2.5 ≤ 4
    expect(c.proof).toContain("You’re at 2.5 h.");
    expect(barCard({ metricKey: "lead_response_hours", benchmark: null, own: 9 })).toMatchObject({ status: "Below the bar", fixLabel: "Tighten the follow-up cadence", fixCategory: "Sales" });
  });
  it("barCards always yields the three Home cards in order, even from a short payload", () => {
    const cards = barCards(tele({ bar: [{ metricKey: "repeat_purchase_pct", benchmark: null, own: 30 }] }));
    expect(cards.map((c) => [c.what, c.status])).toEqual([
      ["Content output", "Not measured yet"],
      ["Repeat purchase", "At the bar ✓"],
      ["Response speed", "Not measured yet"],
    ]);
    expect(Object.keys(REFERENCE_BAR)).toEqual(["content_drafts_per_week", "repeat_purchase_pct", "lead_response_hours"]);
  });
});

describe("hoursSavedLabel / weekLabel", () => {
  it("shows measured hours (one decimal only when fractional)", () => {
    expect(hoursSavedLabel(tele({ automation: { hoursSavedWk: 4, runsThisWeek: 6, routinesOn: 3 } }))).toBe("4");
    expect(hoursSavedLabel(tele({ automation: { hoursSavedWk: 4.25, runsThisWeek: 6, routinesOn: 3 } }))).toBe("4.3");
    expect(hoursSavedLabel(tele())).toBe("0");
  });
  it("week label", () => {
    expect(weekLabel("2026-08-31")).toBe("Week of 31 Aug");
    expect(weekLabel("garbage")).toBe("garbage");
  });
});
