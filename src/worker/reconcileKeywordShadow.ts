/** Operator-only archival recovery. Never dispatches n8n, issues a permit, runs the
 * engine, creates a customer artifact/receipt, changes a switch or sends a message. */
import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { DbShadowAdmission } from "../lib/n8n/shadowAdmission";
import { shadowCandidate, verifiedShadowResult } from "../lib/n8n/shadowCandidate";
import { AVGAR_PILOT_ACCOUNT, shadowContractProblem, verifyHistoricalShadowExecution, type KeywordShadowContract } from "../lib/n8n/shadowContract";
import { createShadowExecutionReader, type ShadowExecutionReader } from "./providers/n8nExecutionReader";

const object = (v: unknown): Row | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : null;
export interface ShadowRecoveryScope { permitId: string; accountId: string; contextGeneration: number }
export interface ShadowRecoveryDeps {
  db: DbClient;
  env: Record<string, string | undefined>;
  now?: () => Date;
  /** Test seam; real reads always use the separate, pinned GET-only execution API. */
  readExecution?: ShadowExecutionReader;
}

export async function reconcileKeywordShadowArchive(scope: ShadowRecoveryScope, deps: ShadowRecoveryDeps) {
  if (scope.accountId !== AVGAR_PILOT_ACCOUNT || !scope.permitId ||
      !Number.isSafeInteger(scope.contextGeneration) || scope.contextGeneration < 0)
    throw new Error("Explicit original AVGAR permit scope required");
  const readPermit = () => unwrap<Row | null>("shadow.recovery.permit", deps.db.from("n8n_shadow_permits")
    .select("id,account_id,context_generation,run_id,contract,status,request_digest,execution_id,dispatched_at,authorized_at,result")
    .eq("id", scope.permitId).eq("account_id", scope.accountId).eq("context_generation", scope.contextGeneration).maybeSingle());
  const permit = await readPermit();
  if (!permit || permit.account_id !== scope.accountId || permit.context_generation !== scope.contextGeneration)
    throw new Error("Original shadow permit unavailable");
  if (shadowContractProblem(permit.contract) || typeof permit.run_id !== "string" ||
      typeof permit.execution_id !== "string" || !/^[1-9]\d{0,29}$/.test(permit.execution_id) ||
      typeof permit.request_digest !== "string" || !/^[a-f0-9]{64}$/.test(permit.request_digest) ||
      typeof permit.authorized_at !== "string" || typeof permit.dispatched_at !== "string")
    throw new Error("Named authorized execution unavailable; reconcile discovery without redispatch");
  const contract = permit.contract as KeywordShadowContract;
  const receiptMatches = (row: Row | null) => {
    const receipt = object(object(object(row?.result)?.artifact)?.meta)?.executionReceipt;
    const r = object(receipt);
    return row?.status === "verified" && r?.revisionEvidence === "verified_execution_record" &&
      r?.accountId === scope.accountId && r?.runId === permit.run_id && r?.executionId === permit.execution_id &&
      r?.workflowId === contract.workflowId && r?.workflowVersion === contract.workflowVersion &&
      object(r?.revisionVerification)?.requestDigest === permit.request_digest;
  };
  const outcome = (alreadyVerified: boolean) => ({ status: "verified_archive" as const, accountId: scope.accountId,
    contextGeneration: scope.contextGeneration, runId: permit.run_id as string, executionId: permit.execution_id as string,
    alreadyVerified, projected: false as const, providerDispatches: 0 as const });
  if (receiptMatches(permit)) return outcome(true);
  if (permit.status !== "uncertain" && permit.status !== "verifying") throw new Error("Shadow permit is not eligible for reconciliation");
  const saved = await unwrap<Row | null>("shadow.recovery.candidate", deps.db.from("n8n_shadow_candidates")
    .select("permit_id,account_id,context_generation,run_id,run_started_at,execution_id,candidate")
    .eq("permit_id", scope.permitId).eq("account_id", scope.accountId).eq("context_generation", scope.contextGeneration).maybeSingle());
  const reported = object(saved?.candidate), receipt = object(reported?.executionReceipt);
  if (!saved || saved.run_id !== permit.run_id || saved.execution_id !== permit.execution_id ||
      typeof saved.run_started_at !== "string" || !receipt || receipt.executionId !== permit.execution_id)
    throw new Error("Original shadow response checkpoint unavailable; no provider retry allowed");
  const candidate = shadowCandidate(reported?.artifact, receipt);
  const read = deps.readExecution ?? createShadowExecutionReader(deps.env, contract.workflowId);
  if (!read) throw new Error("Independent execution reader unavailable; evidence remains unverified");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observation: unknown;
  try {
    observation = await Promise.race([
      read({ workflowId: contract.workflowId, executionId: permit.execution_id, signal: controller.signal }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new Error("execution read timed out"));
      }, 10_000); }),
    ]);
  } catch { throw new Error("Saved execution unavailable; evidence remains unverified, no provider retry allowed"); }
  finally { clearTimeout(timer); }
  const verified = verifyHistoricalShadowExecution(candidate.executionReceipt, observation, contract,
    { accountId: scope.accountId, runId: permit.run_id, routineId: contract.routineId, mode: "dry_run", startedAt: saved.run_started_at },
    (deps.now ?? (() => new Date()))(), permit.request_digest,
    { dispatchedAt: permit.dispatched_at, authorizedAt: permit.authorized_at });
  const result = verifiedShadowResult(candidate, verified);
  try { await new DbShadowAdmission(deps.db).finish(scope.permitId, "verified", permit.execution_id, result); }
  catch {
    // A lost commit response / concurrent verifier is safe to reconcile by readback.
    // Never replace the winning evidence or call the paid workflow again.
    if (receiptMatches(await readPermit())) return outcome(true);
    throw new Error("Verified archive was not recorded; reconcile storage without redispatch");
  }
  if (!receiptMatches(await readPermit())) throw new Error("Verified archive readback failed; reconcile storage without redispatch");
  return outcome(false);
}
