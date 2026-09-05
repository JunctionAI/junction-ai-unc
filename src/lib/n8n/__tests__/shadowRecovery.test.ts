import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { AVGAR_PILOT_ACCOUNT, verifyShadowExecution, verifyHistoricalShadowExecution, type KeywordShadowContract } from "../shadowContract";
import { shadowCandidate } from "../shadowCandidate";
import { reconcileKeywordShadowArchive } from "../../../worker/reconcileKeywordShadow";
import { HttpN8nBridge } from "../../../worker/providers/n8n";
import { DbShadowAdmission, shadowTokenDigest } from "../shadowAdmission";
import type { Row } from "../../db/types";
import type { RunContext } from "../../runtime/types";

const start = "2026-09-05T07:00:00.000Z", end = "2026-09-05T07:00:03.000Z";
const later = new Date("2026-09-06T07:00:00Z");
const contract: KeywordShadowContract = { contract: "unc.keyword-shadow.v1", accountId: AVGAR_PILOT_ACCOUNT,
  workflowId: "synthetic-wrapper", workflowVersion: "synthetic-frozen-revision", routineId: "D03-W01", routineKey: "keyword_opportunity",
  client: { id: "avgar", primaryDomain: "example.com", seedKeyword: "test keyword", locationCode: 2840, languageCode: "en" } };
const run = { accountId: AVGAR_PILOT_ACCOUNT, runId: "synthetic-run", routineId: "D03-W01", mode: "dry_run", startedAt: start };
const scope = { accountId: AVGAR_PILOT_ACCOUNT, contextGeneration: 1, permitId: "synthetic-permit" };
const admission = { dispatchedAt: start, authorizedAt: "2026-09-05T07:00:01.000Z" };
const digest = "a".repeat(64);
const reported = () => ({ contract: contract.contract, accountId: run.accountId, runId: run.runId, routineId: run.routineId,
  routineKey: contract.routineKey, workflowId: contract.workflowId, workflowVersion: null, revisionEvidence: "pending_unc_verification",
  executionId: "123", mode: "dry_run", status: "succeeded", executedAction: "none", client: contract.client,
  startedAt: start, finishedAt: end,
  provider: { name: "dataforseo", statusCode: 20000, taskStatusCode: 20000, taskId: "synthetic-task", itemsCount: 1, fetchedAt: end } });
const artifact = () => ({ kind: "keyword_list", title: "Synthetic keywords", body: "Synthetic evidence for a recovery test only.",
  items: [{ title: "test keyword", body: "Synthetic discovery candidate.", meta: { searchVolume: 100 } }],
  meta: { authorization: "must-not-persist" }, headers: { authorization: "must-not-persist" } });
const seen = () => ({ source: "n8n_execution_record", executionId: "123", workflowId: contract.workflowId,
  workflowVersion: contract.workflowVersion, status: "success", finished: true, startedAt: start, stoppedAt: end,
  request: { accountId: run.accountId, runId: run.runId, routineId: run.routineId }, requestDigest: digest });

function fixture() {
  const db = new FakeSupabase();
  db.seed("n8n_shadow_permits", [{ id: scope.permitId, account_id: run.accountId, context_generation: 1, run_id: run.runId,
    contract, status: "uncertain", request_digest: digest, execution_id: "123", dispatched_at: admission.dispatchedAt,
    authorized_at: admission.authorizedAt, result: null }]);
  db.seed("n8n_shadow_candidates", [{ permit_id: scope.permitId, account_id: run.accountId, context_generation: 1,
    run_id: run.runId, run_started_at: start, execution_id: "123", candidate: shadowCandidate(artifact(), reported()) }]);
  const row = () => db.rows("n8n_shadow_permits")[0];
  const candidate = () => db.rows("n8n_shadow_candidates")[0];
  db.rpcs.finish_keyword_shadow_dispatch = args => {
    if (!["verifying", "uncertain"].includes(String(row().status))) return false;
    row().status = args.outcome; row().result = structuredClone(args.saved_result); return true;
  };
  const readExecution = vi.fn(async () => seen());
  const deps = { db, readExecution, env: {}, now: () => later };
  return { db, row, candidate, readExecution, deps, recover: () => reconcileKeywordShadowArchive(scope, deps) };
}

describe("historical shadow evidence", () => {
  it("accepts old independently verified evidence without relaxing the fresh reply TTL", () => {
    expect(() => verifyShadowExecution(reported(), seen(), contract, run, later, digest)).toThrow("stale");
    const verified = verifyHistoricalShadowExecution(reported(), seen(), contract, run, later, digest, admission);
    expect(verified).toMatchObject({ startedAt: start, finishedAt: end,
      provider: { fetchedAt: end }, revisionVerification: { verifiedAt: later.toISOString(), stoppedAt: end, method: "historical_reconciliation" } });
  });
  it.each([
    { dispatchedAt: "invalid" }, { dispatchedAt: "2026-09-05T06:00:00Z" }, { dispatchedAt: "2026-09-05T08:00:00Z" },
    { authorizedAt: "2026-09-05T06:00:00Z" }, { authorizedAt: "2026-09-05T07:20:00Z" },
  ])("refuses an execution outside its recorded admission: %j", patch => {
    expect(() => verifyHistoricalShadowExecution(reported(), seen(), contract, run, later, digest, { ...admission, ...patch })).toThrow("authorized execution window");
  });
  it.each([
    { workflowVersion: "other" }, { requestDigest: "b".repeat(64) }, { executionId: "999" }, { status: "error" },
    { startedAt: "2026-09-05T07:10:00Z" }, { stoppedAt: "2026-09-05T08:00:00Z" },
    { request: { accountId: "other", runId: run.runId, routineId: run.routineId } },
  ])("does not use an old timestamp to bypass identity/revision checks: %j", patch => {
    expect(() => verifyHistoricalShadowExecution(reported(), { ...seen(), ...patch }, contract, run, later, digest, admission)).toThrow();
  });
  it("rejects future execution records and an invalid clock", () => {
    for (const now of [new Date("2026-09-05T06:00:00Z"), new Date("invalid")])
      expect(() => verifyHistoricalShadowExecution(reported(), seen(), contract, run, now, digest, admission)).toThrow();
  });
});

describe("original shadow result archive recovery", () => {
  it("checkpoints a real bridge reply before a failed read, then recovers with a recreated adapter and no second POST", async () => {
    const f = fixture(); f.row().status = "reserved"; f.row().execution_id = null;
    f.db.rows("n8n_shadow_candidates").splice(0);
    f.db.rpcs.claim_keyword_shadow_dispatch = ({ input }) => {
      if (f.row().status !== "reserved") return null;
      const request = input as Row;
      f.row().request_digest = request.requestDigest; f.row().token_digest = request.tokenDigest;
      f.row().status = "dispatching"; return scope.permitId;
    };
    f.db.rpcs.consume_keyword_shadow_authority = ({ input }) => {
      if (f.row().status !== "dispatching" || (input as Row).tokenDigest !== f.row().token_digest) return false;
      f.row().status = "provider_authorized"; return true;
    };
    f.db.rpcs.checkpoint_keyword_shadow_result = args => {
      if (f.row().status !== "provider_authorized") return false;
      f.db.insertRow("n8n_shadow_candidates", { permit_id: scope.permitId, account_id: scope.accountId, context_generation: 1,
        run_id: run.runId, run_started_at: start, execution_id: args.observed_execution, candidate: structuredClone(args.reported_result) });
      f.row().execution_id = args.observed_execution; f.row().status = "verifying"; return true;
    };
    const admissionStore = new DbShadowAdmission(f.db);
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      expect(await admissionStore.authorize({ accountId: scope.accountId, contextGeneration: 1, runId: run.runId,
        registrationId: "synthetic-registration", contract, specHash: "synthetic-spec", tokenDigest: shadowTokenDigest(request.dataToken) })).toBe(true);
      return Response.json({ artifact: artifact(), executionReceipt: reported() });
    });
    const env = { N8N_SIGNING_SECRET: "synthetic-signing-secret", N8N_SHADOW_RECEIVER_TOKEN: "synthetic-receiver-more-than24",
      N8N_SHADOW_RECEIVER_URL: "https://n8n.test/keyword", N8N_DATA_BASE_URL: "https://unc.test" };
    const ctx: RunContext = { ...run, mode: "dry_run", version: 1, triggeredBy: "manual", inputs: {}, vars: {}, reads: {}, checks: {},
      account: { accountId: scope.accountId, contextGeneration: 1, currency: "NZD", budgetMonthly: 0 }, caps: { currency: "NZD", perDay: 0, perMonth: 0 } };
    const firstRead = vi.fn(async () => { expect(f.candidate().candidate).toBeTruthy(); throw new Error("temporary read failure"); });
    const bridge = new HttpN8nBridge({ env, now: () => new Date(end), fetch, shadowAdmission: admissionStore, readShadowExecution: firstRead });
    await expect(bridge.call({ id: "keyword", kind: "n8n", shadowContract: contract }, ctx,
      { id: "synthetic-registration", accountId: scope.accountId, routineId: "D03-W01", active: true, webhookUrl: env.N8N_SHADOW_RECEIVER_URL })).rejects.toThrow("independently verified");
    expect(f.row().status).toBe("uncertain");
    f.readExecution.mockImplementation(async () => ({ ...seen(), requestDigest: String(f.row().request_digest) }));
    expect(await f.recover()).toMatchObject({ status: "verified_archive", projected: false });
    expect(fetch).toHaveBeenCalledTimes(1); expect(f.readExecution).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.candidate())).not.toContain("unc_dt.");
  });
  it("recovers the original response after timeout, performs only the named read, and is repeatable", async () => {
    const f = fixture();
    expect(await f.recover()).toMatchObject({ status: "verified_archive", executionId: "123", alreadyVerified: false, projected: false, providerDispatches: 0 });
    expect(f.row().result).toMatchObject({ kind: "artifact", artifact: { kind: "keyword_list",
      meta: { executed_action: "none", executionReceipt: { workflowVersion: contract.workflowVersion,
        revisionEvidence: "verified_execution_record", revisionVerification: { method: "historical_reconciliation" } } } } });
    expect(f.readExecution).toHaveBeenCalledWith(expect.objectContaining({ workflowId: contract.workflowId, executionId: "123" }));
    expect(await f.recover()).toMatchObject({ alreadyVerified: true, projected: false });
    expect(f.readExecution).toHaveBeenCalledTimes(1);
    expect(f.db.rows("artifacts")).toHaveLength(0); expect(f.db.rows("receipts")).toHaveLength(0);
    expect(f.db.rows("outbound_messages")).toHaveLength(0); expect(f.db.rows("routine_runs")).toHaveLength(0);
    expect(f.db.calls.every(c => c.op === "select")).toBe(true);
    expect(JSON.stringify(f.row().result)).not.toContain("must-not-persist");
  });
  it("keeps the original account generation even after reset/pause and registration removal", async () => {
    const f = fixture(); f.db.seed("accounts", [{ id: scope.accountId, context_generation: 2, automation_paused: true }]);
    expect(await f.recover()).toMatchObject({ contextGeneration: 1, projected: false });
    expect(f.row().context_generation).toBe(1); expect(f.db.rows("accounts")[0].context_generation).toBe(2);
    expect(f.db.rows("n8n_workflows")).toHaveLength(0);
  });
  it("refuses another tenant or generation without reading n8n", async () => {
    const f = fixture();
    await expect(reconcileKeywordShadowArchive({ ...scope, accountId: "other" }, f.deps)).rejects.toThrow("scope");
    await expect(reconcileKeywordShadowArchive({ ...scope, contextGeneration: 2 }, f.deps)).rejects.toThrow("unavailable");
    expect(f.readExecution).not.toHaveBeenCalled();
  });
  it.each(["reserved", "dispatching", "provider_authorized", "refused"])("never turns %s into another provider allowance", async status => {
    const f = fixture(); f.row().status = status;
    await expect(f.recover()).rejects.toThrow("eligible"); expect(f.readExecution).not.toHaveBeenCalled();
    expect(f.row().status).toBe(status);
  });
  it("refuses missing execution identity or candidate instead of guessing/replaying", async () => {
    const f = fixture(); f.row().execution_id = null;
    await expect(f.recover()).rejects.toThrow("discovery"); f.row().execution_id = "123"; f.candidate().run_id = "different";
    await expect(f.recover()).rejects.toThrow("checkpoint unavailable"); expect(f.readExecution).not.toHaveBeenCalled();
  });
  it("leaves unreadable/mismatched execution evidence unverified and does not expose API errors", async () => {
    const f = fixture(); f.readExecution.mockRejectedValueOnce(new Error("private-api-key"));
    await expect(f.recover()).rejects.toThrow("Saved execution unavailable"); expect(f.row().status).toBe("uncertain");
    f.readExecution.mockResolvedValueOnce({ ...seen(), workflowVersion: "other" });
    await expect(f.recover()).rejects.toThrow("workflowVersion mismatch"); expect(f.row().status).toBe("uncertain");
    expect(f.row().result).toBeNull();
  });
  it("requires separately configured execution access", async () => {
    const f = fixture();
    await expect(reconcileKeywordShadowArchive(scope, { db: f.db, env: {}, now: () => later })).rejects.toThrow("reader unavailable");
    expect(f.row().status).toBe("uncertain");
  });
  it("two reconcilers preserve the first durable outcome", async () => {
    const f = fixture(); const results = await Promise.all([f.recover(), f.recover()]);
    expect(results.every(r => r.status === "verified_archive")).toBe(true);
    expect(results.filter(r => r.alreadyVerified)).toHaveLength(1);
  });
  it("readback resolves a lost commit response without another paid call", async () => {
    const f = fixture(), finish = f.db.rpcs.finish_keyword_shadow_dispatch;
    f.db.rpcs.finish_keyword_shadow_dispatch = args => { finish(args); throw new Error("commit response lost"); };
    expect(await f.recover()).toMatchObject({ alreadyVerified: true }); expect(f.readExecution).toHaveBeenCalledTimes(1);
  });
  it("does not claim recovery on failed storage or an uncorrelated winning result", async () => {
    const f = fixture(); f.db.rpcs.finish_keyword_shadow_dispatch = () => false;
    await expect(f.recover()).rejects.toThrow("not recorded");
    f.row().status = "verified"; f.row().result = { kind: "artifact", artifact: { meta: { executionReceipt: {} } } };
    await expect(f.recover()).rejects.toThrow("eligible");
  });
  it("bounds the private checkpoint and rejects invalid artifacts", () => {
    expect(() => shadowCandidate({ ...artifact(), items: [] }, reported())).toThrow("invalid");
    expect(() => shadowCandidate({ ...artifact(), items: [{ title: "test", meta: { padding: "x".repeat(256_000) } }] }, reported())).toThrow("too large");
  });
});
