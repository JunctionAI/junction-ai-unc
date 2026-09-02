/* The in-loop scheduler: which telemetry jobs are due at a UTC minute, the "already ran"
   markers (in memory, on the heartbeat file, across a restart), the hourly oauth_states
   sweep — all on a fake clock, MemoryStore + the schema-checked fake DB. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "../../lib/db/__tests__/fakeSupabase";
import { clock } from "../../lib/runtime/__tests__/helpers";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { setEnabled } from "../../lib/runtime/versioning";
import { StaticAccountsSource, type WorkerAccount } from "../accounts";
import { FixtureCredentialProvider } from "../credentials";
import { DEFAULT_JOB_LOOKBACK_MS, dueJobs, sanitiseMarkers, SCHEDULED_JOBS, type JobMarkers } from "../jobs";
import { createLogger, memorySink } from "../log";
import { DEFAULT_SWEEP_INTERVAL_MS, readHeartbeatFile, Worker, type WorkerDeps } from "../loop";

const ACCT: WorkerAccount = { account: { accountId: "acct-1", currency: "NZD", budgetMonthly: 3000, approver: "Tom" } };
const H = 3_600_000;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "unc-jobs-"));
  tmpDirs.push(d);
  return d;
}

function harness(startAt: string, extra: Partial<WorkerDeps> = {}) {
  const clk = clock(startAt);
  const store = new MemoryStore();
  const { sink, entries } = memorySink();
  const deps: WorkerDeps = { store, accounts: new StaticAccountsSource([ACCT]), credentials: new FixtureCredentialProvider(), llm: null, now: clk.now, log: createLogger(sink, {}, clk.now), ...extra };
  return { clk, store, deps, entries };
}

describe("dueJobs (pure)", () => {
  it("names the three jobs with the documented UTC crons, in measure → benchmarks → self_review order", () => {
    expect(SCHEDULED_JOBS.map((j) => [j.id, j.cron, j.flag])).toEqual([
      ["measure", "0 2 * * *", "--measure"],
      ["benchmarks", "0 3 * * 1", "--benchmarks"],
      ["self_review", "0 6 * * 1", "--self-review"],
    ]);
    expect(DEFAULT_JOB_LOOKBACK_MS).toBe(6 * H);
  });

  it("a slot inside the look-back with no marker is due; a marker at or after the slot clears it", () => {
    const wed0200 = new Date("2026-09-02T02:00:30.000Z"); // Wednesday
    expect(dueJobs(wed0200, {}).map((d) => [d.job.id, d.slot.toISOString()])).toEqual([["measure", "2026-09-02T02:00:00.000Z"]]);
    expect(dueJobs(wed0200, { measure: { lastSlot: "2026-09-02T02:00:00.000Z", ranAt: "x", ok: true } })).toEqual([]);
    // yesterday's marker does not cover today's slot; a failed marker still counts as served
    expect(dueJobs(wed0200, { measure: { lastSlot: "2026-09-01T02:00:00.000Z", ranAt: "x", ok: true } })).toHaveLength(1);
    expect(dueJobs(wed0200, { measure: { lastSlot: "2026-09-02T02:00:00.000Z", ranAt: "x", ok: false, error: "boom" } })).toEqual([]);
    // 01:59 → nothing yet (yesterday's slot is outside the 6 h look-back)
    expect(dueJobs(new Date("2026-09-02T01:59:00.000Z"), {})).toEqual([]);
    // 07:59 → still inside the look-back; 08:01 → gone
    expect(dueJobs(new Date("2026-09-02T07:59:00.000Z"), {})).toHaveLength(1);
    expect(dueJobs(new Date("2026-09-02T08:01:00.000Z"), {})).toEqual([]);
  });

  it("Monday morning lists all three once each is reached, in run order", () => {
    const mon = (hhmm: string) => new Date(`2026-09-07T${hhmm}:00.000Z`);
    expect(dueJobs(mon("02:00"), {}).map((d) => d.job.id)).toEqual(["measure"]);
    expect(dueJobs(mon("03:00"), {}).map((d) => d.job.id)).toEqual(["measure", "benchmarks"]);
    expect(dueJobs(mon("07:00"), {}).map((d) => d.job.id)).toEqual(["measure", "benchmarks", "self_review"]);
    // a Tuesday never lists the weekly ones
    expect(dueJobs(new Date("2026-09-08T07:00:00.000Z"), {}).map((d) => d.job.id)).toEqual(["measure"]);
  });

  it("sanitiseMarkers keeps only well-formed markers from a heartbeat file", () => {
    expect(sanitiseMarkers(undefined)).toEqual({});
    expect(sanitiseMarkers("junk")).toEqual({});
    expect(sanitiseMarkers({ measure: { lastSlot: "not a date", ok: true }, benchmarks: { lastSlot: "2026-09-07T03:00:00.000Z", ranAt: "2026-09-07T03:00:20.000Z", ok: true, ms: 12 }, nope: { lastSlot: "2026-09-07T03:00:00.000Z" } })).toEqual({
      benchmarks: { lastSlot: "2026-09-07T03:00:00.000Z", ranAt: "2026-09-07T03:00:20.000Z", ok: true },
    });
  });
});

describe("Worker runs the jobs inside the tick", () => {
  it("runs measure at 02:00, not again the same day, benchmarks + self-review on Monday; markers ride on the heartbeat", async () => {
    const { clk, store, deps, entries } = harness("2026-09-02T02:00:30.000Z"); // Wednesday
    await setEnabled({ store, now: clk.now }, "acct-1", "D05-W01", true);
    const dir = tmp();
    const hbPath = join(dir, "heartbeat.json");
    const worker = new Worker(deps, { intervalSec: 60, heartbeatPath: hbPath, handleSignals: false });

    const first = await worker.tick();
    expect(first.jobs).toEqual(["measure"]);
    expect(worker.stats.jobs.measure).toMatchObject({ lastSlot: "2026-09-02T02:00:00.000Z", ranAt: "2026-09-02T02:00:30.000Z", ok: true });
    expect(entries.filter((e) => e.event === "job.start").map((e) => e.job)).toEqual(["measure"]);
    expect(entries.find((e) => e.event === "job.finish")).toMatchObject({ job: "measure", accounts: 1 });
    expect(entries.find((e) => e.event === "measure.done")).toBeTruthy();
    const hb = JSON.parse(readFileSync(hbPath, "utf8")) as { jobs: JobMarkers; lastSweepAt: string | null };
    expect(hb.jobs.measure?.lastSlot).toBe("2026-09-02T02:00:00.000Z");
    expect(hb.lastSweepAt).toBeNull(); // no DB → no sweep

    clk.advanceHours(1 / 60);
    expect((await worker.tick()).jobs).toEqual([]);
    clk.advanceHours(5);
    expect((await worker.tick()).jobs).toEqual([]); // 07:01 — still the same served slot

    // Monday 2026-09-07 06:00:30 → measure (02:00 slot is inside the 6 h look-back), benchmarks, self_review — in that order
    clk.advanceHours(24 * 5 - 5 + (6 - 2)); // → Monday 06:01:30
    const monday = await worker.tick();
    expect(monday.at).toBe("2026-09-07T06:01:30.000Z");
    expect(monday.jobs).toEqual(["measure", "benchmarks", "self_review"]);
    expect(worker.stats.jobs).toMatchObject({
      measure: { lastSlot: "2026-09-07T02:00:00.000Z", ok: true },
      benchmarks: { lastSlot: "2026-09-07T03:00:00.000Z", ok: true },
      self_review: { lastSlot: "2026-09-07T06:00:00.000Z", ok: true },
    });
    expect((await store.getLatestSelfReview("acct-1"))?.weekStart).toBe("2026-09-07");
    expect(worker.heartbeat().jobs).toEqual(worker.stats.jobs);
    expect(worker.stats.runsStarted).toBe(0); // jobs are not routine runs
  });

  it("a restart inside the look-back reloads the markers from the heartbeat file and does not double-run", async () => {
    const { clk, deps, entries } = harness("2026-09-02T02:00:30.000Z");
    const dir = tmp();
    const hbPath = join(dir, "heartbeat.json");
    const w1 = new Worker(deps, { intervalSec: 60, heartbeatPath: hbPath, handleSignals: false });
    expect((await w1.tick()).jobs).toEqual(["measure"]);
    expect(readHeartbeatFile(hbPath)?.jobs?.measure?.ok).toBe(true);

    // "restart" ten minutes later: a new Worker on the same heartbeat path
    clk.advanceHours(10 / 60);
    const w2 = new Worker(deps, { intervalSec: 60, heartbeatPath: hbPath, handleSignals: false });
    expect(w2.stats.jobs.measure?.lastSlot).toBe("2026-09-02T02:00:00.000Z");
    expect((await w2.tick()).jobs).toEqual([]);
    expect(entries.filter((e) => e.event === "job.start")).toHaveLength(1);

    // a restart with no heartbeat file (fresh volume) runs it once more — harmless, measure is idempotent
    const w3 = new Worker(deps, { intervalSec: 60, heartbeatPath: join(dir, "elsewhere.json"), handleSignals: false });
    expect((await w3.tick()).jobs).toEqual(["measure"]);
    // a corrupt heartbeat file is ignored, not fatal
    writeFileSync(hbPath, "{not json");
    expect(new Worker(deps, { intervalSec: 60, heartbeatPath: hbPath, handleSignals: false }).stats.jobs).toEqual({});
  });

  it("a failing job is logged, marked served (ok:false) and not retried until its next slot; jobs can be switched off", async () => {
    const { clk, store, deps, entries } = harness("2026-09-02T02:00:30.000Z");
    const broken = Object.assign(Object.create(store), {
      listRoutineStates: async () => {
        throw new Error("db down");
      },
    }) as MemoryStore;
    // measureOutcomes reads routine states per spec through getRoutineState; break that instead
    (broken as unknown as { getRoutineState: () => Promise<never> }).getRoutineState = async () => {
      throw new Error("db down");
    };
    const worker = new Worker({ ...deps, store: broken }, { intervalSec: 60, heartbeatPath: null, handleSignals: false });
    const report = await worker.tick();
    expect(report.jobs).toEqual(["measure"]);
    expect(worker.stats.jobs.measure).toMatchObject({ ok: false, error: "db down", lastSlot: "2026-09-02T02:00:00.000Z" });
    expect(entries.find((e) => e.event === "job.error")).toMatchObject({ job: "measure", error: "db down" });
    expect(worker.stats.lastError).toBe("db down");
    clk.advanceHours(1 / 60);
    expect((await worker.tick()).jobs).toEqual([]);

    const off = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false, jobs: false });
    expect((await off.tick()).jobs).toEqual([]);
    expect(off.stats.jobs).toEqual({});
  });
});

describe("hourly oauth_states sweep", () => {
  function seededOauth(db: FakeSupabase, accountId: string) {
    const row = (state: string, expiresAt: string) => db.insertRow("oauth_states", { state, account_id: accountId, platform: "klaviyo", code_verifier: null, shop: null, redirect_to: "/app", created_at: "2026-09-02T01:00:00.000Z", expires_at: expiresAt });
    row("expired-1", "2026-09-02T01:10:00.000Z");
    row("expired-2", "2026-09-02T01:55:00.000Z");
    row("fresh", "2026-09-02T02:09:00.000Z");
  }

  it("sweeps expired rows on the first tick, then once per interval, never without a DB", async () => {
    const db = new FakeSupabase();
    db.userId = "user-1";
    const accountId = db.rpcs.create_account({ p_name: "Example", p_currency: "NZD" }) as string;
    seededOauth(db, accountId);
    const { clk, deps, entries } = harness("2026-09-02T02:00:30.000Z", { db });
    const worker = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false });

    const first = await worker.tick();
    expect(first.swept).toBe(true);
    expect(db.rows("oauth_states").map((r) => r.state)).toEqual(["fresh"]);
    expect(db.lastCall("oauth_states", "delete").filters).toEqual([{ kind: "lte", column: "expires_at", value: "2026-09-02T02:00:30.000Z" }]);
    expect(worker.stats.lastSweepAt).toBe("2026-09-02T02:00:30.000Z");
    expect(worker.heartbeat().lastSweepAt).toBe("2026-09-02T02:00:30.000Z");
    expect(entries.filter((e) => e.event === "sweep.oauth_states")).toHaveLength(1);

    // the "fresh" row expires at 02:09 — ticks at 02:01 and 02:30 don't sweep, 03:00:30 does
    clk.advanceHours(1 / 60);
    expect((await worker.tick()).swept).toBe(false);
    clk.advanceHours(29 / 60);
    expect((await worker.tick()).swept).toBe(false);
    expect(db.rows("oauth_states")).toHaveLength(1);
    clk.advanceHours(30 / 60);
    expect((await worker.tick()).swept).toBe(true);
    expect(db.rows("oauth_states")).toEqual([]);
    expect(db.callsFor("oauth_states", "delete")).toHaveLength(2);
    expect(DEFAULT_SWEEP_INTERVAL_MS).toBe(H);

    // demo mode: no DB → never sweeps
    const demo = harness("2026-09-02T02:00:30.000Z");
    const w = new Worker(demo.deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false });
    expect((await w.tick()).swept).toBe(false);
    expect(w.stats.lastSweepAt).toBeNull();
  });

  it("a failing sweep is a warning, tried again an interval later", async () => {
    const db = new FakeSupabase();
    const broken = Object.assign(Object.create(db), {
      from: (table: string) => {
        if (table === "oauth_states") throw new Error("pool exhausted");
        return db.from(table);
      },
    }) as FakeSupabase;
    const { clk, deps, entries } = harness("2026-09-02T02:00:30.000Z", { db: broken });
    const worker = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false, sweepIntervalMs: 10 * 60_000 });
    expect((await worker.tick()).swept).toBe(true);
    expect(entries.find((e) => e.event === "sweep.failed")).toMatchObject({ error: "pool exhausted" });
    clk.advanceHours(5 / 60);
    expect((await worker.tick()).swept).toBe(false);
    clk.advanceHours(5 / 60);
    expect((await worker.tick()).swept).toBe(true);
    expect(entries.filter((e) => e.event === "sweep.failed")).toHaveLength(2);
  });
});
