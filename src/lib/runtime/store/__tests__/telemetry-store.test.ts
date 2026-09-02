/* Migration-0006 methods on SupabaseStore against the schema-checked fake (call shapes,
   idempotent upserts, the n ≥ 5 floor) and parity with MemoryStore. */

import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import type { BenchmarkRecord, OutcomeRecord, SelfReviewRecord, Store } from "../interface";
import { MemoryStore } from "../memory";
import { SupabaseStore } from "../supabase";

const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ACCT = U(1);
const OTHER = U(2);

const outcome = (over: Partial<OutcomeRecord> = {}): OutcomeRecord => ({
  id: U(100),
  accountId: ACCT,
  routineId: "D05-W01",
  runId: U(10),
  kpiKey: "repeat_purchase_pct",
  kpiTarget: 22,
  kpiOp: "gte",
  kpiActual: 14,
  provenance: "ok",
  windowStart: "2026-06-04T00:00:00.000Z",
  windowEnd: "2026-09-02T00:00:00.000Z",
  measuredAt: "2026-09-02T02:00:00.000Z",
  ...over,
});
const review = (over: Partial<SelfReviewRecord> = {}): SelfReviewRecord => ({
  id: U(200),
  accountId: ACCT,
  weekStart: "2026-08-31",
  body: "What worked\nx\n\nWhat I'm changing\ny\n\nOne ask\nz?",
  changes: [{ action: "reprioritise", routineId: "D05-W01", why: "w" }],
  evidence: { ask: "z?", author: "deterministic" },
  createdAt: "2026-09-02T09:00:00.000Z",
  ...over,
});
const bench = (over: Partial<BenchmarkRecord> = {}): BenchmarkRecord => ({ metricKey: "repeat_purchase_pct", segment: "all", p50: 15, p75: 19, n: 6, computedAt: "2026-09-07T00:00:00.000Z", ...over });

function fresh() {
  const db = new FakeSupabase();
  db.seed("accounts", [
    { id: ACCT, name: "A" },
    { id: OTHER, name: "B" },
  ]);
  db.seed("routine_runs", [{ id: U(10), account_id: ACCT, routine_id: "D05-W01", version: 1, mode: "dry_run", status: "done", started_at: "2026-09-01T07:00:00.000Z" }]);
  return { db, store: new SupabaseStore(db) };
}

describe("routine_outcomes", () => {
  it("upsert is idempotent per (account, routine, kpi, window_end) and maps every column", async () => {
    const { db, store } = fresh();
    const a = await store.upsertOutcome(outcome());
    expect(a).toEqual(outcome());
    const b = await store.upsertOutcome(outcome({ id: U(101), kpiActual: 16, measuredAt: "2026-09-02T15:00:00.000Z" }));
    expect(db.rows("routine_outcomes")).toHaveLength(1);
    expect(b.kpiActual).toBe(16);
    expect(db.lastCall("routine_outcomes", "upsert").onConflict).toBe("account_id,routine_id,kpi_key,window_end");
    await store.upsertOutcome(outcome({ id: U(102), windowEnd: "2026-09-03T00:00:00.000Z", kpiActual: null, provenance: "error:down", runId: undefined }));
    const rows = await store.listOutcomes(ACCT);
    expect(rows.map((r) => [r.windowEnd, r.kpiActual, r.provenance])).toEqual([
      ["2026-09-03T00:00:00.000Z", null, "error:down"],
      ["2026-09-02T00:00:00.000Z", 16, "ok"],
    ]);
    expect(rows[0].runId).toBeUndefined();
    const call = db.lastCall("routine_outcomes", "select");
    expect(call.filters).toEqual([{ kind: "eq", column: "account_id", value: ACCT }]);
    expect(call.order).toEqual({ column: "window_end", ascending: false });
  });
  it("listOutcomes filters (routine, kpi, since, limit); listOutcomesAcrossAccounts spans accounts", async () => {
    const { db, store } = fresh();
    await store.upsertOutcome(outcome());
    await store.upsertOutcome(outcome({ id: U(103), routineId: "D01-W01", kpiKey: "content_drafts_per_week", windowEnd: "2026-09-02T00:00:00.000Z" }));
    await store.upsertOutcome(outcome({ id: U(104), accountId: OTHER, windowEnd: "2026-08-20T00:00:00.000Z" }));
    expect((await store.listOutcomes(ACCT, { routineId: "D01-W01" })).map((r) => r.kpiKey)).toEqual(["content_drafts_per_week"]);
    expect((await store.listOutcomes(ACCT, { kpiKey: "repeat_purchase_pct", since: "2026-09-01T00:00:00.000Z", limit: 5 })).length).toBe(1);
    expect(db.lastCall("routine_outcomes", "select").filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "kpi_key", value: "repeat_purchase_pct" }, { kind: "gte", column: "window_end", value: "2026-09-01T00:00:00.000Z" }]));
    expect(db.lastCall("routine_outcomes", "select").limit).toBe(5);
    expect((await store.listOutcomesAcrossAccounts("2026-08-01T00:00:00.000Z")).map((r) => r.accountId).sort()).toEqual([ACCT, ACCT, OTHER].sort());
    expect((await store.listOutcomesAcrossAccounts("2026-09-01T00:00:00.000Z")).map((r) => r.accountId)).toEqual([ACCT, ACCT]);
  });
});

describe("self_reviews", () => {
  it("one row per (account, week_start): upsert rewrites; getLatest picks the newest week; jsonb round-trips", async () => {
    const { db, store } = fresh();
    expect(await store.getLatestSelfReview(ACCT)).toBeNull();
    const a = await store.putSelfReview(review());
    expect(a).toEqual(review());
    await store.putSelfReview(review({ id: U(201), body: "rewritten", createdAt: "2026-09-04T09:00:00.000Z" }));
    expect(db.rows("self_reviews")).toHaveLength(1);
    expect(db.lastCall("self_reviews", "upsert").onConflict).toBe("account_id,week_start");
    await store.putSelfReview(review({ id: U(202), weekStart: "2026-09-07", body: "next week" }));
    await store.putSelfReview(review({ id: U(203), accountId: OTHER, weekStart: "2026-09-14", body: "other" }));
    const latest = await store.getLatestSelfReview(ACCT);
    expect(latest).toMatchObject({ weekStart: "2026-09-07", body: "next week", changes: [{ action: "reprioritise", routineId: "D05-W01", why: "w" }], evidence: { ask: "z?" } });
    const call = db.lastCall("self_reviews", "select");
    expect(call.order).toEqual({ column: "week_start", ascending: false });
    expect(call.limit).toBe(1);
  });
});

describe("benchmarks + opt-ins", () => {
  it("refuses any row under the anonymisation floor before touching the table", async () => {
    const { db, store } = fresh();
    await expect(store.putBenchmarks([bench(), bench({ segment: "shopify", n: 4 })])).rejects.toThrow(/n=4 < 5/);
    expect(db.callsFor("benchmarks")).toHaveLength(0);
    expect(await store.putBenchmarks([])).toEqual([]);
  });
  it("upserts on (metric_key, segment), reads one or all, and lists opt-ins", async () => {
    const { db, store } = fresh();
    await store.putBenchmarks([bench(), bench({ segment: "shopify", p75: 16, n: 5 })]);
    await store.putBenchmarks([bench({ p75: 21 })]);
    expect(db.rows("benchmarks")).toHaveLength(2);
    expect(db.lastCall("benchmarks", "upsert").onConflict).toBe("metric_key,segment");
    expect(await store.getBenchmark("repeat_purchase_pct", "all")).toEqual(bench({ p75: 21 }));
    expect(await store.getBenchmark("repeat_purchase_pct", "revenue_band:300k-2m")).toBeNull();
    expect((await store.listBenchmarks("shopify")).map((b) => b.p75)).toEqual([16]);
    expect((await store.listBenchmarks()).length).toBe(2);
    db.seed("benchmark_optins", [
      { account_id: ACCT, opted_in: false },
      { account_id: OTHER, opted_in: true },
    ]);
    expect(await store.listBenchmarkOptins()).toEqual([
      { accountId: ACCT, optedIn: false },
      { accountId: OTHER, optedIn: true },
    ]);
  });
});

describe("taste_events listing", () => {
  it("newest first, since + limit honoured", async () => {
    const { db, store } = fresh();
    await store.appendTasteEvent({ id: U(300), accountId: ACCT, action: "held", context: {}, createdAt: "2026-09-01T08:00:00.000Z" });
    await store.appendTasteEvent({ id: U(301), accountId: ACCT, action: "approved", context: { a: 1 }, createdAt: "2026-09-02T08:00:00.000Z" });
    await store.appendTasteEvent({ id: U(302), accountId: OTHER, action: "approved", context: {}, createdAt: "2026-09-03T08:00:00.000Z" });
    expect((await store.listTasteEvents(ACCT)).map((t) => t.action)).toEqual(["approved", "held"]);
    expect((await store.listTasteEvents(ACCT, { since: "2026-09-02T00:00:00.000Z", limit: 1 })).map((t) => t.id)).toEqual([U(301)]);
    expect(db.lastCall("taste_events", "select").order).toEqual({ column: "created_at", ascending: false });
  });
});

describe("parity: MemoryStore and SupabaseStore answer the same", () => {
  const scenario = async (store: Store) => {
    await store.upsertOutcome(outcome());
    await store.upsertOutcome(outcome({ id: U(105), kpiActual: 18 }));
    await store.upsertOutcome(outcome({ id: U(106), windowEnd: "2026-09-03T00:00:00.000Z", kpiActual: 20 }));
    await store.putSelfReview(review());
    await store.putSelfReview(review({ id: U(204), body: "again" }));
    await store.putBenchmarks([bench()]);
    return {
      outcomes: (await store.listOutcomes(ACCT)).map((o) => [o.windowEnd, o.kpiActual]),
      review: (await store.getLatestSelfReview(ACCT))?.body,
      bench: (await store.getBenchmark("repeat_purchase_pct", "all"))?.p75,
      across: (await store.listOutcomesAcrossAccounts("2026-09-03T00:00:00.000Z")).length,
    };
  };
  it("outcomes, reviews and benchmarks", async () => {
    const mem = await scenario(new MemoryStore());
    const sb = await scenario(fresh().store);
    expect(sb).toEqual(mem);
    expect(mem).toEqual({ outcomes: [["2026-09-03T00:00:00.000Z", 20], ["2026-09-02T00:00:00.000Z", 18]], review: "again", bench: 19, across: 1 });
  });
});
