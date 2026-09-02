/* Outcome telemetry on MemoryStore with a fixture reader: actual vs target from a certified
   read or the run ledger, hit / miss / trend, honest provenance when the platform couldn't
   answer, idempotent per window. */

import { describe, expect, it } from "vitest";
import { CATALOG_SPEC_BY_ID, HOURS_SAVED_PER_RUN, KPI_CONTRACTS } from "../../runtime/catalog-specs";
import { FailingReader, StaticReader } from "../../runtime/providers";
import { MemoryStore } from "../../runtime/store/memory";
import type { OutcomeRecord } from "../../runtime/store/interface";
import type { Receipt } from "../../runtime/types";
import { actualFromRead, latestByRoutine, measureOutcomes, meetsTarget, scoreRoutine, windowFor } from "../outcomes";

const ACCT = "acct-1";
const NOW = new Date("2026-09-02T07:00:00.000Z");

async function enable(store: MemoryStore, id: string) {
  await store.putRoutineState({ accountId: ACCT, routineId: id, enabled: true, version: 1, draftSpec: null, liveSpec: null, updatedAt: NOW.toISOString() });
}
let n = 0;
async function doneRun(store: MemoryStore, routineId: string, startedAt = "2026-09-01T07:00:00.000Z", drafts = 1) {
  const id = `run-${++n}`;
  await store.createRun({ id, accountId: ACCT, routineId, version: 1, mode: "dry_run", status: "done", startedAt, finishedAt: startedAt });
  for (let i = 0; i < drafts; i++) {
    const r: Receipt = { id: `rc-${id}-${i}`, accountId: ACCT, runId: id, kind: "draft", description: "Would ask: draft", payload: {}, createdAt: startedAt };
    await store.appendReceipt(r);
  }
  return id;
}

describe("catalog KPI contracts + hours constants", () => {
  it("every one of the 35 routines carries a KPI contract and a conservative hours-saved constant", () => {
    const specs = Object.values(CATALOG_SPEC_BY_ID);
    expect(specs).toHaveLength(35);
    for (const s of specs) {
      expect(s.kpi, s.id).toBeDefined();
      expect(s.kpi!.key).toMatch(/^[a-z0-9_]+$/);
      expect(s.kpi!.windowDays).toBeGreaterThan(0);
      expect(["gte", "lte"]).toContain(s.kpi!.op);
      expect(s.hoursSavedPerRun).toBe(HOURS_SAVED_PER_RUN[s.id]);
      expect(s.hoursSavedPerRun!).toBeGreaterThan(0);
      expect(s.hoursSavedPerRun!).toBeLessThanOrEqual(2);
    }
    // the three bar metrics exist as contracts
    expect(KPI_CONTRACTS["D01-W01"].key).toBe("content_drafts_per_week");
    expect(KPI_CONTRACTS["D05-W01"].key).toBe("repeat_purchase_pct");
    expect(KPI_CONTRACTS["D04-W04"].key).toBe("lead_response_hours");
    // read-sourced contracts only name platforms the runtime knows
    for (const c of Object.values(KPI_CONTRACTS)) if (c.source.kind === "read") expect(typeof c.source.platform).toBe("string");
  });
});

describe("windowFor / meetsTarget / actualFromRead", () => {
  it("windows end at the start of the measuring day (UTC) so daily re-runs are idempotent", () => {
    expect(windowFor(KPI_CONTRACTS["D01-W01"], NOW)).toEqual({ windowStart: "2026-08-26T00:00:00.000Z", windowEnd: "2026-09-02T00:00:00.000Z" });
    expect(windowFor(KPI_CONTRACTS["D05-W01"], NOW).windowStart).toBe("2026-06-04T00:00:00.000Z"); // 90d
  });
  it("gte / lte directions; null never hits", () => {
    expect(meetsTarget("gte", 22, 30)).toBe(true);
    expect(meetsTarget("gte", 22, 14)).toBe(false);
    expect(meetsTarget("lte", 3.5, 2.1)).toBe(true);
    expect(meetsTarget("lte", 3.5, 4)).toBe(false);
    expect(meetsTarget("gte", 0, null)).toBe(false);
  });
  it("reads a metric, a count, a ratio with scale, and refuses a missing metric or zero denominator", () => {
    const result = { rows: [{}, {}, {}, {}], metrics: { repeat_count: 1, revenue: "812.5", zero: 0 }, fetchedAt: NOW.toISOString() };
    expect(actualFromRead({ kind: "read", platform: "shopify", resource: "customers", metric: "repeat_count", per: "count", scale: 100 }, result)).toBe(25);
    expect(actualFromRead({ kind: "read", platform: "shopify", resource: "orders", metric: "count" }, result)).toBe(4);
    expect(actualFromRead({ kind: "read", platform: "shopify", resource: "orders", metric: "revenue" }, result)).toBe(812.5);
    expect(actualFromRead({ kind: "read", platform: "shopify", resource: "orders", metric: "nope" }, result)).toBeNull();
    expect(actualFromRead({ kind: "read", platform: "shopify", resource: "orders", metric: "revenue", per: "zero" }, result)).toBeNull();
  });
});

describe("measureOutcomes", () => {
  it("measures a read-sourced KPI from a certified read (hit) and a runs-sourced KPI from the ledger (miss); skips disabled routines and routines with no completed run", async () => {
    const store = new MemoryStore();
    await enable(store, "D05-W01"); // repeat_purchase_pct ← shopify customers repeat_count / count × 100
    await enable(store, "D01-W01"); // content_drafts_per_week ← draft receipts (target 5)
    await enable(store, "D03-W04"); // enabled but never ran
    await doneRun(store, "D05-W01");
    await doneRun(store, "D01-W01", "2026-08-30T07:00:00.000Z", 1);
    await doneRun(store, "D01-W01", "2026-09-01T07:00:00.000Z", 2);
    await doneRun(store, "D01-W01", "2026-09-02T03:00:00.000Z", 1); // today — outside the window (ends 00:00)
    await doneRun(store, "D02-W01", "2026-09-01T07:00:00.000Z"); // not enabled
    const reader = new StaticReader({ "shopify:customers": { rows: Array.from({ length: 10 }, (_, i) => ({ id: i })), metrics: { repeat_count: 3 }, provenance: "ok" } }, () => NOW);

    const report = await measureOutcomes(ACCT, store, reader, { now: () => NOW });
    const byId = Object.fromEntries(report.measured.map((m) => [m.routineId, m]));
    expect(Object.keys(byId).sort()).toEqual(["D01-W01", "D05-W01"]);
    expect(byId["D05-W01"]).toMatchObject({ kpiKey: "repeat_purchase_pct", kpiTarget: 22, kpiOp: "gte", kpiActual: 30, provenance: "ok", windowEnd: "2026-09-02T00:00:00.000Z" });
    expect(byId["D01-W01"]).toMatchObject({ kpiKey: "content_drafts_per_week", kpiTarget: 5, kpiActual: 3, provenance: "runs" });
    expect(byId["D01-W01"].runId).toBe("run-3"); // newest completed run in the window
    expect(report.skipped).toEqual(expect.arrayContaining([{ routineId: "D03-W04", reason: "no completed run in the window" }, { routineId: "D02-W01", reason: "not enabled" }]));
    expect(await store.listOutcomes(ACCT)).toHaveLength(2);
  });

  it("re-running on the same day rewrites the same window (idempotent), a later day adds a window", async () => {
    const store = new MemoryStore();
    await enable(store, "D01-W01");
    await doneRun(store, "D01-W01", "2026-09-01T07:00:00.000Z", 5);
    const reader = new StaticReader({}, () => NOW);
    await measureOutcomes(ACCT, store, reader, { now: () => NOW });
    await measureOutcomes(ACCT, store, reader, { now: () => new Date("2026-09-02T15:00:00.000Z") });
    expect(await store.listOutcomes(ACCT)).toHaveLength(1);
    await doneRun(store, "D01-W01", "2026-09-02T07:00:00.000Z", 1);
    await measureOutcomes(ACCT, store, reader, { now: () => new Date("2026-09-03T07:00:00.000Z") });
    const rows = await store.listOutcomes(ACCT, { routineId: "D01-W01" });
    expect(rows.map((r) => [r.windowEnd, r.kpiActual])).toEqual([
      ["2026-09-03T00:00:00.000Z", 6],
      ["2026-09-02T00:00:00.000Z", 5],
    ]);
  });

  it("records 'couldn't ask' honestly: reader failure → actual null + error provenance; fixture read → provenance fixture (never a measured number)", async () => {
    const store = new MemoryStore();
    await enable(store, "D05-W01");
    await doneRun(store, "D05-W01");
    const failed = await measureOutcomes(ACCT, store, new FailingReader(), { now: () => NOW });
    expect(failed.measured[0].kpiActual).toBeNull();
    expect(failed.measured[0].provenance).toMatch(/^error:/);

    const fixture = new StaticReader({ "shopify:customers": { rows: [{}, {}], metrics: { repeat_count: 1 }, provenance: "fixture" } }, () => NOW);
    const fx = await measureOutcomes(ACCT, store, fixture, { now: () => NOW });
    expect(fx.measured[0]).toMatchObject({ kpiActual: 50, provenance: "fixture" });
    expect(scoreRoutine(fx.measured)).toMatchObject({ hit: 0, miss: 0, unmeasured: 1, trend: "unknown" });

    const missing = new StaticReader({ "shopify:customers": { rows: [{}], metrics: {}, provenance: "ok" } }, () => NOW);
    const m = await measureOutcomes(ACCT, store, missing, { now: () => NOW });
    expect(m.measured[0]).toMatchObject({ kpiActual: null, provenance: 'error:metric "repeat_count" not in the read' });
  });

  it("routineIds / includeDisabled options narrow or widen the sweep", async () => {
    const store = new MemoryStore();
    await doneRun(store, "D01-W01", "2026-09-01T07:00:00.000Z", 2);
    const reader = new StaticReader({}, () => NOW);
    expect((await measureOutcomes(ACCT, store, reader, { now: () => NOW })).measured).toHaveLength(0);
    const widened = await measureOutcomes(ACCT, store, reader, { now: () => NOW, includeDisabled: true, routineIds: ["D01-W01"] });
    expect(widened.measured.map((m) => m.routineId)).toEqual(["D01-W01"]);
    expect(widened.skipped).toEqual([]);
  });
});

describe("scoreRoutine (pure)", () => {
  const o = (windowEnd: string, actual: number | null, over: Partial<OutcomeRecord> = {}): OutcomeRecord => ({
    id: windowEnd,
    accountId: ACCT,
    routineId: "D05-W01",
    kpiKey: "repeat_purchase_pct",
    kpiTarget: 22,
    kpiOp: "gte",
    kpiActual: actual,
    provenance: "ok",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd,
    measuredAt: windowEnd,
    ...over,
  });
  it("counts hits and misses, and reads the trend from the last two measured windows in the contract's good direction", () => {
    expect(scoreRoutine([o("2026-09-01T00:00:00.000Z", 14), o("2026-09-02T00:00:00.000Z", 18), o("2026-09-03T00:00:00.000Z", 24)])).toMatchObject({ hit: 1, miss: 2, unmeasured: 0, trend: "up" });
    expect(scoreRoutine([o("2026-09-03T00:00:00.000Z", 24), o("2026-09-01T00:00:00.000Z", 30)])).toMatchObject({ hit: 2, miss: 0, trend: "down" }); // order-independent
    expect(scoreRoutine([o("2026-09-01T00:00:00.000Z", 20), o("2026-09-02T00:00:00.000Z", 20)]).trend).toBe("flat");
    // lte contracts: falling is improving
    const lte = (w: string, a: number) => o(w, a, { kpiOp: "lte", kpiTarget: 3.5 });
    expect(scoreRoutine([lte("2026-09-01T00:00:00.000Z", 4), lte("2026-09-02T00:00:00.000Z", 3)])).toMatchObject({ hit: 1, miss: 1, trend: "up" });
  });
  it("unmeasured windows (null, fixture, error) never count as hit or miss and never move the trend", () => {
    const s = scoreRoutine([o("2026-09-01T00:00:00.000Z", 30), o("2026-09-02T00:00:00.000Z", null, { provenance: "error:down" }), o("2026-09-03T00:00:00.000Z", 40, { provenance: "fixture" })]);
    expect(s).toMatchObject({ hit: 1, miss: 0, unmeasured: 2, trend: "unknown" });
    expect(s.latest?.windowEnd).toBe("2026-09-03T00:00:00.000Z");
    expect(scoreRoutine([])).toEqual({ hit: 0, miss: 0, unmeasured: 0, trend: "unknown", latest: null });
  });
  it("latestByRoutine keeps the newest window per routine", () => {
    const m = latestByRoutine([o("2026-09-01T00:00:00.000Z", 1), o("2026-09-03T00:00:00.000Z", 3), o("2026-09-02T00:00:00.000Z", 2, { routineId: "D01-W01" })]);
    expect(m.get("D05-W01")?.kpiActual).toBe(3);
    expect(m.get("D01-W01")?.kpiActual).toBe(2);
  });
});
