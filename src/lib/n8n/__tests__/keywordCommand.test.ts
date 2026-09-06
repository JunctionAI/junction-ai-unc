import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keywordCommandApproval, keywordCommandMarket } from "../keywordCommand";
import { keywordPilotContract, KEYWORD_PILOT_PIN, type KeywordPilotApproval } from "../keywordAdmission";
import { keywordShadowSpec } from "../keywordShadowSpec";
import { commandId, DbCommandQueue, digest } from "../../commands/queue";
import { workflowFingerprint } from "../../commands/releaseScope";
import { routeCommand } from "../../commands/message";
import { dispatchDeps } from "../../commands/deps";
import { processCommand } from "../../commands/process";
import { executeRoutineCommand } from "../../../worker/commands";
import { StaticAccountsSource } from "../../../worker/accounts";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { adapters as testAdapters } from "../../runtime/__tests__/helpers";
import type { RunRecord } from "../../runtime/store/interface";
import type { RoutineCommand } from "../../commands/types";

afterEach(() => vi.unstubAllEnvs());
function selected(market: KeywordPilotApproval["market"] = "US") {
  const now = new Date(), userId = "11111111-1111-4111-8111-111111111111";
  const contract = keywordPilotContract({ authorizedBy: userId, approvalReference: "TEST", idempotencyKey: "TEST", market,
    contextGeneration: 1, maxProviderCalls: 1, expiresAt: new Date(now.getTime() + 600_000).toISOString() }, now);
  const spec = keywordShadowSpec(contract, 2), workflow = { id: randomUUID(), accountId: contract.accountId, routineId: spec.id, active: true, webhookUrl: KEYWORD_PILOT_PIN.receiverUrl };
  const actor = { accountId: contract.accountId, userId, contextGeneration: 1, channel: "app" as const, requestId: randomUUID() };
  const request = "/run D03-W01", id = commandId(actor);
  const command: RoutineCommand = { id, actor, contextGeneration: 1, routineId: spec.id, version: 2, request, requestHash: digest(request),
    specHash: digest(spec), workflowHash: workflowFingerprint(workflow), createdAt: now.toISOString(), updatedAt: now.toISOString(), status: "running", runId: id, reply: "" };
  return { now, contract, spec, workflow, actor, command };
}
describe("customer keyword authority is derived from a captured command", () => {
  it("admits the scoped Slack pilot and refuses another room or an expired release", () => {
    const f = selected();
    const actor = { ...f.actor, channel: "slack" as const, linkId: randomUUID(),
      channelBinding: { bindingVersion: 0, externalId: "U0BLLM1NDNV", scopeId: "T0BMD3LMWUQ", conversationId: "C0BR8UNSR26", threadId: "1788663600.123456" } };
    const scope = { accountId: actor.accountId, userId: actor.userId, contextGeneration: 1,
      externalId: actor.channelBinding.externalId, scopeId: actor.channelBinding.scopeId,
      conversationId: actor.channelBinding.conversationId, expiresAt: new Date(Date.now() + 600_000).toISOString() };
    vi.stubEnv("UNC_MESSAGING_ENABLED", "true");
    vi.stubEnv("UNC_MESSAGING_PILOT_SCOPE", JSON.stringify(scope));
    expect(keywordCommandMarket(actor, f.spec, f.workflow)).toBe("US");
    expect(keywordCommandMarket({ ...actor, channelBinding: { ...actor.channelBinding, conversationId: "COTHER" } }, f.spec, f.workflow)).toBeNull();
    vi.stubEnv("UNC_MESSAGING_PILOT_SCOPE", JSON.stringify({ ...scope, expiresAt: new Date(0).toISOString() }));
    expect(keywordCommandMarket(actor, f.spec, f.workflow)).toBeNull();
  });
  it.each(["US", "NZ", "AU"] as const)("binds %s to the saved market and a fixed expiry", market => {
    const f = selected(market), approval = keywordCommandApproval(f.command, f.spec, f.workflow, f.now);
    expect(approval).toEqual({ authorizedBy: f.actor.userId, contextGeneration: 1, market, maxProviderCalls: 1,
      approvalReference: `keyword-command:${f.command.id}`, idempotencyKey: `keyword-command:${f.command.id}`,
      expiresAt: new Date(f.now.getTime() + 600_000).toISOString() });
    expect(keywordCommandApproval(f.command, f.spec, f.workflow, new Date(f.now.getTime() + 300_000))).toEqual(approval);
    expect(() => keywordCommandApproval(f.command, f.spec, f.workflow, new Date(f.now.getTime() + 600_000))).toThrow();
  });
  it.each(["owner", "id", "generation", "status", "run", "request", "spec", "workflow", "future"])("refuses changed %s evidence", field => {
    const f = selected(), c = structuredClone(f.command);
    if (field === "owner") c.actor.userId = randomUUID();
    if (field === "id") c.id = randomUUID();
    if (field === "generation") c.contextGeneration++;
    if (field === "status") c.status = "queued";
    if (field === "run") c.runId = randomUUID();
    if (field === "request") c.request = "changed";
    if (field === "spec") c.specHash = "a".repeat(64);
    if (field === "workflow") c.workflowHash = "a".repeat(64);
    if (field === "future") c.createdAt = new Date(f.now.getTime() + 1000).toISOString();
    expect(() => keywordCommandApproval(c, f.spec, f.workflow, f.now)).toThrow();
  });
  it("refuses other tenants, channels, seeds, revisions, extra fields and builtin fallbacks", () => {
    const f = selected();
    expect(keywordCommandMarket({ ...f.actor, channel: "slack" }, f.spec, f.workflow)).toBeNull();
    expect(keywordCommandMarket({ ...f.actor, accountId: randomUUID() }, f.spec, f.workflow)).toBeNull();
    expect(keywordCommandMarket(f.actor, f.spec, null)).toBeNull();
    for (const contract of [{ ...f.contract, workflowVersion: randomUUID() }, { ...f.contract, client: { ...f.contract.client, seedKeyword: "travel bag" } }, { ...f.contract, extra: "not allowed" }]) {
      expect(keywordCommandMarket(f.actor, keywordShadowSpec(contract, 2), f.workflow)).toBeNull();
    }
  });
});

async function fixture(market: KeywordPilotApproval["market"] = "US") {
  const f = selected(market), db = new FakeSupabase(), h = testAdapters();
  db.seed("accounts", [{ id: f.actor.accountId, context_generation: 1, automation_paused: false }]);
  db.seed("account_members", [{ account_id: f.actor.accountId, user_id: f.actor.userId, role: "owner" }]);
  await h.store.putRoutineState({ accountId: f.actor.accountId, routineId: f.spec.id, version: 2, enabled: true, liveSpec: f.spec, draftSpec: null, updatedAt: f.now.toISOString() });
  await h.store.putN8nWorkflow(f.workflow);
  const issued = vi.fn(({ input }: Record<string, unknown>) => {
    const p = input as { run: RunRecord; commandId: string; commandSpecJson: string; approval: KeywordPilotApproval };
    expect(p.commandId).toBe(f.command.id);expect(JSON.parse(p.commandSpecJson)).toEqual(f.spec);
    expect(p.run.snapshot?.ctx.inputs).toEqual({});expect(p.approval.market).toBe(market);
    void h.store.createRun(p.run);
    return { created: true, runId: p.run.id, permitId: randomUUID(), registrationId: f.workflow.id };
  });
  db.rpcs.issue_keyword_shadow_command = issued;
  db.rpcs.claim_keyword_shadow_command_start = ({ input }) => {
    const r = (input as { run: RunRecord }).run;
    void h.store.updateRun(r.id, { snapshot: { ...r.snapshot!, awaiting: "keyword_started" } });return true;
  };
  const call = vi.fn(async () => ({ kind: "needs" as const, needs: [{ input: "test_only", why: "Fake provider response, not live acceptance" }] }));
  const read = vi.spyOn(h.adapters.reader, "read");
  const wired = { ...h.adapters, now: () => f.now, n8n: { call }, completeKeywordShadow: vi.fn() };
  const accounts = new StaticAccountsSource([{ account: { accountId: f.actor.accountId, contextGeneration: 1, currency: "NZD", budgetMonthly: 0 }, vars: { website: "avgarsport.com" } }]);
  const values = { UNC_COMMANDS_ENABLED: "true", UNC_COMMAND_RELEASE_SCOPES: JSON.stringify([{ accountId: f.actor.accountId, contextGeneration: 1, channel: "app",
    routineId: f.spec.id, specHash: digest(f.spec), workflowHash: workflowFingerprint(f.workflow), expiresAt: new Date(f.now.getTime() + 600_000).toISOString() }]),
    N8N_EXECUTION_READER_ENABLED: "true", N8N_EXECUTION_API_BASE_URL: "https://junctionai8.app.n8n.cloud/api/v1", N8N_EXECUTION_API_KEY: "fake-reader-".repeat(4),
    N8N_SHADOW_WORKFLOW_ID: KEYWORD_PILOT_PIN.workflowId, N8N_SHADOW_TRIGGER_NODE_ID: "fake-trigger", N8N_SHADOW_RECEIVER_URL: KEYWORD_PILOT_PIN.receiverUrl,
    N8N_SHADOW_RECEIVER_TOKEN: "fake-receiver-".repeat(4), N8N_SIGNING_SECRET: "fake-signing-".repeat(4), N8N_DATA_BASE_URL: "https://junction-unc.vercel.app" };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  const queue = new DbCommandQueue(db);
  const response = await routeCommand(db, h.store, f.actor, f.command.request);expect(response?.status).toBe("queued");
  const queued = (await queue.get(f.actor.accountId, f.command.id))!;
  // The command router captures its own current timestamp, not the test's earlier one.
  const executeNow = new Date(Math.max(Date.now(), Date.parse(queued.createdAt)));
  const process = () => processCommand({ ...dispatchDeps(db, h.store, f.actor.accountId),
    execute: (c, spec, workflow) => executeRoutineCommand({ db, store: h.store, accounts, now: () => executeNow }, wired, c, spec, workflow) }, queued);
  return { ...f, db, h, queue, process, issued, read, call };
}
describe("customer keyword dispatcher to command-bound engine wiring (fake I/O)", () => {
  it.each(["US", "NZ", "AU"] as const)("uses the new issuance/start path once for %s", async market => {
    const f = await fixture(market);await Promise.all([f.process(), f.process()]);
    expect(f.issued).toHaveBeenCalledTimes(1);expect(f.read).toHaveBeenCalledTimes(2);expect(f.call).toHaveBeenCalledTimes(1);
    expect(f.h.producer.calls).toHaveLength(0);expect(f.h.executor.calls).toHaveLength(0);
    expect((await f.queue.get(f.actor.accountId, f.command.id))?.status).toBe("waiting");
    expect(await routeCommand(f.db, f.h.store, f.actor, f.command.request)).toMatchObject({ commandId: f.command.id, status: "waiting" });
    expect(f.issued).toHaveBeenCalledTimes(1);
  });
  it("does not issue or read when the execution reader is unavailable", async () => {
    const f = await fixture();vi.stubEnv("N8N_EXECUTION_READER_ENABLED", "false");await f.process();
    expect(f.issued).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
  });
  it("a lost issuance response is not retried", async () => {
    const f = await fixture(), original = f.db.rpcs.issue_keyword_shadow_command;
    f.db.rpcs.issue_keyword_shadow_command = args => { original(args);throw Error("Lost committed response"); };
    await f.process();await f.process();expect(f.issued).toHaveBeenCalledTimes(1);expect(f.read).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
    expect((await f.queue.get(f.actor.accountId, f.command.id))?.status).toBe("uncertain");
  });
});
