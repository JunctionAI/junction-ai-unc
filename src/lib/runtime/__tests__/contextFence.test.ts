import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { assertRuntimeContext } from "../../db/runtimeContext";
import { assertSameRuntimeContext, runtimeGeneration, RuntimeContextError } from "../contextFence";
import { runRoutine, resumeRun, resumeRunWithInput, completeExternalArtifact } from "../engine";
import { SupabaseStore } from "../store/supabase";
import { DbAccountsSource } from "../../../worker/accounts";
import { buildAdapters } from "../../../worker/service";
import { adapters, budgetMoveSpec, draftSpec, input, SPEND_FIXTURE, SAMPLE_ARTIFACT } from "./helpers";

const accountId = "acct-1";
const spec = () => draftSpec({ nodes: [
  { kind: "trigger", id: "t", cadence: "manual" },
  { kind: "produce", id: "p", skill: "D01-W01" },
  { kind: "gate", id: "g", title: "review", expiryHours: 24 },
  { kind: "receipt", id: "r" },
] });
function database(generation = 1, paused = false) {
  const db = new FakeSupabase();
  db.seed("accounts", [{ id: accountId, context_generation: generation, automation_paused: paused, currency: "NZD" }]);
  return db;
}

describe("captured runtime context", () => {
  it("maps only legacy absence to zero and refuses invalid generations", () => {
    expect(runtimeGeneration(undefined)).toBe(0);
    for (const x of [-1, 0.5, null, "1", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => runtimeGeneration(x)).toThrow(RuntimeContextError);
    expect(() => assertSameRuntimeContext({ accountId, contextGeneration: 1 }, { accountId })).toThrow(/old run/);
    expect(() => assertSameRuntimeContext({ accountId }, { accountId: "other" })).toThrow(/old run/);
  });
  it("permits the current generation, refuses a pause, stale identity and unavailable controls", async () => {
    const db = database();
    await expect(assertRuntimeContext(db, { accountId, contextGeneration: 1 })).resolves.toBeUndefined();
    await expect(assertRuntimeContext(db, { accountId })).rejects.toMatchObject({ code: "context_changed" });
    await expect(assertRuntimeContext(db, { accountId: "other", contextGeneration: 1 })).rejects.toMatchObject({ code: "context_unavailable" });
    await db.from("accounts").update({ automation_paused: true }).eq("id", accountId);
    await expect(assertRuntimeContext(db, { accountId, contextGeneration: 1 })).rejects.toMatchObject({ code: "automation_paused" });
    await db.from("accounts").update({ context_generation: null }).eq("id", accountId);
    await expect(assertRuntimeContext(db, { accountId })).rejects.toMatchObject({ code: "context_unavailable" });
    vi.spyOn(db, "from").mockImplementation(() => { throw new Error("secret database failure"); });
    await expect(assertRuntimeContext(db, { accountId })).rejects.toThrow("Could not verify");
  });
  it("captures DB context before inputs and rejects an intervening reset rather than rebasing", async () => {
    const db = database(2);
    const source = new DbAccountsSource(db);
    expect((await source.getAccount(accountId))?.account.contextGeneration).toBe(2);
    const original = db.from.bind(db);
    let first = true;
    vi.spyOn(db, "from").mockImplementation(table => {
      if (table === "resource_profiles" && first) {
        first = false;
        db.rows("accounts")[0].context_generation = 3;
      }
      return original(table);
    });
    await expect(source.getAccount(accountId)).rejects.toMatchObject({ code: "context_changed" });
  });
  it("builds the production DB admission guard without requiring a caller opt-in", async () => {
    const db = database();
    const { store } = adapters();
    const built = buildAdapters({ store, accounts: new DbAccountsSource(db), db, producer: null, n8n: null });
    expect(built.assertContext).toBeTypeOf("function");
    await expect(built.assertContext!({ accountId })).rejects.toMatchObject({ code: "context_changed" });
  });
  it("persists the captured generation and refuses relabelling in both stores", async () => {
    const { store, adapters: a } = adapters();
    const result = await runRoutine(spec(), input({ account: { ...input().account, contextGeneration: 4 } }), a, { mode: "dry_run" });
    const run = (await store.getRun(result.runId))!;
    expect(run.contextGeneration).toBe(4);
    const dbStore = new SupabaseStore(database(4));
    expect((await dbStore.createRun(run)).contextGeneration).toBe(4);
    for (const s of [store, dbStore]) await expect(s.updateRun(run.id, { contextGeneration: 5 })).rejects.toThrow(/immutable/);
  });
  it("rejects before run creation/provider calls when paused or stale", async () => {
    const { store, adapters: a, producer, executor } = adapters();
    a.assertContext = identity => assertRuntimeContext(database(1), identity);
    await expect(runRoutine(spec(), input(), a, { mode: "dry_run" })).rejects.toMatchObject({ code: "context_changed" });
    expect(await store.listRuns(accountId)).toEqual([]);
    expect(producer.calls).toHaveLength(0);
    expect(executor.calls).toHaveLength(0);
  });
  it("rejects a delayed producer result after reset without any artifact or failure receipt", async () => {
    const db = database(0);
    const { store, adapters: a } = adapters();
    a.assertContext = identity => assertRuntimeContext(db, identity);
    a.producer = { async produce() {
      await db.from("accounts").update({ context_generation: 1 }).eq("id", accountId);
      return { artifact: SAMPLE_ARTIFACT };
    } };
    await expect(runRoutine(spec(), input(), a, { mode: "dry_run" })).rejects.toMatchObject({ code: "context_changed" });
    expect(await store.listArtifacts(accountId)).toEqual([]);
    expect(await store.listReceipts(accountId)).toEqual([]);
    expect((await store.listRuns(accountId))[0]).toMatchObject({ contextGeneration: 0, status: "running" });
  });
  it("rejects paused work even without changing generation", async () => {
    const db = database(0);
    const { store, adapters: a } = adapters();
    a.assertContext = identity => assertRuntimeContext(db, identity);
    a.producer = { async produce() {
      await db.from("accounts").update({ automation_paused: true }).eq("id", accountId);
      return { artifact: SAMPLE_ARTIFACT };
    } };
    await expect(runRoutine(spec(), input(), a, { mode: "dry_run" })).rejects.toMatchObject({ code: "automation_paused" });
    expect(await store.listArtifacts(accountId)).toEqual([]);
  });
  it("cannot resume an old approval after reset or forge its snapshot generation", async () => {
    const db = database(0);
    const { store, adapters: a, executor } = adapters({ fixtures: SPEND_FIXTURE });
    a.assertContext = identity => assertRuntimeContext(db, identity);
    const waiting = await runRoutine(budgetMoveSpec(), input(), a, { mode: "live" });
    const before = await store.listReceipts(accountId);
    await db.from("accounts").update({ context_generation: 1 }).eq("id", accountId);
    await expect(resumeRun(waiting.runId, "approved", a)).rejects.toMatchObject({ code: "context_changed" });
    const run = (await store.getRun(waiting.runId))!;
    run.snapshot!.ctx.account.contextGeneration = 1;
    await store.updateRun(run.id, { snapshot: run.snapshot });
    await expect(resumeRun(run.id, "approved", a)).rejects.toMatchObject({ code: "context_changed" });
    expect(executor.calls).toHaveLength(0);
    expect((await store.getApproval(waiting.approval!.id))?.status).toBe("pending");
    expect(await store.listReceipts(accountId)).toEqual(before);
  });
  it("rejects old input resumes and asynchronous external artifacts", async () => {
    const db = database(0);
    const { store, adapters: a } = adapters();
    a.assertContext = identity => assertRuntimeContext(db, identity);
    a.producer = { async produce() { return { needs: [{ input: "topic", why: "required" }] }; } };
    const waiting = await runRoutine(spec(), input(), a, { mode: "dry_run" });
    const old = (await store.getRun(waiting.runId))!;
    await store.updateRun(old.id, { status: "running", snapshot: { ...old.snapshot!, awaiting: "n8n", nextNodeIndex: 2 } });
    await db.from("accounts").update({ context_generation: 1 }).eq("id", accountId);
    await expect(completeExternalArtifact(old.id, { artifact: SAMPLE_ARTIFACT }, a)).rejects.toMatchObject({ code: "context_changed" });
    await store.updateRun(old.id, { status: "waiting_input", snapshot: old.snapshot });
    await expect(resumeRunWithInput(old.id, { topic: "new text" }, a)).rejects.toMatchObject({ code: "context_changed" });
    expect(await store.listArtifacts(accountId)).toEqual([]);
  });
});
