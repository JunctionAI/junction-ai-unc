import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { contentShadowArtifact, contentShadowProblem, validateContentShadowReceipt, verifyContentShadowExecution,
  CONTENT_WORKFLOW_ID, CONTENT_WORKFLOW_VERSION, CONTENT_SEED } from "../contentShadowContract";
import { contentShadowSpec } from "../contentShadowSpec";
import { buildHooksArtifact, buildQuestionsArtifact, contentNeeds } from "../contentReceiver";

import { projectContentShadowExecution, shadowRequestDigest } from "../executionEvidence";
import { createShadowExecutionReader } from "../../../worker/providers/n8nExecutionReader";
import { HttpN8nBridge, buildN8nPayload } from "../../../worker/providers/n8n";
import { DbShadowAdmission, type ShadowAdmission } from "../shadowAdmission";
import { contentShadowAuthority, shadowAuthority } from "../shadowAuthority";
import { completeExternalArtifact, planContentShadowCompletion, planKeywordShadowCompletion, runRoutine,
  resumePreparedContentShadowRun } from "../../runtime/engine";
import { MemoryStore } from "../../runtime/store/memory";
import { adapters as testAdapters } from "../../runtime/__tests__/helpers";
import { NoCredentialsProvider } from "../../../worker/credentials";
import { RateLimiter } from "../dataToken";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import type { ProxyDeps } from "../proxy";
import type { N8nCallResult, N8nNode, RunResult } from "../../runtime/types";
import type { RunRecord } from "../../runtime/store/interface";
import { account, contract, ctx, dns, end, env, hooksArtifact, now, questionsArtifact, questionsContract,
  receipt, registration, savedExecution, start } from "./contentFixture";

const node = (): N8nNode => ({ kind: "n8n", id: "produce", shadowContract: structuredClone(contract) });
const payload = () => buildN8nPayload(node(), ctx, { env, secret: env.N8N_SIGNING_SECRET, now });
const pins = { workflowId: contract.workflowId, executionId: "12345", triggerNodeId: "incoming-content", resultNodeId: "result-content" };
const reply = () => ({ artifact: hooksArtifact(), executionReceipt: receipt() });

describe("AVGAR content search contract (simulated; no provider or PostgreSQL)", () => {
  it("replaces TikTok/Gorgias reads and does not inherit those scopes", () => {
    const spec = contentShadowSpec(contract, 2);
    expect(spec.nodes.map(n => n.kind)).toEqual(["trigger", "n8n", "gate", "receipt"]);
    expect(spec.nodes.some(n => n.kind === "read")).toBe(false);
    expect(spec.mutates).toBe(false);
    expect(payload().data.scopes).toEqual([]);
    expect(contentShadowSpec(questionsContract, 2).id).toBe("D01-W03");
  });
  it("pins the historical Nguyen workflow identity without treating exec #68 as a live Unc run", () => {
    expect(CONTENT_WORKFLOW_ID).toBe("lMXjTgd3Qh4vZaMp");
    expect(CONTENT_WORKFLOW_VERSION).toBe("c8d6955d-0033-47ce-9672-399f7f10118c");
    expect(CONTENT_SEED).toBe("golf travel bag");
  });
  it("rejects historical packaged kinds, other seeds, measured virality and ticket frequency", () => {
    const identity = { ...ctx, accountId: account.accountId };
    expect(() => contentShadowArtifact({ ...hooksArtifact(), kind: "content_hooks" }, contract, identity)).toThrow(/kind/);
    expect(contentShadowProblem({ ...contract, client: { ...contract.client, seedKeyword: "travel bag" } })).not.toBeNull();
    const measured = hooksArtifact(); measured.items![0].meta!.status = "measured"; measured.items![0].meta!.views = 1_000_000;
    expect(() => contentShadowArtifact(measured, contract, identity)).toThrow(/unmeasured/);
    const tickets = questionsArtifact(); tickets.items![0].meta!.frequency = 20; tickets.items![0].meta!.question_source_type = "tickets";
    expect(() => contentShadowArtifact(tickets, questionsContract, { ...identity, routineId: "D01-W03" })).toThrow();
  });
  it("rejects Nguyen historical packaging as current AVGAR golf-market proof", () => {
    const file = path.resolve(__dirname, "../../../../docs/integration/deliveries/nguyen-2026-09-06-final/examples/D01-W02_hooks.json");
    const historical = JSON.parse(readFileSync(file, "utf8")) as { kind: string; not_current_avgar_golf_market_context?: boolean };
    expect(historical.kind).toBe("content_hooks");
    expect(historical.not_current_avgar_golf_market_context).toBe(true);
    expect(() => contentShadowArtifact(historical, contract, { ...ctx, accountId: account.accountId })).toThrow(/kind/);
  });
  it("accepts search hypotheses with SERP evidence and strips private fields", () => {
    const draft = hooksArtifact(); draft.meta = { private_unused: "do not retain" };
    const result = contentShadowArtifact(draft, contract, { ...ctx, accountId: account.accountId });
    expect(result.items).toHaveLength(3); expect(result.meta).toEqual({});
    expect(JSON.stringify(result)).not.toContain("do not retain");
    expect(result.items![0].meta).toMatchObject({ status: "hypothesis", views: null, measured: false, source: "search" });
  });
  it.each(["wrong-tenant", "wrong-seed", "keyword-endpoint", "echoed-version", "zero-items"])("refuses misleading provenance: %s", fault => {
    const reported = receipt(), provider = reported.provider as Record<string, unknown>;
    if (fault === "wrong-tenant") reported.accountId = "00000000-0000-4000-8000-000000000099";
    if (fault === "wrong-seed") provider.seedKeyword = "travel bag";
    if (fault === "keyword-endpoint") provider.endpoint = "keyword_overview";
    if (fault === "echoed-version") reported.workflowVersion = contract.workflowVersion;
    if (fault === "zero-items") provider.itemsCount = 0;
    expect(() => validateContentShadowReceipt(reported, contract, { ...ctx, accountId: account.accountId }, now())).toThrow();
  });
  it("builds inspectable drafts from synthetic SERP rows; empty SERP is needs, not invented copy", () => {
    const hooks = buildHooksArtifact([{ rank: 1, title: "Golf travel bags", url: "https://example.com", domain: "example.com" }], contract, end);
    expect(hooks.kind).toBe("hook_list"); expect(hooks.items![0].meta).toMatchObject({ status: "hypothesis", views: null });
    expect(() => buildHooksArtifact([], contract, end)).toThrow("empty_serp");
    expect(contentNeeds("No People Also Ask results for this seed").needs[0].input).toBe("search_results");
    const questions = buildQuestionsArtifact([{ rank: 1, question: "What is the best golf travel bag?" }], questionsContract, end);
    expect(questions.kind).toBe("question_list"); expect(questions.items![0].meta).toMatchObject({ frequency: null, question_source_type: "search_paa" });
  });
});

describe("independent content execution (simulated n8n record; no live API)", () => {
  it("requires separate content pins and never borrows keyword configuration", () => {
    expect(createShadowExecutionReader(env, contract.workflowId)).toBeUndefined();
    expect(createShadowExecutionReader(env, contract.workflowId, { protocol: "content" })).toBeTypeOf("function");
    expect(createShadowExecutionReader({ ...env, N8N_CONTENT_SHADOW_RESULT_NODE_ID: "" }, contract.workflowId, { protocol: "content" })).toBeUndefined();
  });
  it("matches saved output as well as input and never exports saved headers", () => {
    const body = payload(), envelope = reply(), seen = projectContentShadowExecution(savedExecution(body, envelope), pins);
    expect(seen.resultDigest).toBe(shadowRequestDigest(envelope)); expect(JSON.stringify(seen)).not.toContain("never-export");
    const verified = verifyContentShadowExecution(envelope.executionReceipt, seen, contract, { ...ctx, accountId: account.accountId }, now(), shadowRequestDigest(body), shadowRequestDigest(envelope));
    expect(verified.revisionEvidence).toBe("verified_execution_record");
  });
});

async function wiring() {
  const store = new MemoryStore(), spec = contentShadowSpec(contract, 2);
  await store.putN8nWorkflow(registration);
  let claimed = false, authorized = false, started = false, digest = "", tokenDigest = "";
  let verified: Extract<N8nCallResult, { kind: "artifact" }> | undefined;
  let recorded: RunResult | undefined, checkpoint: unknown;
  const ledger: ShadowAdmission = {
    claim: vi.fn(async input => { if (claimed || input.accountId !== account.accountId) throw new Error("already claimed/foreign account");
      claimed = true; digest = input.requestDigest; tokenDigest = input.tokenDigest; return "00000000-0000-4000-8000-000000000009"; }),
    authorize: vi.fn(async input => { if (!claimed || authorized || input.tokenDigest !== tokenDigest || input.accountId !== account.accountId) return false;
      authorized = true; return true; }),
    observe: vi.fn(async (_permit, _execution, candidate) => { if (!authorized) throw new Error("not authorized"); checkpoint = structuredClone(candidate); }),
    finish: vi.fn(async (_permit, outcome, _exec, result) => { if (outcome === "verified" && result?.kind === "artifact") verified = structuredClone(result); }),
  };
  const deps: ProxyDeps = { store, secret: env.N8N_SIGNING_SECRET, credentials: new NoCredentialsProvider(), credentialsKind: "none", db: null,
    now, contentShadowAdmission: ledger, limiter: new RateLimiter(60, 60000, now), playbooks: null };
  let body: Record<string, unknown>, envelope: ReturnType<typeof reply>;
  const fetch = vi.fn(async (_url, init) => {
    body = JSON.parse(String(init.body));
    const req = new Request("https://unc.example.com/api/n8n/content-shadow-authority", { method: "POST", headers: { authorization: `Bearer ${body.dataToken}` } });
    expect((await shadowAuthority(deps, req, env.N8N_CONTENT_HOOKS_SHADOW_RECEIVER_URL)).status).toBe(403);
    const auth = await contentShadowAuthority(deps, req, env.N8N_CONTENT_HOOKS_SHADOW_RECEIVER_URL);
    expect(auth.status).toBe(200); expect((await auth.json()).shadow).toEqual(contract);
    expect((await contentShadowAuthority(deps, req, env.N8N_CONTENT_HOOKS_SHADOW_RECEIVER_URL)).status).toBe(409);
    envelope = { artifact: hooksArtifact(), executionReceipt: { ...receipt(), runId: body.runId } };
    return Response.json(envelope);
  });
  const executionFetch = vi.fn(async () => Response.json(savedExecution(body, envelope)));
  const bridge = new HttpN8nBridge({ env, now, fetch, executionFetch, lookup: dns, contentShadowAdmission: ledger });
  const f = testAdapters({ store });
  const complete = vi.fn(async (run: RunRecord) => {
    if (recorded) return recorded;
    if (!verified) throw new Error("no verified durable result");
    const planned = await planContentShadowCompletion(run, verified.artifact, { now });
    recorded = planned.result; await store.putArtifact(recorded.artifact!);
    for (const r of recorded.receipts) await store.appendReceipt(r);
    await store.updateRun(run.id, { status: "done", snapshot: undefined });
    return recorded;
  });
  const adapters = { ...f.adapters, now: () => new Date(start), n8n: bridge, completeContentShadow: complete };
  const options = { mode: "dry_run" as const, runId: ctx.runId,
    reserveContentShadowRun: async (run: RunRecord) => { await store.createRun(run); return structuredClone(run); },
    claimContentShadowStart: async () => { if (started) return false; started = true; return true; } };
  return { store, spec, deps, ledger, fetch, executionFetch, adapters, options, complete,
    digest: () => digest, checkpoint: () => checkpoint, run: () => runRoutine(spec, { account, triggeredBy: "manual" }, adapters, options) };
}

describe("content engine → admission → authority → verification → draft (simulated HTTP/ledger)", () => {
  it("produces a tenant/run-correlated hook_list through the real engine, with one POST and no actions", async () => {
    const f = await wiring(), read = vi.spyOn(f.adapters.reader, "read"), execute = vi.spyOn(f.adapters.executor, "execute");
    const result = await f.run();
    expect(result.status).toBe("done");
    expect(result.artifact).toMatchObject({ accountId: account.accountId, runId: ctx.runId, routineId: "D01-W02", kind: "hook_list", status: "draft" });
    expect(result.artifact?.items).toHaveLength(3);
    expect(result.receipts.every(r => r.kind === "draft")).toBe(true);
    expect(result.artifact?.meta.executionReceipt).toMatchObject({ workflowVersion: contract.workflowVersion, revisionEvidence: "verified_execution_record" });
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.executionFetch).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    expect(await f.store.listArtifacts(account.accountId)).toHaveLength(1);
    expect(await f.store.listArtifacts("foreign-account")).toHaveLength(0);
    await expect(resumePreparedContentShadowRun(ctx.runId, f.adapters, f.options.claimContentShadowStart)).rejects.toThrow();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("leaves the original continuation recoverable after verification fails; no automatic redispatch", async () => {
    const f = await wiring(); f.executionFetch.mockImplementation(async () => new Response(null, { status: 401 }));
    const result = await f.run();
    expect(result).toMatchObject({ status: "running", error: "content_shadow_reconciliation_required" });
    expect((await f.store.getRun(ctx.runId))?.snapshot?.awaiting).toBe("content_shadow");
    expect(f.complete).not.toHaveBeenCalled();
    expect(await f.store.listArtifacts(account.accountId)).toHaveLength(0);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("will not borrow keyword admission or run before a distinct start claim", async () => {
    const f = await wiring();
    await expect(runRoutine(f.spec, { account, triggeredBy: "manual" }, f.adapters, { mode: "dry_run" })).rejects.toThrow("own durable");
    await expect(runRoutine(f.spec, { account, triggeredBy: "manual" }, f.adapters, { ...f.options, claimContentShadowStart: async () => false })).rejects.toThrow("already claimed");
    expect(f.fetch).not.toHaveBeenCalled();
    const db = new FakeSupabase(), keyword = new DbShadowAdmission(db);
    await expect(keyword.claim({ accountId: account.accountId, contextGeneration: 1, runId: ctx.runId, registrationId: registration.id,
      contract, receiverUrl: registration.webhookUrl, requestDigest: "a".repeat(64), tokenDigest: "b".repeat(64) })).rejects.toThrow("cannot authorize");
  });
  it("cannot complete content through the keyword planner or generic callback", async () => {
    const f = await wiring(); f.executionFetch.mockImplementation(async () => new Response(null, { status: 401 }));
    await f.run(); const run = (await f.store.getRun(ctx.runId))!;
    await expect(planKeywordShadowCompletion(run, hooksArtifact(), { now })).rejects.toThrow("unavailable");
    await expect(completeExternalArtifact(run.id, { artifact: hooksArtifact() }, f.adapters)).rejects.toThrow("not waiting");
  });
  it("does not consume content authority through GET", async () => {
    const f = await wiring();
    const response = await contentShadowAuthority(f.deps, new Request("https://unc.example.com/api/n8n/content-shadow-authority"), registration.webhookUrl);
    expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("POST");
    expect(f.ledger.authorize).not.toHaveBeenCalled();
  });
  it("refuses extra pre-producer reads before issuance", async () => {
    const f = await wiring(), reserve = vi.fn(f.options.reserveContentShadowRun);
    const altered = structuredClone(f.spec);
    altered.nodes.splice(1, 0, { kind: "read", id: "extra", as: "videos", source: "tiktok", query: { resource: "videos" } });
    await expect(runRoutine(altered, { account, triggeredBy: "manual" }, f.adapters, { ...f.options, reserveContentShadowRun: reserve })).rejects.toThrow("only its manual trigger");
    expect(reserve).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(["foreign-account", "missing-admission", "keyword-receiver-token"])("refuses %s before POST", async fault => {
    const f = await wiring(), changedEnv = { ...env }, context = structuredClone(ctx);
    let admission: ShadowAdmission | undefined = f.ledger;
    if (fault === "foreign-account") context.account.accountId = "00000000-0000-4000-8000-000000000099";
    if (fault === "missing-admission") admission = undefined;
    if (fault === "keyword-receiver-token") changedEnv.N8N_CONTENT_HOOKS_SHADOW_RECEIVER_TOKEN = env.N8N_SHADOW_RECEIVER_TOKEN;
    const bridge = new HttpN8nBridge({ env: changedEnv, now, fetch: f.fetch, lookup: dns, contentShadowAdmission: admission });
    await expect(bridge.call(node(), context, registration)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("provider HTTP failure does not mint an artifact", async () => {
    const f = await wiring();
    f.fetch.mockImplementation(async () => new Response("upstream", { status: 502 }));
    const result = await f.run();
    expect(result.status).toBe("running");
    expect(await f.store.listArtifacts(account.accountId)).toHaveLength(0);
  });
});
