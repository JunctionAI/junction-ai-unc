import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { adapters as makeAdapters, FakeProducer, SAMPLE_ARTIFACT } from "../../runtime/__tests__/helpers";
import { StaticAccountsSource } from "../../../worker/accounts";
import { executeRoutineCommand, runCommandsTick } from "../../../worker/commands";
import { routeCommand } from "../message";
import { DbCommandQueue } from "../queue";
import type { RoutineCommand } from "../types";
import type { N8nBridge, RoutineSpec } from "../../runtime/types";
import { CATALOG_SPEC_BY_ID } from "../../runtime/catalog-specs";

const A = "account-a", B = "account-b";
const spec: RoutineSpec = { id: "D01-W01", name: "Founder content engine", version: 1, wave: 1, mutates: false, nodes: [{ id: "trigger", kind: "trigger", cadence: "manual" }, { id: "produce", kind: "produce", skill: "D01-W01" }, { id: "receipt", kind: "receipt", summary: "Draft ready" }] };
const cmd = (id: string): RoutineCommand => ({ id, actor: { accountId: A, userId: "owner-a", channel: "app", requestId: id }, request: "Run founder content", requestHash: "", specHash: "", workflowHash: "", routineId: spec.id, version: 1, status: "running", reply: "", runId: id, createdAt: "2026-09-04T01:00:00Z", updatedAt: "2026-09-04T01:00:00Z" });
afterEach(() => vi.unstubAllEnvs());

describe("command-to-existing-runtime integration", () => {
  it("uses the pinned account and selected n8n workflow, then stores its artifact", async () => {
    const h = makeAdapters();
    const accounts = new StaticAccountsSource([{ account: { accountId: A, currency: "NZD", budgetMonthly: 1000 } }]);
    const workflow = { id: "chosen", accountId: A, routineId: spec.id, webhookUrl: "https://workflow.test/v1", active: true };
    const n8n = { call: vi.fn<N8nBridge["call"]>(async () => ({ kind: "artifact" as const, artifact: SAMPLE_ARTIFACT })) };
    const result = await executeRoutineCommand({ store: h.store, accounts }, { ...h.adapters, n8n }, cmd("command-a"), spec, workflow);
    expect(result).toMatchObject({ runId: "command-a", mode: "dry_run", status: "done" });
    expect(n8n.call.mock.calls[0]?.[1]).toMatchObject({ account: { accountId: A }, runId: "command-a" });
    expect(n8n.call.mock.calls[0]?.[2]).toEqual(workflow);
    expect(await h.store.listArtifacts(A)).toHaveLength(1);
    expect(await h.store.listArtifacts(B)).toHaveLength(0);
    expect(h.producer.calls).toHaveLength(0);
  });
  it("does not fall back to a model when the selected external workflow fails", async () => {
    const h = makeAdapters();
    const accounts = new StaticAccountsSource([{ account: { accountId: A, currency: "NZD", budgetMonthly: 1000 } }]);
    const workflow = { id: "chosen", accountId: A, routineId: spec.id, webhookUrl: "https://workflow.test/v1", active: true };
    const n8n = { call: vi.fn(async () => { throw new Error("provider timeout"); }) };
    const result = await executeRoutineCommand({ store: h.store, accounts }, { ...h.adapters, n8n }, cmd("command-b"), spec, workflow);
    expect(result.status).toBe("failed");
    expect(h.producer.calls).toHaveLength(0);
  });
  it("runs two customers through the same catalog routine without mixing identities", async () => {
    vi.stubEnv("UNC_COMMANDS_ENABLED", "true");
    const db = new FakeSupabase();
    const producer = new FakeProducer();
    const h = makeAdapters({ producer });
    const queue = new DbCommandQueue(db);
    const accounts = new StaticAccountsSource([A, B].map((id) => ({ account: { accountId: id, currency: "NZD", budgetMonthly: 1000 } })));
    db.seed("account_members", [A, B].map((id) => ({ account_id: id, user_id: `owner-${id}`, role: "owner" })));
    for (const id of [A, B]) {
      await h.store.putRoutineState({ accountId: id, routineId: spec.id, enabled: true, version: 1, liveSpec: CATALOG_SPEC_BY_ID[spec.id], draftSpec: null, updatedAt: "2026-09-04T01:00:00Z" });
      const response = await routeCommand(db, h.store, { accountId: id, userId: `owner-${id}`, channel: "app", requestId: "same-message-id" }, "/run D01-W01");
      expect(response?.status).toBe("queued");
    }
    await runCommandsTick({ store: h.store, accounts, db }, h.adapters);
    const done = await queue.list("done", 10);
    expect(done).toHaveLength(2);
    expect(producer.calls.map((c) => c.ctx.account.accountId).sort()).toEqual([A, B]);
    expect(await h.store.listArtifacts(A)).toHaveLength(1);
    expect(await h.store.listArtifacts(B)).toHaveLength(1);
    expect(done.every((c) => c.id === c.runId)).toBe(true);
  });
});
