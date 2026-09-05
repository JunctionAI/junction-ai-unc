import { describe, expect, it, vi } from "vitest";
import { projectShadowExecution, shadowRequestDigest } from "../executionEvidence";
import { createShadowExecutionReader, N8N_EXECUTION_API_BASE } from "../../../worker/providers/n8nExecutionReader";
import { HttpN8nBridge, buildN8nPayload } from "../../../worker/providers/n8n";
import { AVGAR_PILOT_ACCOUNT, KEYWORD_SHADOW_CONTRACT, type KeywordShadowContract } from "../shadowContract";
import type { N8nNode, RunContext } from "../../runtime/types";

// Synthetic API response, grounded in the documented public execution schema, not live proof.
const binding = { workflowId: "test-keyword-wrapper", executionId: "12345", triggerNodeId: "trigger-1" };
const start = "2026-09-05T04:00:00.000Z", end = "2026-09-05T04:00:02.000Z", now = new Date("2026-09-05T04:00:03.000Z");
const contract: KeywordShadowContract = { contract: KEYWORD_SHADOW_CONTRACT, accountId: AVGAR_PILOT_ACCOUNT,
  workflowId: binding.workflowId, workflowVersion: "test-revision-1", routineId: "D03-W01", routineKey: "keyword_opportunity",
  client: { id: "avgar", primaryDomain: "example.com", seedKeyword: "synthetic keyword", locationCode: 2840, languageCode: "en" } };
const ctx: RunContext = { runId: "test-run", routineId: "D03-W01", version: 1, mode: "dry_run", startedAt: start,
  account: { accountId: AVGAR_PILOT_ACCOUNT, currency: "NZD", budgetMonthly: 0 }, caps: { currency: "NZD", perDay: 0, perMonth: 0 },
  triggeredBy: "manual", vars: {}, inputs: {}, reads: {}, checks: {} };
const env = { NODE_ENV: "production", N8N_EXECUTION_READER_ENABLED: "true", N8N_EXECUTION_API_BASE_URL: N8N_EXECUTION_API_BASE,
  N8N_EXECUTION_API_KEY: "synthetic-independent-execution-api-key", N8N_SHADOW_WORKFLOW_ID: binding.workflowId,
  N8N_SHADOW_TRIGGER_NODE_ID: binding.triggerNodeId, N8N_SIGNING_SECRET: "synthetic-signing-root", N8N_SHADOW_RECEIVER_TOKEN: "synthetic-separate-receiver-key",
  N8N_SHADOW_RECEIVER_URL: "https://junctionai8.app.n8n.cloud/webhook/test-keyword", N8N_DATA_BASE_URL: "https://unc.example.com" };
const node: N8nNode = { id: "keyword", kind: "n8n", shadowContract: contract, webhookUrl: env.N8N_SHADOW_RECEIVER_URL };
const payload = () => JSON.parse(JSON.stringify(buildN8nPayload(node, ctx, { env, secret: env.N8N_SIGNING_SECRET, now: () => now }))) as Record<string, unknown>;
function saved(body = payload()): Record<string, unknown> {
  return { id: binding.executionId, workflowId: binding.workflowId, workflowVersionId: contract.workflowVersion,
    status: "success", finished: true, mode: "webhook", retryOf: null, startedAt: start, stoppedAt: end,
    workflowData: { id: binding.workflowId, versionId: contract.workflowVersion, nodes: [{ id: binding.triggerNodeId, name: "Incoming", type: "n8n-nodes-base.webhook" }] },
    data: { resultData: { runData: { Incoming: [{ executionStatus: "success", data: { main: [[{ json: { body, headers: { authorization: "never-emit-receiver-key" } } }]] } }] } } },
    customData: { apiKey: "never-emit-api-key" } };
}
function edited(...edits: [string, unknown][]) {
  const record = saved();
  for (const [path, value] of edits) {
    const parts = path.split(".");
    let at = record;
    for (const part of parts.slice(0, -1)) at = at[part] as Record<string, unknown>;
    at[parts.at(-1)!] = value;
  }
  return record;
}
const dns = async () => [{ address: "93.184.216.34", family: 4 }];
const input = () => ({ ...binding, signal: new AbortController().signal });
const wait = async () => {};

describe("saved execution evidence", () => {
  it("projects actual revision and the pinned original trigger, stripping raw data and credentials", () => {
    const seen = projectShadowExecution(saved(), binding);
    expect(seen).toMatchObject({ source: "n8n_execution_record", workflowVersion: contract.workflowVersion,
      request: { accountId: AVGAR_PILOT_ACCOUNT, runId: ctx.runId, routineId: ctx.routineId }, requestDigest: shadowRequestDigest(payload()) });
    expect(JSON.stringify(seen)).not.toMatch(/never-emit|dataToken|synthetic-signing|synthetic-independent/);
    expect(projectShadowExecution(edited(["workflowVersionId", null]), binding).workflowVersion).toBe(contract.workflowVersion);
    expect(projectShadowExecution(edited(["workflowData.versionId", undefined]), binding).workflowVersion).toBe(contract.workflowVersion);
  });
  it.each([
    ["id", "54321"], ["workflowId", "other"], ["workflowData.id", "other"], ["workflowVersionId", "conflicting"],
    ["mode", "manual"], ["retryOf", "100"], ["status", "error"], ["finished", false], ["dataTooLargeToDisplay", true],
    ["data.redactionInfo", { isRedacted: true }], ["data.resultData.error", { message: "secret" }],
    ["workflowData.nodes.0.type", "n8n-nodes-base.set"], ["workflowData.nodes.0.id", "not-pinned"],
    ["workflowData.nodes.0.disabled", true], ["data.resultData.runData.Incoming", []],
    ["data.resultData.runData.Incoming.0.executionStatus", "error"], ["data.resultData.runData.Incoming.0.data.main.0", []],
    ["data.resultData.runData.Incoming.0.data.main.0.0.json.body.mode", "live"], ["stoppedAt", "invalid"],
  ])("rejects unusable execution evidence: %s", (path, value) => {
    expect(() => projectShadowExecution(edited([path as string, value]), binding)).toThrow("evidence rejected");
  });
  it("never substitutes expected/custom data for a missing actual revision, or accepts child-only provenance", () => {
    expect(() => projectShadowExecution(edited(["workflowVersionId", null], ["workflowData.versionId", null]), binding)).toThrow("revision_missing");
    const trigger = { id: binding.triggerNodeId, name: "Incoming", type: "n8n-nodes-base.webhook" };
    expect(() => projectShadowExecution(edited(["workflowData.nodes", [trigger, { id: "child", name: "Child", type: "n8n-nodes-base.executeWorkflow" }]]), binding)).toThrow("child_execution");
    expect(() => projectShadowExecution(edited(["workflowData.nodes", [trigger, trigger]]), binding)).toThrow("trigger_binding");
  });
  it("hashes business inputs independent of object order/token redaction, while detecting changed inputs", () => {
    const body = payload();
    expect(shadowRequestDigest({ ...body, dataToken: null })).toBe(shadowRequestDigest(body));
    expect(shadowRequestDigest(Object.fromEntries(Object.entries(body).reverse()))).toBe(shadowRequestDigest(body));
    expect(shadowRequestDigest({ ...body, inputs: { seed: "different" } })).not.toBe(shadowRequestDigest(body));
    expect(() => shadowRequestDigest({ bad: undefined })).toThrow("request_value");
  });
});

describe("independent GET-only execution reader", () => {
  it.each(["N8N_EXECUTION_READER_ENABLED", "N8N_EXECUTION_API_BASE_URL", "N8N_EXECUTION_API_KEY", "N8N_SHADOW_WORKFLOW_ID", "N8N_SHADOW_TRIGGER_NODE_ID"])("refuses missing configuration before dispatch: %s", key => {
    expect(createShadowExecutionReader({ ...env, [key]: "" }, binding.workflowId)).toBeUndefined();
  });
  it("refuses alternate origins, workflow IDs and shared credentials", () => {
    expect(createShadowExecutionReader({ ...env, N8N_EXECUTION_API_BASE_URL: "https://attacker.example/api/v1" }, binding.workflowId)).toBeUndefined();
    expect(createShadowExecutionReader(env, "different-workflow")).toBeUndefined();
    expect(createShadowExecutionReader({ ...env, N8N_EXECUTION_API_KEY: env.N8N_SHADOW_RECEIVER_TOKEN }, binding.workflowId)).toBeUndefined();
    expect(createShadowExecutionReader({ ...env, N8N_EXECUTION_API_KEY: env.N8N_SIGNING_SECRET }, binding.workflowId)).toBeUndefined();
  });
  it("sends only GET for the exact named execution to a pinned public address", async () => {
    const fetch = vi.fn(async () => Response.json(saved()));
    const reader = createShadowExecutionReader(env, binding.workflowId, { fetch, lookup: dns })!;
    expect(await reader(input())).toMatchObject({ requestDigest: shadowRequestDigest(payload()) });
    expect(fetch).toHaveBeenCalledWith(`${N8N_EXECUTION_API_BASE}/executions/12345?includeData=true`, expect.objectContaining({ method: "GET", redirect: "manual", cache: "no-store", headers: { accept: "application/json", "X-N8N-API-KEY": env.N8N_EXECUTION_API_KEY } }), { address: "93.184.216.34", family: 4 });
  });
  it("blocks bad IDs, private DNS and cancellation before transmitting any credential", async () => {
    const fetch = vi.fn();
    const reader = createShadowExecutionReader(env, binding.workflowId, { fetch, lookup: dns })!;
    await expect(reader({ ...input(), executionId: "../workflows" })).rejects.toThrow("identity refused");
    await expect(reader({ ...input(), workflowId: "other" })).rejects.toThrow("identity refused");
    await expect(reader({ ...input(), signal: AbortSignal.abort() })).rejects.toThrow();
    const privateReader = createShadowExecutionReader(env, binding.workflowId, { fetch, lookup: async () => [{ address: "127.0.0.1", family: 4 }] })!;
    await expect(privateReader(input())).rejects.toThrow("destination refused");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([301, 302, 307, 308, 400, 401, 403])("does not follow/retry HTTP %i or expose its body", async status => {
    const fetch = vi.fn(async () => new Response("secret-provider-response", { status }));
    const reader = createShadowExecutionReader(env, binding.workflowId, { fetch, lookup: dns, wait })!;
    await expect(reader(input())).rejects.toThrow("evidence remains unverified");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reconciles finalization with bounded reads of the SAME execution, not a workflow retry", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ...saved(), status: "running", finished: false })).mockResolvedValueOnce(Response.json(saved()));
    const reader = createShadowExecutionReader(env, binding.workflowId, { fetch, lookup: dns, wait })!;
    await expect(reader(input())).resolves.toMatchObject({ executionId: "12345" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Set(fetch.mock.calls.map(c => c[0])).size).toBe(1);
  });
  it.each([404, 429, 503])("bounds temporary HTTP %i responses to four safe reads", async status => {
    const fetch = vi.fn(async () => new Response("secret", { status }));
    const reader = createShadowExecutionReader(env, binding.workflowId, { fetch, lookup: dns, wait })!;
    await expect(reader(input())).rejects.toThrow("reconcile without rerunning");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("does not retry malformed bodies, wrong tenant executions or transport errors", async () => {
    for (const response of [() => Promise.resolve(new Response("invalid json")), () => Promise.resolve(Response.json({ ...saved(), workflowId: "other" })), () => Promise.reject(new Error("secret-transport-detail"))]) {
      const fetch = vi.fn(response);
      await expect(createShadowExecutionReader(env, binding.workflowId, { fetch, lookup: dns, wait })!(input())).rejects.toThrow("evidence remains unverified");
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe("bridge uses the real reader adapter, not a webhook-supplied observation", () => {
  const reply = () => ({ artifact: { kind: "keyword_list", title: "Synthetic keyword", body: "Contract test, not a real recommendation.", items: [{ title: "Test keyword", body: "Synthetic observation." }] },
    executionReceipt: { contract: contract.contract, accountId: AVGAR_PILOT_ACCOUNT, runId: ctx.runId, routineId: ctx.routineId, routineKey: contract.routineKey,
      workflowId: binding.workflowId, executionId: binding.executionId, workflowVersion: null, revisionEvidence: "pending_unc_verification", mode: "dry_run", status: "succeeded", executedAction: "none",
      startedAt: start, finishedAt: end, client: contract.client, provider: { name: "dataforseo", taskId: "synthetic-task", statusCode: 20000, taskStatusCode: 20000, itemsCount: 1, fetchedAt: end } } });
  it("accepts correlated independent API evidence and keeps the two credentials separate", async () => {
    const fetch = vi.fn(async () => Response.json(reply()));
    const executionFetch = vi.fn(async () => Response.json(saved()));
    const bridge = new HttpN8nBridge({ env, fetch, executionFetch, lookup: dns, now: () => now });
    const result = await bridge.call(node, ctx, null);
    expect(result).toMatchObject({ kind: "artifact", artifact: { meta: { executionReceipt: { workflowVersion: contract.workflowVersion, revisionEvidence: "verified_execution_record" } } } });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(env.N8N_EXECUTION_API_KEY);
    expect(JSON.stringify(executionFetch.mock.calls)).not.toContain(env.N8N_SHADOW_RECEIVER_TOKEN);
  });
  it("rejects changed saved business inputs even when execution/account/run IDs match", async () => {
    const fetch = vi.fn(async () => Response.json(reply()));
    const executionFetch = vi.fn(async () => Response.json(saved({ ...payload(), vars: { seed: "wrong-market" } })));
    await expect(new HttpN8nBridge({ env, fetch, executionFetch, lookup: dns, now: () => now }).call(node, ctx, null)).rejects.toThrow("digest mismatch");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
