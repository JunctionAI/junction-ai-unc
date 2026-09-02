import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRoutine } from "../../lib/runtime/engine";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { setEnabled } from "../../lib/runtime/versioning";
import { budgetMoveSpec, clock, FakeProducer, input, SPEND_FIXTURE } from "../../lib/runtime/__tests__/helpers";
import { StaticAccountsSource, type WorkerAccount } from "../accounts";
import { FixtureCredentialProvider } from "../credentials";
import { heartbeatIsFresh } from "../health";
import { createLogger, memorySink } from "../log";
import { readHeartbeatFile, Worker, type WorkerDeps } from "../loop";
import { StaticReader } from "../../lib/runtime/providers";
import { NOT_IMPLEMENTED_REASON } from "../providers/executor";
import { assertModeAllowed, buildAdapters, collectCandidates, LIVE_MODE_ENABLED, resumeApproval, triggerRun, WorkerError } from "../service";

const ACCT: WorkerAccount = { account: { accountId: "acct-1", currency: "NZD", budgetMonthly: 3000, approver: "Tom" }, vars: { niche: "natural health" } };

function harness(startAt = "2026-09-02T07:00:30.000Z") {
  const clk = clock(startAt);
  const store = new MemoryStore();
  const { sink, entries } = memorySink();
  const deps: WorkerDeps = { store, accounts: new StaticAccountsSource([ACCT]), credentials: new FixtureCredentialProvider(), llm: null, producer: new FakeProducer(), db: null, now: clk.now, log: createLogger(sink, {}, clk.now) };
  return { clk, store, deps, entries };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("LIVE_MODE_ENABLED", () => {
  it("is false and the service refuses live runs", () => {
    expect(LIVE_MODE_ENABLED).toBe(false);
    expect(assertModeAllowed(undefined)).toBe("dry_run");
    expect(assertModeAllowed("dry_run")).toBe("dry_run");
    expect(() => assertModeAllowed("live")).toThrow(WorkerError);
    expect(() => assertModeAllowed("live")).toThrow(/live mode is disabled/);
  });
});

describe("a full loop tick against MemoryStore", () => {
  it("dry-runs the due routines, writes receipts, and never runs the same slot twice", async () => {
    const { clk, store, deps, entries } = harness();
    await setEnabled({ store, now: clk.now }, "acct-1", "D05-W02", true); // abandoned cart recovery, daily 07:00, gated (draft-only)
    await setEnabled({ store, now: clk.now }, "acct-1", "D01-W02", true); // weekly Monday — not due on a Wednesday
    await setEnabled({ store, now: clk.now }, "acct-1", "D01-W01", false); // disabled

    const worker = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false });
    const report = await worker.tick();

    expect(report).toMatchObject({ accounts: 1, candidates: 3, due: 1, deferred: 0 });
    expect(report.started).toHaveLength(1);
    expect(report.started[0]).toMatchObject({ accountId: "acct-1", routineId: "D05-W02", status: "done", slot: "2026-09-02T07:00:00.000Z" });

    const runs = await store.listRuns("acct-1");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ routineId: "D05-W02", mode: "dry_run", status: "done" });
    expect(runs[0].snapshot).toBeUndefined();

    const receipts = await store.listReceipts("acct-1", { runId: runs[0].id });
    // read ×3 → the produce step's "Drafted:" receipt → the gate preview → the run receipt
    expect(receipts.map((r) => r.kind)).toEqual(["read", "read", "read", "draft", "draft", "draft"]);
    // reads are fixture-provenanced, never mistaken for live data
    for (const r of receipts.filter((x) => x.kind === "read")) expect(r.payload.provenance).toBe("fixture");
    // the artifact is stored and linked from its draft receipt
    const drafted = receipts.find((r) => r.description.startsWith("Drafted:"))!;
    expect((await store.listArtifacts("acct-1")).map((a) => a.id)).toEqual([drafted.payload.artifactId]);
    // the gate became a "Would ask" draft preview carrying the artifact — no approval was created in dry run
    const gate = receipts.find((r) => r.description.startsWith("Would ask"))!;
    expect(gate.description).toBe("Would ask Tom: 3 founder posts: why we ship from Auckland — from 5 carts abandoned this week");
    expect((gate.payload.approvalPreview as { artifactId: string }).artifactId).toBe(drafted.payload.artifactId);
    expect(await store.listApprovals("acct-1")).toHaveLength(0);
    // no mutation receipts, no spend
    expect(receipts.some((r) => r.kind === "mutation")).toBe(false);
    expect(worker.adapters.executor.refused).toHaveLength(0);

    // second tick a minute later: slot already served → nothing new
    clk.advanceHours(1 / 60);
    const again = await worker.tick();
    expect(again.due).toBe(0);
    expect(again.started).toHaveLength(0);
    expect(await store.listRuns("acct-1")).toHaveLength(1);

    // next day 07:00 → fires again
    clk.advanceHours(24);
    const tomorrow = await worker.tick();
    expect(tomorrow.started.map((s) => s.routineId)).toEqual(["D05-W02"]);
    expect(await store.listRuns("acct-1")).toHaveLength(2);

    expect(worker.stats).toMatchObject({ ticks: 3, runsStarted: 2 });
    const events = entries.map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(["tick.start", "run.start", "run.finish", "tick.end"]));
    expect(JSON.stringify(entries)).not.toMatch(/accessToken|apiKey/);
  });

  it("collectCandidates reports the effective cadence and the newest run", async () => {
    const { clk, store } = harness();
    await setEnabled({ store, now: clk.now }, "acct-1", "D02-W03", true);
    const before = await collectCandidates(store, "acct-1");
    expect(before).toEqual([{ accountId: "acct-1", routineId: "D02-W03", enabled: true, cadence: "0 */6 * * *", lastRunStartedAt: undefined, lastRunInFlight: false }]);
    await store.createRun({ id: "r1", accountId: "acct-1", routineId: "D02-W03", version: 1, mode: "dry_run", status: "running", startedAt: clk.now().toISOString() });
    const after = await collectCandidates(store, "acct-1");
    expect(after[0]).toMatchObject({ lastRunStartedAt: "2026-09-02T07:00:30.000Z", lastRunInFlight: true });
  });

  it("honours the per-tick time budget and defers the rest", async () => {
    const { clk, store, deps, entries } = harness();
    for (const id of ["D01-W01", "D01-W05", "D02-W01", "D05-W02"]) await setEnabled({ store, now: clk.now }, "acct-1", id, true);
    // a store whose createRun takes ~8ms makes elapsed time deterministic enough: budget 1ms → first run starts, the rest defer
    const slow = Object.assign(Object.create(store), {
      createRun: async (run: Parameters<MemoryStore["createRun"]>[0]) => {
        await new Promise((r) => setTimeout(r, 8));
        return store.createRun(run);
      },
    }) as MemoryStore;
    const worker = new Worker({ ...deps, store: slow }, { intervalSec: 60, tickBudgetMs: 1, heartbeatPath: null, handleSignals: false });
    const report = await worker.tick();
    expect(report.due).toBe(4);
    expect(report.started).toHaveLength(1);
    expect(report.deferred).toBe(3);
    expect(entries.some((e) => e.event === "tick.budget_exhausted")).toBe(true);
    // the deferred three are still due next tick (their slot is unserved); the started one is not
    clk.advanceHours(1 / 60);
    const next = await worker.tick();
    expect(next.due).toBe(3);
  });

  it("survives a routine that errors and keeps ticking", async () => {
    const { clk, store, deps, entries } = harness();
    await setEnabled({ store, now: clk.now }, "acct-1", "D01-W01", true);
    const broken: WorkerDeps = { ...deps, store: Object.assign(Object.create(store), { createRun: async () => { throw new Error("db down"); } }) as MemoryStore };
    const worker = new Worker(broken, { heartbeatPath: null, handleSignals: false });
    const report = await worker.tick();
    expect(report.started[0]).toMatchObject({ status: "error", error: "db down" });
    expect(worker.stats.lastError).toBe("db down");
    expect(entries.some((e) => e.event === "run.error")).toBe(true);
  });

  it("writes an atomic heartbeat file that the health check can read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unc-worker-"));
    tmpDirs.push(dir);
    const path = join(dir, "nested", "heartbeat.json");
    const { clk, deps } = harness();
    const worker = new Worker(deps, { heartbeatPath: path, handleSignals: false });
    await worker.tick();
    const hb = readHeartbeatFile(path)!;
    expect(hb).toMatchObject({ pid: process.pid, ticks: 1, runsStarted: 0, mode: "dry_run", liveModeEnabled: false, stopping: false, lastTickAt: "2026-09-02T07:00:30.000Z" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(hb);
    expect(heartbeatIsFresh(hb, clk.now(), 180_000)).toBe(true);
    clk.advanceHours(1);
    expect(heartbeatIsFresh(hb, clk.now(), 180_000)).toBe(false);
    await worker.stop();
    expect(readHeartbeatFile(path)!.stopping).toBe(true);
    expect(heartbeatIsFresh(readHeartbeatFile(path), clk.now(), 10 ** 9)).toBe(false);
    expect(readHeartbeatFile(join(dir, "missing.json"))).toBeNull();
  });

  it("start() ticks immediately; stop() waits for the in-flight tick", async () => {
    const { clk, store, deps } = harness();
    await setEnabled({ store, now: clk.now }, "acct-1", "D05-W02", true);
    const worker = new Worker(deps, { intervalSec: 3600, heartbeatPath: null, handleSignals: false });
    worker.start();
    await worker.whenIdle();
    expect(worker.stats.ticks).toBe(1);
    expect(await store.listRuns("acct-1")).toHaveLength(1);
    await worker.stop();
    expect(worker.isStopping).toBe(true);
    // a later tick after stop is a no-op for new work: still nothing beyond the one run
    expect(await store.listRuns("acct-1")).toHaveLength(1);
  });

  it("stop() during a tick defers the runs it had not started (graceful SIGTERM semantics)", async () => {
    const { clk, store, deps, entries } = harness();
    await setEnabled({ store, now: clk.now }, "acct-1", "D05-W02", true);
    const worker = new Worker(deps, { intervalSec: 3600, heartbeatPath: null, handleSignals: false });
    worker.start();
    await worker.stop(); // stopping flag is seen before the first run starts
    expect(worker.stats.ticks).toBe(1);
    expect(await store.listRuns("acct-1")).toHaveLength(0);
    expect(entries.some((e) => e.event === "tick.stopping" && e.deferred === 1)).toBe(true);
  });
});

describe("manual trigger (the API's path)", () => {
  it("runs regardless of enabled, merges vars, and refuses unknown ids and live mode", async () => {
    const { store, deps } = harness();
    const res = await triggerRun(deps, { accountId: "acct-1", routineId: "D01-W02", vars: { hashtags: "#golf" } }); // weekly, never enabled
    expect(res.mode).toBe("dry_run");
    expect(res.status).toBe("skipped"); // tiktok/instagram have no reader → empty fixture → check fails quietly
    expect(res.summary).toContain("Fewer than 10 breakout videos");
    expect((await store.listRuns("acct-1"))[0]).toMatchObject({ routineId: "D01-W02", mode: "dry_run" });

    await expect(triggerRun(deps, { accountId: "nobody", routineId: "D01-W01" })).rejects.toMatchObject({ code: "unknown_account" });
    const fallback = await triggerRun(deps, { accountId: "nobody", routineId: "D01-W01", accountFallback: { currency: "AUD", budgetMonthly: 900 } });
    expect(fallback.routineId).toBe("D01-W01");
    await expect(triggerRun(deps, { accountId: "acct-1", routineId: "D09-W01" })).rejects.toMatchObject({ code: "unknown_routine" });
    await expect(triggerRun(deps, { accountId: "acct-1", routineId: "D01-W01", mode: "live" })).rejects.toMatchObject({ code: "live_mode_disabled" });
    expect(deps.store === store).toBe(true);
  });
});

describe("resume (the API's path)", () => {
  // Dry runs never pause. To exercise resume we seed a paused LIVE run straight
  // through the engine — something the worker/API never do — using the
  // worker's own adapters, so the refusing executor is what an approval hits.
  async function seedPaused() {
    const { clk, store, deps } = harness();
    const adapters = { ...buildAdapters(deps), reader: new StaticReader(SPEND_FIXTURE, clk.now) };
    const paused = await runRoutine(budgetMoveSpec(), input(), adapters, { mode: "live" });
    expect(paused.status).toBe("waiting_approval");
    expect((await store.getRun(paused.runId))!.status).toBe("waiting_approval");
    expect(await store.listApprovals("acct-1", "pending")).toHaveLength(1);
    return { clk, store, deps, adapters, paused };
  }

  it("a gated routine waiting_approval → held ends skipped, nothing executed", async () => {
    const { store, deps, adapters, paused } = await seedPaused();
    const res = await resumeApproval(deps, { runId: paused.runId, decision: "held", decidedBy: "user-tom" }, adapters);
    expect(res.status).toBe("skipped");
    expect(res.summary).toContain("Held");
    expect((await store.getApproval(paused.approval!.id))!).toMatchObject({ status: "held", decidedBy: "user-tom" });
    expect(adapters.executor.refused).toHaveLength(0);
    expect(await store.listTasteEvents("acct-1")).toMatchObject([{ action: "held" }]);
  });

  it("approved reaches execute and the refusing executor fails it closed with a not_implemented receipt", async () => {
    const { store, deps, adapters, paused } = await seedPaused();
    const res = await resumeApproval(deps, { runId: paused.runId, decision: "approved", decidedBy: "user-tom" }, adapters);
    expect(res.status).toBe("failed");
    expect(res.error).toBe(NOT_IMPLEMENTED_REASON);
    expect(adapters.executor.refused).toEqual([{ action: "update_adset_budget", platform: "meta_ads", runId: paused.runId }]);
    const receipts = await store.listReceipts("acct-1", { runId: paused.runId });
    expect(receipts.some((r) => r.kind === "mutation")).toBe(false);
    expect(receipts.at(-1)!.description).toContain(NOT_IMPLEMENTED_REASON);
    expect(await store.sumSpend("acct-1", "2026-09-01T00:00:00.000Z", "2026-09-03T00:00:00.000Z")).toBe(0);
  });

  it("rejects unknown and already-decided runs the way the API maps them", async () => {
    const { deps, adapters, paused } = await seedPaused();
    await expect(resumeApproval(deps, { runId: "nope", decision: "approved" }, adapters)).rejects.toThrow(/not found/);
    await resumeApproval(deps, { runId: paused.runId, decision: "held" }, adapters);
    await expect(resumeApproval(deps, { runId: paused.runId, decision: "approved" }, adapters)).rejects.toThrow(/not waiting_approval/);
  });
});
