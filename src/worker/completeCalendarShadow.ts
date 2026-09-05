/** Normal and recovered calendars project the same immutable verified ledger result. */
import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { planCalendarShadowCompletion } from "../lib/runtime/engine";
import { SupabaseStore } from "../lib/runtime/store/supabase";
import { assertSameRuntimeContext } from "../lib/runtime/contextFence";
import type { ArtifactDraft, RunResult } from "../lib/runtime/types";
import { calendarContractForRun, calendarScope, type CalendarScope } from "../lib/n8n/calendarAdmission";
import { calendarShadowArtifact } from "../lib/n8n/calendarShadowContract";

export async function completeCalendarShadowRun(db: DbClient, input: CalendarScope,
  opts: { now?: () => Date; idGen?: () => string } = {}): Promise<RunResult> {
  const scope = calendarScope(input);
  await assertRuntimeContext(db, scope);
  const commit = (packet: unknown = null) => unwrap<RunResult | null>("calendar.complete", db.rpc("commit_calendar_shadow_completion",
    { acct: scope.accountId, generation: scope.contextGeneration, requested_run: scope.runId, packet }));
  const previous = await commit(); if (previous) return previous;
  const run = await new SupabaseStore(db).getRun(scope.runId);
  if (!run) throw new Error("Original calendar run unavailable");
  assertSameRuntimeContext(scope, run);
  const contract = calendarContractForRun(run);
  const ledger = await unwrap<Row | null>("calendar.complete.ledger", db.from("n8n_calendar_runs").select("state,verified_result")
    .eq("account_id", scope.accountId).eq("context_generation", scope.contextGeneration).eq("run_id", scope.runId).maybeSingle());
  const result = ledger?.verified_result as { kind?: string; artifact?: ArtifactDraft } | null;
  const artifact = result?.artifact;
  if (ledger?.state !== "verified" || result?.kind !== "artifact" || !artifact ||
      (artifact.meta?.executionReceipt as Row | undefined)?.revisionEvidence !== "verified_execution_record")
    throw new Error("Verified calendar ledger result unavailable");
  // Revalidate business fields against the ORIGINAL start date, not today's calendar.
  calendarShadowArtifact(artifact, contract, { accountId: scope.accountId, runId: scope.runId, routineId: run.routineId, mode: run.mode, startedAt: run.startedAt });
  const packet = await planCalendarShadowCompletion(run, artifact, opts);
  try { if (!await commit(packet)) throw new Error("Calendar completion was not persisted"); }
  catch (error) { const after = await commit(); if (after) return after; throw error; }
  const saved = await commit();
  if (!saved) throw new Error("Calendar completion readback unavailable; reconcile without redispatch");
  return saved;
}
