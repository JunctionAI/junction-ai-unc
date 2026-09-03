import { describe, expect, it } from "vitest";
import { runRoutine } from "../engine";
import type { ArtifactDraft, Executor, RoutineSpec } from "../types";
import { adapters, budgetMoveSpec, FakeProducer, input, SAMPLE_ARTIFACT, SPEND_FIXTURE } from "./helpers";

function producedMutationSpec(): RoutineSpec {
  const spec = budgetMoveSpec();
  const gateIndex = spec.nodes.findIndex((node) => node.kind === "gate");
  spec.nodes.splice(gateIndex, 0, { kind: "produce", id: "produce", skill: spec.id });
  return spec;
}

describe("live approval preflight", () => {
  it.each([
    ["root status", { ...SAMPLE_ARTIFACT, meta: { status: "BLOCKED" } }, "artifact status is BLOCKED"],
    ["body status", { ...SAMPLE_ARTIFACT, body: "STATUS: PARTIAL\n\nMore evidence is needed." }, "artifact status is PARTIAL"],
    [
      "item status",
      { ...SAMPLE_ARTIFACT, items: [{ ...SAMPLE_ARTIFACT.items![0], meta: { ...SAMPLE_ARTIFACT.items![0].meta, status: "HOLD" } }] },
      "artifact item 1 status is HOLD",
    ],
    ["apply readiness", { ...SAMPLE_ARTIFACT, meta: { apply_ready: false } }, "artifact explicitly says apply_ready is false"],
    ["action mismatch", { ...SAMPLE_ARTIFACT, meta: { action_id: "different.action" } }, "artifact action_id different.action does not match update_adset_budget"],
  ] satisfies [string, ArtifactDraft, string][]) ("holds an explicitly unsafe artifact before asking for approval: %s", async (_case, artifact, reason) => {
    const { adapters: a, executor, store } = adapters({ fixtures: SPEND_FIXTURE, producer: new FakeProducer({ artifact }) });

    const result = await runRoutine(producedMutationSpec(), input(), a, { mode: "live" });

    expect(result.status).toBe("skipped");
    expect(result.summary).toBe(`Held before approval: ${reason}. Nothing was changed.`);
    expect(result.approval).toBeUndefined();
    expect(executor.calls).toHaveLength(0);
    expect(await store.listApprovals("acct-1")).toHaveLength(0);
    expect(result.receipts.at(-1)).toMatchObject({ kind: "notification", payload: { blocked: reason } });
  });

  it("does not create an approval when the executor says the rendered live action is unsupported", async () => {
    const dryRuns: unknown[] = [];
    let executeCalls = 0;
    const executor: Executor = {
      async dryRun(node, mutation, ctx) {
        dryRuns.push({ node, mutation, mode: ctx.mode });
        return { preview: `refuse unsupported action ${mutation.action}`, payload: { actionId: mutation.action, implemented: false }, blocked: "not_implemented — no typed action" };
      },
      async execute() {
        executeCalls += 1;
        return { ok: true };
      },
    };
    const { adapters: a, store } = adapters({ fixtures: SPEND_FIXTURE, executor, producer: new FakeProducer() });

    const result = await runRoutine(producedMutationSpec(), input(), a, { mode: "live" });

    expect(result.status).toBe("skipped");
    expect(result.summary).toBe("Held before approval: not_implemented — no typed action. Nothing was changed.");
    expect(dryRuns).toMatchObject([
      { node: { id: "execute", platform: "meta_ads" }, mutation: { action: "update_adset_budget", target: { adsetId: "as-1" }, params: { increase: 20 } }, mode: "live" },
    ]);
    expect(executeCalls).toBe(0);
    expect(await store.listApprovals("acct-1")).toHaveLength(0);
    expect(result.receipts.at(-1)).toMatchObject({
      kind: "notification",
      platform: "meta_ads",
      payload: { blocked: "not_implemented — no typed action", preview: "refuse unsupported action update_adset_budget" },
    });
  });

  it("keeps dry runs informative even when the proposal and executor report blockers", async () => {
    let executeCalls = 0;
    const executor: Executor = {
      async dryRun(_node, mutation, ctx) {
        expect(ctx.mode).toBe("dry_run");
        return { preview: `refuse unsupported action ${mutation.action}`, payload: { actionId: mutation.action }, blocked: "not_implemented" };
      },
      async execute() {
        executeCalls += 1;
        return { ok: true };
      },
    };
    const producer = new FakeProducer({ artifact: { ...SAMPLE_ARTIFACT, meta: { status: "BLOCKED", apply_ready: false } } });
    const { adapters: a, store } = adapters({ fixtures: SPEND_FIXTURE, executor, producer });

    const result = await runRoutine(producedMutationSpec(), input(), a, { mode: "dry_run" });

    expect(result.status).toBe("done");
    expect(result.receipts.some((receipt) => receipt.description.startsWith("Would ask"))).toBe(true);
    expect(result.receipts.some((receipt) => receipt.description.includes("guards would block it: not_implemented"))).toBe(true);
    expect(executeCalls).toBe(0);
    expect(await store.listApprovals("acct-1")).toHaveLength(0);
  });
});
