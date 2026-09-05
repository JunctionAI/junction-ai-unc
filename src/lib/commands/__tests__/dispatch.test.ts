import { describe, it, expect, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { MemoryStore } from "../../runtime/store/memory";
import { CATALOG_SPEC_BY_ID } from "../../runtime/catalog-specs";
import { DbCommandQueue, commandId } from "../queue";
import { dispatchMessage, type DispatchDeps } from "../dispatch";
import { parseIntent } from "../interpret";
import { processCommand, reconcileCommand } from "../process";
import { commandOwner } from "../deps";
import type { CommandActor, RoutineCommand } from "../types";
import { assertRuntimeContext } from "../../db/runtimeContext";

const actor: CommandActor = { accountId: "account-a", userId: "owner-a", channel: "app", requestId: "message-1" };
const T0 = "2026-09-04T01:00:00.000Z";
async function setup(routineId = "D01-W01") {
  const db = new FakeSupabase();
  db.seed("accounts", [{ id: actor.accountId, context_generation: 0, automation_paused: false }]);
  const store = new MemoryStore();
  const queue = new DbCommandQueue(db);
  await store.putRoutineState({ accountId: actor.accountId, routineId, enabled: true, version: 1, liveSpec: null, draftSpec: null, updatedAt: T0 });
  const deps: DispatchDeps = { store, queue, assertContext: (accountId, contextGeneration) => assertRuntimeContext(db, { accountId, contextGeneration }), isOwner: vi.fn(async () => true), connected: async () => ["meta_ads", "shopify", "search_console", "ga4", "klaviyo"], business: async () => null, budget: vi.fn(async () => true), interpret: vi.fn(async () => ({ kind: "run" as const, routineId })), now: () => new Date(T0) };
  const enqueue = async (text = "Run the founder content routine") => {
    await dispatchMessage(deps, actor, text);
    return (await queue.get(actor.accountId, commandId(actor)))!;
  };
  return { db, store, queue, deps, enqueue };
}

describe("structured intent", () => {
  const caps = [{ id: "D01-W01", name: "Founder content", purpose: "Draft", enabled: true }];
  it("accepts only a known high confidence routine", () => {
    expect(parseIntent('{"kind":"run","routineId":"D01-W01","confidence":0.99}', caps)).toEqual({ kind: "run", routineId: "D01-W01" });
  });
  it.each([
    '{"kind":"run","routineId":"D99-W99","confidence":1}',
    '{"kind":"run","routineId":"D01-W01","confidence":0.8}',
    '{"kind":"run","routineId":"D01-W01","confidence":1,"accountId":"victim"}',
    '{"kind":"run","routineId":"D01-W01","confidence":1,"mode":"live"}',
    '{"kind":"run","routineId":"D01-W01","confidence":1,"webhookUrl":"https://evil.test"}',
    '{"kind":"enable","routineId":"D01-W01"}',
    '```json\n{"kind":"run"}\n```', 'null', '[]',
  ])("rejects malformed or authority-bearing intent: %s", (raw) => {
    expect(parseIntent(raw, caps)).toEqual({ kind: "clarify" });
  });
});

describe("request admission", () => {
  it("queues a draft with version, spec and implementation fingerprints", async () => {
    const { enqueue } = await setup();
    const c = await enqueue();
    expect(c).toMatchObject({ status: "queued", version: 1, actor });
    expect(c.specHash).toHaveLength(64);
    expect(c.reply).toContain("hasn’t completed");
  });
  it("replays the same message ID and rejects changed content", async () => {
    const { deps, queue, enqueue } = await setup();
    await enqueue();
    await enqueue();
    expect(await queue.list("queued", 10)).toHaveLength(1);
    expect(deps.interpret).toHaveBeenCalledTimes(1);
    expect((await dispatchMessage(deps, actor, "different"))?.reply).toContain("different content");
  });
  it("isolates identical message IDs across accounts and users", () => {
    expect(commandId(actor)).not.toBe(commandId({ ...actor, accountId: "b" }));
    expect(commandId(actor)).not.toBe(commandId({ ...actor, userId: "b" }));
  });
  it("does not reveal another account's command", async () => {
    const { queue, enqueue } = await setup();
    const c = await enqueue();
    expect(await queue.get("other", c.id)).toBeNull();
  });
  it("checks authority before interpreting", async () => {
    const { deps } = await setup();
    deps.isOwner = async () => false;
    expect((await dispatchMessage(deps, actor, "run it"))?.reply).toContain("owner");
    expect(deps.interpret).not.toHaveBeenCalled();
  });
  it("refuses disabled routines without changing their state", async () => {
    const { deps, store, queue } = await setup();
    const state = (await store.getRoutineState(actor.accountId, "D01-W01"))!;
    await store.putRoutineState({ ...state, enabled: false });
    expect((await dispatchMessage(deps, actor, "run it"))?.reply).toContain("switched off");
    expect(await queue.list("queued", 10)).toHaveLength(0);
    expect((await store.getRoutineState(actor.accountId, "D01-W01"))?.enabled).toBe(false);
  });
  it("blocks unverifiable/exhausted budget", async () => {
    const { deps, queue } = await setup();
    deps.budget = async () => false;
    expect((await dispatchMessage(deps, actor, "run it"))?.reply).toContain("budget");
    expect(await queue.list("queued", 10)).toHaveLength(0);
  });
  it("leaves normal conversation outside the queue", async () => {
    const { deps, queue } = await setup();
    deps.interpret = async () => ({ kind: "chat" });
    expect(await dispatchMessage(deps, actor, "hello")).toBeNull();
    expect(await queue.list("queued", 10)).toHaveLength(0);
  });
  it("asks for clarification without starting work", async () => {
    const { deps, queue } = await setup();
    deps.interpret = async () => ({ kind: "clarify" });
    expect((await dispatchMessage(deps, actor, "do it"))?.reply).toContain("Which routine");
    expect(await queue.list("queued", 10)).toHaveLength(0);
  });
});

describe("durable execution", () => {
  const execution = (c: RoutineCommand) => ({ runId: c.id, routineId: c.routineId, version: 1, mode: "dry_run" as const, status: "done" as const, summary: "done", receipts: [] });
  it("only one worker can claim a command", async () => {
    const { deps, enqueue, queue } = await setup();
    const c = await enqueue();
    const execute = vi.fn(async () => execution(c));
    await Promise.all([processCommand({ ...deps, execute }, c), processCommand({ ...deps, execute }, c)]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("done");
  });
  it.each(["disabled", "owner revoked", "budget", "version", "workflow"])("rechecks %s at execution time", async (change) => {
    const { deps, enqueue, store, queue } = await setup();
    const c = await enqueue();
    const state = (await store.getRoutineState(actor.accountId, c.routineId))!;
    if (change === "disabled") await store.putRoutineState({ ...state, enabled: false });
    if (change === "owner revoked") deps.isOwner = async () => false;
    if (change === "budget") deps.budget = async () => false;
    if (change === "version") await store.putRoutineState({ ...state, version: 2 });
    if (change === "workflow") await store.putN8nWorkflow({ id: "wf", accountId: actor.accountId, routineId: c.routineId, active: true, webhookUrl: "https://workflow.test/new" });
    const execute = vi.fn(async () => execution(c));
    await processCommand({ ...deps, execute }, c);
    expect(execute).not.toHaveBeenCalled();
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("blocked");
  });
  it("blocks a queued source-dependent routine if its connector disappears", async () => {
    const { deps, enqueue, queue } = await setup("D05-W02");
    const c = await enqueue();
    expect(c).not.toBeNull();
    deps.connected = async () => [];
    const execute = vi.fn(async () => execution(c));
    await processCommand({ ...deps, execute }, c);
    expect(execute).not.toHaveBeenCalled();
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("blocked");
  });
  it("holds ambiguous execution rather than retrying", async () => {
    const { deps, enqueue, queue } = await setup();
    const c = await enqueue();
    const execute = vi.fn(async () => { throw new Error("response lost"); });
    await processCommand({ ...deps, execute }, c);
    await processCommand({ ...deps, execute }, c);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("uncertain");
  });
  it("reconciles a saved completion after a worker crash without re-execution", async () => {
    const { deps, enqueue, queue, store } = await setup();
    const c = await enqueue();
    const claimed = (await queue.transition(c, "queued", { status: "running", runId: c.id }))!;
    await store.createRun({ id: c.id, accountId: actor.accountId, routineId: c.routineId, version: 1, mode: "dry_run", status: "done", startedAt: T0 });
    await reconcileCommand(deps, claimed);
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("done");
  });
  it("marks a stranded claim uncertain without rerunning it", async () => {
    const { deps, enqueue, queue } = await setup();
    const c = await enqueue();
    const claimed = (await queue.transition(c, "queued", { status: "running", runId: c.id }))!;
    deps.now = () => new Date("2026-09-04T02:00:00Z");
    await reconcileCommand(deps, claimed);
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("uncertain");
  });
  it("does not restart an existing run or claim nothing previously happened", async () => {
    const { deps, enqueue, queue, store } = await setup();
    const c = await enqueue();
    await store.createRun({ id: c.id, accountId: actor.accountId, routineId: c.routineId, version: 1, mode: "dry_run", status: "running", startedAt: T0 });
    const execute = vi.fn(async () => execution(c));
    await processCommand({ ...deps, execute }, c);
    expect(execute).not.toHaveBeenCalled();
    expect((await queue.get(actor.accountId, c.id))?.reply).toContain("already has a run record");
  });
  it("rejects a malformed run identity", async () => {
    const { deps, enqueue, queue } = await setup();
    const c = await enqueue();
    await processCommand({ ...deps, execute: async () => ({ ...execution(c), runId: "different" }) }, c);
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("uncertain");
  });
});

describe("verified channel authority", () => {
  it("requires matching account, owner, linked user and channel", async () => {
    const db = new FakeSupabase();
    db.seed("account_members", [{ account_id: actor.accountId, user_id: actor.userId, role: "owner" }]);
    db.seed("channel_links", [{ id: "link", account_id: actor.accountId, user_id: actor.userId, channel: "slack", verified_at: T0 }]);
    const linked: CommandActor = { ...actor, channel: "slack", linkId: "link" };
    expect(await commandOwner(db, linked)).toBe(true);
    expect(await commandOwner(db, { ...linked, channel: "sms" })).toBe(false);
    expect(await commandOwner(db, { ...linked, userId: "other" })).toBe(false);
    expect(await commandOwner(db, { ...linked, accountId: "other" })).toBe(false);
    expect(await commandOwner(db, { ...linked, linkId: undefined })).toBe(false);
  });
  it("every queued version refers to a catalog capability", () => {
    expect(CATALOG_SPEC_BY_ID["D01-W01"]).toBeDefined();
  });
});

describe("captured command context", () => {
  const execution = (c: RoutineCommand) => ({ runId: c.id, routineId: c.routineId, version: 1, mode: "dry_run" as const, status: "done" as const, summary: "done", receipts: [] });
  it.each(["reset", "pause", "missing controls"])("refuses %s before intent model work", async reason => {
    const { db, deps } = await setup();
    if (reason === "reset") db.rows("accounts")[0].context_generation = 1;
    if (reason === "pause") db.rows("accounts")[0].automation_paused = true;
    if (reason === "missing controls") delete db.rows("accounts")[0].context_generation;
    await expect(dispatchMessage(deps, actor, "run it")).rejects.toThrow();
    expect(deps.interpret).not.toHaveBeenCalled();
    expect(db.rows("routine_commands")).toHaveLength(0);
  });
  it("surfaces unavailable controls to worker health without claiming a command", async () => {
    const { db, deps, enqueue, queue } = await setup();
    const c = await enqueue();
    delete db.rows("accounts")[0].automation_paused;
    const execute = vi.fn(async () => execution(c));
    await expect(processCommand({ ...deps, execute }, c)).rejects.toThrow("unavailable");
    expect(execute).not.toHaveBeenCalled();
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("queued");
  });
  it("supports an explicitly captured nonzero generation", async () => {
    const { db, deps, queue } = await setup();
    db.rows("accounts")[0].context_generation = 2;
    const response = await dispatchMessage(deps, { ...actor, contextGeneration: 2 }, "run it");
    expect(response?.status).toBe("queued");
    expect((await queue.get(actor.accountId, response!.commandId!))?.contextGeneration).toBe(2);
  });
  it.each(["interpret", "connected", "budget"])("refuses a reset during %s without enqueueing", async phase => {
    const { db, deps } = await setup();
    const reset = () => { db.rows("accounts")[0].context_generation = 1; };
    if (phase === "interpret") deps.interpret = async () => { reset(); return { kind: "run", routineId: "D01-W01" }; };
    if (phase === "connected") deps.connected = async () => { reset(); return []; };
    if (phase === "budget") deps.budget = async () => { reset(); return true; };
    await expect(dispatchMessage(deps, actor, "run it")).rejects.toThrow("context changed");
    expect(db.rows("routine_commands")).toHaveLength(0);
  });
  it("does not disclose or re-execute an old message ID after reset", async () => {
    const { db, deps, enqueue } = await setup();
    await enqueue();
    db.rows("accounts")[0].context_generation = 1;
    await expect(dispatchMessage(deps, { ...actor, contextGeneration: 1 }, "Run the founder content routine")).rejects.toThrow("context changed");
    expect(deps.interpret).toHaveBeenCalledTimes(1);
    expect(db.rows("routine_commands")).toHaveLength(1);
  });
  it("does not rebase a caller-mutated actor while interpretation waits", async () => {
    const { deps, queue } = await setup();
    const mutable = { ...actor };
    deps.interpret = async () => { mutable.accountId = "other"; return { kind: "run", routineId: "D01-W01" }; };
    const reply = await dispatchMessage(deps, mutable, "run it");
    expect((await queue.get(actor.accountId, reply!.commandId!))?.actor.accountId).toBe(actor.accountId);
  });
  it.each(["reset", "pause"])("does not claim a command after %s", async reason => {
    const { db, deps, enqueue, queue } = await setup();
    const c = await enqueue();
    if (reason === "reset") db.rows("accounts")[0].context_generation = 1;
    else db.rows("accounts")[0].automation_paused = true;
    const execute = vi.fn(async () => execution(c));
    await processCommand({ ...deps, execute }, c);
    expect(execute).not.toHaveBeenCalled();
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("queued");
  });
  it("holds a claim if the context changes during eligibility", async () => {
    const { db, deps, enqueue, queue } = await setup();
    const c = await enqueue();
    deps.budget = async () => { db.rows("accounts")[0].context_generation = 1; return true; };
    const execute = vi.fn(async () => execution(c));
    await processCommand({ ...deps, execute }, c);
    expect(execute).not.toHaveBeenCalled();
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("running");
  });
  it.each(["return", "throw"])("does not write a new-context result or error after late execution %s", async outcome => {
    const { db, deps, enqueue, queue } = await setup();
    const c = await enqueue();
    const execute = vi.fn(async () => {
      db.rows("accounts")[0].context_generation = 1;
      if (outcome === "throw") throw new Error("late provider failure");
      return execution(c);
    });
    await processCommand({ ...deps, execute }, c);
    await processCommand({ ...deps, execute }, c);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("running");
  });
  it("does not reconcile a run from a different generation", async () => {
    const { deps, enqueue, queue, store } = await setup();
    const c = await enqueue();
    const claimed = (await queue.transition(c, "queued", { status: "running", runId: c.id }))!;
    await store.createRun({ id: c.id, accountId: actor.accountId, contextGeneration: 1, routineId: c.routineId, version: 1, mode: "dry_run", status: "done", startedAt: T0 });
    await reconcileCommand(deps, claimed);
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("running");
  });
  it("does not reconcile a reset account or expose its stale notification", async () => {
    const { db, deps, enqueue, queue, store } = await setup();
    const c = await enqueue();
    const claimed = (await queue.transition(c, "queued", { status: "running", runId: c.id }))!;
    await store.createRun({ id: c.id, accountId: actor.accountId, contextGeneration: 0, routineId: c.routineId, version: 1, mode: "dry_run", status: "done", startedAt: T0 });
    db.rows("accounts")[0].context_generation = 1;
    await reconcileCommand(deps, claimed);
    expect((await queue.get(actor.accountId, c.id))?.status).toBe("running");
    expect(await queue.notifications(20)).toEqual([]);
  });
  it("filters stale and paused records before limiting current candidates", async () => {
    const { db, enqueue, queue } = await setup();
    const old = await enqueue();
    db.rows("accounts")[0].context_generation = 1;
    db.seed("accounts", [{ id: "active", context_generation: 0, automation_paused: false }, { id: "paused", context_generation: 0, automation_paused: true }]);
    await queue.enqueue({ ...old, id: "paused", actor: { ...actor, accountId: "paused" } });
    await queue.enqueue({ ...old, id: "active", actor: { ...actor, accountId: "active" }, createdAt: "2026-09-04T02:00:00Z" });
    expect((await queue.list("queued", 1)).map(c => c.id)).toEqual(["active"]);
  });
});
