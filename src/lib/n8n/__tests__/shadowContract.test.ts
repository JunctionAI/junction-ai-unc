import { describe, expect, it } from "vitest";
import { AVGAR_PILOT_ACCOUNT, AVGAR_SEO_WORKFLOW, KEYWORD_SHADOW_CONTRACT, assertShadowRequest, validateShadowReceipt, type KeywordShadowContract } from "../shadowContract";
import { keywordShadowSpec } from "../keywordShadowSpec";
import { HttpN8nBridge, parseN8nReply } from "../../../worker/providers/n8n";
import { runRoutine } from "../../runtime/engine";
import { adapters as buildAdapters, FakeProducer } from "../../runtime/__tests__/helpers";
import type { N8nNode, RunContext } from "../../runtime/types";

// Synthetic contract-test values, not production configuration or execution evidence.
const contract: KeywordShadowContract = {
  contract: KEYWORD_SHADOW_CONTRACT, accountId: AVGAR_PILOT_ACCOUNT,
  workflowId: AVGAR_SEO_WORKFLOW, workflowVersion: "test-revision",
  routineId: "D03-W01", routineKey: "keyword_opportunity",
  client: { id: "avgar", primaryDomain: "example.com", seedKeyword: "test keyword", locationCode: 2840, languageCode: "en" },
};
const start = "2026-09-04T04:00:00.000Z";
const end = "2026-09-04T04:00:10.000Z";
const now = new Date("2026-09-04T04:00:11.000Z");
const identity = { accountId: contract.accountId, routineId: contract.routineId, runId: "run-test", mode: "dry_run", startedAt: start };
const ctx: RunContext = { ...identity, version: 2, mode: "dry_run", account: { accountId: contract.accountId, currency: "NZD", budgetMonthly: 0 }, caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, inputs: {}, reads: {}, checks: {} };
const node: N8nNode = { kind: "n8n", id: "produce", shadowContract: contract };
const workflow = { id: "registered-test", accountId: contract.accountId, routineId: contract.routineId, active: true, webhookUrl: "https://n8n.test/keyword" };
const env = { N8N_SIGNING_SECRET: "test-secret", N8N_DATA_BASE_URL: "https://unc.test", N8N_SHADOW_RECEIVER_URL: workflow.webhookUrl, N8N_SHADOW_RECEIVER_TOKEN: "synthetic-receiver-token-for-tests-only" };
function receipt() {
  return { ...identity, contract: contract.contract, routineKey: contract.routineKey, workflowId: contract.workflowId, workflowVersion: contract.workflowVersion,
    executionId: "12345", mode: "dry_run", status: "succeeded", executedAction: "none", startedAt: start, finishedAt: end, client: { ...contract.client },
    provider: { name: "dataforseo", taskId: "synthetic-task", statusCode: 20000, taskStatusCode: 20000, itemsCount: 1, fetchedAt: end } };
}
function reply() {
  return { artifact: { kind: "keyword_list", title: "Test keyword opportunity", body: "A synthetic provider-backed recommendation for contract testing only.", items: [{ title: "test keyword", body: "Synthetic observation, not real business evidence." }] }, executionReceipt: receipt() };
}
function bridge(body: unknown, status = 200) {
  let count = 0;
  const sent: unknown[] = [];
  const b = new HttpN8nBridge({ env, now: () => now,
    fetch: async (_url, init) => { count++; sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(body), { status }); } });
  return { b, sent, count: () => count };
}

describe("AVGAR keyword shadow contract", () => {
  it("pins account, routine, workflow revision and client scope before sending", async () => {
    const { b, sent } = bridge(reply());
    const out = await b.call(node, ctx, workflow);
    expect(sent[0]).toMatchObject({ shadow: contract, accountId: contract.accountId, routineId: "D03-W01", mode: "dry_run" });
    expect(out).toMatchObject({ kind: "artifact", artifact: { meta: { executionReceipt: { executionId: "12345", executedAction: "none" } }, evidence: [{ source: "n8n_execution", ref: expect.stringContaining("/executions/12345") }] } });
  });
  it.each(["accountId", "runId", "routineId", "routineKey", "workflowId", "workflowVersion", "mode", "status", "executedAction", "contract"])("rejects mismatched receipt %s", key => {
    expect(() => validateShadowReceipt({ ...receipt(), [key]: "wrong" }, contract, identity, now)).toThrow(/mismatch/);
  });
  it("rejects another account or live mode before a network call", async () => {
    const test = bridge(reply());
    await expect(test.b.call(node, { ...ctx, mode: "live" }, workflow)).rejects.toThrow("refuses live");
    await expect(test.b.call(node, { ...ctx, account: { ...ctx.account, accountId: "other-account" } }, workflow)).rejects.toThrow("mismatch");
    await expect(test.b.call(node, ctx, { ...workflow, accountId: null })).rejects.toThrow("account-specific");
    expect(test.count()).toBe(0);
  });
  it("requires separate URL-pinned receiver auth and never sends it to an edited destination", async () => {
    let calls = 0;
    const fetch = async () => { calls++; return new Response(JSON.stringify(reply()), { status: 200 }); };
    await expect(new HttpN8nBridge({ env: { ...env, N8N_SHADOW_RECEIVER_TOKEN: "" }, fetch }).call(node, ctx, workflow)).rejects.toThrow("separate scoped");
    await expect(new HttpN8nBridge({ env: { ...env, N8N_SIGNING_SECRET: env.N8N_SHADOW_RECEIVER_TOKEN }, fetch }).call(node, ctx, workflow)).rejects.toThrow("separate scoped");
    await expect(new HttpN8nBridge({ env, fetch }).call(node, ctx, { ...workflow, webhookUrl: "https://other.test/hook" })).rejects.toThrow("not pinned");
    expect(calls).toBe(0);
    let headers: HeadersInit | undefined;
    await new HttpN8nBridge({ env, now: () => now, fetch: async (_url, init) => { headers = init.headers; return fetch(); } }).call(node, ctx, workflow);
    expect(new Headers(headers).get("authorization")).toBe(`Bearer ${env.N8N_SHADOW_RECEIVER_TOKEN}`);
  });
  it("rejects unbound, missing, failed or stale evidence", () => {
    expect(() => validateShadowReceipt(null, contract, identity, now)).toThrow("requires executionReceipt");
    expect(() => validateShadowReceipt({ ...receipt(), client: { ...contract.client, primaryDomain: "other.test" } }, contract, identity, now)).toThrow("primaryDomain");
    expect(() => validateShadowReceipt({ ...receipt(), provider: { ...receipt().provider, taskStatusCode: 40501 } }, contract, identity, now)).toThrow("DataForSEO");
    expect(() => validateShadowReceipt({ ...receipt(), provider: { ...receipt().provider, itemsCount: 0 } }, contract, identity, now)).toThrow("DataForSEO");
    expect(() => validateShadowReceipt({ ...receipt(), finishedAt: "2026-09-01T00:00:00Z" }, contract, identity, now)).toThrow("timing");
    expect(() => validateShadowReceipt({ ...receipt(), provider: { ...receipt().provider, fetchedAt: "2026-09-01T00:00:00Z" } }, contract, identity, now)).toThrow("outside this execution");
  });
  it("does not store unrelated fields supplied as receipt metadata", () => {
    expect(validateShadowReceipt({ ...receipt(), token: "do-not-store" }, contract, identity, now)).not.toHaveProperty("token");
  });
  it("rejects unreceipted artifacts and async acknowledgements, but preserves an honest needs response", async () => {
    await expect(bridge({ artifact: reply().artifact }).b.call(node, ctx, workflow)).rejects.toThrow("requires executionReceipt");
    await expect(bridge({}, 202).b.call(node, ctx, workflow)).rejects.toThrow("synchronous");
    expect(await bridge({ needs: [{ input: "seed_keyword", why: "No provider coverage." }] }).b.call(node, ctx, workflow)).toMatchObject({ kind: "needs" });
  });
  it("rejects a valid but wrong artifact kind rather than accepting the workflow's choice", () => {
    expect(() => parseN8nReply({ artifact: { kind: "generic", title: "Wrong kind", body: "This is not the keyword list that the caller requested." } }, "keyword_list", 15)).toThrow("expected");
  });
  it("builds a manual-only, non-mutating spec without an LLM fallback", async () => {
    const spec = keywordShadowSpec(contract, 2);
    expect(spec.nodes[0]).toMatchObject({ kind: "trigger", cadence: "manual" });
    expect(spec.nodes.some(n => n.kind === "execute" || n.kind === "produce")).toBe(false);
    const { adapters, producer } = buildAdapters({ producer: new FakeProducer() });
    const result = await runRoutine(spec, { account: ctx.account, triggeredBy: "manual" }, { ...adapters, n8n: { async call() { throw new Error("shadow receipt missing"); } } }, { mode: "dry_run" });
    expect(result.status).toBe("failed");
    expect(producer.calls).toHaveLength(0);
  });
  it("does not reuse the competitor content ID for backlink gap", () => {
    expect(() => assertShadowRequest({ ...contract, routineId: "D03-W06" } as unknown as KeywordShadowContract, identity)).toThrow("only keyword");
  });
  it("stores the accepted execution receipt with the artifact and linked draft receipt", async () => {
    const spec = keywordShadowSpec(contract, 2);
    const { adapters, store, producer, executor } = buildAdapters({ producer: new FakeProducer() });
    await store.putN8nWorkflow(workflow);
    const b = new HttpN8nBridge({ env, now: () => now,
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ...reply(), executionReceipt: { ...receipt(), runId: request.runId } }), { status: 200 });
      } });
    const result = await runRoutine(spec, { account: ctx.account, triggeredBy: "manual" }, { ...adapters, now: () => new Date(start), n8n: b }, { mode: "dry_run" });
    expect(result.status).toBe("done");
    expect(result.artifact).toMatchObject({ accountId: contract.accountId, routineId: "D03-W01", status: "draft", meta: { via: "n8n", executionReceipt: { executionId: "12345" } } });
    const draft = result.receipts.find(r => r.kind === "draft");
    expect(draft?.payload).toMatchObject({ artifactId: result.artifact?.id, externalExecution: { executionId: "12345", executedAction: "none" } });
    expect(producer.calls).toHaveLength(0);
    expect(executor.calls).toHaveLength(0);
  });
});
