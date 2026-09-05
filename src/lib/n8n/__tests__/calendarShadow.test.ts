import { describe, expect, it, vi } from "vitest";
import { calendarShadowArtifact, calendarWeekStarts, validateCalendarShadowReceipt, calendarShadowProblem,
  verifyCalendarShadowExecution, verifyHistoricalCalendarShadowExecution } from "../calendarShadowContract";
import { calendarShadowSpec } from "../calendarShadowSpec";
import { protocolCandidate } from "../shadowProtocols";
import { projectCalendarShadowExecution, shadowRequestDigest } from "../executionEvidence";
import { createShadowExecutionReader } from "../../../worker/providers/n8nExecutionReader";
import { HttpN8nBridge, buildN8nPayload } from "../../../worker/providers/n8n";
import { DbShadowAdmission, type ShadowAdmission } from "../shadowAdmission";
import { calendarShadowAuthority, shadowAuthority } from "../shadowAuthority";
import { completeExternalArtifact, planCalendarShadowCompletion, planKeywordShadowCompletion, runRoutine, resumePreparedCalendarShadowRun } from "../../runtime/engine";
import { MemoryStore } from "../../runtime/store/memory";
import { adapters as testAdapters } from "../../runtime/__tests__/helpers";
import { NoCredentialsProvider } from "../../../worker/credentials";
import { RateLimiter } from "../dataToken";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import type { ProxyDeps } from "../proxy";
import type { N8nCallResult, N8nNode, RunResult } from "../../runtime/types";
import type { RunRecord } from "../../runtime/store/interface";
import { account, artifact, contract, ctx, dns, end, env, now, receipt, registration, savedExecution, start } from "./calendarFixture";

const node = (): N8nNode => ({ kind: "n8n", id: "produce", shadowContract: structuredClone(contract) });
const payload = () => buildN8nPayload(node(), ctx, { env, secret: env.N8N_SIGNING_SECRET, now });
const pins = { workflowId: contract.workflowId, executionId: "12345", triggerNodeId: "incoming-calendar", resultNodeId: "result-calendar" };
const reply = () => ({ artifact: artifact(), executionReceipt: receipt() });

describe("campaign calendar contract and source truth", () => {
  it("does not inherit Shopify or Klaviyo read scopes from the different native calendar", () => {
    const spec = calendarShadowSpec(contract, 2);
    expect(spec.nodes.map(n => n.kind)).toEqual(["trigger", "n8n", "gate", "receipt"]);
    expect(spec.mutates).toBe(false); expect(payload().data.scopes).toEqual([]);
  });
  it.each([
    ["2026-09-06T12:00:00Z", "Pacific/Auckland", "2026-09-14"],
    ["2026-09-06T12:00:00Z", "America/Los_Angeles", "2026-09-07"],
    ["2026-09-27T00:00:00Z", "Pacific/Auckland", "2026-09-28"],
    ["2026-12-31T23:30:00Z", "Pacific/Auckland", "2027-01-04"],
  ])("uses the customer's calendar date at %s in %s", (date, zone, monday) => {
    const weeks = calendarWeekStarts(date, zone); expect(weeks[0]).toBe(monday); expect(weeks).toHaveLength(6);
    for (let i = 1; i < 6; i++) expect(Date.parse(weeks[i]) - Date.parse(weeks[i - 1])).toBe(7 * 86400000);
  });
  it.each(["wrong-kind", "five-weeks", "past-week", "duplicate-week", "unproved-anchor", "scheduled", "invalid-channel", "no-basis"])("rejects %s", fault => {
    const draft = artifact();
    if (fault === "wrong-kind") draft.kind = "email";
    if (fault === "five-weeks") draft.items!.pop();
    if (fault === "past-week") draft.items![0].meta!.week_start = "2026-09-07";
    if (fault === "duplicate-week") draft.items![1].meta!.week_start = "2026-09-14";
    if (fault === "unproved-anchor") draft.items![0].meta!.timing_basis = "approved_event";
    if (fault === "scheduled") draft.items![0].meta!.scheduled = true;
    if (fault === "invalid-channel") draft.items![0].meta!.channel = "fax";
    if (fault === "no-basis") delete draft.items![0].meta!.timing_basis;
    expect(() => calendarShadowArtifact(draft, contract, { ...ctx, accountId: account.accountId })).toThrow();
  });
  it("allows empty campaign history as a hypothesis, not invented performance", () => {
    const draft = artifact(); draft.items![0].meta!.raw_private_response = "never-store";
    const result = calendarShadowArtifact(draft, contract, { ...ctx, accountId: account.accountId });
    expect(result.items).toHaveLength(6); expect(result.meta).toEqual({});
    expect(JSON.stringify(result)).not.toContain("never-store");
    expect(validateCalendarShadowReceipt(receipt(), contract, { ...ctx, accountId: account.accountId }, now()).provider).toMatchObject({ itemsCount: 0, dataset: "campaign_metadata" });
  });
  it.each(["wrong-tenant", "wrong-asset", "wrong-binding", "wrong-query", "partial", "freshened-cache", "performance", "echoed-version"])("refuses misleading provenance: %s", fault => {
    const reported = receipt(), provider = reported.provider as Record<string, unknown>;
    if (fault === "wrong-tenant") reported.accountId = "foreign";
    if (fault === "wrong-asset") provider.accountId = "foreign";
    if (fault === "wrong-binding") provider.bindingId = "foreign";
    if (fault === "wrong-query") provider.queryHash = "b".repeat(64);
    if (fault === "partial") provider.complete = false;
    if (fault === "freshened-cache") provider.fetchedAt = "2026-09-05T00:00:00Z";
    if (fault === "performance") provider.dataset = "campaign_performance";
    if (fault === "echoed-version") reported.workflowVersion = contract.workflowVersion;
    expect(() => validateCalendarShadowReceipt(reported, contract, { ...ctx, accountId: account.accountId }, now())).toThrow();
  });
  it("preserves pinned snapshot time and rejects expiry, substitution and arbitrary contract fields", () => {
    const c = { ...contract, data: { mode: "stored" as const, queryHash: "a".repeat(64), snapshotId: "00000000-0000-4000-8000-000000000006",
      fetchedAt: "2026-09-06T11:55:00.000Z", maxAgeSeconds: 600 } };
    const r = receipt(c);
    expect(validateCalendarShadowReceipt(r, c, { ...ctx, accountId: account.accountId }, now()).provider).toMatchObject({ fetchedAt: c.data.fetchedAt, snapshotId: c.data.snapshotId });
    expect(() => validateCalendarShadowReceipt(r, { ...c, data: { ...c.data, maxAgeSeconds: 60 } }, { ...ctx, accountId: account.accountId }, now())).toThrow("stale");
    expect(() => validateCalendarShadowReceipt({ ...r, provider: { ...(r.provider as object), fetchedAt: end } }, c, { ...ctx, accountId: account.accountId }, now())).toThrow();
    expect(calendarShadowProblem({ ...contract, secret: "never accept" })).not.toBeNull();
    expect(calendarShadowProblem({ ...contract, client: { ...contract.client, timezone: "invalid-zone" } })).not.toBeNull();
  });
  it("requires owned campaign references and actual nonempty history for a known timing anchor", () => {
    const draft = artifact(), ref = `klaviyo:${contract.client.klaviyoAccountId}:campaign:synthetic-campaign`;
    draft.items![0].meta!.timing_basis = "observed_campaign_history"; draft.items![0].meta!.anchor_refs = [ref];
    draft.evidence = [{ source: "klaviyo_campaign", ref }];
    const identity = { ...ctx, accountId: account.accountId };
    expect(() => protocolCandidate(draft, receipt(), contract, identity, "a".repeat(64))).toThrow("Empty campaign history");
    const reported = receipt(); (reported.provider as Record<string, unknown>).itemsCount = 1;
    expect(protocolCandidate(draft, reported, contract, identity, "a".repeat(64)).artifact.items).toHaveLength(6);
    draft.items![0].meta!.anchor_refs = ["klaviyo:foreign-account:campaign:synthetic-campaign"];
    draft.evidence = [{ source: "klaviyo_campaign", ref: "klaviyo:foreign-account:campaign:synthetic-campaign" }];
    expect(() => protocolCandidate(draft, reported, contract, identity, "a".repeat(64))).toThrow("evidence references");
  });
});

describe("independent calendar execution and exact returned output", () => {
  it("requires separate workflow/trigger/result pins and never borrows keyword configuration", () => {
    expect(createShadowExecutionReader(env, contract.workflowId)).toBeUndefined();
    expect(createShadowExecutionReader(env, contract.workflowId, { protocol: "calendar" })).toBeTypeOf("function");
    for (const key of ["N8N_CALENDAR_SHADOW_WORKFLOW_ID", "N8N_CALENDAR_SHADOW_TRIGGER_NODE_ID", "N8N_CALENDAR_SHADOW_RESULT_NODE_ID"])
      expect(createShadowExecutionReader({ ...env, [key]: "" }, contract.workflowId, { protocol: "calendar" })).toBeUndefined();
  });
  it("matches the saved output as well as input and never exports saved headers", () => {
    const body = payload(), envelope = reply(), seen = projectCalendarShadowExecution(savedExecution(body, envelope), pins);
    expect(seen.resultDigest).toBe(shadowRequestDigest(envelope)); expect(JSON.stringify(seen)).not.toContain("never-export");
    const verified = verifyCalendarShadowExecution(envelope.executionReceipt, seen, contract, { ...ctx, accountId: account.accountId }, now(), shadowRequestDigest(body), shadowRequestDigest(envelope));
    expect(verified.revisionEvidence).toBe("verified_execution_record");
    expect(() => verifyCalendarShadowExecution(envelope.executionReceipt, seen, contract, { ...ctx, accountId: account.accountId }, now(), shadowRequestDigest(body), "b".repeat(64))).toThrow("result digest");
  });
  it.each(["missing", "duplicate", "failed", "multiple-items", "wrong-pin"])("refuses ambiguous/unavailable result output: %s", fault => {
    const saved = savedExecution(payload(), reply());
    if (fault === "missing") saved.data.resultData.runData.Result = [];
    if (fault === "duplicate") saved.workflowData.nodes.push({ ...saved.workflowData.nodes[1] });
    if (fault === "failed") saved.data.resultData.runData.Result[0].executionStatus = "error";
    if (fault === "multiple-items") saved.data.resultData.runData.Result[0].data.main[0].push({ json: reply() });
    expect(() => projectCalendarShadowExecution(saved, { ...pins, ...(fault === "wrong-pin" ? { resultNodeId: "other" } : {}) })).toThrow();
  });
  it("reconciles an old authorized receipt without relabelling its data as fresh", () => {
    const body = payload(), envelope = reply(), seen = projectCalendarShadowExecution(savedExecution(body, envelope), pins);
    const verified = verifyHistoricalCalendarShadowExecution(envelope.executionReceipt, seen, contract, { ...ctx, accountId: account.accountId },
      new Date("2026-09-10T00:00:00Z"), shadowRequestDigest(body), shadowRequestDigest(envelope), { dispatchedAt: start, authorizedAt: start });
    expect(verified.provider).toMatchObject({ fetchedAt: end });
    expect(verified.revisionVerification).toMatchObject({ method: "historical_reconciliation" });
    expect(() => verifyHistoricalCalendarShadowExecution(envelope.executionReceipt, seen, contract, { ...ctx, accountId: account.accountId }, now(),
      shadowRequestDigest(body), shadowRequestDigest(envelope), { dispatchedAt: start, authorizedAt: "2026-09-07T00:00:00Z" })).toThrow();
  });
});

/** This ledger is a wiring fixture, NOT durable SQL/concurrency acceptance. */
async function wiring() {
  const store = new MemoryStore(), spec = calendarShadowSpec(contract, 2);
  await store.putN8nWorkflow(registration);
  let claimed = false, authorized = false, started = false, digest = "", tokenDigest = "";
  let verified: Extract<N8nCallResult, { kind: "artifact" }> | undefined;
  let recorded: RunResult | undefined, checkpoint: unknown;
  const ledger: ShadowAdmission = {
    claim: vi.fn(async input => { if (claimed || input.accountId !== account.accountId) throw new Error("already claimed/foreign account");
      claimed = true; digest = input.requestDigest; tokenDigest = input.tokenDigest; return "calendar-permit"; }),
    authorize: vi.fn(async input => { if (!claimed || authorized || input.tokenDigest !== tokenDigest || input.accountId !== account.accountId) return false;
      authorized = true; return true; }),
    observe: vi.fn(async (_permit, _execution, candidate) => { if (!authorized) throw new Error("not authorized"); checkpoint = structuredClone(candidate); }),
    finish: vi.fn(async (_permit, outcome, _exec, result) => { if (outcome === "verified" && result?.kind === "artifact") verified = structuredClone(result); }),
  };
  const deps: ProxyDeps = { store, secret: env.N8N_SIGNING_SECRET, credentials: new NoCredentialsProvider(), credentialsKind: "none", db: null,
    now, calendarShadowAdmission: ledger, limiter: new RateLimiter(60, 60000, now), playbooks: null };
  let body: Record<string, unknown>, envelope: ReturnType<typeof reply>;
  const fetch = vi.fn(async (_url, init) => {
    body = JSON.parse(String(init.body));
    const req = new Request("https://unc.example.com/api/n8n/calendar-shadow-authority", { method: "POST", headers: { authorization: `Bearer ${body.dataToken}` } });
    expect((await shadowAuthority(deps, req, env.N8N_CALENDAR_SHADOW_RECEIVER_URL)).status).toBe(403);
    const auth = await calendarShadowAuthority(deps, req, env.N8N_CALENDAR_SHADOW_RECEIVER_URL);
    expect(auth.status).toBe(200); expect((await auth.json()).shadow).toEqual(contract);
    expect((await calendarShadowAuthority(deps, req, env.N8N_CALENDAR_SHADOW_RECEIVER_URL)).status).toBe(409);
    envelope = { artifact: artifact(), executionReceipt: { ...receipt(), runId: body.runId } };
    return Response.json(envelope);
  });
  const executionFetch = vi.fn(async () => Response.json(savedExecution(body, envelope)));
  const bridge = new HttpN8nBridge({ env, now, fetch, executionFetch, lookup: dns, calendarShadowAdmission: ledger });
  const f = testAdapters({ store });
  const complete = vi.fn(async (run: RunRecord) => {
    if (recorded) return recorded;
    if (!verified) throw new Error("no verified durable result");
    const planned = await planCalendarShadowCompletion(run, verified.artifact, { now });
    recorded = planned.result; await store.putArtifact(recorded.artifact!);
    for (const r of recorded.receipts) await store.appendReceipt(r);
    await store.updateRun(run.id, { status: "done", snapshot: undefined });
    return recorded;
  });
  const adapters = { ...f.adapters, now: () => new Date(start), n8n: bridge, completeCalendarShadow: complete };
  const options = { mode: "dry_run" as const, runId: ctx.runId,
    reserveCalendarShadowRun: async (run: RunRecord) => { await store.createRun(run); return structuredClone(run); },
    claimCalendarShadowStart: async () => { if (started) return false; started = true; return true; } };
  return { store, spec, deps, ledger, fetch, executionFetch, bridge, adapters, options, complete,
    digest: () => digest, checkpoint: () => checkpoint, run: () => runRoutine(spec, { account, triggeredBy: "manual" }, adapters, options) };
}

describe("calendar engine → admission → authority → verification → draft continuation", () => {
  it("produces a tenant/run-correlated calendar through the real engine and bridge, with one POST and no actions", async () => {
    const f = await wiring(), read = vi.spyOn(f.adapters.reader, "read"), execute = vi.spyOn(f.adapters.executor, "execute");
    const result = await f.run();
    expect(result.status).toBe("done"); expect(result.artifact).toMatchObject({ accountId: account.accountId, runId: ctx.runId, routineId: "D05-W07", kind: "calendar", status: "draft" });
    expect(result.artifact?.items).toHaveLength(6); expect(result.receipts).toHaveLength(3);
    expect(result.receipts.every(r => r.kind === "draft")).toBe(true);
    expect(result.artifact?.meta.executionReceipt).toMatchObject({ workflowVersion: contract.workflowVersion,
      revisionVerification: { requestDigest: f.digest(), resultDigest: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(f.checkpoint()).toMatchObject({ artifact: { meta: {} }, resultDigest: expect.any(String) });
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.executionFetch).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    expect(await f.store.listArtifacts(account.accountId)).toHaveLength(1);
    expect(await f.store.listArtifacts("foreign-account")).toHaveLength(0);
    await expect(resumePreparedCalendarShadowRun(ctx.runId, f.adapters, f.options.claimCalendarShadowStart)).rejects.toThrow();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("leaves the original continuation and checkpoint recoverable after verification fails; no automatic redispatch", async () => {
    const f = await wiring(); f.executionFetch.mockImplementation(async () => new Response(null, { status: 401 }));
    const result = await f.run();
    expect(result).toMatchObject({ status: "running", error: "calendar_shadow_reconciliation_required" });
    expect((await f.store.getRun(ctx.runId))?.snapshot?.awaiting).toBe("calendar_shadow");
    expect(f.checkpoint()).toBeDefined(); expect(f.complete).not.toHaveBeenCalled();
    expect(await f.store.listArtifacts(account.accountId)).toHaveLength(0);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("will not borrow keyword admission or run before a distinct start claim", async () => {
    const f = await wiring();
    await expect(runRoutine(f.spec, { account, triggeredBy: "manual" }, f.adapters, { mode: "dry_run" })).rejects.toThrow("own durable");
    await expect(runRoutine(f.spec, { account, triggeredBy: "manual" }, f.adapters, { ...f.options, claimCalendarShadowStart: async () => false })).rejects.toThrow("already claimed");
    expect(f.fetch).not.toHaveBeenCalled(); expect(await f.store.listReceipts(account.accountId)).toHaveLength(0);
    const db = new FakeSupabase(), keyword = new DbShadowAdmission(db);
    await expect(keyword.claim({ accountId: account.accountId, contextGeneration: 2, runId: ctx.runId, registrationId: registration.id,
      contract, receiverUrl: registration.webhookUrl, requestDigest: "a".repeat(64), tokenDigest: "b".repeat(64) })).rejects.toThrow("cannot authorize a calendar");
  });
  it("cannot complete a calendar through the keyword planner or generic callback", async () => {
    const f = await wiring(); f.executionFetch.mockImplementation(async () => new Response(null, { status: 401 }));
    await f.run(); const run = (await f.store.getRun(ctx.runId))!;
    await expect(planKeywordShadowCompletion(run, artifact(), { now })).rejects.toThrow("unavailable");
    await expect(completeExternalArtifact(run.id, { artifact: artifact() }, f.adapters)).rejects.toThrow("not waiting");
  });
  it("does not consume calendar authority through a GET/prefetch", async () => {
    const f = await wiring();
    const response = await calendarShadowAuthority(f.deps, new Request("https://unc.example.com/api/n8n/calendar-shadow-authority"), registration.webhookUrl);
    expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(f.ledger.authorize).not.toHaveBeenCalled();
  });
  it("refuses extra pre-producer reads before issuance, not after a provider call", async () => {
    const f = await wiring(), reserve = vi.fn(f.options.reserveCalendarShadowRun);
    const altered = structuredClone(f.spec);
    altered.nodes.splice(1, 0, { kind: "read", id: "extra", as: "orders", source: "shopify", query: { resource: "orders" } });
    await expect(runRoutine(altered, { account, triggeredBy: "manual" }, f.adapters, { ...f.options, reserveCalendarShadowRun: reserve })).rejects.toThrow("only its manual trigger");
    expect(reserve).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(["foreign-account", "currency", "missing-admission", "missing-reader", "keyword-receiver-token", "legacy-producer"])("refuses %s before POST", async fault => {
    const f = await wiring(), changedEnv = { ...env }, context = structuredClone(ctx);
    const call = node(); let admission: ShadowAdmission | undefined = f.ledger;
    if (fault === "foreign-account") context.account.accountId = "00000000-0000-4000-8000-000000000099";
    if (fault === "currency") context.account.currency = "USD";
    if (fault === "missing-admission") admission = undefined;
    if (fault === "missing-reader") changedEnv.N8N_CALENDAR_SHADOW_RESULT_NODE_ID = "";
    if (fault === "keyword-receiver-token") changedEnv.N8N_CALENDAR_SHADOW_RECEIVER_TOKEN = env.N8N_SHADOW_RECEIVER_TOKEN;
    const bridge = new HttpN8nBridge({ env: changedEnv, now, fetch: f.fetch, lookup: dns, calendarShadowAdmission: admission });
    await expect(bridge.call(fault === "legacy-producer" ? { kind: "produce", id: "produce" } : call, context, registration)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
