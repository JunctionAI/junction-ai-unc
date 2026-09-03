import { describe, expect, it } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { KPI_METRICS } from "../../brain/kpi";
import { getMetric, getMetricDef, getMetrics, isMetricKey, METRIC_CATALOG } from "../catalog";

const ACCT = "00000000-0000-4000-8000-00000000acc1";

describe("metric catalog", () => {
  it("is the locked KPI set — keys cannot be invented", () => {
    expect(METRIC_CATALOG.map((m) => m.key)).toEqual(KPI_METRICS.map((m) => m.key));
    expect(isMetricKey("revenue_7d")).toBe(true);
    expect(isMetricKey("made_up_roas")).toBe(false);
    expect(getMetricDef("made_up_roas")).toBeNull();
    expect(getMetricDef("roas_7d")?.platform).toBe("meta_ads");
  });

  it("getMetric returns the latest certified snapshot, never a zero for a missing key", async () => {
    const db = new FakeSupabase();
    db.seed("kpi_snapshots", [
      { account_id: ACCT, metric_key: "revenue_7d", value: 12640, currency: "NZD", window_start: "2026-08-27", window_end: "2026-09-03", platform: "shopify", provenance: "live", captured_at: "2026-09-03T01:30:00.000Z" },
      { account_id: ACCT, metric_key: "revenue_7d", value: 9800, currency: "NZD", window_start: "2026-08-20", window_end: "2026-08-27", platform: "shopify", provenance: "live", captured_at: "2026-08-27T01:30:00.000Z" },
    ]);
    const m = await getMetric(db, ACCT, "revenue_7d");
    expect(m).toMatchObject({ key: "revenue_7d", value: 12640, money: true, currency: "NZD", windowEnd: "2026-09-03", provenance: "live", label: "Revenue (7d)" });
    expect(m!.definition.metric).toBe("revenue");
    expect(await getMetric(db, ACCT, "roas_7d")).toBeNull();
    expect(await getMetric(db, ACCT, "not_a_key")).toBeNull();
    expect(await getMetrics(db, ACCT)).toEqual([m]);
  });
});
