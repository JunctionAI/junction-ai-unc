import { describe, expect, it, vi } from "vitest";
import { planKeywordShadowCompletion, runRoutine } from "../../runtime/engine";
import { keywordShadowSpec } from "../keywordShadowSpec";
import { stableHash } from "../../runtime/context";
import type { RunRecord } from "../../runtime/store/interface";
import type { ArtifactDraft, RunContext, RunResult } from "../../runtime/types";
import { AVGAR_PILOT_ACCOUNT, type KeywordShadowContract } from "../shadowContract";
import { adapters as testAdapters } from "../../runtime/__tests__/helpers";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { SupabaseStore } from "../../runtime/store/supabase";
import { completeKeywordShadowRun } from "../../../worker/completeKeywordShadow";
import { commandResult } from "../../commands/process";
import { shadowCandidate, verifiedShadowResult } from "../shadowCandidate";

const startedAt = "2026-09-05T08:00:00.000Z", now = () => new Date("2026-09-05T08:01:00.000Z");
const account = { accountId: AVGAR_PILOT_ACCOUNT, contextGeneration: 1, currency: "NZD", budgetMonthly: 0, approver: "Tom" };
const contract: KeywordShadowContract = { contract: "unc.keyword-shadow.v1", accountId: account.accountId, workflowId: "synthetic-wrapper",
  workflowVersion: "synthetic-frozen-revision", routineId: "D03-W01", routineKey: "keyword_opportunity",
  client: { id: "avgar", primaryDomain: "example.com", seedKeyword: "test keyword", locationCode: 2840, languageCode: "en" } };
const draft: ArtifactDraft = { kind: "keyword_list", title: "Synthetic keyword list", body: "A synthetic keyword list, not live provider evidence.",
  items: [{ title: "test keyword", body: "A synthetic discovery candidate." }], evidence: [],
  meta: { executed_action: "none", approval_status: "pending_approval", executionReceipt: { revisionEvidence: "verified_execution_record",
    workflowId: contract.workflowId, workflowVersion: contract.workflowVersion, executionId: "12345" } } };
function original(): RunRecord {
  const spec = keywordShadowSpec(contract, 2);
  const ctx: RunContext = { runId: "original-run", routineId: spec.id, version: spec.version, mode: "dry_run", startedAt, account,
    caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual", inputs: {}, vars: {}, reads: {}, checks: {} };
  return { id: ctx.runId, accountId: account.accountId, contextGeneration: 1, routineId: spec.id, version: 2, mode: "dry_run", status: "running", startedAt,
    specHash: stableHash(spec), snapshot: { spec, ctx, nextNodeIndex: 4, awaiting: "keyword_shadow" } };
}

describe("original keyword completion plan", () => {
  it("keeps the execution reference inside the artifact evidence limit on revalidation", () => {
    const candidate = shadowCandidate({ ...draft, evidence: Array.from({ length: 40 }, (_, i) => ({ source: "synthetic", ref: `ref-${i}` })) }, {});
    const result = verifiedShadowResult(candidate, { workflowId: "test", executionId: "123" });
    const revalidated = shadowCandidate(result.artifact, {}).artifact;
    expect(result.artifact.evidence).toHaveLength(40);
    expect(revalidated.evidence).toEqual(result.artifact.evidence);
    expect(revalidated.evidence?.at(-1)?.source).toBe("n8n_execution");
  });
  it("retains the original draft gate and final receipt without rerunning reads or providers", async () => {
    const run = original(), before = structuredClone(run);
    const planned = await planKeywordShadowCompletion(run, draft, { now });
    expect(run).toEqual(before); expect(planned.snapshot).toEqual(before.snapshot);
    expect(planned.result).toMatchObject({ runId: run.id, status: "done", mode: "dry_run", artifact: { status: "draft", accountId: run.accountId, runId: run.id } });
    expect(planned.result.receipts).toHaveLength(3);
    expect(planned.result.receipts[0].payload.externalExecution).toEqual(draft.meta?.executionReceipt);
    expect(planned.result.receipts[1].payload.approvalPreview).toMatchObject({ title: draft.title, afterState: "Opportunity list in your queue" });
    expect(planned.result.receipts[2].payload).toMatchObject({ artifactId: planned.result.artifact?.id, executed: false, measurementWindowDays: 28 });
    expect(planned.result.approval).toBeUndefined();
    expect(new Set([planned.result.artifact?.createdAt, ...planned.result.receipts.map(r => r.createdAt)]).size).toBe(1);
    expect(commandResult(planned.result).status).toBe("done");
  });
  it.each(["live", "waiting_input", "wrong_generation", "wrong_hash", "wrong_snapshot", "wrong_run", "wrong_version", "already_produced", "dangerous_tail"])("refuses %s", async fault => {
    const run = original();
    if (fault === "live") run.mode = "live";
    if (fault === "waiting_input") run.status = "waiting_input";
    if (fault === "wrong_generation") run.snapshot!.ctx.account = { ...account, contextGeneration: 2 };
    if (fault === "wrong_hash") run.specHash = "different";
    if (fault === "wrong_snapshot") run.snapshot!.awaiting = "n8n";
    if (fault === "wrong_run") run.snapshot!.ctx.runId = "other";
    if (fault === "wrong_version") run.snapshot!.ctx.version = 3;
    if (fault === "already_produced") run.snapshot!.ctx.artifact = { ...draft, id: "old-artifact" } as RunContext["artifact"];
    if (fault === "dangerous_tail") {
      run.snapshot!.spec.nodes.splice(4, 0, { kind: "n8n", id: "second-provider", webhookUrl: "https://example.com/forbidden" });
      run.specHash = stableHash(run.snapshot!.spec);
    }
    await expect(planKeywordShadowCompletion(run, draft, { now })).rejects.toThrow();
  });
  it("uses an immutable snapshot before dispatch and leaves it recoverable on failure", async () => {
    const { adapters, store } = testAdapters(); const spec = keywordShadowSpec(contract, 2);
    const complete = vi.fn();
    const n8n = { call: vi.fn(async (_node, ctx) => {
      expect((await store.getRun(ctx.runId))?.snapshot).toMatchObject({ awaiting: "keyword_shadow", nextNodeIndex: 4 });
      throw new Error("verification unavailable");
    }) };
    const result = await runRoutine(spec, { account, triggeredBy: "manual" }, { ...adapters, n8n, completeKeywordShadow: complete, now }, { mode: "dry_run" });
    expect(result).toMatchObject({ status: "running", error: "keyword_shadow_reconciliation_required" });
    expect((await store.getRun(result.runId))?.snapshot?.awaiting).toBe("keyword_shadow");
    expect(await store.listArtifacts(account.accountId)).toHaveLength(0); expect(complete).not.toHaveBeenCalled();
  });
  it("does not overwrite a successful commit when its response is lost", async () => {
    const { adapters, store } = testAdapters(); const spec = keywordShadowSpec(contract, 2);
    const result = await runRoutine(spec, { account, triggeredBy: "manual" }, { ...adapters, now,
      n8n: { call: async () => ({ kind: "artifact", artifact: draft }) }, completeKeywordShadow: async run => {
        await store.updateRun(run.id, { status: "done", snapshot: undefined }); throw new Error("commit response lost");
      } }, { mode: "dry_run" });
    expect(result.status).toBe("running"); expect((await store.getRun(result.runId))?.status).toBe("done");
  });
  it("refuses missing atomic completion before a paid dispatch", async () => {
    const { adapters } = testAdapters(); const call = vi.fn();
    const result = await runRoutine(keywordShadowSpec(contract, 2), { account }, { ...adapters, n8n: { call } }, { mode: "dry_run" });
    expect(result.status).toBe("failed"); expect(call).not.toHaveBeenCalled();
  });
});

async function dbFixture() {
  const db = new FakeSupabase(), store = new SupabaseStore(db), run = original();
  db.seed("accounts", [{ id: account.accountId, context_generation: 1, automation_paused: false }]);
  await store.createRun(run);
  db.seed("n8n_shadow_permits", [{ id: "permit", account_id: account.accountId, context_generation: 1, run_id: run.id,
    spec: run.snapshot!.spec, status: "verified", result: { kind: "artifact", artifact: draft } }]);
  let stored: RunResult | null = null; let commits = 0;
  // Wiring seam only. Real lock/rollback/identity semantics are checked in PostgreSQL.
  db.rpcs.commit_keyword_shadow_completion = ({ packet }) => {
    if (stored || !packet) return stored;
    if (db.rows("accounts")[0].context_generation !== 1 || db.rows("accounts")[0].automation_paused) throw new Error("context changed under commit");
    stored = structuredClone((packet as { result: RunResult }).result); commits++;
    db.rows("routine_runs")[0].status = "done"; db.rows("routine_runs")[0].snapshot = null;
    return stored;
  };
  const scope = { ...account, runId: run.id };
  return { db, store, scope, committed: () => commits, complete: () => completeKeywordShadowRun(db, scope, { now }) };
}
describe("durable keyword completion adapter", () => {
  it("normal and recovery callers return one committed identity", async () => {
    const f = await dbFixture(); const [a, b] = await Promise.all([f.complete(), f.complete()]);
    expect(a).toEqual(b); expect(f.committed()).toBe(1); expect(await f.complete()).toEqual(a);
    expect(f.db.rows("routine_runs")[0].status).toBe("done");
  });
  it("reconciles a lost commit response by readback", async () => {
    const f = await dbFixture(), rpc = f.db.rpcs.commit_keyword_shadow_completion;
    f.db.rpcs.commit_keyword_shadow_completion = args => { const out = rpc(args); if (args.packet) throw new Error("lost response"); return out; };
    expect((await f.complete()).status).toBe("done"); expect(f.committed()).toBe(1);
  });
  it("leaves a failed commit recoverable", async () => {
    const f = await dbFixture(); f.db.rpcs.commit_keyword_shadow_completion = ({ packet }) => { if (packet) throw new Error("storage unavailable"); return null; };
    await expect(f.complete()).rejects.toThrow("storage unavailable");
    expect(f.db.rows("routine_runs")[0]).toMatchObject({ status: "running", snapshot: { awaiting: "keyword_shadow" } });
  });
  it("refuses paused, replaced and unverified results", async () => {
    const f = await dbFixture(); f.db.rows("accounts")[0].automation_paused = true;
    await expect(f.complete()).rejects.toThrow(); f.db.rows("accounts")[0].automation_paused = false;
    f.db.rows("accounts")[0].context_generation = 2; await expect(f.complete()).rejects.toThrow();
    f.db.rows("accounts")[0].context_generation = 1; f.db.rows("n8n_shadow_permits")[0].status = "uncertain";
    await expect(f.complete()).rejects.toThrow("Verified keyword result unavailable"); expect(f.committed()).toBe(0);
  });
  it("rechecks under commit if reset happens after the initial read", async () => {
    const f = await dbFixture(), rpc = f.db.rpcs.commit_keyword_shadow_completion;
    f.db.rpcs.commit_keyword_shadow_completion = args => { if (args.packet) f.db.rows("accounts")[0].context_generation = 2; return rpc(args); };
    await expect(f.complete()).rejects.toThrow("context changed"); expect(f.committed()).toBe(0);
  });
});
