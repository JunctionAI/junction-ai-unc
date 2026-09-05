/** Re-read the named saved execution only. No provider POST, new allowance or projection. */
import { isDeepStrictEqual } from "node:util";
import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { calendarScope, calendarContractForRun, DbCalendarShadowAdmission, type CalendarScope } from "../lib/n8n/calendarAdmission";
import type { RunRecord } from "../lib/runtime/store/interface";
import { verifyHistoricalCalendarShadowExecution } from "../lib/n8n/calendarShadowContract";
import { protocolCandidate } from "../lib/n8n/shadowProtocols";
import { verifiedShadowResult, type ShadowCandidate } from "../lib/n8n/shadowCandidate";
import { createShadowExecutionReader, type ShadowExecutionReader } from "./providers/n8nExecutionReader";

export async function reconcileCalendarShadowArchive(input: CalendarScope & { permitId: string }, deps: {
  db: DbClient; env: Record<string, string | undefined>; now?: () => Date; readExecution?: ShadowExecutionReader;
}) {
  const scope = calendarScope(input);
  const readLedger = () => unwrap<Row | null>("calendar.recovery.ledger", deps.db.from("n8n_calendar_runs")
    .select("id,account_id,context_generation,run_id,initial_run,state,request_digest,execution_id,dispatched_at,authorized_at,candidate,verified_result")
    .eq("id", input.permitId).eq("account_id", scope.accountId).eq("context_generation", scope.contextGeneration).eq("run_id", scope.runId).maybeSingle());
  const ledger = await readLedger();
  if (!ledger || ledger.account_id !== scope.accountId || ledger.run_id !== scope.runId || ledger.context_generation !== scope.contextGeneration)
    throw new Error("Original scoped calendar ledger unavailable");
  const run = ledger.initial_run as RunRecord, contract = calendarContractForRun(run);
  if (run.id !== scope.runId || run.accountId !== scope.accountId || run.contextGeneration !== scope.contextGeneration ||
      typeof ledger.execution_id !== "string" || !/^[1-9]\d{0,29}$/.test(ledger.execution_id) ||
      typeof ledger.request_digest !== "string" || !/^[a-f0-9]{64}$/.test(ledger.request_digest) ||
      typeof ledger.dispatched_at !== "string" || typeof ledger.authorized_at !== "string")
    throw new Error("Named originally authorized calendar execution unavailable; never redispatch");
  const candidate = ledger.candidate as ShadowCandidate | null;
  if (!candidate || candidate.executionReceipt.executionId !== ledger.execution_id)
    throw new Error("Original calendar result checkpoint unavailable; never redispatch");
  const identity = { accountId: scope.accountId, runId: scope.runId, routineId: run.routineId, mode: run.mode, startedAt: run.startedAt };
  const clean = protocolCandidate(candidate.artifact, candidate.executionReceipt, contract, identity, candidate.resultDigest);
  if (!isDeepStrictEqual(clean, candidate)) throw new Error("Calendar checkpoint is not canonical");
  const matches = (row: Row | null) => {
    const result = row?.verified_result as ReturnType<typeof verifiedShadowResult> | undefined;
    const receipt = result?.artifact.meta?.executionReceipt as Row | undefined;
    return ["verified", "completed"].includes(String(row?.state)) && result?.kind === "artifact" &&
      receipt?.revisionEvidence === "verified_execution_record" && receipt.accountId === scope.accountId && receipt.runId === scope.runId &&
      receipt.executionId === ledger.execution_id && receipt.workflowId === contract.workflowId && receipt.workflowVersion === contract.workflowVersion &&
      (receipt.revisionVerification as Row)?.requestDigest === ledger.request_digest && (receipt.revisionVerification as Row)?.resultDigest === candidate.resultDigest &&
      isDeepStrictEqual(result, verifiedShadowResult(candidate, receipt));
  };
  const outcome = (alreadyVerified: boolean) => ({ status: "verified_archive" as const, ...scope, executionId: ledger.execution_id,
    alreadyVerified, projected: false as const, providerDispatches: 0 as const });
  if (matches(ledger)) return outcome(true);
  if (!["uncertain", "verifying"].includes(String(ledger.state))) throw new Error("Calendar ledger cannot be reconciled in this state");
  const read = deps.readExecution ?? createShadowExecutionReader(deps.env, contract.workflowId, { protocol: "calendar" });
  if (!read) throw new Error("Independent calendar execution reader unavailable");
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let observation: unknown;
  try { observation = await Promise.race([read({ workflowId: contract.workflowId, executionId: ledger.execution_id, signal: controller.signal }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Calendar execution read timed out")); }, 10000); })]); }
  finally { clearTimeout(timer); }
  const verified = verifyHistoricalCalendarShadowExecution(candidate.executionReceipt, observation, contract, identity,
    (deps.now ?? (() => new Date()))(), ledger.request_digest, candidate.resultDigest!, { dispatchedAt: ledger.dispatched_at, authorizedAt: ledger.authorized_at });
  try { await new DbCalendarShadowAdmission(deps.db, scope).finish(input.permitId, "verified", ledger.execution_id, verifiedShadowResult(candidate, verified)); }
  catch { if (matches(await readLedger())) return outcome(true); throw new Error("Calendar archive not recorded; reconcile storage without redispatch"); }
  if (!matches(await readLedger())) throw new Error("Calendar archive readback unavailable; never redispatch");
  return outcome(false);
}
