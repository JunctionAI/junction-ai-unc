/* The worker's telemetry one-shots on MemoryStore + fixtures: --measure, --self-review
   (idempotent per week), --benchmarks (opt-ins, floor), and the CLI flags. */

import { describe, expect, it } from "vitest";
import { StaticReader } from "../../lib/runtime/providers";
import { MemoryStore } from "../../lib/runtime/store/memory";
import type { OutcomeRecord } from "../../lib/runtime/store/interface";
import { StaticAccountsSource, type WorkerAccount } from "../accounts";
import { parseArgs } from "../cli";
import { BENCHMARK_LOOKBACK_DAYS, runBenchmarks, runMeasure, runSelfReview } from "../telemetry";

const NOW = new Date("2026-09-02T02:00:00.000Z");
const acct = (id: string): WorkerAccount => ({ account: { accountId: id, currency: "NZD", budgetMonthly: 3000, approver: "the founder" } });

async function seeded(ids: string[]) {
  const store = new MemoryStore();
  let n = 0;
  for (const id of ids) {
    await store.putRoutineState({ accountId: id, routineId: "D05-W01", enabled: true, version: 1, draftSpec: null, liveSpec: null, updatedAt: NOW.toISOString() });
    await store.createRun({ id: `run-${++n}`, accountId: id, routineId: "D05-W01", version: 1, mode: "dry_run", status: "done", startedAt: "2026-09-01T07:00:00.000Z", finishedAt: "2026-09-01T07:01:00.000Z" });
  }
  return store;
}

describe("--measure", () => {
  it("measures every account the source lists, from the injected (certified) reader", async () => {
    const store = await seeded(["a", "b"]);
    const reader = new StaticReader({ "shopify:customers": { rows: Array.from({ length: 20 }, () => ({})), metrics: { repeat_count: 5 }, provenance: "ok" } }, () => NOW);
    const r = await runMeasure({ store, accounts: new StaticAccountsSource([acct("a"), acct("b")]), reader, now: () => NOW });
    expect(r).toMatchObject({ accounts: 2, measured: 2 });
    expect((await store.listOutcomes("a"))[0]).toMatchObject({ kpiKey: "repeat_purchase_pct", kpiActual: 25, provenance: "ok" });
    const one = await runMeasure({ store, accounts: new StaticAccountsSource([acct("a"), acct("b")]), reader, now: () => NOW }, { accountId: "b" });
    expect(one.accounts).toBe(1);
    expect(one.perAccount[0].accountId).toBe("b");
  });
});

describe("--self-review", () => {
  it("writes one review per account per week; a second run the same week is a no-op unless forced", async () => {
    const store = await seeded(["a"]);
    const deps = { store, accounts: new StaticAccountsSource([acct("a")]), reader: new StaticReader({}, () => NOW), now: () => NOW, llm: null };
    const first = await runSelfReview(deps);
    expect(first.written).toEqual([{ accountId: "a", weekStart: "2026-08-31", author: "deterministic", liveFields: 0, changes: 0 }]);
    const again = await runSelfReview(deps);
    expect(again.written).toEqual([]);
    expect(again.alreadyDone).toEqual(["a"]);
    const forced = await runSelfReview(deps, { force: true });
    expect(forced.written).toHaveLength(1);
    expect((await store.getLatestSelfReview("a"))?.weekStart).toBe("2026-08-31");
  });
  it("uses the injected model when present and falls back on failure", async () => {
    const store = await seeded(["a"]);
    const llm = { complete: async () => JSON.stringify({ worked: "I completed 1 run.", changing: "Nothing yet.", ask: "Shall I keep going?", changes: [] }) };
    const r = await runSelfReview({ store, accounts: new StaticAccountsSource([acct("a")]), reader: new StaticReader({}, () => NOW), now: () => NOW, llm });
    expect(r.written[0]).toMatchObject({ author: "sonnet", liveFields: 3 });
  });
});

describe("--benchmarks", () => {
  const o = (accountId: string, actual: number, windowEnd = "2026-09-01T00:00:00.000Z"): OutcomeRecord => ({
    id: `${accountId}-${windowEnd}`,
    accountId,
    routineId: "D05-W01",
    kpiKey: "repeat_purchase_pct",
    kpiTarget: 22,
    kpiOp: "gte",
    kpiActual: actual,
    provenance: "ok",
    windowStart: "2026-06-03T00:00:00.000Z",
    windowEnd,
    measuredAt: windowEnd,
  });
  it("aggregates opted-in accounts' latest outcomes within the look-back and publishes only n ≥ 5", async () => {
    const store = new MemoryStore();
    for (const [id, v] of [["a", 10], ["b", 12], ["c", 14], ["d", 16], ["e", 30], ["f", 50]] as const) await store.upsertOutcome(o(id, v));
    await store.upsertOutcome(o("g", 99, "2026-06-01T00:00:00.000Z")); // outside the look-back
    store.setBenchmarkOptin("f", false); // opted out
    const deps = { store, accounts: new StaticAccountsSource(), reader: new StaticReader(), now: () => new Date("2026-09-07T00:00:00.000Z") };
    const r = await runBenchmarks(deps);
    expect(r).toEqual({ accounts: 6, optedIn: 5, published: 1, suppressed: 0 });
    expect(await store.getBenchmark("repeat_purchase_pct", "all")).toMatchObject({ p50: 14, p75: 16, n: 5 });
    expect(BENCHMARK_LOOKBACK_DAYS).toBe(35);
    // one more opt-out → below the floor → nothing published, the pair is reported suppressed
    store.setBenchmarkOptin("e", false);
    const r2 = await runBenchmarks(deps);
    expect(r2).toMatchObject({ optedIn: 4, published: 0, suppressed: 1 });
  });
});

describe("CLI flags", () => {
  it("parses --measure / --self-review / --benchmarks and remembers an explicit --account", () => {
    expect(parseArgs([])).toMatchObject({ measure: false, selfReview: false, benchmarks: false, accountGiven: false, accountId: "demo" });
    expect(parseArgs(["--measure", "--self-review", "--benchmarks", "--account", "acct-9"])).toMatchObject({ measure: true, selfReview: true, benchmarks: true, accountGiven: true, accountId: "acct-9" });
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });
});
