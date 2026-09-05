import { afterEach, describe, expect, it, vi } from "vitest";
import { commandReleaseScopes, commandSelectionReleased, workflowFingerprint, type CommandReleaseScope } from "../releaseScope";
import { commandId, DbCommandQueue, digest } from "../queue";
import { routeCommand } from "../message";
import { dispatchDeps } from "../deps";
import { processCommand } from "../process";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { adapters as makeAdapters } from "../../runtime/__tests__/helpers";
import { StaticAccountsSource } from "../../../worker/accounts";
import { executeRoutineCommand } from "../../../worker/commands";
import type { CommandActor, RoutineCommand } from "../types";
import type { N8nWorkflow, RoutineSpec } from "../../runtime/types";

const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const actor: CommandActor = { accountId: A, userId: "owner", contextGeneration: 1, channel: "app", requestId: "request-1" };
const spec: RoutineSpec = { id: "D01-W01", name: "Test-only founder draft", version: 1, wave: 1, mutates: false, nodes: [
  { kind: "trigger", id: "trigger", cadence: "manual" },
  { kind: "read", id: "read", as: "products", source: "shopify", query: { resource: "products" }, optional: true },
  { kind: "produce", id: "produce", skill: "D01-W01" },
  { kind: "receipt", id: "receipt", summary: "Test draft" },
] };
const workflow: N8nWorkflow = { id: "workflow", accountId: A, routineId: spec.id, active: true, webhookUrl: "https://example.test/workflow" };
const scope = (w: N8nWorkflow | null = null): CommandReleaseScope => ({ accountId: A, contextGeneration: 1, channel: "app",
  routineId: spec.id, specHash: digest(spec), workflowHash: workflowFingerprint(w), expiresAt: new Date(Date.now() + 60_000).toISOString() });
const env = (entries: unknown = [scope()]) => ({ UNC_COMMANDS_ENABLED: "true", UNC_COMMAND_RELEASE_SCOPES: JSON.stringify(entries) });
afterEach(() => vi.unstubAllEnvs());

describe("exact command rollout scope", () => {
  it("accepts the exact reviewed selection only while both release gates are valid", () => {
    expect(commandSelectionReleased(actor, spec, null, env())).toBe(true);
    expect(commandSelectionReleased(actor, spec, null, { ...env(), UNC_COMMANDS_ENABLED: "false" })).toBe(false);
    expect(commandSelectionReleased(actor, spec, null, { UNC_COMMANDS_ENABLED: "true" })).toBe(false);
  });
  it.each([undefined, "", "{", "null", "{}", "true", "[null]", "[[]]", " ".repeat(32_769)])("denies malformed configuration %s", raw => {
    expect(commandReleaseScopes(raw)).toEqual([]);
  });
  it.each([
    { accountId: "*" }, { contextGeneration: -1 }, { contextGeneration: 1.1 }, { contextGeneration: "1" },
    { channel: "*" }, { routineId: "D01-*" }, { specHash: "*" }, { workflowHash: "*" },
    { expiresAt: "tomorrow" }, { expiresAt: "2099-01-01" }, { secret: "not-allowed" },
  ])("does not salvage valid entries beside invalid configuration %j", bad => {
    expect(commandReleaseScopes(JSON.stringify([scope(), { ...scope(), accountId: B, ...bad }]))).toEqual([]);
  });
  it("rejects duplicate identities even when pins differ, excessive entries and missing fields", () => {
    expect(commandReleaseScopes(JSON.stringify([scope(), { ...scope(), specHash: "a".repeat(64) }]))).toEqual([]);
    expect(commandReleaseScopes(JSON.stringify(Array.from({ length: 101 }, () => scope())))).toEqual([]);
    const partial: Partial<CommandReleaseScope> = scope();
    delete partial.expiresAt;
    expect(commandReleaseScopes(JSON.stringify([partial]))).toEqual([]);
  });
  it.each([
    { accountId: B }, { contextGeneration: 0 }, { contextGeneration: undefined }, { channel: "slack" as const },
  ])("does not transfer app authority to another identity %j", change => {
    expect(commandSelectionReleased({ ...actor, ...change }, spec, null, env())).toBe(false);
  });
  it("pins the whole spec, not just routine name/version", () => {
    expect(commandSelectionReleased(actor, { ...spec, name: "changed" }, null, env())).toBe(false);
    expect(commandSelectionReleased(actor, { ...spec, version: 2 }, null, env())).toBe(false);
  });
  it("pins selected workflow identity and refuses cross-tenant, wrong-routine and inactive selections", () => {
    expect(commandSelectionReleased(actor, spec, workflow, env([scope(workflow)]))).toBe(true);
    expect(commandSelectionReleased(actor, spec, null, env([scope(workflow)]))).toBe(false);
    for (const changed of [{ ...workflow, accountId: B }, { ...workflow, routineId: "D01-W02" }, { ...workflow, active: false }]) {
      expect(commandSelectionReleased(actor, spec, changed, env([scope(changed)]))).toBe(false);
    }
    expect(workflowFingerprint(workflow)).not.toBe(workflowFingerprint({ ...workflow, routineId: "D01-W02" }));
  });
  it("expires exactly at the boundary and never relies on an invalid clock", () => {
    const s = scope(), at = Date.parse(s.expiresAt);
    expect(commandSelectionReleased(actor, spec, null, env([s]), at - 1)).toBe(true);
    expect(commandSelectionReleased(actor, spec, null, env([s]), at)).toBe(false);
    expect(commandSelectionReleased(actor, spec, null, env([s]), Number.NaN)).toBe(false);
  });
});

async function fixture() {
  const db = new FakeSupabase();
  db.seed("accounts", [{ id: A, context_generation: 1, automation_paused: false }]);
  db.seed("account_members", [{ account_id: A, user_id: "owner", role: "owner" }]);
  const h = makeAdapters();
  const state = { accountId: A, routineId: spec.id, enabled: true, version: 1, liveSpec: spec, draftSpec: null, updatedAt: new Date().toISOString() };
  await h.store.putRoutineState(state);
  const accounts = new StaticAccountsSource([{ account: { accountId: A, contextGeneration: 1, currency: "NZD", budgetMonthly: 1000 } }]);
  const queue = new DbCommandQueue(db);
  const deps = { db, store: h.store, accounts };
  vi.stubEnv("UNC_COMMANDS_ENABLED", "true");
  vi.stubEnv("UNC_COMMAND_RELEASE_SCOPES", JSON.stringify([scope()]));
  const enqueue = async () => {
    const response = await routeCommand(db, h.store, actor, "/run D01-W01");
    expect(response?.status).toBe("queued");
    return (await queue.get(A, commandId(actor)))!;
  };
  const execute = vi.fn((c: RoutineCommand, s: RoutineSpec, w: N8nWorkflow | null) => executeRoutineCommand(deps, h.adapters, c, s, w));
  const process = (c: RoutineCommand) => processCommand({ ...dispatchDeps(db, h.store, A), execute }, c);
  return { db, h, state, queue, enqueue, execute, process };
}

describe("released customer command through the real dispatcher and worker with fake provider I/O", () => {
  it("runs once, stores a correlated artifact, and returns the original request on redelivery", async () => {
    const f = await fixture(), command = await f.enqueue();
    await Promise.all([f.process(command), f.process(command)]);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect((await f.queue.get(A, command.id))?.status).toBe("done");
    expect(await f.h.store.listArtifacts(A)).toHaveLength(1);
    expect((await f.h.store.listArtifacts(A))[0].runId).toBe(command.id);
    expect(await routeCommand(f.db, f.h.store, actor, "/run D01-W01")).toMatchObject({ commandId: command.id, status: "done" });
    expect(f.h.producer.calls).toHaveLength(1);
    expect(f.h.executor.calls).toHaveLength(0);
  });
  it("refuses a global flag alone before enqueue and gives deterministic flag-off slash-command feedback", async () => {
    const f = await fixture();
    vi.stubEnv("UNC_COMMAND_RELEASE_SCOPES", "[]");
    expect((await routeCommand(f.db, f.h.store, actor, "/run D01-W01"))?.reply).toContain("not released");
    vi.stubEnv("UNC_COMMANDS_ENABLED", "false");
    expect((await routeCommand(f.db, f.h.store, actor, "/run D01-W01"))?.reply).toContain("Nothing was queued");
    expect(await routeCommand(f.db, f.h.store, actor, "hello")).toBeNull();
    expect(await f.queue.list("queued", 10)).toHaveLength(0);
  });
  it("blocks withdrawal after enqueue before the worker calls any provider", async () => {
    const f = await fixture(), c = await f.enqueue();
    vi.stubEnv("UNC_COMMAND_RELEASE_SCOPES", "[]");
    await f.process(c);
    expect(f.execute).not.toHaveBeenCalled();
    expect((await f.queue.get(A, c.id))?.status).toBe("blocked");
    expect(await f.h.store.getRun(c.id)).toBeNull();
  });
  it("multiple selected routines do not expand the single released routine", async () => {
    const f = await fixture();
    await f.h.store.putRoutineState({ ...f.state, routineId: "D01-W02", liveSpec: { ...spec, id: "D01-W02" } });
    expect((await routeCommand(f.db, f.h.store, { ...actor, requestId: "other-routine" }, "/run D01-W02"))?.reply).toContain("not released");
    await f.enqueue();
    expect(await f.queue.list("queued", 10)).toHaveLength(1);
  });
  it("all-off selection cannot be overridden by release configuration", async () => {
    const f = await fixture();
    await f.h.store.putRoutineState({ ...f.state, enabled: false });
    expect((await routeCommand(f.db, f.h.store, actor, "/run D01-W01"))?.reply).toContain("switched off");
    expect(await f.queue.list("queued", 10)).toHaveLength(0);
  });
  it("does not turn the operator keyword allowance into a generic customer command", async () => {
    const f = await fixture(), keyword = { ...spec, id: "D03-W01" };
    await f.h.store.putRoutineState({ ...f.state, routineId: keyword.id, liveSpec: keyword });
    vi.stubEnv("UNC_COMMAND_RELEASE_SCOPES", JSON.stringify([{ ...scope(), routineId: keyword.id, specHash: digest(keyword) }]));
    expect((await routeCommand(f.db, f.h.store, actor, "/run D03-W01"))?.reply).toContain("customer authorization connection");
    expect(await f.queue.list("queued", 10)).toHaveLength(0);
    expect(f.h.producer.calls).toHaveLength(0);
  });
  it.each(["switch", "owner", "spec", "release"])("stops later steps when %s changes during a read", async change => {
    const f = await fixture(), c = await f.enqueue();
    const read = vi.spyOn(f.h.adapters.reader, "read");
    read.mockImplementationOnce(async () => {
      if (change === "switch") await f.h.store.putRoutineState({ ...f.state, enabled: false });
      if (change === "owner") f.db.rows("account_members")[0].role = "member";
      if (change === "spec") await f.h.store.putRoutineState({ ...f.state, liveSpec: { ...spec, name: "changed" } });
      if (change === "release") vi.stubEnv("UNC_COMMAND_RELEASE_SCOPES", "[]");
      return { rows: [], metrics: {}, fetchedAt: new Date().toISOString() };
    });
    await f.process(c);
    expect(read).toHaveBeenCalledTimes(1);
    expect(f.h.producer.calls).toHaveLength(0);
    expect(await f.h.store.listArtifacts(A)).toHaveLength(0);
    expect((await f.queue.get(A, c.id))?.status).toBe("uncertain");
    await f.process(c);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("refuses a supplied runtime implementation that differs from the captured command", async () => {
    const f = await fixture(), c = await f.enqueue();
    await expect(f.execute(c, { ...spec, name: "substituted" }, null)).rejects.toThrow("queued selection");
    expect(f.h.producer.calls).toHaveLength(0);
    expect(await f.h.store.getRun(c.id)).toBeNull();
  });
});
