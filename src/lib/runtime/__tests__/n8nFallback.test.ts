/* The engine's n8n → built-in skill fallback: a registered workflow that cannot answer
   (unreachable, a rejected artifact) hands the produce step to the LlmProducer with a receipt
   saying so; an explicit n8n node never falls back; without a producer the run fails closed. */

import { describe, expect, it } from "vitest";
import { runRoutine } from "../engine";
import type { N8nBridge, Node, RoutineSpec } from "../types";
import { adapters as build, draftSpec, FakeProducer, input, QUESTIONS_FIXTURE } from "./helpers";

const failing: N8nBridge = {
  async call() {
    throw new Error("n8n webhook unreachable (TimeoutError)");
  },
};
const workflow = { id: "wf-1", accountId: null, routineId: "D01-W01", webhookUrl: "https://n8n.test/hook", active: true };

/** draftSpec with a produce step in place of its decide node (the wave-1 shape). */
function produceSpec(): RoutineSpec {
  const base = draftSpec();
  const produce: Node = { kind: "produce", id: "produce", skill: "D01-W01", maxItems: 3 };
  return { ...base, nodes: base.nodes.map((n) => (n.kind === "decide" ? produce : n)) };
}
const adapters = (opts: Parameters<typeof build>[0] = {}) => build({ fixtures: QUESTIONS_FIXTURE, ...opts });

describe("produce: n8n fails → built-in producer", () => {
  it("drafts with the producer, marks the artifact, and receipts the fallback", async () => {
    const { adapters: a, store, producer } = adapters({ producer: new FakeProducer() });
    await store.putN8nWorkflow(workflow);
    const result = await runRoutine(produceSpec(), input(), { ...a, n8n: failing }, { mode: "dry_run" });
    expect(result.status).toBe("done");
    expect(producer.calls).toHaveLength(1);
    expect(result.artifact).toMatchObject({ meta: { via: "producer", fallbackFrom: "n8n", workflowId: "wf-1" } });
    const fallback = result.receipts.find((r) => r.description.includes("n8n workflow couldn’t answer"));
    expect(fallback).toBeDefined();
    expect(fallback!.payload).toMatchObject({ workflowId: "wf-1", fallback: "producer", reason: "n8n webhook unreachable (TimeoutError)" });
    expect(result.receipts.find((r) => r.description.startsWith("Drafted:"))!.payload).toMatchObject({ via: "producer" });
  });

  it("without a producer the run still fails closed with the n8n reason", async () => {
    const { adapters: a, store } = adapters({ producer: null });
    await store.putN8nWorkflow(workflow);
    const result = await runRoutine(produceSpec(), input(), { ...a, n8n: failing }, { mode: "dry_run" });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/n8n webhook unreachable/);
  });

  it("an explicit n8n node never falls back to the producer", async () => {
    const { adapters: a, producer } = adapters({ producer: new FakeProducer() });
    const spec: RoutineSpec = { ...produceSpec(), nodes: produceSpec().nodes.map((n) => (n.kind === "produce" ? { kind: "n8n" as const, id: "n8n", webhookUrl: "https://n8n.test/explicit" } : n)) };
    const result = await runRoutine(spec, input(), { ...a, n8n: failing }, { mode: "dry_run" });
    expect(result.status).toBe("failed");
    expect(producer.calls).toHaveLength(0);
  });

  it("a workflow that answers keeps the step (no producer call, via n8n)", async () => {
    const { adapters: a, store, producer } = adapters({ producer: new FakeProducer() });
    await store.putN8nWorkflow(workflow);
    const ok: N8nBridge = { async call() { return { kind: "artifact", artifact: { kind: "post_set", title: "From n8n", body: "Three posts the workflow wrote from the material it was given.", items: [{ title: "a", body: "b" }] } }; } };
    const result = await runRoutine(produceSpec(), input(), { ...a, n8n: ok }, { mode: "dry_run" });
    expect(result.status).toBe("done");
    expect(producer.calls).toHaveLength(0);
    expect(result.artifact).toMatchObject({ title: "From n8n", meta: { via: "n8n" } });
    expect((await store.listN8nWorkflows("acct-1")).map((w) => w.id)).toEqual(["wf-1"]);
  });
});
