/* SupabaseStore against the schema-checked fake:
   1. call-shape tests — table / columns / filters / order / onConflict per method;
   2. parity — the runtime's gate, spend-cap and dedup scenarios run on BOTH stores. */

import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { resumeRun, runRoutine, type Adapters } from "../../engine";
import { DeterministicDecisionProvider, StaticReader } from "../../providers";
import { RecordingExecutor, SPEND_FIXTURE, T0, account, budgetMoveSpec, clock, input } from "../../__tests__/helpers";
import type { ApprovalRecord, Receipt, TasteEvent } from "../../types";
import type { RunRecord, Store } from "../interface";
import { MemoryStore } from "../memory";
import { SupabaseStore } from "../supabase";

const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ACCT = U(1);

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: U(10),
  accountId: ACCT,
  routineId: "D02-W01",
  version: 1,
  mode: "live",
  status: "running",
  startedAt: "2026-09-02T07:00:00.000Z",
  ...over,
});
const approval = (over: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  id: U(20),
  accountId: ACCT,
  runId: U(10),
  routineId: "D02-W01",
  title: "Move NZD 20/day",
  status: "pending",
  expiresAt: "2026-09-03T07:00:00.000Z",
  createdAt: "2026-09-02T07:00:00.000Z",
  ...over,
});
const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: U(30),
  accountId: ACCT,
  runId: U(10),
  kind: "read",
  description: "Read spend",
  payload: { rows: 1 },
  createdAt: "2026-09-02T07:00:00.000Z",
  ...over,
});

function fresh() {
  const db = new FakeSupabase();
  return { db, store: new SupabaseStore(db) };
}

describe("SupabaseStore call shapes (columns/filters match the migrations)", () => {
  it("routine_states: select by the composite key, upsert on it", async () => {
    const { db, store } = fresh();
    expect(await store.getRoutineState(ACCT, "D01-W01")).toBeNull();
    expect(db.lastCall("routine_states", "select")).toMatchObject({
      columns: "*",
      filters: [
        { kind: "eq", column: "account_id", value: ACCT },
        { kind: "eq", column: "routine_id", value: "D01-W01" },
      ],
      single: "maybeSingle",
    });
    const rec = { accountId: ACCT, routineId: "D01-W01", enabled: true, version: 2, draftSpec: null, liveSpec: budgetMoveSpec({ id: "D01-W01", version: 2 }), updatedAt: T0 };
    expect(await store.putRoutineState(rec)).toEqual(rec);
    expect(db.lastCall("routine_states", "upsert")).toMatchObject({
      onConflict: "account_id,routine_id",
      values: { account_id: ACCT, routine_id: "D01-W01", enabled: true, version: 2, draft_spec: null, live_spec: rec.liveSpec, updated_at: T0 },
      single: "single",
      returning: true,
    });
    expect(await store.getRoutineState(ACCT, "D01-W01")).toEqual(rec);
  });

  it("routine_runs: insert writes the 0002 columns; explicit undefined clears via NULL; duplicates throw", async () => {
    const { db, store } = fresh();
    const r = run({ dedupKey: "D02-W01:2026-09-02", specHash: "abc", snapshot: { spec: budgetMoveSpec(), ctx: {} as never, nextNodeIndex: 5 } });
    expect(await store.createRun(r)).toEqual(r);
    expect(db.lastCall("routine_runs", "insert").values).toEqual({
      id: r.id,
      account_id: ACCT,
      routine_id: "D02-W01",
      version: 1,
      mode: "live",
      status: "running",
      started_at: r.startedAt,
      finished_at: null,
      summary: null,
      approval_id: null,
      dedup_key: "D02-W01:2026-09-02",
      spec_hash: "abc",
      snapshot: r.snapshot,
    });
    await expect(store.createRun(r)).rejects.toThrow(/duplicate key/);

    const done = await store.updateRun(r.id, { status: "done", finishedAt: "2026-09-02T08:00:00.000Z", summary: "ok", snapshot: undefined });
    expect(db.lastCall("routine_runs", "update")).toMatchObject({
      values: { status: "done", finished_at: "2026-09-02T08:00:00.000Z", summary: "ok", snapshot: null },
      filters: [{ kind: "eq", column: "id", value: r.id }],
      single: "single",
    });
    expect(done.snapshot).toBeUndefined();
    expect("snapshot" in done).toBe(false);
    expect(done.dedupKey).toBe("D02-W01:2026-09-02");
    await expect(store.updateRun(U(99), { status: "done" })).rejects.toThrow(/routine_runs\.update/);
    expect(await store.getRun(U(99))).toBeNull();
  });

  it("routine_runs: listRuns applies every filter, newest first, limited", async () => {
    const { db, store } = fresh();
    await store.createRun(run({ id: U(11), startedAt: "2026-09-01T07:00:00.000Z", dedupKey: "k" }));
    await store.createRun(run({ id: U(12), startedAt: "2026-09-03T07:00:00.000Z", dedupKey: "k", mode: "dry_run" }));
    await store.createRun(run({ id: U(13), startedAt: "2026-09-02T07:00:00.000Z", dedupKey: "k" }));
    const out = await store.listRuns(ACCT, { routineId: "D02-W01", mode: "live", status: "running", version: 1, dedupKey: "k", since: "2026-09-01T07:00:00.000Z", limit: 5 });
    expect(out.map((r) => r.id)).toEqual([U(13), U(11)]);
    expect(db.lastCall("routine_runs", "select")).toMatchObject({
      filters: [
        { kind: "eq", column: "account_id", value: ACCT },
        { kind: "eq", column: "routine_id", value: "D02-W01" },
        { kind: "eq", column: "mode", value: "live" },
        { kind: "eq", column: "status", value: "running" },
        { kind: "eq", column: "version", value: 1 },
        { kind: "eq", column: "dedup_key", value: "k" },
        { kind: "gte", column: "started_at", value: "2026-09-01T07:00:00.000Z" },
      ],
      order: { column: "started_at", ascending: false },
      limit: 5,
    });
  });

  it("approvals: insert/update/list columns", async () => {
    const { db, store } = fresh();
    await store.createRun(run());
    const a = approval({ detail: "d", beforeState: "b", afterState: "a", reasoning: "r" });
    expect(await store.createApproval(a)).toEqual(a);
    expect(db.lastCall("approvals", "insert").values).toEqual({
      id: a.id,
      account_id: ACCT,
      run_id: U(10),
      routine_id: "D02-W01",
      title: "Move NZD 20/day",
      detail: "d",
      before_state: "b",
      after_state: "a",
      reasoning: "r",
      status: "pending",
      expires_at: a.expiresAt,
      decided_at: null,
      decided_by: null,
      created_at: a.createdAt,
    });
    const upd = await store.updateApproval(a.id, { status: "approved", decidedAt: "2026-09-02T09:00:00.000Z", decidedBy: U(7) });
    expect(db.lastCall("approvals", "update")).toMatchObject({ values: { status: "approved", decided_at: "2026-09-02T09:00:00.000Z", decided_by: U(7) }, filters: [{ kind: "eq", column: "id", value: a.id }] });
    expect(upd).toEqual({ ...a, status: "approved", decidedAt: "2026-09-02T09:00:00.000Z", decidedBy: U(7) });
    expect(await store.listApprovals(ACCT, "pending")).toEqual([]);
    expect(db.lastCall("approvals", "select")).toMatchObject({
      filters: [
        { kind: "eq", column: "account_id", value: ACCT },
        { kind: "eq", column: "status", value: "pending" },
      ],
      order: { column: "created_at", ascending: false },
    });
    expect((await store.listApprovals(ACCT)).map((x) => x.id)).toEqual([a.id]);
    await expect(store.updateApproval(U(99), { status: "held" })).rejects.toThrow(/approvals\.update/);
  });

  it("receipts: spend folds into payload.spend and unfolds on read; ordering per contract", async () => {
    const { db, store } = fresh();
    await store.createRun(run());
    const m = receipt({ id: U(31), kind: "mutation", platform: "meta_ads", approvalId: undefined, spend: { amount: 20, currency: "NZD", period: "day" }, createdAt: "2026-09-02T07:00:02.000Z" });
    expect(await store.appendReceipt(m)).toEqual(m);
    expect(db.lastCall("receipts", "insert").values).toEqual({
      id: m.id,
      account_id: ACCT,
      run_id: U(10),
      approval_id: null,
      kind: "mutation",
      platform: "meta_ads",
      description: "Read spend",
      payload: { rows: 1, spend: { amount: 20, currency: "NZD", period: "day" } },
      created_at: m.createdAt,
    });
    await store.appendReceipt(receipt({ id: U(32), createdAt: "2026-09-02T07:00:01.000Z" }));
    expect((await store.listReceipts(ACCT, { runId: U(10) })).map((r) => r.id)).toEqual([U(32), U(31)]); // oldest first within a run
    expect(db.lastCall("receipts", "select")).toMatchObject({ filters: [{ column: "account_id" }, { kind: "eq", column: "run_id", value: U(10) }], order: { column: "created_at", ascending: true } });
    expect((await store.listReceipts(ACCT)).map((r) => r.id)).toEqual([U(31), U(32)]); // newest first across the account
    expect((await store.listReceipts(ACCT, { kind: "mutation", since: "2026-09-02T07:00:02.000Z", limit: 1 })).map((r) => r.id)).toEqual([U(31)]);
    expect(db.lastCall("receipts", "select")).toMatchObject({ filters: [{ column: "account_id" }, { kind: "eq", column: "kind", value: "mutation" }, { kind: "gte", column: "created_at" }], limit: 1 });
  });

  it("sumSpend selects payload of mutation receipts with since <= created_at <= until (inclusive)", async () => {
    const { db, store } = fresh();
    await store.createRun(run());
    const at = (s: string, id: number, amount: number, kind: Receipt["kind"] = "mutation") =>
      store.appendReceipt(receipt({ id: U(id), kind, createdAt: s, spend: { amount, currency: "NZD", period: "day" } }));
    await at("2026-09-02T00:00:00.000Z", 40, 5); // exactly since
    await at("2026-09-02T12:00:00.000Z", 41, 7);
    await at("2026-09-02T23:59:59.999Z", 42, 11); // exactly until
    await at("2026-09-01T23:59:59.999Z", 43, 100); // before
    await at("2026-09-03T00:00:00.000Z", 44, 100); // after
    await at("2026-09-02T12:00:00.000Z", 45, 100, "draft"); // wrong kind
    expect(await store.sumSpend(ACCT, "2026-09-02T00:00:00.000Z", "2026-09-02T23:59:59.999Z")).toBe(23);
    expect(db.lastCall("receipts", "select")).toMatchObject({
      columns: "payload",
      filters: [
        { kind: "eq", column: "account_id", value: ACCT },
        { kind: "eq", column: "kind", value: "mutation" },
        { kind: "gte", column: "created_at", value: "2026-09-02T00:00:00.000Z" },
        { kind: "lte", column: "created_at", value: "2026-09-02T23:59:59.999Z" },
      ],
    });
    expect(await store.sumSpend(U(2), "2026-09-02T00:00:00.000Z", "2026-09-02T23:59:59.999Z")).toBe(0);
  });

  it("taste_events: insert columns", async () => {
    const { db, store } = fresh();
    const e: TasteEvent = { id: U(50), accountId: ACCT, routineId: "D02-W01", action: "approved", context: { a: 1 }, createdAt: T0 };
    expect(await store.appendTasteEvent(e)).toEqual(e);
    expect(db.lastCall("taste_events", "insert").values).toEqual({ id: e.id, account_id: ACCT, approval_id: null, routine_id: "D02-W01", action: "approved", context: { a: 1 }, created_at: T0 });
  });

  it("timestamps come back ISO-normalised even when Postgres formats them differently", async () => {
    const { db, store } = fresh();
    db.seed("routine_runs", [{ id: U(60), account_id: ACCT, routine_id: "x", version: 1, mode: "live", status: "done", started_at: "2026-09-02 07:00:00+00", finished_at: "2026-09-02T08:00:00+00:00" }]);
    const r = (await store.getRun(U(60)))!;
    expect(r.startedAt).toBe("2026-09-02T07:00:00.000Z");
    expect(r.finishedAt).toBe("2026-09-02T08:00:00.000Z");
    expect(r.summary).toBeUndefined();
  });
});

// ---------- parity: the engine's scenarios on both stores ----------

function engine(store: Store) {
  const clk = clock();
  const executor = new RecordingExecutor();
  const a: Adapters = { reader: new StaticReader(SPEND_FIXTURE, clk.now), decider: new DeterministicDecisionProvider(), executor, store, now: clk.now };
  return { a, executor, clk, store };
}

describe.each([
  ["MemoryStore", () => new MemoryStore() as Store],
  ["SupabaseStore + fake", () => new SupabaseStore(new FakeSupabase()) as Store],
])("engine parity on %s", (_name, make) => {
  it("gate pauses the live run; approve resumes, executes, receipts the mutation, clears the snapshot", async () => {
    const { a, executor, store } = engine(make());
    const paused = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(paused.status).toBe("waiting_approval");
    expect(paused.approval?.expiresAt).toBe("2026-09-03T07:00:00.000Z");
    const stored = (await store.getRun(paused.runId))!;
    expect(stored.status).toBe("waiting_approval");
    expect(stored.snapshot?.nextNodeIndex).toBe(5);
    expect((await store.listApprovals("acct-1", "pending")).map((x) => x.id)).toEqual([paused.approval!.id]);

    const done = await resumeRun(paused.runId, "approved", a, { decidedBy: "user-tom" });
    expect(done.status).toBe("done");
    expect(done.summary).toBe("Done: Scale the winner");
    expect(executor.calls).toHaveLength(1);
    const approval = (await store.getApproval(paused.approval!.id))!;
    expect(approval).toMatchObject({ status: "approved", decidedBy: "user-tom" });
    const receipts = await store.listReceipts("acct-1", { runId: paused.runId });
    expect(receipts.map((r) => r.kind)).toEqual(["read", "notification", "draft", "notification", "notification", "mutation", "notification"]);
    const mutation = receipts.find((r) => r.kind === "mutation")!;
    expect(mutation.spend).toEqual({ amount: 20, currency: "NZD", period: "day" });
    expect(mutation.approvalId).toBe(approval.id);
    expect(mutation.payload.externalRef).toBe("ext-1");
    expect((await store.getRun(paused.runId))!.snapshot).toBeUndefined();
    expect((await store.listApprovals("acct-1", "pending")).length).toBe(0);
  });

  it("held terminates the run without executing; a second resume is refused", async () => {
    const { a, executor, store } = engine(make());
    const paused = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    const res = await resumeRun(paused.runId, "held", a, { decidedBy: "user-tom" });
    expect(res.status).toBe("skipped");
    expect(executor.calls).toHaveLength(0);
    expect((await store.getApproval(paused.approval!.id))!.status).toBe("held");
    await expect(resumeRun(paused.runId, "approved", a)).rejects.toThrow(/not waiting_approval/);
  });

  it("spend already receipted today counts against the daily cap (sumSpend window)", async () => {
    const { a, executor } = engine(make());
    const acct = account({ caps: { currency: "NZD", perDay: 30, perMonth: 1000 } });
    const p1 = await runRoutine(budgetMoveSpec(), input({ account: acct }), a, { mode: "live" });
    expect((await resumeRun(p1.runId, "approved", a)).status).toBe("done");
    const p2 = await runRoutine(budgetMoveSpec(), input({ account: acct, triggeredBy: "manual" }), a, { mode: "live" });
    const r2 = await resumeRun(p2.runId, "approved", a);
    expect(r2.status).toBe("failed");
    expect(r2.error).toMatch(/today's spend to NZD 40.00, over the NZD 30.00\/day cap/);
    expect(executor.calls).toHaveLength(1);
  });

  it("scheduled live runs dedupe per day; manual runs do not", async () => {
    const { a } = engine(make());
    const first = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(first.status).toBe("waiting_approval");
    const second = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    expect(second.status).toBe("skipped");
    expect(second.summary).toContain("Already ran today");
    const manual = await runRoutine(budgetMoveSpec(), input({ triggeredBy: "manual" }), a, { mode: "live" });
    expect(manual.status).toBe("waiting_approval");
  });

  it("sumSpend is inclusive at both ends and ignores non-mutation receipts", async () => {
    const store = make();
    await store.createRun(run({ accountId: "acct-1" }));
    const r = (id: number, createdAt: string, amount: number, kind: Receipt["kind"] = "mutation") =>
      store.appendReceipt(receipt({ id: U(id), accountId: "acct-1", createdAt, kind, spend: { amount, currency: "NZD", period: "day" } }));
    await r(1, "2026-09-02T00:00:00.000Z", 1);
    await r(2, "2026-09-02T23:59:59.999Z", 2);
    await r(3, "2026-09-01T23:59:59.999Z", 4);
    await r(4, "2026-09-03T00:00:00.000Z", 8);
    await r(5, "2026-09-02T12:00:00.000Z", 16, "draft");
    expect(await store.sumSpend("acct-1", "2026-09-02T00:00:00.000Z", "2026-09-02T23:59:59.999Z")).toBe(3);
  });

  it("listRuns is newest-first with filters + limit; getRun round-trips optional fields", async () => {
    const store = make();
    await store.createRun(run({ accountId: "acct-1", id: U(11), startedAt: "2026-09-01T07:00:00.000Z" }));
    await store.createRun(run({ accountId: "acct-1", id: U(12), startedAt: "2026-09-03T07:00:00.000Z", status: "done", finishedAt: "2026-09-03T07:05:00.000Z", summary: "s" }));
    await store.createRun(run({ accountId: "acct-1", id: U(13), startedAt: "2026-09-02T07:00:00.000Z" }));
    expect((await store.listRuns("acct-1")).map((x) => x.id)).toEqual([U(12), U(13), U(11)]);
    expect((await store.listRuns("acct-1", { status: "running", limit: 1 })).map((x) => x.id)).toEqual([U(13)]);
    expect((await store.listRuns("acct-1", { since: "2026-09-02T07:00:00.000Z" })).map((x) => x.id)).toEqual([U(12), U(13)]);
    expect(await store.getRun(U(12))).toEqual(run({ accountId: "acct-1", id: U(12), startedAt: "2026-09-03T07:00:00.000Z", status: "done", finishedAt: "2026-09-03T07:05:00.000Z", summary: "s" }));
    expect(await store.listRuns("someone-else")).toEqual([]);
  });
});
