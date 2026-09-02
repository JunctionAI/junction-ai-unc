/* The anonymised benchmark feed: n < 5 suppressed, p50/p75 correct, segment split,
   opt-outs excluded, one value per account, fallback to "all". */

import { describe, expect, it } from "vitest";
import type { OutcomeRecord } from "../../runtime/store/interface";
import { ANONYMISATION_FLOOR, BAR_METRICS, barInputs, benchmarkFor, computeBenchmarks, latestActualsByMetric, percentile, revenueBand, type AccountBenchmarkRows } from "../benchmarks";

const NOW = () => new Date("2026-09-07T00:00:00.000Z");
const o = (accountId: string, kpiKey: string, actual: number | null, windowEnd = "2026-09-06T00:00:00.000Z", provenance = "ok"): OutcomeRecord => ({
  id: `${accountId}-${kpiKey}-${windowEnd}`,
  accountId,
  routineId: kpiKey === "repeat_purchase_pct" ? "D05-W01" : kpiKey === "content_drafts_per_week" ? "D01-W01" : "D04-W04",
  kpiKey,
  kpiTarget: 22,
  kpiOp: "gte",
  kpiActual: actual,
  provenance,
  windowStart: "2026-08-30T00:00:00.000Z",
  windowEnd,
  measuredAt: windowEnd,
});
const acct = (id: string, value: number, segments: string[] = [], optedIn = true): AccountBenchmarkRows => ({ accountId: id, optedIn, segments, outcomes: [o(id, "repeat_purchase_pct", value)] });

describe("percentile", () => {
  it("linear interpolation (numpy default)", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.75)).toBe(4);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0.75)).toBe(32.5);
    expect(percentile([7], 0.75)).toBe(7);
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });
});

describe("computeBenchmarks", () => {
  it("publishes nothing below the anonymisation floor (4 accounts → no row), a row at exactly 5", () => {
    expect(ANONYMISATION_FLOOR).toBe(5);
    const four = [acct("a", 10), acct("b", 12), acct("c", 14), acct("d", 16)];
    expect(computeBenchmarks(four, { now: NOW })).toEqual([]);
    const five = [...four, acct("e", 30)];
    expect(computeBenchmarks(five, { now: NOW })).toEqual([{ metricKey: "repeat_purchase_pct", segment: "all", p50: 14, p75: 16, n: 5, computedAt: "2026-09-07T00:00:00.000Z" }]);
  });

  it("opted-out accounts and unmeasured outcomes never contribute; a busy account counts once (its latest window)", () => {
    const rows: AccountBenchmarkRows[] = [
      acct("a", 10),
      acct("b", 12),
      acct("c", 14),
      acct("d", 16),
      acct("e", 30, [], false), // opted out
      { accountId: "f", optedIn: true, segments: [], outcomes: [o("f", "repeat_purchase_pct", null, "2026-09-06T00:00:00.000Z", "error:down")] }, // unmeasured
      { accountId: "g", optedIn: true, segments: [], outcomes: [o("g", "repeat_purchase_pct", 40, "2026-09-06T00:00:00.000Z", "fixture")] }, // fixture never counts
    ];
    expect(computeBenchmarks(rows, { now: NOW })).toEqual([]); // only a–d are usable → 4 < 5
    const busy: AccountBenchmarkRows = { accountId: "h", optedIn: true, segments: [], outcomes: [o("h", "repeat_purchase_pct", 90, "2026-09-01T00:00:00.000Z"), o("h", "repeat_purchase_pct", 18, "2026-09-06T00:00:00.000Z")] };
    const out = computeBenchmarks([...rows, busy], { now: NOW });
    expect(out).toEqual([{ metricKey: "repeat_purchase_pct", segment: "all", p50: 14, p75: 16, n: 5, computedAt: "2026-09-07T00:00:00.000Z" }]); // h's latest = 18, not 90
  });

  it("splits by segment: every account is in 'all', segments with < 5 accounts are suppressed, others published", () => {
    const rows = [
      acct("a", 10, ["shopify", "revenue_band:300k-2m"]),
      acct("b", 12, ["shopify"]),
      acct("c", 14, ["shopify", "revenue_band:300k-2m"]),
      acct("d", 16, ["shopify"]),
      acct("e", 30, ["shopify", "revenue_band:300k-2m"]),
      acct("f", 20, ["revenue_band:under-300k"]),
    ];
    const out = computeBenchmarks(rows, { now: NOW });
    expect(out.map((r) => [r.segment, r.n, r.p50, r.p75])).toEqual([
      ["all", 6, 15, 19],
      ["shopify", 5, 14, 16],
    ]);
  });

  it("keys metrics separately", () => {
    const rows: AccountBenchmarkRows[] = ["a", "b", "c", "d", "e"].map((id, i) => ({ accountId: id, optedIn: true, segments: [], outcomes: [o(id, "repeat_purchase_pct", 10 + i), o(id, "content_drafts_per_week", 2 + i)] }));
    const out = computeBenchmarks(rows, { now: NOW });
    expect(out.map((r) => `${r.metricKey}/${r.segment}=${r.p50}`)).toEqual(["content_drafts_per_week/all=4", "repeat_purchase_pct/all=12"]);
  });

  it("latestActualsByMetric: one number per metric from the newest measured window", () => {
    const m = latestActualsByMetric([o("a", "repeat_purchase_pct", 5, "2026-09-01T00:00:00.000Z"), o("a", "repeat_purchase_pct", 9, "2026-09-06T00:00:00.000Z"), o("a", "lead_response_hours", null, "2026-09-06T00:00:00.000Z", "error:x")]);
    expect([...m.entries()]).toEqual([["repeat_purchase_pct", 9]]);
  });
});

describe("benchmarkFor / barInputs / revenueBand", () => {
  const rows = [
    { metricKey: "repeat_purchase_pct", segment: "all", p50: 15, p75: 19, n: 6, computedAt: "x" },
    { metricKey: "repeat_purchase_pct", segment: "shopify", p50: 14, p75: 16, n: 5, computedAt: "x" },
    { metricKey: "content_drafts_per_week", segment: "all", p50: 3, p75: 5, n: 4, computedAt: "x" }, // below floor — must never be read
  ];
  it("picks the requested segment, falls back to 'all', and never returns a row under the floor", () => {
    expect(benchmarkFor("repeat_purchase_pct", "shopify", rows)?.p75).toBe(16);
    expect(benchmarkFor("repeat_purchase_pct", "revenue_band:300k-2m", rows)?.segment).toBe("all");
    expect(benchmarkFor("content_drafts_per_week", "all", rows)).toBeNull();
    expect(benchmarkFor("lead_response_hours", "all", rows)).toBeNull();
  });
  it("barInputs returns the three Home cards in order with the account's own latest measured value", () => {
    const own = [o("me", "repeat_purchase_pct", 14), o("me", "content_drafts_per_week", 3)];
    const inputs = barInputs(rows, own, "shopify");
    expect(inputs.map((b) => b.metricKey)).toEqual(BAR_METRICS.map((m) => m.metricKey));
    expect(inputs[0]).toEqual({ metricKey: "content_drafts_per_week", benchmark: null, own: 3 });
    expect(inputs[1]).toMatchObject({ metricKey: "repeat_purchase_pct", benchmark: { segment: "shopify", p75: 16 }, own: 14 });
    expect(inputs[2]).toEqual({ metricKey: "lead_response_hours", benchmark: null, own: null });
  });
  it("revenue bands", () => {
    expect(revenueBand(null)).toBeNull();
    expect(revenueBand(0)).toBeNull();
    expect(revenueBand(120_000)).toBe("revenue_band:under-300k");
    expect(revenueBand(300_000)).toBe("revenue_band:300k-2m");
    expect(revenueBand(1_999_999)).toBe("revenue_band:300k-2m");
    expect(revenueBand(5_000_000)).toBe("revenue_band:2m-10m");
    expect(revenueBand(50_000_000)).toBe("revenue_band:10m-plus");
  });
});
