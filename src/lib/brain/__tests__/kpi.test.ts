/* KPI snapshots: the metric set per connected platform, one certified read per (platform,
   resource, window) shared across metrics, "couldn't ask" → no row + a receipt, fixture
   provenance, idempotent upsert, and the week-over-week deltas with the 15 % threshold. */

import { describe, expect, it } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import type { ConnectorReader, Platform, ReadQuery, ReadResult } from "../../runtime/types";
import { computeDeltas, describeDelta, KPI_METRICS, kpiDeltas, metricsForPlatforms, NOTABLE_DELTA_PCT, snapshotKpis, valueFromRead, windowStartDate } from "../kpi";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const NOW = new Date("2026-09-02T01:30:30.000Z");

function fakeReader(answers: Record<string, ReadResult | Error>, calls: string[] = []): ConnectorReader & { calls: string[] } {
  return {
    calls,
    async read(source: Platform, query: ReadQuery) {
      const key = `${source}:${query.resource}:${query.window ?? ""}`;
      calls.push(key);
      const a = answers[key];
      if (!a) throw new Error(`couldn't ask ${source} ${query.resource}: nothing connected for this account`);
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

const read = (rows: number, metrics: ReadResult["metrics"], provenance = "ok"): ReadResult => ({ rows: Array.from({ length: rows }, (_, i) => ({ id: i })), metrics, fetchedAt: NOW.toISOString(), provenance });

describe("metricsForPlatforms (pure)", () => {
  it("asks only what the connected platforms can answer; never the rest", () => {
    expect(metricsForPlatforms([]).map((m) => m.key)).toEqual([]);
    expect(metricsForPlatforms(["shopify"]).map((m) => m.key)).toEqual(["revenue_28d", "revenue_7d", "orders_7d", "aov_28d", "repeat_rate_90d"]);
    expect(metricsForPlatforms(["ga4"]).map((m) => m.key)).toEqual(["sessions_7d"]);
    expect(metricsForPlatforms(["meta_ads"]).map((m) => m.key)).toEqual(["roas_7d"]);
    expect(metricsForPlatforms(["klaviyo"]).map((m) => m.key)).toEqual(["email_revenue_28d"]);
    expect(metricsForPlatforms(["shopify", "ga4", "meta_ads", "klaviyo", "hubspot"]).map((m) => m.key)).toEqual(KPI_METRICS.map((m) => m.key));
  });

  it("valueFromRead: metrics, counts, ratios; null when the read lacks the number", () => {
    const orders = KPI_METRICS.find((m) => m.key === "revenue_7d")!;
    expect(valueFromRead(orders, read(3, { revenue: 412.456 }))).toBe(412.46);
    expect(valueFromRead(KPI_METRICS.find((m) => m.key === "orders_7d")!, read(3, {}))).toBe(3);
    const repeat = KPI_METRICS.find((m) => m.key === "repeat_rate_90d")!;
    expect(valueFromRead(repeat, read(40, { repeat_count: 12 }))).toBe(30);
    expect(valueFromRead(repeat, read(0, { repeat_count: 0 }))).toBe(0);
    expect(valueFromRead(orders, read(3, { aov: 1 }))).toBeNull();
  });
});

describe("snapshotKpis", () => {
  function seeded() {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT, name: "Example", currency: "NZD" }]);
    db.seed("connectors", [
      { account_id: ACCT, platform: "shopify", status: "connected" },
      { account_id: ACCT, platform: "ga4", status: "connected" },
      { account_id: ACCT, platform: "meta_ads", status: "disconnected" },
    ]);
    return db;
  }

  it("writes one row per answerable metric, shares reads, and turns 'couldn't ask' into a receipt — never a zero", async () => {
    const db = seeded();
    const reader = fakeReader({
      "shopify:orders:28d": read(60, { revenue: 4120, aov: 68.67 }),
      "shopify:orders:7d": read(14, { revenue: 980.5, aov: 70.04 }),
      "shopify:customers:90d": read(40, { repeat_count: 12, total_spent: 9000 }),
      "ga4:report:7d": new Error("couldn't ask ga4 report: 401 Unauthorized (analyticsdata.googleapis.com /v1beta/properties/x:runReport)"),
    });
    const report = await snapshotKpis({ db, reader, accountId: ACCT, account: { currency: "NZD", budgetMonthly: 3000 }, now: () => NOW });
    expect(report.connected.sort()).toEqual(["ga4", "shopify"]);
    expect(report.written.map((r) => [r.metric_key, r.value, r.currency, r.provenance, r.window_start, r.window_end])).toEqual([
      ["revenue_28d", 4120, "NZD", "live", "2026-08-05", "2026-09-02"],
      ["revenue_7d", 980.5, "NZD", "live", "2026-08-26", "2026-09-02"],
      ["orders_7d", 14, null, "live", "2026-08-26", "2026-09-02"],
      ["aov_28d", 68.67, "NZD", "live", "2026-08-05", "2026-09-02"],
      ["repeat_rate_90d", 30, null, "live", "2026-06-04", "2026-09-02"],
    ]);
    expect(report.couldntAsk).toEqual([{ key: "sessions_7d", platform: "ga4", reason: expect.stringContaining("couldn't ask ga4 report") }]);
    expect(report.notConnected).toEqual(["roas_7d", "email_revenue_28d"]);
    // one certified read per (platform, resource, window)
    expect(reader.calls.sort()).toEqual(["ga4:report:7d", "shopify:customers:90d", "shopify:orders:28d", "shopify:orders:7d"]);
    // the table + the receipt
    expect(db.rows("kpi_snapshots")).toHaveLength(5);
    expect(db.rows("kpi_snapshots").map((r) => r.metric_key)).not.toContain("sessions_7d");
    const receipts = db.rows("receipts");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ account_id: ACCT, run_id: null, kind: "notification", platform: "ga4", description: expect.stringMatching(/^Couldn't ask ga4 for sessions \(7d\): couldn't ask ga4 report/) });
    expect((receipts[0].payload as { metricKey: string }).metricKey).toBe("sessions_7d");
    expect(db.lastCall("kpi_snapshots", "upsert").onConflict).toBe("account_id,metric_key,window_end");

    // re-running the same day rewrites the same rows (idempotent)
    await snapshotKpis({ db, reader, accountId: ACCT, now: () => new Date("2026-09-02T09:00:00.000Z") });
    expect(db.rows("kpi_snapshots")).toHaveLength(5);
    expect(db.rows("receipts")).toHaveLength(2); // a second "couldn't ask" is a second incident
  });

  it("fixture reads are stored as provenance 'fixture' — never mistakable for a live number", async () => {
    const db = seeded();
    const reader = fakeReader({
      "shopify:orders:28d": read(2, { revenue: 200, aov: 100 }, "fixture"),
      "shopify:orders:7d": read(2, { revenue: 200, aov: 100 }, "fixture"),
      "shopify:customers:90d": read(2, { repeat_count: 1 }, "fixture"),
      "ga4:report:7d": read(3, { sessions: 8025 }, "fixture"),
    });
    const report = await snapshotKpis({ db, reader, accountId: ACCT, now: () => NOW });
    expect(new Set(report.written.map((r) => r.provenance))).toEqual(new Set(["fixture"]));
    expect(report.written.find((r) => r.metric_key === "sessions_7d")?.value).toBe(8025);
    expect(report.couldntAsk).toEqual([]);
  });

  it("an account with nothing connected asks nothing and writes nothing", async () => {
    const db = new FakeSupabase();
    const reader = fakeReader({});
    const report = await snapshotKpis({ db, reader, accountId: ACCT, now: () => NOW });
    expect(report.written).toEqual([]);
    expect(report.notConnected).toHaveLength(KPI_METRICS.length);
    expect(reader.calls).toEqual([]);
    expect(db.callsFor("kpi_snapshots")).toEqual([]);
  });
});

describe("deltas", () => {
  const row = (metric_key: string, window_end: string, value: number, provenance = "live", currency: string | null = "NZD") => ({ metric_key, value, currency, window_end, provenance });

  it("latest vs the row a week earlier, |Δ| ≥ 15 % is notable; no comparison → null", () => {
    expect(NOTABLE_DELTA_PCT).toBe(15);
    expect(windowStartDate("2026-09-02", 7)).toBe("2026-08-26");
    const deltas = computeDeltas(
      [row("revenue_7d", "2026-08-26", 3500), row("revenue_7d", "2026-09-02", 4120), row("orders_7d", "2026-09-02", 60, "live", null), row("orders_7d", "2026-08-26", 58, "live", null), row("aov_28d", "2026-09-02", 68.67), row("roas_7d", "2026-09-03", 9)],
      NOW,
    );
    expect(deltas.map((d) => [d.key, d.latest, d.previous, d.deltaPct, d.notable])).toEqual([
      ["revenue_7d", 4120, 3500, 17.7, true],
      ["orders_7d", 60, 58, 3.4, false],
      ["aov_28d", 68.67, null, null, false],
      // the 2026-09-03 roas row is in the future for a 2026-09-02 clock → ignored entirely
    ]);
    expect(describeDelta(deltas[0])).toBe("Revenue (7d) NZD 4,120, up 17.7% on a week ago");
    expect(describeDelta(deltas[1])).toBe("Orders (7d) 60 orders, up 3.4% on a week ago");
    expect(describeDelta(deltas[2])).toBe("Average order (28d) NZD 68.67 (no comparison yet)");
  });

  it("nearest snapshot at or before a week earlier; fixture vs live is never a delta", () => {
    const d = computeDeltas([row("revenue_7d", "2026-09-02", 100), row("revenue_7d", "2026-08-24", 200), row("sessions_7d", "2026-09-02", 100, "live", null), row("sessions_7d", "2026-08-26", 300, "fixture", null)], NOW);
    expect(d.find((x) => x.key === "revenue_7d")).toMatchObject({ previous: 200, previousWindowEnd: "2026-08-24", deltaPct: -50, notable: true });
    expect(d.find((x) => x.key === "sessions_7d")).toMatchObject({ previous: null, deltaPct: null, notable: false });
  });

  it("kpiDeltas reads the account's last 35 days from the table", async () => {
    const db = new FakeSupabase();
    db.seed("kpi_snapshots", [
      { account_id: ACCT, metric_key: "revenue_7d", value: 4120, currency: "NZD", window_start: "2026-08-26", window_end: "2026-09-02", platform: "shopify", provenance: "live", captured_at: NOW.toISOString() },
      { account_id: ACCT, metric_key: "revenue_7d", value: 3500, currency: "NZD", window_start: "2026-08-19", window_end: "2026-08-26", platform: "shopify", provenance: "live", captured_at: NOW.toISOString() },
      { account_id: "00000000-0000-4000-8000-00000000acc2", metric_key: "revenue_7d", value: 9, currency: "NZD", window_start: "2026-08-26", window_end: "2026-09-02", platform: "shopify", provenance: "live", captured_at: NOW.toISOString() },
    ]);
    const d = await kpiDeltas(db, ACCT, NOW);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ key: "revenue_7d", latest: 4120, previous: 3500, deltaPct: 17.7, notable: true, provenance: "live" });
    expect(db.lastCall("kpi_snapshots", "select").filters).toEqual([
      { kind: "eq", column: "account_id", value: ACCT },
      { kind: "gte", column: "window_end", value: "2026-07-29" },
    ]);
  });
});
