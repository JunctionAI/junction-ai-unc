/** Shared normal/recovery completion. All permanent writes are one service-only RPC. */
import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { planKeywordShadowCompletion } from "../lib/runtime/engine";
import { SupabaseStore } from "../lib/runtime/store/supabase";
import { assertSameRuntimeContext, type RuntimeContextIdentity } from "../lib/runtime/contextFence";
import type { RunResult } from "../lib/runtime/types";
import { shadowCandidate } from "../lib/n8n/shadowCandidate";

const object = (v: unknown): Row | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : null;
export async function completeKeywordShadowRun(db: DbClient, scope: RuntimeContextIdentity & { runId: string },
  opts: { now?: () => Date; idGen?: () => string } = {}): Promise<RunResult> {
  await assertRuntimeContext(db, scope);
  const args = { acct: scope.accountId, generation: scope.contextGeneration ?? 0, requested_run: scope.runId };
  const commit = (packet: unknown = null) => unwrap<RunResult | null>("shadow.complete", db.rpc("commit_keyword_shadow_completion", { ...args, packet }));
  const previous = await commit();
  if (previous) return previous;
  const run = await new SupabaseStore(db).getRun(scope.runId);
  if (!run) throw new Error("Original keyword run unavailable");
  assertSameRuntimeContext(scope, run);
  const permit = await unwrap<Row | null>("shadow.complete.permit", db.from("n8n_shadow_permits")
    .select("result,status,spec").eq("run_id", scope.runId).eq("account_id", scope.accountId)
    .eq("context_generation", scope.contextGeneration ?? 0).maybeSingle());
  const result = object(permit?.result), artifact = object(result?.artifact), meta = object(artifact?.meta), receipt = object(meta?.executionReceipt);
  if (permit?.status !== "verified" || result?.kind !== "artifact" || !receipt || receipt.revisionEvidence !== "verified_execution_record")
    throw new Error("Verified keyword result unavailable");
  const validated = shadowCandidate(artifact, receipt).artifact;
  // Restore only the trusted ledger's machine receipt/no-action markers. SQL checks
  // the exact draft against that immutable ledger again under the commit locks.
  validated.meta = { executionReceipt: receipt, approval_status: "pending_approval", executed_action: "none" };
  const packet = await planKeywordShadowCompletion(run, validated, opts);
  try {
    const committed = await commit(packet);
    if (!committed) throw new Error("Keyword completion was not persisted");
  } catch (error) {
    const after = await commit();
    if (after) return after;
    throw error;
  }
  const readback = await commit();
  if (!readback) throw new Error("Keyword completion readback failed; reconcile without redispatch");
  return readback;
}
