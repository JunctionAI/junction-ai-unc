/* The produce step: the engine stores the artifact, links it from a draft receipt, shows it at
   the gate (dry and live), ends waiting_input when the producer needs something and resumes
   with the founder's answers; optional reads never fail a run; a registered n8n workflow
   takes the step over, synchronously or through the async callback. */

import { describe, expect, it } from "vitest";
import { completeExternalArtifact, describeNeed, resumeRun, resumeRunWithInput, runRoutine } from "../engine";
import { FailingReader } from "../providers";
import { validateSpec } from "../validate";
import type { N8nBridge, N8nCallResult, RoutineSpec } from "../types";
import { adapters, clock, draftSpec, FakeProducer, input, QUESTIONS_FIXTURE, SAMPLE_ARTIFACT } from "./helpers";

/** trigger → optional read → produce → gate → receipt (the wave-1 shape). */
function produceSpec(overrides: Partial<RoutineSpec> = {}): RoutineSpec {
  return draftSpec({
    nodes: [
      { kind: "trigger", id: "trigger", cadence: "0 7 * * *" },
      { kind: "read", id: "read_q", as: "questions", source: "gorgias", query: { resource: "tickets", window: "7d" }, optional: true },
      { kind: "produce", id: "produce", skill: "D01-W01", maxItems: 3 },
      { kind: "gate", id: "gate", title: "{{artifact.title}} — for your voice check", expiryHours: 48 },
      { kind: "receipt", id: "receipt", summary: "Handed over: {{artifact.title}}" },
    ],
    ...overrides,
  });
}

describe("produce node", () => {
  it("validates in its place in the chain", () => {
    expect(validateSpec(produceSpec())).toEqual([]);
    const bad = produceSpec({ nodes: [{ kind: "trigger", id: "t", cadence: "manual" }, { kind: "gate", id: "g", title: "x", expiryHours: 1 }, { kind: "produce", id: "p" }, { kind: "receipt", id: "r" }] });
    expect(validateSpec(bad).map((i) => i.message)).toContain("produce cannot follow gate (order is trigger→read→check→decide→produce|n8n→gate→execute→receipt)");
  });

  it("dry run: stores the artifact, links it from a draft receipt, previews it at the gate, renders it in templates", async () => {
    const { adapters: a, store, producer } = adapters({ fixtures: QUESTIONS_FIXTURE });
    const res = await runRoutine(produceSpec(), input(), a, { mode: "dry_run" });
    expect(res.status).toBe("done");
    expect(res.summary).toBe("Handed over: 3 founder posts: why we ship from Auckland");
    expect(producer.calls).toHaveLength(1);
    expect(producer.calls[0].node).toMatchObject({ kind: "produce", skill: "D01-W01", maxItems: 3 });
    expect(producer.calls[0].ctx.reads.questions.rows).toHaveLength(3);
    // stored, status draft, meta says who made it
    const stored = await store.listArtifacts("acct-1");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ runId: res.runId, routineId: "D01-W01", kind: "post_set", status: "draft", meta: { via: "producer", node: "produce", mode: "dry_run" } });
    expect(stored[0].items).toHaveLength(3);
    expect(res.artifact?.id).toBe(stored[0].id);
    // the draft receipt links it; the gate preview carries it
    const kinds = res.receipts.map((r) => r.kind);
    expect(kinds).toEqual(["read", "draft", "draft", "draft"]);
    const drafted = res.receipts[1];
    expect(drafted.description).toBe("Drafted: 3 founder posts: why we ship from Auckland (3 items).");
    expect(drafted.payload).toMatchObject({ artifactId: stored[0].id, artifactKind: "post_set", items: 3, via: "producer" });
    const gate = res.receipts[2];
    expect(gate.description).toBe("Would ask Tom: 3 founder posts: why we ship from Auckland — for your voice check");
    expect(gate.payload.approvalPreview).toMatchObject({ artifactId: stored[0].id, artifactKind: "post_set", artifactItems: 3 });
    expect(res.receipts[3].payload.artifactId).toBe(stored[0].id);
  });

  it("live: produces before pausing at the gate; approval completes the run with the artifact intact", async () => {
    const { adapters: a, store } = adapters({ fixtures: QUESTIONS_FIXTURE });
    const paused = await runRoutine(produceSpec(), input({ triggeredBy: "manual" }), a, { mode: "live" });
    expect(paused.status).toBe("waiting_approval");
    expect(paused.artifact?.title).toBe(SAMPLE_ARTIFACT.title);
    expect(paused.approval?.title).toBe("3 founder posts: why we ship from Auckland — for your voice check");
    expect(await store.listArtifacts("acct-1")).toHaveLength(1);
    const done = await resumeRun(paused.runId, "approved", a);
    expect(done.status).toBe("done");
    expect(done.artifact?.id).toBe(paused.artifact?.id);
  });

  it("needs → waiting_input with an honest receipt, then resume-input re-runs the produce step with the answers", async () => {
    const clk = clock();
    let asked = 0;
    const producer = new FakeProducer((_node, ctx) => {
      asked++;
      if (!ctx.inputs?.about_the_business) return { needs: [{ input: "about_the_business", why: "tell me what you sell" }, { platform: "gorgias", why: "real customer questions" }], note: "Nothing was drafted." };
      return { artifact: { ...SAMPLE_ARTIFACT, title: `Posts about ${ctx.inputs.about_the_business}` } };
    });
    const { adapters: a, store } = adapters({ clk, producer });
    const waiting = await runRoutine(produceSpec(), input(), a, { mode: "dry_run" });
    expect(waiting.status).toBe("waiting_input");
    expect(waiting.needs).toHaveLength(2);
    expect(waiting.summary).toBe("To draft this I need: about the business — tell me what you sell; gorgias connected — real customer questions. Nothing was drafted.");
    expect(waiting.receipts.map((r) => r.kind)).toEqual(["read", "notification"]); // the (empty) read, then the ask
    const run = (await store.getRun(waiting.runId))!;
    expect(run.status).toBe("waiting_input");
    expect(run.snapshot?.nextNodeIndex).toBe(2); // the produce node itself
    expect(run.snapshot?.needs).toHaveLength(2);
    expect(await store.listArtifacts("acct-1")).toHaveLength(0); // never a placeholder
    expect(describeNeed(waiting.needs![1])).toBe("gorgias connected — real customer questions");

    // junk answers are rejected; a real one resumes
    await expect(resumeRunWithInput(waiting.runId, { "bad key!": "x" }, a)).rejects.toThrow("answers are empty");
    const done = await resumeRunWithInput(waiting.runId, { about_the_business: "marine collagen for swimmers", ignored: 42 }, a);
    expect(asked).toBe(2);
    expect(done.status).toBe("done");
    expect(done.artifact?.title).toBe("Posts about marine collagen for swimmers");
    expect(done.receipts[0].description).toBe("You answered: about the business, ignored. Drafting again with that.");
    const after = (await store.getRun(waiting.runId))!;
    expect(after.status).toBe("done");
    expect(after.snapshot).toBeUndefined();
    await expect(resumeRunWithInput(waiting.runId, { about_the_business: "again" }, a)).rejects.toThrow("not waiting_input");
  });

  it("no producer configured → the run fails closed with a receipt (never a silent skip)", async () => {
    const { adapters: a } = adapters({ producer: null });
    const res = await runRoutine(produceSpec(), input(), a, { mode: "dry_run" });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("no producer is configured — nothing was drafted");
  });

  it("a producer that throws fails the run closed with the reason", async () => {
    const producer: FakeProducer = new FakeProducer(() => {
      throw new Error("no model provider is configured");
    });
    const { adapters: a } = adapters({ producer });
    const res = await runRoutine(produceSpec(), input(), a, { mode: "dry_run" });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("produce failed: no model provider is configured");
  });
});

describe("optional reads", () => {
  it("an optional read that cannot be asked lands as 'unavailable' with a receipt and the chain carries on", async () => {
    const { adapters: a, producer } = adapters();
    a.reader = new FailingReader("couldn't ask gorgias tickets: nothing connected for this account");
    const res = await runRoutine(produceSpec(), input(), a, { mode: "dry_run" });
    expect(res.status).toBe("done");
    expect(res.receipts[0]).toMatchObject({ kind: "notification", description: "Couldn’t read gorgias tickets (nothing connected for this account) — drafting from what I have.", payload: { provenance: "unavailable", optional: true } });
    expect(producer.calls[0].ctx.reads.questions).toMatchObject({ rows: [], provenance: "unavailable" });
  });

  it("a required read that cannot be asked still fails the run", async () => {
    const { adapters: a } = adapters();
    a.reader = new FailingReader("couldn't ask shopify checkouts: nothing connected");
    const spec = produceSpec();
    (spec.nodes[1] as { optional?: boolean }).optional = false;
    const res = await runRoutine(spec, input(), a, { mode: "dry_run" });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("couldn't ask shopify checkouts");
  });
});

describe("n8n bridge", () => {
  class FakeBridge implements N8nBridge {
    calls: { url: string | null; skill: string }[] = [];
    constructor(private readonly answer: N8nCallResult) {}
    async call(node: Parameters<N8nBridge["call"]>[0], _ctx: Parameters<N8nBridge["call"]>[1], workflow: Parameters<N8nBridge["call"]>[2]) {
      this.calls.push({ url: workflow?.webhookUrl ?? null, skill: node.kind === "produce" ? (node.skill ?? "") : "n8n" });
      return this.answer;
    }
  }

  it("a registered active workflow takes the produce step over (account row beats global)", async () => {
    const bridge = new FakeBridge({ kind: "artifact", artifact: { ...SAMPLE_ARTIFACT, title: "From n8n" } });
    const { adapters: a, store, producer } = adapters();
    a.n8n = bridge;
    await store.putN8nWorkflow({ id: "w-global", accountId: null, routineId: "D01-W01", webhookUrl: "https://n8n.test/global", active: true });
    await store.putN8nWorkflow({ id: "w-mine", accountId: "acct-1", routineId: "D01-W01", webhookUrl: "https://n8n.test/mine", active: true });
    await store.putN8nWorkflow({ id: "w-off", accountId: "acct-1", routineId: "D01-W01", webhookUrl: "https://n8n.test/off", active: false });
    const res = await runRoutine(produceSpec(), input(), a, { mode: "dry_run" });
    expect(res.status).toBe("done");
    expect(bridge.calls).toEqual([{ url: "https://n8n.test/mine", skill: "D01-W01" }]);
    expect(producer.calls).toHaveLength(0);
    expect(res.artifact).toMatchObject({ title: "From n8n", meta: { via: "n8n" } });
  });

  it("without a registered workflow the producer runs; a global row applies to every account", async () => {
    const bridge = new FakeBridge({ kind: "artifact", artifact: SAMPLE_ARTIFACT });
    const { adapters: a, store, producer } = adapters();
    a.n8n = bridge;
    await runRoutine(produceSpec(), input(), a, { mode: "dry_run" });
    expect(producer.calls).toHaveLength(1);
    await store.putN8nWorkflow({ id: "w-global", accountId: null, routineId: "D01-W01", webhookUrl: "https://n8n.test/global", active: true });
    await runRoutine(produceSpec(), input({ account: { accountId: "acct-2", currency: "NZD", budgetMonthly: 0 } }), a, { mode: "dry_run" });
    expect(bridge.calls).toEqual([{ url: "https://n8n.test/global", skill: "D01-W01" }]);
  });

  it("202 accepted holds the run; the async callback delivers the artifact and the chain finishes", async () => {
    const bridge = new FakeBridge({ kind: "accepted" });
    const { adapters: a, store } = adapters();
    a.n8n = bridge;
    await store.putN8nWorkflow({ id: "w", accountId: null, routineId: "D01-W01", webhookUrl: "https://n8n.test/w", active: true });
    const held = await runRoutine(produceSpec(), input(), a, { mode: "dry_run" });
    expect(held.status).toBe("running");
    expect(held.summary).toBe("Waiting for the n8n workflow's artifact.");
    const run = (await store.getRun(held.runId))!;
    expect(run.snapshot).toMatchObject({ awaiting: "n8n", nextNodeIndex: 3 });
    await expect(completeExternalArtifact("nope", { artifact: SAMPLE_ARTIFACT }, a)).rejects.toThrow("not found");
    const done = await completeExternalArtifact(held.runId, { artifact: { ...SAMPLE_ARTIFACT, title: "Delivered later" } }, a);
    expect(done.status).toBe("done");
    expect(done.artifact).toMatchObject({ title: "Delivered later", meta: { via: "n8n" } });
    expect(done.receipts.map((r) => r.kind)).toEqual(["draft", "draft", "draft"]);
    const finished = (await store.getRun(held.runId))!;
    expect(finished.status).toBe("done");
    expect(finished.snapshot).toBeUndefined();
    await expect(completeExternalArtifact(held.runId, { artifact: SAMPLE_ARTIFACT }, a)).rejects.toThrow("not waiting for an n8n artifact");
  });

  it("the callback can also answer with needs → waiting_input", async () => {
    const bridge = new FakeBridge({ kind: "accepted" });
    const { adapters: a, store } = adapters();
    a.n8n = bridge;
    await store.putN8nWorkflow({ id: "w", accountId: null, routineId: "D01-W01", webhookUrl: "https://n8n.test/w", active: true });
    const held = await runRoutine(produceSpec(), input(), a, { mode: "dry_run" });
    const waiting = await completeExternalArtifact(held.runId, { needs: [{ input: "brand_notes", why: "the workflow wants your brand notes" }] }, a);
    expect(waiting.status).toBe("waiting_input");
    expect((await store.getRun(held.runId))!.status).toBe("waiting_input");
  });

  it("an explicit n8n node with its own webhook runs through the bridge without a registered row", async () => {
    const bridge = new FakeBridge({ kind: "artifact", artifact: { ...SAMPLE_ARTIFACT, kind: "generic", title: "Explicit" } });
    const { adapters: a } = adapters();
    a.n8n = bridge;
    const spec = produceSpec({ nodes: [{ kind: "trigger", id: "t", cadence: "manual" }, { kind: "read", id: "r", as: "q", source: "gorgias", query: { resource: "tickets" }, optional: true }, { kind: "n8n", id: "n8n", webhookUrl: "https://n8n.test/explicit", timeoutMs: 5000 }, { kind: "gate", id: "g", title: "{{artifact.title}}", expiryHours: 1 }, { kind: "receipt", id: "rc" }] });
    expect(validateSpec(spec)).toEqual([]);
    const res = await runRoutine(spec, input({ triggeredBy: "manual" }), a, { mode: "dry_run" });
    expect(res.status).toBe("done");
    expect(bridge.calls).toEqual([{ url: null, skill: "n8n" }]);
    expect(res.artifact?.title).toBe("Explicit");
  });

  it("no bridge configured → the step fails closed", async () => {
    const { adapters: a } = adapters();
    const spec = produceSpec({ nodes: [{ kind: "trigger", id: "t", cadence: "manual" }, { kind: "n8n", id: "n8n", webhookUrlEnv: "N8N_TEST_URL" }, { kind: "gate", id: "g", title: "x", expiryHours: 1 }, { kind: "receipt", id: "rc" }] });
    const res = await runRoutine(spec, input({ triggeredBy: "manual" }), a, { mode: "dry_run" });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("no n8n bridge is configured — nothing was drafted");
  });
});
