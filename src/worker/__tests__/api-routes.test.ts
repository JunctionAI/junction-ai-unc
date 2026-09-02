import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as resumePost } from "../../app/api/routines/resume/route";
import { POST as runPost } from "../../app/api/routines/run/route";
import { runRoutine } from "../../lib/runtime/engine";
import { StaticReader } from "../../lib/runtime/providers";
import { getStore, setStoreForTests } from "../../lib/runtime/store";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { budgetMoveSpec, clock, FakeProducer, input, SPEND_FIXTURE } from "../../lib/runtime/__tests__/helpers";
import { StaticAccountsSource } from "../accounts";
import { NOT_IMPLEMENTED_REASON } from "../providers/executor";
import { buildAdapters, setProducerForTests } from "../service";

const post = (path: string, body: unknown) => new Request(`http://unc.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
  setStoreForTests(store);
  setProducerForTests(new FakeProducer());
});
afterEach(() => {
  setStoreForTests(undefined);
  setProducerForTests(undefined);
});

describe("POST /api/routines/run", () => {
  it("dry-runs the routine for the demo account and returns the receipt trail", async () => {
    const res = await runPost(post("/api/routines/run", { accountId: "demo", routineId: "D05-W02" }));
    expect(res.status).toBe(200);
    const { run } = await res.json();
    expect(run).toMatchObject({ routineId: "D05-W02", mode: "dry_run", status: "done", approval: null, needs: null });
    expect(run.receipts.map((r: { kind: string }) => r.kind)).toEqual(["read", "read", "read", "draft", "draft", "draft"]);
    expect(run.receipts.find((r: { description: string }) => r.description.startsWith("Would ask")).description).toContain("the founder");
    // the produced artifact rides on the response and is stored
    expect(run.artifact).toMatchObject({ kind: "post_set", title: "3 founder posts: why we ship from Auckland", items: 3, status: "draft" });
    expect((await getStore().listArtifacts("demo")).map((a) => a.id)).toEqual([run.artifact.id]);
    expect(run.receipts.some((r: { kind: string }) => r.kind === "mutation")).toBe(false);
    // persisted in the process-wide store the API and the loop share
    expect((await getStore().listRuns("demo")).map((r) => r.id)).toEqual([run.runId]);
  });

  it("accepts an account fallback for ids the accounts source does not know", async () => {
    const res = await runPost(post("/api/routines/run", { accountId: "acct-x", routineId: "D01-W01", account: { currency: "AUD", budgetMonthly: 1200, approver: "Sam" }, vars: { niche: "golf" } }));
    expect(res.status).toBe(200);
    const { run } = await res.json();
    expect(run.status).toBe("done");
    expect((await store.listRuns("acct-x")).length).toBe(1);
  });

  it("validates the body", async () => {
    expect((await runPost(post("/api/routines/run", "{not json"))).status).toBe(400);
    expect((await runPost(post("/api/routines/run", { routineId: "D01-W01" }))).status).toBe(400);
    expect((await runPost(post("/api/routines/run", { accountId: "demo", routineId: "nope" }))).status).toBe(400);
    expect((await runPost(post("/api/routines/run", { accountId: "demo", routineId: "D01-W01", mode: "yolo" }))).status).toBe(400);
    expect((await runPost(post("/api/routines/run", { accountId: "x", routineId: "D01-W01", account: { currency: "NZD" } }))).status).toBe(400);
    expect((await runPost(post("/api/routines/run", { accountId: "nobody", routineId: "D01-W01" }))).status).toBe(404);
  });

  it("refuses live mode with 403", async () => {
    const res = await runPost(post("/api/routines/run", { accountId: "demo", routineId: "D01-W01", mode: "live" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "live_mode_disabled" });
    expect(await store.listRuns("demo")).toHaveLength(0);
  });
});

describe("POST /api/routines/resume", () => {
  async function seedPausedLiveRun() {
    // Only live runs pause; the app never creates one. Seed through the engine
    // (triggeredBy manual so the engine's live per-day dedup lets a second seed through).
    const clk = clock();
    const adapters = { ...buildAdapters({ store, accounts: new StaticAccountsSource(), now: clk.now }), reader: new StaticReader(SPEND_FIXTURE, clk.now) };
    const paused = await runRoutine(budgetMoveSpec(), input({ account: { accountId: "demo", currency: "NZD", budgetMonthly: 3000 }, triggeredBy: "manual" }), adapters, { mode: "live" });
    expect(paused.status).toBe("waiting_approval");
    return paused;
  }

  it("validates the body", async () => {
    expect((await resumePost(post("/api/routines/resume", "{"))).status).toBe(400);
    expect((await resumePost(post("/api/routines/resume", { decision: "approved" }))).status).toBe(400);
    expect((await resumePost(post("/api/routines/resume", { runId: "r", decision: "maybe" }))).status).toBe(400);
  });

  it("404s an unknown run and 409s a run that is not waiting", async () => {
    expect((await resumePost(post("/api/routines/resume", { runId: "missing", decision: "approved" }))).status).toBe(404);
    const done = await runPost(post("/api/routines/run", { accountId: "demo", routineId: "D05-W02" }));
    const { run } = await done.json();
    const res = await resumePost(post("/api/routines/resume", { runId: run.runId, decision: "approved" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not waiting_approval/);
  });

  it("held → skipped; approved → refused executor fails the run closed", async () => {
    const paused = await seedPausedLiveRun();
    const held = await resumePost(post("/api/routines/resume", { runId: paused.runId, decision: "held", decidedBy: "user-tom" }));
    expect(held.status).toBe(200);
    expect((await held.json()).run).toMatchObject({ status: "skipped", approval: { status: "held", decidedBy: "user-tom" } });

    const paused2 = await seedPausedLiveRun();
    const approved = await resumePost(post("/api/routines/resume", { runId: paused2.runId, decision: "approved" }));
    expect(approved.status).toBe(200);
    const { run } = await approved.json();
    expect(run.status).toBe("failed");
    expect(run.error).toBe(NOT_IMPLEMENTED_REASON);
    expect(run.receipts.some((r: { kind: string }) => r.kind === "mutation")).toBe(false);
  });
});
