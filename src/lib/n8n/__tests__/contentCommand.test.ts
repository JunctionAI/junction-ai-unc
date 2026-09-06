import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentCommandApproval, contentCommandMarket, CONTENT_PILOT_PIN } from "../contentCommand";
import { contentPilotContract, ContentAlreadyIssued, contentReservation, type ContentApproval } from "../contentAdmission";
import { contentShadowSpec } from "../contentShadowSpec";
import { CONTENT_ROUTINES, CONTENT_SEED } from "../contentShadowContract";

import { commandId, digest } from "../../commands/queue";
import { workflowFingerprint } from "../../commands/releaseScope";
import { eligible } from "../../commands/dispatch";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { MemoryStore } from "../../runtime/store/memory";
import type { RoutineCommand } from "../../commands/types";
import type { DispatchDeps } from "../../commands/dispatch";
import { CATALOG_SPEC_BY_ID } from "../../runtime/catalog-specs";

afterEach(() => vi.unstubAllEnvs());

function selected(market: ContentApproval["market"] = "US", routineId: ContentApproval["routineId"] = "D01-W02") {
  const now = new Date(), userId = "74802c60-149a-4405-b719-dc058d174072";
  const approval: ContentApproval = { authorizedBy: userId, approvalReference: "TEST", idempotencyKey: "TEST", market, routineId,
    contextGeneration: 1, maxProviderCalls: 1, expiresAt: new Date(now.getTime() + 600_000).toISOString() };
  const contract = contentPilotContract(approval, now);
  const spec = contentShadowSpec(contract, 2);
  const workflow = { id: randomUUID(), accountId: contract.accountId, routineId: spec.id, active: true,
    webhookUrl: CONTENT_ROUTINES[routineId].receiverUrl };
  const actor = { accountId: contract.accountId, userId, contextGeneration: 1, channel: "app" as const, requestId: randomUUID() };
  const request = `/run ${routineId}`, id = commandId(actor);
  const command: RoutineCommand = { id, actor, contextGeneration: 1, routineId: spec.id, version: 2, request, requestHash: digest(request),
    specHash: digest(spec), workflowHash: workflowFingerprint(workflow), createdAt: now.toISOString(), updatedAt: now.toISOString(),
    status: "running", runId: id, reply: "" };
  return { now, contract, spec, workflow, actor, command, approval };
}

describe("AVGAR content command admission (simulated; FakeSupabase, no provider)", () => {
  it.each(["US", "NZ", "AU"] as const)("binds %s to the saved market and reviewed pin", market => {
    const f = selected(market);
    expect(contentCommandMarket(f.actor, f.spec, f.workflow)).toBe(market);
    expect(f.contract.client.seedKeyword).toBe(CONTENT_SEED);
    expect(f.contract.workflowId).toBe(CONTENT_PILOT_PIN.workflowId);
    expect(f.contract.workflowVersion).toBe(CONTENT_PILOT_PIN.workflowVersion);
  });
  it("admits customer questions as a separate routine with the same workflow pin", () => {
    const f = selected("US", "D01-W03");
    expect(contentCommandMarket(f.actor, f.spec, f.workflow)).toBe("US");
    expect(f.spec.id).toBe("D01-W03");
    expect(f.workflow.webhookUrl).toBe(CONTENT_ROUTINES["D01-W03"].receiverUrl);
  });
  it("refuses Slack, other tenants, catalog builtins, historical seed and builtin fallbacks", () => {
    const f = selected();
    expect(contentCommandMarket({ ...f.actor, channel: "slack" }, f.spec, f.workflow)).toBeNull();
    expect(contentCommandMarket({ ...f.actor, accountId: randomUUID() }, f.spec, f.workflow)).toBeNull();
    expect(contentCommandMarket(f.actor, CATALOG_SPEC_BY_ID["D01-W02"], f.workflow)).toBeNull();
    expect(contentCommandMarket(f.actor, f.spec, null)).toBeNull();
    expect(contentCommandMarket(f.actor, f.spec, { ...f.workflow, webhookUrl: "https://example.test/other" })).toBeNull();
    const foreign = contentShadowSpec({ ...f.contract, workflowVersion: randomUUID() }, 2);
    expect(contentCommandMarket(f.actor, foreign, f.workflow)).toBeNull();
  });
  it.each(["owner", "id", "generation", "status", "run", "request"])("refuses changed %s evidence", field => {
    const f = selected(), c = structuredClone(f.command);
    if (field === "owner") c.actor.userId = randomUUID();
    if (field === "id") c.id = randomUUID();
    if (field === "generation") c.contextGeneration++;
    if (field === "status") c.status = "queued";
    if (field === "run") c.runId = randomUUID();
    if (field === "request") c.request = "changed";
    expect(() => contentCommandApproval(c, f.spec, f.workflow, f.now)).toThrow();
  });
});

describe("disabled, duplicate and isolation", () => {
  function deps(store: MemoryStore): DispatchDeps {
    return {
      store, queue: { get: async () => null, enqueue: async () => { throw new Error("unused"); }, list: async () => [], update: async () => undefined } as never,
      isOwner: async () => true, assertContext: async () => undefined, connected: async () => [],
      business: async () => ({ businessType: "ecommerce", sells: "products", storefront: "shopify" }), budget: async () => true,
      interpret: async () => ({ kind: "run", routineId: "D01-W02" }), selectionReleased: () => true,
    };
  }
  const state = (accountId: string, enabled: boolean, liveSpec: ReturnType<typeof contentShadowSpec> | null, version = 2) =>
    ({ accountId, routineId: "D01-W02", enabled, version, liveSpec, draftSpec: null, updatedAt: new Date().toISOString() });
  it("refuses a switched-off AVGAR content routine before any provider work", async () => {
    const f = selected(), store = new MemoryStore();
    await store.putRoutineState(state(f.actor.accountId, false, f.spec));
    await store.putN8nWorkflow(f.workflow);
    const out = await eligible(deps(store), f.actor, "D01-W02");
    expect(out).toMatchObject({ ok: false, reply: expect.stringContaining("switched off") });
  });
  it("refuses AVGAR catalog content without the reviewed search adapter", async () => {
    const f = selected(), store = new MemoryStore();
    await store.putRoutineState(state(f.actor.accountId, true, null, 1));
    const out = await eligible(deps(store), f.actor, "D01-W02");
    expect(out).toMatchObject({ ok: false, reply: expect.stringContaining("reviewed AVGAR hooks/questions") });
  });
  it("does not admit another tenant even with a copied spec", async () => {
    const f = selected(), other = randomUUID();
    expect(contentCommandMarket({ ...f.actor, accountId: other }, f.spec, { ...f.workflow, accountId: other })).toBeNull();
  });
  it("duplicate issuance returns the original run rather than a second provider call", async () => {
    const f = selected(), db = new FakeSupabase();
    const run = { id: f.command.id, accountId: f.actor.accountId, contextGeneration: 1, routineId: "D01-W02" as const, version: 2,
      mode: "dry_run" as const, status: "running" as const, startedAt: f.now.toISOString(), specHash: digest(f.spec),
      snapshot: { spec: f.spec, ctx: { account: { accountId: f.actor.accountId, contextGeneration: 1, currency: "NZD", budgetMonthly: 0 },
        runId: f.command.id, routineId: "D01-W02" as const, version: 2, startedAt: f.now.toISOString(), mode: "dry_run" as const,
        caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual" as const, vars: {}, inputs: {}, reads: {}, checks: {} },
        awaiting: "content_start" as const, nextNodeIndex: 0, startProtocol: "content_claim_v1" as const } };
    db.rpcs.issue_content_shadow_run = () => ({ created: false, runId: run.id, permitId: randomUUID() });
    await expect(contentReservation(db, { ...f.approval, authorizedBy: f.actor.userId, contextGeneration: 1 }, () => f.now)(run))
      .rejects.toBeInstanceOf(ContentAlreadyIssued);
  });
});
