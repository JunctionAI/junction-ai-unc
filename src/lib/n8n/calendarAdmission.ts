/** Server-only calendar admission. Bind each instance to one tenant/generation/run;
 * checkpoint/finalization must never rely on a permit UUID alone. */
import { isDeepStrictEqual } from "node:util";
import { unwrap, type DbClient, type Row } from "../db/types";
import type { RunOptions } from "../runtime/engine";
import type { RunRecord } from "../runtime/store/interface";
import type { ShadowAdmission } from "./shadowAdmission";
import { calendarShadowSchema } from "./calendarShadowContract";
import { stableHash } from "../runtime/context";

export interface CalendarScope { accountId: string; contextGeneration: number; runId: string }
export interface CalendarApproval {
  authorizedBy: string; approvalReference: string; idempotencyKey: string;
  contextGeneration: number; maxDispatches: 1; expiresAt: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function calendarScope(scope: CalendarScope): CalendarScope {
  if (!uuid.test(scope.accountId) || !uuid.test(scope.runId) || !Number.isSafeInteger(scope.contextGeneration) || scope.contextGeneration < 0)
    throw new Error("Original calendar account, generation and run required");
  return Object.freeze({ accountId: scope.accountId, contextGeneration: scope.contextGeneration, runId: scope.runId });
}
export function calendarContractForRun(run: RunRecord) {
  const node = run.snapshot?.spec.nodes[1];
  const contract = calendarShadowSchema.parse(node?.kind === "n8n" ? node.shadowContract : null);
  if (contract.accountId !== run.accountId || run.routineId !== "D05-W07" || run.mode !== "dry_run" ||
      run.specHash !== stableHash(run.snapshot!.spec)) throw new Error("Original calendar run specification changed");
  return contract;
}
export class DbCalendarShadowAdmission implements ShadowAdmission {
  readonly scope: CalendarScope;
  constructor(private readonly db: DbClient, scope: CalendarScope) { this.scope = calendarScope(scope); }
  private transition(operation: string, fields: Row) {
    return unwrap<unknown>("calendar." + operation, this.db.rpc("transition_calendar_shadow", { input: { ...fields, ...this.scope, operation } }));
  }
  private identity(input: Parameters<ShadowAdmission["claim"]>[0] | Parameters<ShadowAdmission["authorize"]>[0]) {
    if (!isDeepStrictEqual(calendarScope(input), this.scope) || input.contract.contract !== "unc.campaign-calendar-shadow.v1" || input.contract.accountId !== this.scope.accountId)
      throw new Error("Calendar admission cannot cross its original scope or protocol");
  }
  async claim(input: Parameters<ShadowAdmission["claim"]>[0]): Promise<string> {
    this.identity(input);
    const id = await this.transition("dispatch", { ...input });
    if (typeof id !== "string" || !uuid.test(id)) throw new Error("Calendar dispatch already claimed or unavailable; reconcile without redispatch");
    return id;
  }
  async authorize(input: Parameters<ShadowAdmission["authorize"]>[0]): Promise<boolean> {
    this.identity(input); return await this.transition("authorize", { ...input }) === true;
  }
  async observe(permitId: string, executionId: string, candidate: Parameters<ShadowAdmission["observe"]>[2]): Promise<void> {
    if (!uuid.test(permitId) || await this.transition("checkpoint", { permitId, executionId, candidate }) !== true)
      throw new Error("Calendar checkpoint unavailable; preserve original execution and do not retry provider");
  }
  async finish(permitId: string, outcome: Parameters<ShadowAdmission["finish"]>[1], executionId?: string, result?: Parameters<ShadowAdmission["finish"]>[3]): Promise<void> {
    if (!uuid.test(permitId) || await this.transition("finish", { permitId, outcome, executionId: executionId ?? null, result: result ?? null }) !== true)
      throw new Error("Calendar outcome uncertain; reconcile original ledger without redispatch");
  }
}
export class CalendarAlreadyIssued extends Error {
  constructor(readonly original: { runId: string; permitId: string }) { super("Calendar allowance already issued; reconcile the original run without redispatch"); }
}
export function calendarReservation(db: DbClient, approval: CalendarApproval,
  now: () => Date = () => new Date()): NonNullable<RunOptions["reserveCalendarShadowRun"]> {
  const captured = structuredClone(approval);
  return async run => {
    calendarContractForRun(run);
    const expiry = Date.parse(captured.expiresAt), clock = now().getTime();
    if (!uuid.test(captured.authorizedBy) || captured.contextGeneration !== run.contextGeneration || captured.maxDispatches !== 1 ||
        !Number.isFinite(expiry) || !Number.isFinite(clock) || expiry <= clock || expiry > clock + 600000 ||
        ![captured.approvalReference, captured.idempotencyKey].every(s => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(s)))
      throw new Error("Explicit current owner calendar allowance required");
    const issued = await unwrap<{ created: boolean; runId: string; permitId: string }>("calendar.issue", db.rpc("issue_calendar_shadow_run", { input: { run, approval: captured } }));
    if (!issued || typeof issued.created !== "boolean" || !uuid.test(issued.runId) || !uuid.test(issued.permitId))
      throw new Error("Calendar issuance response uncertain; inspect original key before dispatch");
    if (!issued.created) throw new CalendarAlreadyIssued(issued);
    if (issued.runId !== run.id) throw new Error("Calendar issuance run mismatch; do not dispatch");
    return structuredClone(run);
  };
}
export function calendarStartClaim(db: DbClient): NonNullable<RunOptions["claimCalendarShadowStart"]> {
  return async run => {
    calendarContractForRun(run);
    const scope = calendarScope({ accountId: run.accountId, contextGeneration: run.contextGeneration ?? 0, runId: run.id });
    return await unwrap<unknown>("calendar.start", db.rpc("transition_calendar_shadow", { input: { ...scope, operation: "start", run } })) === true;
  };
}
