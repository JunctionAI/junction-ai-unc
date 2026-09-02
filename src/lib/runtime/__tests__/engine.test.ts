import { describe, expect, it } from "vitest";
import { resumeRun, runRoutine } from "../engine";
import { FailingReader } from "../providers";
import { SPEND_FIXTURE, QUESTIONS_FIXTURE, adapters, budgetMoveSpec, draftSpec, input, account, RecordingExecutor } from "./helpers";

describe("dry run", () => {
  it("runs the whole chain, never calls the executor, and writes draft receipts", async () => {
    const { adapters: a, executor, store } = adapters({ fixtures: SPEND_FIXTURE });
    const res = await runRoutine(budgetMoveSpec(), input(), a, { mode: "dry_run" });

    expect(res.status).toBe("done");
    expect(executor.calls).toHaveLength(0);
    expect(res.receipts.map((r) => r.kind)).toEqual(["read", "notification", "draft", "draft", "draft", "draft"]);
    expect(res.receipts.some((r) => r.kind === "mutation")).toBe(false);

    const decision = res.receipts.find((r) => r.description.startsWith("Decided"))!;
    expect(decision.payload.optionId).toBe("scale");
    expect((decision.payload.spend as { amount: number }).amount).toBe(20);

    const gatePreview = res.receipts.find((r) => r.description.startsWith("Would ask"))!;
    expect(gatePreview.description).toContain("Tom");
    expect((gatePreview.payload.approvalPreview as { title: string }).title).toBe("Move NZD 20/day to Prospecting NZ");

    const wouldExecute = res.receipts.find((r) => r.description.startsWith("Would update_adset_budget"))!;
    expect(wouldExecute.payload.dryRun).toBe(true);
    expect((wouldExecute.payload.mutation as { target: { adsetId: string } }).target.adsetId).toBe("as-1");
    expect((wouldExecute.payload.mutation as { params: { increase: number } }).params.increase).toBe(20);

    // no approval was created in dry run
    expect(await store.listApprovals("acct-1")).toHaveLength(0);
    const run = (await store.getRun(res.runId))!;
    expect(run.mode).toBe("dry_run");
    expect(run.status).toBe("done");
    expect(run.snapshot).toBeUndefined();
  });

  it("dry-runs a draft-only routine to done with a draft summary receipt", async () => {
    const { adapters: a } = adapters({ fixtures: QUESTIONS_FIXTURE });
    const res = await runRoutine(draftSpec(), input(), a, { mode: "dry_run" });
    expect(res.status).toBe("done");
    expect(res.receipts.at(-1)!.kind).toBe("draft");
    expect(res.receipts.at(-1)!.description).toBe("Drafts handed over.");
  });
});

describe("gate pause + resume", () => {
  it("pauses live runs at the gate; approve resumes, executes, and receipts the mutation", async () => {
    const { adapters: a, executor, store } = adapters({ fixtures: SPEND_FIXTURE });
    const paused = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });

    expect(paused.status).toBe("waiting_approval");
    expect(executor.calls).toHaveLength(0);
    expect(paused.approval?.status).toBe("pending");
    expect(paused.approval?.title).toBe("Move NZD 20/day to Prospecting NZ");
    expect(paused.approval?.beforeState).toBe("100/day");
    expect(paused.approval?.afterState).toBe("+20/day");
    expect(paused.approval?.expiresAt).toBe("2026-09-03T07:00:00.000Z");
    expect(paused.approval?.reasoning).toContain("reads.spend.top_roas = 3.10");

    const stored = (await store.getRun(paused.runId))!;
    expect(stored.status).toBe("waiting_approval");
    expect(stored.snapshot?.nextNodeIndex).toBe(5);
    expect((await store.listApprovals("acct-1", "pending")).map((x) => x.id)).toEqual([paused.approval!.id]);

    const done = await resumeRun(paused.runId, "approved", a, { decidedBy: "user-tom" });
    expect(done.status).toBe("done");
    expect(done.summary).toBe("Done: Scale the winner");
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].mutation).toEqual({ action: "update_adset_budget", target: { adsetId: "as-1" }, params: { increase: 20 } });

    const approval = (await store.getApproval(paused.approval!.id))!;
    expect(approval.status).toBe("approved");
    expect(approval.decidedBy).toBe("user-tom");

    const receipts = await store.listReceipts("acct-1", { runId: paused.runId });
    expect(receipts.map((r) => r.kind)).toEqual(["read", "notification", "draft", "notification", "notification", "mutation", "notification"]);
    const mutation = receipts.find((r) => r.kind === "mutation")!;
    expect(mutation.spend).toEqual({ amount: 20, currency: "NZD", period: "day" });
    expect(mutation.approvalId).toBe(approval.id);
    expect(mutation.platform).toBe("meta_ads");
    expect(mutation.payload.externalRef).toBe("ext-1");

    expect(await store.listTasteEvents("acct-1")).toMatchObject([{ action: "approved", approvalId: approval.id, routineId: "D02-W01" }]);
    expect((await store.getRun(paused.runId))!.snapshot).toBeUndefined();
  });

  it("held terminates the run without executing", async () => {
    const { adapters: a, executor, store } = adapters({ fixtures: SPEND_FIXTURE });
    const paused = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    const res = await resumeRun(paused.runId, "held", a, { decidedBy: "user-tom" });

    expect(res.status).toBe("skipped");
    expect(res.summary).toContain("Held");
    expect(executor.calls).toHaveLength(0);
    expect((await store.getApproval(paused.approval!.id))!.status).toBe("held");
    expect(await store.listTasteEvents("acct-1")).toMatchObject([{ action: "held" }]);
    expect((await store.listReceipts("acct-1", { runId: paused.runId })).some((r) => r.kind === "mutation")).toBe(false);
    await expect(resumeRun(paused.runId, "approved", a)).rejects.toThrow(/not waiting_approval/);
  });

  it("an expired approval cannot be approved — the run is skipped", async () => {
    const { adapters: a, executor, clk, store } = adapters({ fixtures: SPEND_FIXTURE });
    const paused = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    clk.advanceHours(25);
    const res = await resumeRun(paused.runId, "approved", a);
    expect(res.status).toBe("skipped");
    expect(executor.calls).toHaveLength(0);
    expect((await store.getApproval(paused.approval!.id))!.status).toBe("expired");
  });

  it("a draft-only routine hands the draft over at the gate and completes on approval", async () => {
    const { adapters: a, executor } = adapters({ fixtures: QUESTIONS_FIXTURE });
    const paused = await runRoutine(draftSpec(), input(), a, { mode: "live" });
    expect(paused.status).toBe("waiting_approval");
    expect(paused.approval?.title).toBe("3 posts drafted from 3 questions");
    const done = await resumeRun(paused.runId, "approved", a);
    expect(done.status).toBe("done");
    expect(executor.calls).toHaveLength(0);
  });
});

describe("hard rules on execute", () => {
  it("live execute without an approved gate is impossible — the store is re-read, a context claiming approval is not enough", async () => {
    const { adapters: a, executor, store } = adapters({ fixtures: SPEND_FIXTURE });
    const paused = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(executor.calls).toHaveLength(0);

    // Simulate a lost/forged approval write: resume is told "approved", the in-flight
    // context carries an approved record, but the store still says pending.
    const lossy = Object.create(store) as typeof store;
    lossy.updateApproval = async (id, patch) => ({ ...(await store.getApproval(id))!, ...patch });
    const res = await resumeRun(paused.runId, "approved", { ...a, store: lossy });

    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/Execution blocked — approval .* is pending, not approved/);
    expect(executor.calls).toHaveLength(0);
    const blocked = res.receipts.find((r) => r.description.includes("Execution blocked"))!;
    expect(blocked.kind).toBe("notification");
    expect((await store.listReceipts("acct-1", { runId: paused.runId })).some((r) => r.kind === "mutation")).toBe(false);
  });

  it("running a mutation spec live can never reach execute without passing through the gate", async () => {
    const { adapters: a, executor } = adapters({ fixtures: SPEND_FIXTURE });
    const res = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(res.status).toBe("waiting_approval");
    expect(executor.calls).toHaveLength(0);
    // the only way forward is resumeRun, which is the approval path
    await expect(resumeRun(res.runId, "approved", { ...a, store: Object.assign(Object.create(a.store), { getRun: async () => null }) })).rejects.toThrow(/not found/);
    expect(executor.calls).toHaveLength(0);
  });

  it("an approval from a different run does not unlock execute", async () => {
    const { adapters: a, executor, store } = adapters({ fixtures: SPEND_FIXTURE });
    const first = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    await resumeRun(first.runId, "approved", a);
    expect(executor.calls).toHaveLength(1);
    executor.calls.length = 0;

    const second = await runRoutine(budgetMoveSpec(), input({ triggeredBy: "manual" }), a, { mode: "live" });
    // a confused adapter hands back the FIRST run's approved approval when the second is decided
    const confused = Object.create(store) as typeof store;
    confused.updateApproval = async () => (await store.getApproval(first.approval!.id))!;
    const res = await resumeRun(second.runId, "approved", { ...a, store: confused });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/belongs to run/);
    expect(executor.calls).toHaveLength(0);
  });

  it("spend cap breach fails closed with an explanatory receipt", async () => {
    // budget 300/mo → 10/day cap; the decision wants 20/day
    const { adapters: a, executor } = adapters({ fixtures: SPEND_FIXTURE });
    const paused = await runRoutine(budgetMoveSpec(), input({ account: account({ budgetMonthly: 300 }) }), a, { mode: "live" });
    const res = await resumeRun(paused.runId, "approved", a);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/over the NZD 10.00\/day cap/);
    expect(executor.calls).toHaveLength(0);
    const blocked = res.receipts.find((r) => r.description.includes("Execution blocked"))!;
    expect(blocked.kind).toBe("notification");
    expect((blocked.payload.capsCheck as { ok: boolean }).ok).toBe(false);
  });

  it("spend already receipted today counts against the daily cap", async () => {
    // cap 30/day: first move of 20 passes, second move of 20 would reach 40 → blocked
    const { adapters: a, executor } = adapters({ fixtures: SPEND_FIXTURE });
    const acct = account({ caps: { currency: "NZD", perDay: 30, perMonth: 1000 } });
    const p1 = await runRoutine(budgetMoveSpec(), input({ account: acct }), a, { mode: "live" });
    expect((await resumeRun(p1.runId, "approved", a)).status).toBe("done");
    const p2 = await runRoutine(budgetMoveSpec(), input({ account: acct, triggeredBy: "manual" }), a, { mode: "live" });
    const r2 = await resumeRun(p2.runId, "approved", a);
    expect(r2.status).toBe("failed");
    expect(r2.error).toMatch(/today's spend to NZD 40.00, over the NZD 30.00\/day cap/);
    expect(executor.calls).toHaveLength(1);
  });

  it("monthly cap is enforced too", async () => {
    const { adapters: a, executor } = adapters({ fixtures: SPEND_FIXTURE });
    const acct = account({ caps: { currency: "NZD", perDay: 100, perMonth: 15 } });
    const p = await runRoutine(budgetMoveSpec(), input({ account: acct }), a, { mode: "live" });
    const r = await resumeRun(p.runId, "approved", a);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/month's spend to NZD 20.00, over the NZD 15.00\/month cap/);
    expect(executor.calls).toHaveLength(0);
  });

  it("dry run reports a would-be cap breach without failing", async () => {
    const { adapters: a } = adapters({ fixtures: SPEND_FIXTURE });
    const res = await runRoutine(budgetMoveSpec(), input({ account: account({ budgetMonthly: 300 }) }), a, { mode: "dry_run" });
    expect(res.status).toBe("done");
    const would = res.receipts.find((r) => r.description.startsWith("Would update_adset_budget"))!;
    expect(would.description).toContain("caps would block it");
  });

  it("a spec with execute but no gate is rejected before anything runs", async () => {
    const { adapters: a, store } = adapters({ fixtures: SPEND_FIXTURE });
    const spec = budgetMoveSpec();
    spec.nodes = spec.nodes.filter((n) => n.kind !== "gate");
    await expect(runRoutine(spec, input(), a, { mode: "live" })).rejects.toThrow(/execute requires a gate/);
    expect(await store.listRuns("acct-1")).toHaveLength(0);
  });

  it("executor failure is receipted and fails the run", async () => {
    const { adapters: a } = adapters({ fixtures: SPEND_FIXTURE, executor: new RecordingExecutor({ ok: false, error: "Meta 400: budget too low" }) });
    const p = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    const r = await resumeRun(p.runId, "approved", a);
    expect(r.status).toBe("failed");
    expect(r.error).toBe("Meta 400: budget too low");
    expect(r.receipts.some((x) => x.kind === "mutation")).toBe(false);
  });
});

describe("checks, decisions, reads", () => {
  it("a failing check skips the run with the reason as the receipt", async () => {
    const { adapters: a } = adapters({ fixtures: { "meta_ads:insights": { rows: [], metrics: { spend: 0 } } } });
    const res = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(res.status).toBe("skipped");
    expect(res.summary).toBe("No spend.");
    expect(res.approval).toBeUndefined();
  });

  it("onFail:'fail' turns a false check into an incident", async () => {
    const spec = budgetMoveSpec();
    const check = spec.nodes.find((n) => n.kind === "check")!;
    if (check.kind === "check") check.onFail = "fail";
    const { adapters: a } = adapters({ fixtures: { "meta_ads:insights": { rows: [], metrics: { spend: 0 } } } });
    const res = await runRoutine(spec, input(), a, { mode: "live" });
    expect(res.status).toBe("failed");
  });

  it("a terminal decision ends the run as done without a gate", async () => {
    const { adapters: a, store } = adapters({ fixtures: { "meta_ads:insights": { rows: [{}], metrics: { spend: 100, top_roas: 1.2, top_budget: 50 } } } });
    const res = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(res.status).toBe("done");
    expect(res.summary).toContain("Hold");
    expect(await store.listApprovals("acct-1")).toHaveLength(0);
  });

  it("read failures fail the run with a notification receipt", async () => {
    const { adapters: a } = adapters();
    a.reader = new FailingReader("Meta token expired");
    const res = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/read failed: Meta token expired/);
    expect(res.receipts[0].kind).toBe("notification");
  });

  it("stale certified inputs are rejected when freshnessMinutes is set", async () => {
    const spec = budgetMoveSpec();
    const read = spec.nodes[1];
    if (read.kind === "read") read.freshnessMinutes = 60;
    const { adapters: a } = adapters({ fixtures: { "meta_ads:insights": { ...SPEND_FIXTURE["meta_ads:insights"], fetchedAt: "2026-09-02T04:00:00.000Z" } } });
    const res = await runRoutine(spec, input(), a, { mode: "live" });
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/180 min old \(limit 60\)/);
  });

  it("scheduled live runs dedupe per day; manual runs do not", async () => {
    const { adapters: a } = adapters({ fixtures: SPEND_FIXTURE });
    const first = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(first.status).toBe("waiting_approval");
    const second = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(second.status).toBe("skipped");
    expect(second.summary).toContain("Already ran today");
    const manual = await runRoutine(budgetMoveSpec(), input({ triggeredBy: "manual" }), a, { mode: "live" });
    expect(manual.status).toBe("waiting_approval");
  });

  it("every read and decision appends a receipt in order", async () => {
    const { adapters: a } = adapters({ fixtures: SPEND_FIXTURE });
    const res = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(res.receipts[0]).toMatchObject({ kind: "read", platform: "meta_ads" });
    expect(res.receipts[0].payload).toMatchObject({ as: "spend", rowCount: 1, provenance: "ok" });
    expect(res.receipts[2]).toMatchObject({ kind: "draft" });
    expect(res.receipts[2].description).toMatch(/^Decided: Scale the winner/);
  });
});
