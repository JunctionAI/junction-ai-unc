import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paidShadowArtifact, paidShadowSchema, validatePaidShadowReceipt, verifyPaidShadowExecution, verifyHistoricalPaidShadowExecution,
  PAID_SHADOW_ROUTINE_IDS, META_SHADOW_RECEIVER_URL, GADS_SHADOW_RECEIVER_URL, META_SHADOW_ROUTINES, type MetaShadowContract } from "../paidShadowContract";
import { isPaidShadowSpec, paidShadowSpec } from "../paidShadowSpec";
import { protocolCandidate, protocolReceiver, protocolEnvPrefix, shadowKind } from "../shadowProtocols";
import { projectResultShadowExecution, shadowRequestDigest } from "../executionEvidence";
import { createShadowExecutionReader } from "../../../worker/providers/n8nExecutionReader";
import { HttpN8nBridge, buildN8nPayload } from "../../../worker/providers/n8n";
import { DbShadowAdmission, type ShadowAdmission } from "../shadowAdmission";
import { paidCommandLane, paidCommandApproval } from "../paidCommand";
import { paidContractForRun } from "../paidAdmission";
import { planPaidShadowCompletion, runRoutine } from "../../runtime/engine";
import { validateSpec } from "../../runtime/validate";
import { CATALOG_SPEC_BY_ID } from "../../runtime/catalog-specs";
import { MemoryStore } from "../../runtime/store/memory";
import { stableHash } from "../../runtime/context";
import { adapters as testAdapters } from "../../runtime/__tests__/helpers";
import { eligible, type DispatchDeps } from "../../commands/dispatch";
import { commandId, digest } from "../../commands/queue";
import { workflowFingerprint } from "../../commands/releaseScope";
import { triggerRun } from "../../../worker/service";
import { StaticAccountsSource } from "../../../worker/accounts";
import { NoCredentialsProvider } from "../../../worker/credentials";
import { issueDataToken, RateLimiter, scopesForSpec } from "../dataToken";
import type { ProxyDeps } from "../proxy";
import type { N8nNode, RoutineSpec, RunResult } from "../../runtime/types";
import type { PaidShadowContract } from "../paidShadowContract";
import type { RunRecord } from "../../runtime/store/interface";
import type { CommandActor, RoutineCommand } from "../../commands/types";
import { syntheticAdmission } from "./admissionFixture";
import { account, ctxFor, dns, end, env, gadsArtifact, gadsContract, gadsReceipt, gadsRegistration, identityFor, metaArtifact, metaContract,
  metaFor, metaReceipt, metaRegistration, now, runId, savedExecution, start } from "./paidFixture";

const mocked = vi.hoisted(() => ({ deps: null as unknown }));
vi.mock("@/lib/n8n/routeDeps", () => ({ proxyDeps: () => mocked.deps }));
import { GET, POST } from "@/app/api/n8n/paid-shadow-authority/route";

const node = (c: PaidShadowContract = metaContract): N8nNode => ({ kind: "n8n", id: "produce", shadowContract: structuredClone(c) });
const payload = (c: PaidShadowContract = metaContract) => buildN8nPayload(node(c), ctxFor(c), { env, secret: env.N8N_SIGNING_SECRET, now });
const metaPins = { workflowId: metaContract.workflowId, executionId: "12345", triggerNodeId: "incoming-meta", resultNodeId: "result-meta" };
const reply = () => ({ artifact: metaArtifact(), executionReceipt: metaReceipt() });
const item = (draft = metaArtifact()) => draft.items![0].meta!;

describe("paid-ads shadow contract and spec", () => {
  it("builds a manual, draft-only, four-node spec for every AVGAR paid routine and grants no data scopes", () => {
    expect(PAID_SHADOW_ROUTINE_IDS).toEqual(["D02-W01", "D02-W02", "D02-W03", "D02-W04", "D02-W06", "D02-W07", "D02-W09"]);
    for (const routineId of PAID_SHADOW_ROUTINE_IDS) {
      const contract = routineId === "D02-W09" ? gadsContract : metaFor(routineId, META_SHADOW_ROUTINES[routineId]);
      const spec = paidShadowSpec(contract, 2);
      expect(spec.nodes.map(n => n.kind)).toEqual(["trigger", "n8n", "gate", "receipt"]);
      expect(spec.mutates).toBe(false); expect(validateSpec(spec)).toEqual([]); expect(isPaidShadowSpec(spec)).toBe(true);
      expect(buildN8nPayload(node(contract), ctxFor(contract), { env, secret: env.N8N_SIGNING_SECRET, now }).data.scopes).toEqual([]);
      expect(CATALOG_SPEC_BY_ID[routineId].mutates || routineId === "D02-W09" || routineId === "D02-W06").toBe(true);
    }
    expect(isPaidShadowSpec(CATALOG_SPEC_BY_ID["D02-W01"])).toBe(false);
    expect(shadowKind(metaContract)).toBe("paid"); expect(protocolReceiver(metaContract)).toBe(META_SHADOW_RECEIVER_URL);
    expect(protocolReceiver(gadsContract)).toBe(GADS_SHADOW_RECEIVER_URL); expect(protocolEnvPrefix(gadsContract)).toBe("N8N_GADS_SHADOW");
  });
  it.each([
    ["another account", { ...metaContract, accountId: "00000000-0000-4000-8000-000000000999" }],
    ["routineKey mismatch", { ...metaContract, routineKey: "ad_fatigue" }],
    ["gads routine on the meta lane", { ...metaContract, routineId: "D02-W09", routineKey: "bofu_campaign_plan" }],
    ["market/location mismatch", { ...gadsContract, client: { ...gadsContract.client, market: "NZ" } }],
    ["a different cap", { ...metaContract, policy: { ...metaContract.policy, cpaCapPct: 40 } }],
    ["an ad account without act_", { ...metaContract, client: { ...metaContract.client, adAccountId: "1234567890" } }],
    ["an unlisted field", { ...metaContract, secret: "never" }],
    ["a deferred routine", { ...metaContract, routineId: "D02-W05", routineKey: "creator_whitelisting" }],
  ])("rejects %s", (_label, contract) => {
    expect(paidShadowSchema.safeParse(contract).success).toBe(false);
    expect(() => paidShadowSpec(contract as MetaShadowContract, 2)).toThrow();
  });
});

describe("Meta artifact acceptance encodes the 50% cap rule", () => {
  it("accepts a translated HOLD verdict, keeps only checked fields and never a raw provider payload", () => {
    const out = paidShadowArtifact(metaArtifact(), metaContract, identityFor(metaContract));
    expect(out.meta).toEqual({});
    expect(out.items![0].meta).toEqual({ routine: "D02-W01", decision_state: "HOLD", status: "observed", executed_action: "none",
      adset_id: "120252863530370580", adset_name: "AD_ORG01_PROLINE_ALIGNSTICKS_REEL", window: "last_7d", next_action: "REPAIR_MEASUREMENT",
      observed: { spend: 162.39, purchases: 1, cpa: 162.39, ctr: 2.556818181818182, frequency: 1.201018 },
      cpa_cap: { value: 60, currency: "NZD", basis: "product_price_50pct", product_price: 120, product_ref: "shopify:variant:synthetic", comparable_value: 60 },
      rollback_proposal: "Do not pause or scale; keep the current state until measurement is repaired." });
    expect(JSON.stringify(out)).not.toContain("never-store");
  });
  const metaCases: [string, (d: ReturnType<typeof metaArtifact>) => void][] = [
    ["Nguyen's provider-specific kind", d => { d.kind = "meta_decisions" as never; }],
    ["six routines bundled in one run", d => { item(d).routines = ["D02-W01", "D02-W02"]; }],
    ["another routine's item", d => { item(d).routine = "D02-W04"; }],
    ["an apply-ready claim", d => { item(d).apply_ready = true; }],
    ["an executed pause", d => { item(d).executed_action = "paused"; }],
    ["a cap that is not half the price", d => { (item(d).cpa_cap as Record<string, unknown>).value = 70; }],
    ["a cap in another currency with no verified conversion", d => { (item(d).cpa_cap as Record<string, unknown>).currency = "USD"; }],
    ["a cap with an unverified price", d => { (item(d).cpa_cap as Record<string, unknown>).product_price = 0; }],
    ["a cap basis that is not the product price", d => { (item(d).cpa_cap as Record<string, unknown>).basis = "store_aov"; }],
    ["a hold for price that still states a cap", d => { item(d).cap_reason = "pending_product_price"; }],
    ["an unknown decision state", d => { item(d).decision_state = "PAUSE_PROPOSED"; }],
    ["SCALE without a cap", d => { item(d).decision_state = "SCALE"; delete item(d).cpa_cap; }],
    ["SCALE with CPA over the cap", d => { item(d).decision_state = "SCALE"; }],
    ["TURN_OFF without a rollback", d => { item(d).decision_state = "TURN_OFF"; delete item(d).rollback_proposal; }],
    ["a non-numeric observation", d => { (item(d).observed as Record<string, unknown>).cpa = "162.39"; }],
    ["an entity that is not a platform ID", d => { item(d).adset_id = "proline"; }],
    ["a second verdict where the skill allows one", d => { d.items!.push(structuredClone(d.items![0])); }],
  ];
  it.each(metaCases)("rejects %s", (_label, mutate) => {
    const draft = metaArtifact(); mutate(draft);
    expect(() => paidShadowArtifact(draft, metaContract, identityFor(metaContract))).toThrow();
  });
  it("accepts SCALE and TURN_OFF only when the observed CPA sits on the right side of the cap", () => {
    const scale = metaArtifact(); item(scale).decision_state = "SCALE"; (item(scale).observed as Record<string, unknown>).cpa = 59.5;
    expect(paidShadowArtifact(scale, metaContract, identityFor(metaContract)).items![0].meta!.decision_state).toBe("SCALE");
    const off = metaArtifact(); item(off).decision_state = "TURN_OFF";
    expect(paidShadowArtifact(off, metaContract, identityFor(metaContract)).items![0].meta!.decision_state).toBe("TURN_OFF");
    const offUnder = metaArtifact(); item(offUnder).decision_state = "TURN_OFF"; (item(offUnder).observed as Record<string, unknown>).cpa = 30;
    expect(() => paidShadowArtifact(offUnder, metaContract, identityFor(metaContract))).toThrow("over the cap");
  });
  it("validates the other Meta routines with their own vocabulary and item limits", () => {
    const fatigue = metaFor("D02-W04", "ad_fatigue"), pace = metaFor("D02-W07", "budget_pacing"), planner = metaFor("D02-W06", "creative_test_planner");
    const pause = metaArtifact(); Object.assign(item(pause), { routine: "D02-W04", decision_state: "PAUSE_PROPOSED", ad_id: "120252863530370580" });
    expect(paidShadowArtifact(pause, fatigue, identityFor(fatigue)).items![0].meta).toMatchObject({ decision_state: "PAUSE_PROPOSED", ad_id: "120252863530370580" });
    const within = metaArtifact(); Object.assign(item(within), { routine: "D02-W07", decision_state: "WITHIN_CAP", daily_budget_cap: { value: 3000, currency: "NZD" }, observed: { window_spend: 305.88 } }); delete item(within).cpa_cap;
    expect(paidShadowArtifact(within, pace, identityFor(pace)).items![0].meta).toMatchObject({ daily_budget_cap: { value: 3000, currency: "NZD" }, observed: { window_spend: 305.88 } });
    const foreignCap = metaArtifact(); Object.assign(item(foreignCap), { routine: "D02-W07", decision_state: "WITHIN_CAP", daily_budget_cap: { value: 3000, currency: "USD" } });
    expect(() => paidShadowArtifact(foreignCap, pace, identityFor(pace))).toThrow("daily_budget_cap");
    const blocked = metaArtifact(); Object.assign(item(blocked), { routine: "D02-W06", decision_state: "BLOCKED", status: "blocked", blocked_field: "experiment_ledger_connected", experiment_ledger_connected: false }); delete item(blocked).cpa_cap;
    expect(paidShadowArtifact(blocked, planner, identityFor(planner)).items![0].meta).toMatchObject({ decision_state: "BLOCKED", experiment_ledger_connected: false });
  });
});

describe("Google Ads BOFU plan acceptance", () => {
  it("accepts a PAUSED plan held on price and strips private notes", () => {
    const out = paidShadowArtifact(gadsArtifact(), gadsContract, identityFor(gadsContract));
    expect(out.items![0].meta).toMatchObject({ routine: "D02-W09", decision_state: "PLAN_PROPOSED", campaign_status: "PAUSED", customer_id: "1797030595",
      market: "US", mutate_attempted: false, cpa_ceiling: null, cap_reason: "pending_product_price", login_customer_id: null, conversion_action: null,
      keywords: [{ keyword: "golf travel bag", match_type: "PHRASE", search_volume: 49500, cpc: 1.2, competition: "HIGH", intent: "transactional" }] });
    expect(JSON.stringify(out)).not.toContain("never-store");
    const capped = gadsArtifact(); Object.assign(item(capped), { cpa_ceiling: { value: 47.5, currency: "NZD", basis: "product_price_50pct", product_price: 95 } }); delete item(capped).cap_reason;
    expect(paidShadowArtifact(capped, gadsContract, identityFor(gadsContract)).items![0].meta!.cpa_ceiling).toEqual({ value: 47.5, currency: "NZD", basis: "product_price_50pct", product_price: 95, comparable_value: 47.5 });
  });
  const gadsCases: [string, (m: Record<string, unknown>) => void][] = [
    ["an active campaign", m => { m.campaign_status = "ENABLED"; }],
    ["another customer", m => { m.customer_id = "0000000001"; }],
    ["another market", m => { m.market = "NZ"; }],
    ["an off-domain landing page", m => { m.landing_url = "https://example.com/landing"; }],
    ["an attempted mutation", m => { m.mutate_attempted = true; }],
    ["a plan with no keyword lines", m => { m.keywords = []; }],
    ["a plan with neither ceiling nor hold reason", m => { delete m.cap_reason; }],
    ["a ceiling in another currency", m => { m.cpa_ceiling = { value: 47.5, currency: "USD", basis: "product_price_50pct", product_price: 95 }; }],
    ["an invalid match type", m => { (m.keywords as Record<string, unknown>[])[0].match_type = "MODIFIED_BROAD"; }],
    ["too many headlines", m => { m.headlines = Array.from({ length: 16 }, (_, i) => `Headline ${i}`); }],
  ];
  it.each(gadsCases)("rejects %s", (_label, mutate) => {
    const draft = gadsArtifact(); mutate(item(draft));
    expect(() => paidShadowArtifact(draft, gadsContract, identityFor(gadsContract))).toThrow();
  });
});

describe("receipts bind the lane's own provider evidence", () => {
  it("accepts matching Meta and DataForSEO receipts and enriches only after an independent execution read", () => {
    expect(validatePaidShadowReceipt(metaReceipt(), metaContract, identityFor(metaContract), now()).provider).toMatchObject({ name: "meta_graph", adAccountId: "act_1234567890", currency: "NZD", reportingWindow: "last_7d", credentialRef: "j6w7zi8lhRivXI0q" });
    expect(validatePaidShadowReceipt(gadsReceipt(), gadsContract, identityFor(gadsContract), now()).provider).toMatchObject({ name: "dataforseo", locationCode: 2840, taskId: "synthetic-task" });
    const body = payload(), envelope = reply(), seen = projectResultShadowExecution(savedExecution(metaContract, body, envelope), metaPins);
    const verified = verifyPaidShadowExecution(envelope.executionReceipt, seen, metaContract, identityFor(metaContract), now(), shadowRequestDigest(body), shadowRequestDigest(envelope));
    expect(verified).toMatchObject({ revisionEvidence: "verified_execution_record", workflowVersion: metaContract.workflowVersion });
    expect(() => verifyPaidShadowExecution(envelope.executionReceipt, seen, metaContract, identityFor(metaContract), now(), shadowRequestDigest(body), "b".repeat(64))).toThrow("result digest");
    const later = new Date(Date.parse(end) + 20 * 60000);
    expect(() => verifyPaidShadowExecution(envelope.executionReceipt, seen, metaContract, identityFor(metaContract), later, shadowRequestDigest(body), shadowRequestDigest(envelope))).toThrow();
    expect(verifyHistoricalPaidShadowExecution(envelope.executionReceipt, seen, metaContract, identityFor(metaContract), later, shadowRequestDigest(body), shadowRequestDigest(envelope),
      { dispatchedAt: start, authorizedAt: start }).revisionVerification).toMatchObject({ method: "historical_reconciliation" });
  });
  const receiptCases: [string, (r: Record<string, unknown>) => void][] = [
    ["another ad account", r => { (r.provider as Record<string, unknown>).adAccountId = "act_999"; }],
    ["another currency", r => { (r.provider as Record<string, unknown>).currency = "USD"; }],
    ["another window", r => { (r.provider as Record<string, unknown>).reportingWindow = "last_28d"; }],
    ["a performance dataset it did not read", r => { (r.provider as Record<string, unknown>).dataset = "conversions_api"; }],
    ["an echoed revision", r => { r.workflowVersion = metaContract.workflowVersion; }],
    ["the wrong lane", r => { r.lane = "google_ads"; }],
    ["an executed action", r => { r.executedAction = "meta.adset.pause"; }],
    ["a read outside the execution", r => { (r.provider as Record<string, unknown>).fetchedAt = "2026-09-05T00:00:00Z"; }],
  ];
  it.each(receiptCases)("refuses a Meta receipt with %s", (_label, mutate) => {
    const r = metaReceipt(); mutate(r);
    expect(() => validatePaidShadowReceipt(r, metaContract, identityFor(metaContract), now())).toThrow();
  });
  it("refuses DataForSEO evidence for another market or a failed task", () => {
    const wrongMarket = gadsReceipt(); (wrongMarket.provider as Record<string, unknown>).locationCode = 2554;
    expect(() => validatePaidShadowReceipt(wrongMarket, gadsContract, identityFor(gadsContract), now())).toThrow("contract market");
    const failed = gadsReceipt(); (failed.provider as Record<string, unknown>).taskStatusCode = 40000;
    expect(() => validatePaidShadowReceipt(failed, gadsContract, identityFor(gadsContract), now())).toThrow();
  });
});

describe("bridge: AVGAR's contract, its own ledger and reader, nothing else", () => {
  function bridge(opts: { admission?: ShadowAdmission | null; env?: Record<string, string | undefined>; status?: number; body?: unknown; reader?: boolean } = {}) {
    const sent: unknown[] = []; let calls = 0;
    const b = new HttpN8nBridge({ env: opts.env ?? env, now, lookup: dns,
      ...(opts.admission === null ? {} : { paidShadowAdmission: opts.admission ?? syntheticAdmission() }),
      ...(opts.reader === false ? {} : { readPaidShadowExecution: async ({ executionId }) => projectResultShadowExecution(savedExecution(metaContract, sent[0], opts.body ?? reply(), executionId), { ...metaPins, executionId }) }),
      fetch: async (_url, init) => { calls++; sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(opts.body ?? reply()), { status: opts.status ?? 200 }); } });
    return { b, sent, calls: () => calls };
  }
  it("sends the pinned contract, verifies the saved execution and returns a verified artifact", async () => {
    const t = bridge();
    const out = await t.b.call(node(), ctxFor(metaContract), metaRegistration);
    expect(t.sent[0]).toMatchObject({ shadow: metaContract, accountId: account.accountId, routineId: "D02-W01", mode: "dry_run", data: { scopes: [] } });
    expect(out).toMatchObject({ kind: "artifact", artifact: { kind: "generic", meta: { executed_action: "none", executionReceipt: { revisionEvidence: "verified_execution_record", executedAction: "none" } },
      evidence: expect.arrayContaining([{ source: "n8n_execution", ref: expect.stringContaining(`/workflow/${metaContract.workflowId}/executions/12345`) }]) } });
    expect(JSON.stringify(out)).not.toContain("never-store");
  });
  it("fails closed before any POST when the paid ledger, currency, receiver pin or reader is missing", async () => {
    const noLedger = bridge({ admission: null });
    await expect(noLedger.b.call(node(), ctxFor(metaContract), metaRegistration)).rejects.toThrow("Durable shadow admission is not configured");
    expect(noLedger.calls()).toBe(0);
    const keywordLedger = bridge({ admission: new DbShadowAdmission({ from: () => { throw new Error("never"); }, rpc: async () => ({ data: null, error: null }) } as never) });
    await expect(keywordLedger.b.call(node(), ctxFor(metaContract), metaRegistration)).rejects.toThrow("cannot authorize");
    expect(keywordLedger.calls()).toBe(0);
    const unpinned = bridge({ env: { ...env, N8N_META_SHADOW_RECEIVER_URL: undefined } });
    await expect(unpinned.b.call(node(), ctxFor(metaContract), metaRegistration)).rejects.toThrow("receiver");
    expect(unpinned.calls()).toBe(0);
    const borrowed = bridge({ env: { ...env, N8N_META_SHADOW_RECEIVER_TOKEN: env.N8N_SHADOW_RECEIVER_TOKEN } });
    await expect(borrowed.b.call(node(), ctxFor(metaContract), metaRegistration)).rejects.toThrow("own receiver URL and scoped credential");
    const noReader = bridge({ reader: false, env: { ...env, N8N_META_SHADOW_RESULT_NODE_ID: "" } });
    await expect(noReader.b.call(node(), ctxFor(metaContract), metaRegistration)).rejects.toThrow("independent n8n execution verification is not configured");
    expect(noReader.calls()).toBe(0);
    const foreign = bridge();
    await expect(foreign.b.call(node(), ctxFor(metaContract), { ...metaRegistration, accountId: "00000000-0000-4000-8000-000000000999" })).rejects.toThrow("account-specific workflow registration");
    const gadsOnMeta = bridge();
    await expect(gadsOnMeta.b.call(node(gadsContract), ctxFor(gadsContract), { ...gadsRegistration, webhookUrl: META_SHADOW_RECEIVER_URL })).rejects.toThrow();
  });
  it("refuses an asynchronous reply, a raw-kind artifact and a proposal without provider evidence", async () => {
    await expect(bridge({ status: 202 }).b.call(node(), ctxFor(metaContract), metaRegistration)).rejects.toThrow("synchronous");
    const raw = reply(); raw.artifact.kind = "meta_decisions" as never;
    await expect(bridge({ body: raw }).b.call(node(), ctxFor(metaContract), metaRegistration)).rejects.toThrow();
    const empty = reply(); (empty.executionReceipt.provider as Record<string, unknown>).itemsCount = 0;
    expect(() => protocolCandidate(empty.artifact, validatePaidShadowReceipt(empty.executionReceipt, metaContract, identityFor(metaContract), now()), metaContract, identityFor(metaContract), "a".repeat(64))).toThrow("empty Meta insights read");
  });
  it("pins the execution reader per lane and never falls back to the keyword or calendar family", () => {
    expect(createShadowExecutionReader(env, metaContract.workflowId, { protocol: "meta" })).toBeTypeOf("function");
    expect(createShadowExecutionReader(env, gadsContract.workflowId, { protocol: "google_ads" })).toBeTypeOf("function");
    expect(createShadowExecutionReader(env, metaContract.workflowId)).toBeUndefined();
    expect(createShadowExecutionReader(env, metaContract.workflowId, { protocol: "google_ads" })).toBeUndefined();
    for (const key of ["N8N_META_SHADOW_WORKFLOW_ID", "N8N_META_SHADOW_TRIGGER_NODE_ID", "N8N_META_SHADOW_RESULT_NODE_ID"])
      expect(createShadowExecutionReader({ ...env, [key]: "" }, metaContract.workflowId, { protocol: "meta" })).toBeUndefined();
    expect(createShadowExecutionReader({ ...env, N8N_EXECUTION_API_KEY: env.N8N_META_SHADOW_RECEIVER_TOKEN }, metaContract.workflowId, { protocol: "meta" })).toBeUndefined();
  });
});

describe("engine: paid runs need their own reservation, claim and completion; disabled routines never run", () => {
  const spec = paidShadowSpec(metaContract, 2);
  it("refuses to start without the paid allowance, or with another lane's allowance", async () => {
    const { adapters } = testAdapters();
    await expect(runRoutine(spec, { account, triggeredBy: "manual" }, adapters, { mode: "dry_run" })).rejects.toThrow("Paid-ads shadow requires its own durable reservation");
    await expect(runRoutine(spec, { account, triggeredBy: "manual" }, { ...adapters, completePaidShadow: async () => ({}) as RunResult },
      { mode: "dry_run", reserveCalendarShadowRun: async r => r, claimCalendarShadowStart: async () => true })).rejects.toThrow("Paid-ads shadow requires");
    await expect(runRoutine(CATALOG_SPEC_BY_ID["D01-W01"], { account, triggeredBy: "manual" }, adapters,
      { mode: "dry_run", reservePaidShadowRun: async r => r, claimPaidShadowStart: async () => true })).rejects.toThrow("Paid-ads allowance cannot start another routine");
    await expect(runRoutine(spec, { account, triggeredBy: "manual" }, adapters, { mode: "live" as never, reservePaidShadowRun: async r => r, claimPaidShadowStart: async () => true })).rejects.toThrow();
  });
  it("reserves, claims, dispatches once, and completes only through the verified ledger", async () => {
    const { adapters, store } = testAdapters();
    const claims: string[] = []; let dispatched = 0;
    const complete = vi.fn(async (run: RunRecord) => {
      expect(run.snapshot).toMatchObject({ awaiting: "paid_shadow", nextNodeIndex: 2 });
      const draft = paidShadowArtifact(metaArtifact(), metaContract, { accountId: run.accountId, runId: run.id, routineId: run.routineId, mode: run.mode, startedAt: run.startedAt });
      draft.meta = { executionReceipt: { revisionEvidence: "verified_execution_record" }, approval_status: "pending_approval", executed_action: "none" };
      return (await planPaidShadowCompletion(run, draft, { now })).result;
    });
    const result = await runRoutine(spec, { account, triggeredBy: "manual" }, {
      ...adapters, now, n8n: { call: async () => { dispatched++; return { kind: "artifact", artifact: metaArtifact() }; } }, completePaidShadow: complete,
    }, { mode: "dry_run", runId, reservePaidShadowRun: async run => { claims.push("reserve"); expect(run.snapshot).toMatchObject({ awaiting: "paid_start", startProtocol: "paid_claim_v1" }); expect(paidContractForRun(run)).toEqual(metaContract); return store.createRun(run); },
      claimPaidShadowStart: async () => { claims.push("claim"); return true; } });
    expect(claims).toEqual(["reserve", "claim"]); expect(dispatched).toBe(1); expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "done", artifact: { kind: "generic", routineId: "D02-W01" } });
    expect(result.receipts.length).toBeGreaterThan(0); expect(result.receipts.every(r => r.kind === "draft")).toBe(true);
    expect((await store.getRun(runId))?.snapshot?.awaiting).toBe("paid_shadow");
    const denied = await runRoutine(spec, { account, triggeredBy: "manual" }, { ...adapters, now, n8n: { call: async () => { throw new Error("must not be called"); } }, completePaidShadow: complete },
      { mode: "dry_run", runId: "00000000-0000-4000-8000-000000000105", reservePaidShadowRun: async run => store.createRun(run), claimPaidShadowStart: async () => false }).catch(e => e);
    expect(String(denied)).toContain("already claimed");
  });
  it("keeps a lost completion reconcilable instead of dispatching again", async () => {
    const { adapters, store } = testAdapters();
    const result = await runRoutine(spec, { account, triggeredBy: "manual" }, {
      ...adapters, now, n8n: { call: async () => ({ kind: "artifact", artifact: metaArtifact() }) }, completePaidShadow: async () => { throw new Error("ledger unavailable"); },
    }, { mode: "dry_run", runId, reservePaidShadowRun: async run => store.createRun(run), claimPaidShadowStart: async () => true });
    expect(result).toMatchObject({ status: "running", error: "paid_shadow_reconciliation_required" });
    expect((await store.getRun(runId))?.snapshot?.awaiting).toBe("paid_shadow");
  });
  it("a scheduled tick and a chat request both refuse a switched-off paid routine", async () => {
    const { adapters, store } = testAdapters();
    const deps = { store, accounts: new StaticAccountsSource([{ account }]), db: null };
    await expect(triggerRun(deps as never, { accountId: account.accountId, routineId: "D02-W01", triggeredBy: "schedule" }, adapters)).rejects.toThrow("switched off");
    expect(await store.listRuns(account.accountId, {})).toEqual([]);
    const actor: CommandActor = { accountId: account.accountId, userId: "00000000-0000-4000-8000-000000000201", channel: "app", requestId: "req-1", contextGeneration: 1 };
    const dispatch: DispatchDeps = { store, queue: {} as never, isOwner: async () => true, assertContext: async () => {}, connected: async () => ["meta_ads", "shopify"],
      business: async () => null, budget: async () => true, interpret: async () => ({ kind: "chat" }), selectionReleased: () => true };
    expect(await eligible(dispatch, actor, "D02-W01")).toMatchObject({ ok: false, reply: expect.stringContaining("switched off") });
    await store.putRoutineState({ accountId: account.accountId, routineId: "D02-W01", enabled: true, version: 2, liveSpec: spec, draftSpec: null, updatedAt: start });
    expect(await eligible(dispatch, actor, "D02-W01")).toMatchObject({ ok: false, reply: expect.stringContaining("reviewed paid-ads shadow configuration") });
    await store.putN8nWorkflow(metaRegistration);
    expect(await eligible(dispatch, actor, "D02-W01")).toMatchObject({ ok: true, spec: expect.objectContaining({ id: "D02-W01" }), workflow: expect.objectContaining({ id: metaRegistration.id }) });
  });
});

describe("chat/Slack selection is the reviewed spec, the pinned receiver and AVGAR only", () => {
  const spec = paidShadowSpec(metaContract, 2);
  const actor: CommandActor = { accountId: account.accountId, userId: "00000000-0000-4000-8000-000000000201", channel: "app", requestId: "req-1", contextGeneration: 1 };
  it("returns the lane only for an exact reviewed selection", () => {
    expect(paidCommandLane(actor, spec, metaRegistration, {})).toBe("meta");
    expect(paidCommandLane(actor, paidShadowSpec(gadsContract, 2), gadsRegistration, {})).toBe("google_ads");
    expect(paidCommandLane({ ...actor, accountId: "00000000-0000-4000-8000-000000000999" }, spec, metaRegistration, {})).toBeNull();
    expect(paidCommandLane(actor, spec, { ...metaRegistration, webhookUrl: "https://junctionai8.app.n8n.cloud/webhook/other" }, {})).toBeNull();
    expect(paidCommandLane(actor, spec, { ...metaRegistration, active: false }, {})).toBeNull();
    expect(paidCommandLane(actor, spec, null, {})).toBeNull();
    const tampered: RoutineSpec = structuredClone(spec); (tampered.nodes[2] as { expiryHours: number }).expiryHours = 999;
    expect(paidCommandLane(actor, tampered, metaRegistration, {})).toBeNull();
    expect(paidCommandLane(actor, CATALOG_SPEC_BY_ID["D02-W01"], metaRegistration, {})).toBeNull();
    expect(paidCommandLane({ ...actor, channel: "slack", linkId: "link" }, spec, metaRegistration, {})).toBeNull();
    expect(paidCommandLane({ ...actor, channel: "slack", linkId: "link" }, spec, metaRegistration, { UNC_MESSAGING_PILOT_SCOPE: "{}" })).toBeNull();
  });
  it("derives a fixed, one-dispatch approval from the claimed command and refuses drift", () => {
    const command: RoutineCommand = { id: commandId(actor), contextGeneration: 1, actor, requestHash: digest("run my paid decision"), routineId: "D02-W01",
      specHash: digest(spec), workflowHash: workflowFingerprint(metaRegistration), version: 2, request: "run my paid decision", status: "running", reply: "",
      runId: commandId(actor), createdAt: start, updatedAt: start };
    expect(paidCommandApproval(command, spec, metaRegistration, now(), {})).toEqual({ authorizedBy: actor.userId, approvalReference: `paid-command:${command.id}`,
      idempotencyKey: `paid-command:${command.id}`, contextGeneration: 1, lane: "meta", maxDispatches: 1, expiresAt: new Date(Date.parse(start) + 600_000).toISOString() });
    expect(() => paidCommandApproval({ ...command, status: "queued" }, spec, metaRegistration, now(), {})).toThrow("reviewed selection");
    expect(() => paidCommandApproval({ ...command, specHash: "0".repeat(64) }, spec, metaRegistration, now(), {})).toThrow("reviewed selection");
    expect(() => paidCommandApproval(command, spec, { ...metaRegistration, webhookUrl: GADS_SHADOW_RECEIVER_URL }, now(), {})).toThrow("reviewed selection");
  });
});

describe("corrections: unmapped price holds without a cap; source currency is preserved", () => {
  it("accepts HOLD with cap_reason pending_product_price and no cap, and refuses KEEP or any cap without a verified price", () => {
    const hold = metaArtifact(); delete item(hold).cpa_cap; Object.assign(item(hold), { cap_reason: "pending_product_price", next_action: "RESOLVE_PRODUCT_PRICE_MAPPING" });
    expect(paidShadowArtifact(hold, metaContract, identityFor(metaContract)).items![0].meta).toMatchObject({ decision_state: "HOLD", cap_reason: "pending_product_price" });
    expect(paidShadowArtifact(hold, metaContract, identityFor(metaContract)).items![0].meta).not.toHaveProperty("cpa_cap");
    const keep = metaArtifact(); delete item(keep).cpa_cap; Object.assign(item(keep), { decision_state: "KEEP", observed: { spend: 90, purchases: 3, cpa: 30 } });
    expect(() => paidShadowArtifact(keep, metaContract, identityFor(metaContract))).toThrow("KEEP is a cap-judged verdict");
    const invented = metaArtifact(); (item(invented).cpa_cap as Record<string, unknown>).product_price = null;
    expect(() => paidShadowArtifact(invented, metaContract, identityFor(metaContract))).toThrow("verified product price");
    const guessed = metaArtifact(); Object.assign(item(guessed), { cpa_cap: { value: 60, currency: "NZD", basis: "preset_target_cpa", product_price: 120 } });
    expect(() => paidShadowArtifact(guessed, metaContract, identityFor(metaContract))).toThrow("verified product price");
  });
  it("keeps the product's own currency on the cap and demands a verified conversion into the account currency", () => {
    const usdPrice = { value: 45, currency: "USD", basis: "product_price_50pct", product_price: 90 };
    const fx = { from: "USD", to: "NZD", rate: 1.65, source: "rbnz-mid-2026-09-05", as_of: "2026-09-05T00:00:00.000Z", converted_value: 74.25 };
    const converted = metaArtifact(); Object.assign(item(converted), { cpa_cap: { ...usdPrice, conversion: fx } });
    const out = paidShadowArtifact(converted, metaContract, identityFor(metaContract)).items![0].meta!;
    expect(out.cpa_cap).toEqual({ ...usdPrice, conversion: fx, comparable_value: 74.25 });
    const scale = metaArtifact(); Object.assign(item(scale), { decision_state: "SCALE", cpa_cap: { ...usdPrice, conversion: fx }, observed: { spend: 148, purchases: 2, cpa: 74 } });
    expect(paidShadowArtifact(scale, metaContract, identityFor(metaContract)).items![0].meta!.decision_state).toBe("SCALE");
    const overInNzd = metaArtifact(); Object.assign(item(overInNzd), { decision_state: "SCALE", cpa_cap: { ...usdPrice, conversion: fx }, observed: { spend: 150, purchases: 2, cpa: 75 } });
    expect(() => paidShadowArtifact(overInNzd, metaContract, identityFor(metaContract))).toThrow("at or under the cap");
    for (const bad of [{ ...fx, converted_value: 70 }, { ...fx, to: "AUD" }, { ...fx, rate: 0 }, { ...fx, source: "" }, { ...fx, as_of: "yesterday" }]) {
      const draft = metaArtifact(); Object.assign(item(draft), { cpa_cap: { ...usdPrice, conversion: bad } });
      expect(() => paidShadowArtifact(draft, metaContract, identityFor(metaContract))).toThrow("verified conversion");
    }
    const needless = metaArtifact(); Object.assign(item(needless), { cpa_cap: { value: 60, currency: "NZD", basis: "product_price_50pct", product_price: 120, conversion: { ...fx, from: "NZD" } } });
    expect(() => paidShadowArtifact(needless, metaContract, identityFor(metaContract))).toThrow("not needed");
  });
  it("does not force the Google Ads billing currency to equal the workspace currency", async () => {
    const usdBilling = { ...gadsContract, client: { ...gadsContract.client, currency: "USD" } };
    expect(paidShadowSchema.safeParse(usdBilling).success).toBe(true);
    const ceilingInNzd = gadsArtifact(); Object.assign(item(ceilingInNzd), { cpa_ceiling: { value: 47.5, currency: "NZD", basis: "product_price_50pct", product_price: 95 } }); delete item(ceilingInNzd).cap_reason;
    expect(() => paidShadowArtifact(ceilingInNzd, usdBilling, identityFor(usdBilling))).toThrow("verified conversion to USD");
    Object.assign(item(ceilingInNzd).cpa_ceiling as Record<string, unknown>, { conversion: { from: "NZD", to: "USD", rate: 0.6, source: "rbnz-mid-2026-09-05", as_of: "2026-09-05T00:00:00.000Z", converted_value: 28.5 } });
    expect(paidShadowArtifact(ceilingInNzd, usdBilling, identityFor(usdBilling)).items![0].meta!.cpa_ceiling).toMatchObject({ currency: "NZD", comparable_value: 28.5 });
    const sent: unknown[] = [];
    const b = new HttpN8nBridge({ env, now, lookup: dns, paidShadowAdmission: syntheticAdmission(),
      readPaidShadowExecution: async ({ executionId }) => projectResultShadowExecution(savedExecution(usdBilling, sent[0], { artifact: gadsArtifact(), executionReceipt: gadsReceipt(usdBilling) }, executionId), { workflowId: usdBilling.workflowId, executionId, triggerNodeId: "incoming-gads", resultNodeId: "result-gads" }),
      fetch: async (_url, init) => { sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ artifact: gadsArtifact(), executionReceipt: { ...gadsReceipt(usdBilling), executionId: "12346" } }), { status: 200 }); } });
    const out = await b.call(node(usdBilling), ctxFor(usdBilling), gadsRegistration);
    expect(out).toMatchObject({ kind: "artifact", artifact: { meta: { executionReceipt: { client: { currency: "USD" }, revisionEvidence: "verified_execution_record" } } } });
    expect((sent[0] as { account: { currency: string } }).account.currency).toBe("NZD");
  });
});

describe("paid-ads authority endpoint", () => {
  const NOW = now(), SECRET = env.N8N_SIGNING_SECRET;
  let store: MemoryStore, deps: ProxyDeps, spec: RoutineSpec, run: RunRecord;
  const request = (over: Partial<{ runId: string; scopes: string[] }> = {}) => {
    const { token } = issueDataToken(SECRET, { accountId: run.accountId, runId: run.id, routineId: run.routineId, scopes: scopesForSpec(spec), ...over }, { now: () => NOW });
    return new Request("https://unc.example.com/api/n8n/paid-shadow-authority", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  };
  beforeEach(async () => {
    store = new MemoryStore(); spec = paidShadowSpec(metaContract, 2);
    run = { id: runId, accountId: account.accountId, contextGeneration: 1, routineId: "D02-W01", version: 2, mode: "dry_run", status: "running", startedAt: NOW.toISOString(),
      specHash: stableHash(spec), snapshot: { spec, ctx: ctxFor(metaContract), nextNodeIndex: 2, awaiting: "paid_shadow" } };
    await store.createRun(run);
    await store.putRoutineState({ accountId: run.accountId, routineId: run.routineId, enabled: true, version: 1, liveSpec: null, draftSpec: spec, updatedAt: NOW.toISOString() });
    await store.putN8nWorkflow(metaRegistration);
    deps = { store, secret: SECRET, credentials: new NoCredentialsProvider(), credentialsKind: "none", db: null, paidShadowAdmission: syntheticAdmission(),
      now: () => NOW, limiter: new RateLimiter(60, 60_000, () => NOW), playbooks: null };
    mocked.deps = deps;
    vi.stubEnv("N8N_META_SHADOW_RECEIVER_URL", META_SHADOW_RECEIVER_URL);
    vi.stubEnv("N8N_GADS_SHADOW_RECEIVER_URL", GADS_SHADOW_RECEIVER_URL);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("discloses only the projected contract for an authorized paid run, and denies everything else", async () => {
    const ok = await POST(request());
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ ok: true, shadow: metaContract, revisionEvidence: "expected_only", executedAction: "none", run: { id: run.id, routineId: "D02-W01" } });
    expect(JSON.stringify(body)).not.toContain("never-store");
    expect((await GET()).status).toBe(405);
    deps.paidShadowAdmission = { ...syntheticAdmission(), authorize: async () => false };
    expect((await POST(request())).status).toBe(409);
    deps.paidShadowAdmission = undefined;
    expect((await POST(request())).status).toBe(503);
    deps.paidShadowAdmission = syntheticAdmission();
    vi.stubEnv("N8N_META_SHADOW_RECEIVER_URL", GADS_SHADOW_RECEIVER_URL);
    expect((await POST(request())).status).toBe(403);
  });
  it("refuses a run that is not awaiting paid dispatch or whose registration is not the lane receiver", async () => {
    await store.updateRun(run.id, { snapshot: { ...run.snapshot!, awaiting: "keyword_shadow" } });
    expect((await POST(request())).status).toBe(403);
    await store.updateRun(run.id, { snapshot: run.snapshot });
    await store.putN8nWorkflow({ ...metaRegistration, webhookUrl: GADS_SHADOW_RECEIVER_URL });
    expect((await POST(request())).status).toBe(503);
  });
});
