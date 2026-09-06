/** Normal and recovered paid-ads runs project the same immutable verified ledger result.
 * Requires the paid ledger RPC `commit_paid_shadow_completion` and table `n8n_paid_runs`
 * (not yet migrated — see docs/PAID-SHADOW-INTEGRATION.md); absent, every call fails closed. */
import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { planPaidShadowCompletion } from "../lib/runtime/engine";
import { SupabaseStore } from "../lib/runtime/store/supabase";
import { assertSameRuntimeContext } from "../lib/runtime/contextFence";
import type { ArtifactDraft, RunResult } from "../lib/runtime/types";
import { paidContractForRun, paidScope, type PaidScope } from "../lib/n8n/paidAdmission";
import { paidShadowArtifact } from "../lib/n8n/paidShadowContract";

export async function completePaidShadowRun(db: DbClient, input: PaidScope,
  opts: { now?: () => Date; idGen?: () => string } = {}): Promise<RunResult> {
  const scope = paidScope(input);
  await assertRuntimeContext(db, scope);
  const commit = (packet: unknown = null) => unwrap<RunResult | null>("paid.complete", db.rpc("commit_paid_shadow_completion",
    { acct: scope.accountId, generation: scope.contextGeneration, requested_run: scope.runId, packet }));
  const previous = await commit(); if (previous) return previous;
  const run = await new SupabaseStore(db).getRun(scope.runId);
  if (!run) throw new Error("Original paid-ads run unavailable");
  assertSameRuntimeContext(scope, run);
  const contract = paidContractForRun(run);
  const ledger = await unwrap<Row | null>("paid.complete.ledger", db.from("n8n_paid_runs").select("state,verified_result")
    .eq("account_id", scope.accountId).eq("context_generation", scope.contextGeneration).eq("run_id", scope.runId).maybeSingle());
  const result = ledger?.verified_result as { kind?: string; artifact?: ArtifactDraft } | null;
  const artifact = result?.artifact;
  if (ledger?.state !== "verified" || result?.kind !== "artifact" || !artifact ||
      (artifact.meta?.executionReceipt as Row | undefined)?.revisionEvidence !== "verified_execution_record")
    throw new Error("Verified paid-ads ledger result unavailable");
  // Revalidate the business fields (cap arithmetic, no executed change) against the pinned contract.
  paidShadowArtifact(artifact, contract, { accountId: scope.accountId, runId: scope.runId, routineId: run.routineId, mode: run.mode, startedAt: run.startedAt });
  const packet = await planPaidShadowCompletion(run, artifact, opts);
  try { if (!await commit(packet)) throw new Error("Paid-ads completion was not persisted"); }
  catch (error) { const after = await commit(); if (after) return after; throw error; }
  const saved = await commit();
  if (!saved) throw new Error("Paid-ads completion readback unavailable; reconcile without redispatch");
  return saved;
}
