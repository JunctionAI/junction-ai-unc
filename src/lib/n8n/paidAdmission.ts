/** Server-only paid-ads admission. Mirrors the calendar ledger's operation vocabulary against
 * its own RPCs (`issue_paid_shadow_run`, `transition_paid_shadow`, `commit_paid_shadow_completion`).
 * Those functions are NOT in this branch's migrations: until the paid ledger migration is
 * reviewed and applied, every call fails closed at the database, which is the intended
 * behaviour for an unreleased lane. Bind each instance to one tenant/generation/run. */
import { isDeepStrictEqual } from "node:util";
import { unwrap, type DbClient, type Row } from "../db/types";
import type { RunOptions } from "../runtime/engine";
import type { RunRecord } from "../runtime/store/interface";
import type { ShadowAdmission } from "./shadowAdmission";
import { paidShadowSchema, paidShadowReceiver, PAID_SHADOW_CONTRACT, type PaidLane, type PaidShadowContract } from "./paidShadowContract";
import { paidShadowSpec } from "./paidShadowSpec";
import { stableHash } from "../runtime/context";

export interface PaidScope { accountId: string; contextGeneration: number; runId: string }
export interface PaidApproval {
  authorizedBy: string; approvalReference: string; idempotencyKey: string;
  contextGeneration: number; lane: PaidLane; maxDispatches: 1; expiresAt: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function paidScope(scope: PaidScope): PaidScope {
  if (!uuid.test(scope.accountId) || !uuid.test(scope.runId) || !Number.isSafeInteger(scope.contextGeneration) || scope.contextGeneration < 0)
    throw new Error("Original paid-ads account, generation and run required");
  return Object.freeze({ accountId: scope.accountId, contextGeneration: scope.contextGeneration, runId: scope.runId });
}
/** The stored run's own reviewed spec is the pin: no hard-coded workflow IDs in code. */
export function paidContractForRun(run: RunRecord): PaidShadowContract {
  const node = run.snapshot?.spec.nodes[1];
  const contract = paidShadowSchema.parse(node?.kind === "n8n" ? node.shadowContract : null);
  if (contract.accountId !== run.accountId || run.routineId !== contract.routineId || run.mode !== "dry_run" ||
      run.specHash !== stableHash(run.snapshot!.spec) || !isDeepStrictEqual(run.snapshot!.spec, paidShadowSpec(contract, run.version)))
    throw new Error("Original paid-ads run specification changed");
  return contract;
}
export class DbPaidShadowAdmission implements ShadowAdmission {
  readonly scope: PaidScope;
  constructor(private readonly db: DbClient, scope: PaidScope) { this.scope = paidScope(scope); }
  private transition(operation: string, fields: Row) {
    return unwrap<unknown>("paid." + operation, this.db.rpc("transition_paid_shadow", { input: { ...fields, ...this.scope, operation } }));
  }
  private identity(input: Parameters<ShadowAdmission["claim"]>[0] | Parameters<ShadowAdmission["authorize"]>[0]) {
    if (!isDeepStrictEqual(paidScope(input), this.scope) || input.contract.contract !== PAID_SHADOW_CONTRACT || input.contract.accountId !== this.scope.accountId)
      throw new Error("Paid-ads admission cannot cross its original scope or protocol");
  }
  async claim(input: Parameters<ShadowAdmission["claim"]>[0]): Promise<string> {
    this.identity(input);
    if (input.contract.contract === PAID_SHADOW_CONTRACT && input.receiverUrl !== paidShadowReceiver(input.contract))
      throw new Error("Paid-ads dispatch receiver is not this lane's pinned receiver");
    const id = await this.transition("dispatch", { ...input });
    if (typeof id !== "string" || !uuid.test(id)) throw new Error("Paid-ads dispatch already claimed or unavailable; reconcile without redispatch");
    return id;
  }
  async authorize(input: Parameters<ShadowAdmission["authorize"]>[0]): Promise<boolean> {
    this.identity(input); return await this.transition("authorize", { ...input }) === true;
  }
  async observe(permitId: string, executionId: string, candidate: Parameters<ShadowAdmission["observe"]>[2]): Promise<void> {
    if (!uuid.test(permitId) || await this.transition("checkpoint", { permitId, executionId, candidate }) !== true)
      throw new Error("Paid-ads checkpoint unavailable; preserve original execution and do not retry provider");
  }
  async finish(permitId: string, outcome: Parameters<ShadowAdmission["finish"]>[1], executionId?: string, result?: Parameters<ShadowAdmission["finish"]>[3]): Promise<void> {
    if (!uuid.test(permitId) || await this.transition("finish", { permitId, outcome, executionId: executionId ?? null, result: result ?? null }) !== true)
      throw new Error("Paid-ads outcome uncertain; reconcile original ledger without redispatch");
  }
}
export class PaidShadowAlreadyIssued extends Error {
  constructor(readonly original: { runId: string; permitId: string }) { super("Paid-ads allowance already issued; reconcile the original run without redispatch"); }
}
export function paidReservation(db: DbClient, approval: PaidApproval,
  now: () => Date = () => new Date()): NonNullable<RunOptions["reservePaidShadowRun"]> {
  const captured = structuredClone(approval);
  return async run => {
    const contract = paidContractForRun(run);
    const expiry = Date.parse(captured.expiresAt), clock = now().getTime();
    if (!uuid.test(captured.authorizedBy) || captured.contextGeneration !== run.contextGeneration || captured.maxDispatches !== 1 ||
        captured.lane !== contract.lane || !Number.isFinite(expiry) || !Number.isFinite(clock) || expiry <= clock || expiry > clock + 600000 ||
        ![captured.approvalReference, captured.idempotencyKey].every(s => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(s)))
      throw new Error("Explicit current owner paid-ads allowance required");
    const issued = await unwrap<{ created: boolean; runId: string; permitId: string }>("paid.issue", db.rpc("issue_paid_shadow_run", { input: { run, approval: captured } }));
    if (!issued || typeof issued.created !== "boolean" || !uuid.test(issued.runId) || !uuid.test(issued.permitId))
      throw new Error("Paid-ads issuance response uncertain; inspect original key before dispatch");
    if (!issued.created) throw new PaidShadowAlreadyIssued(issued);
    if (issued.runId !== run.id) throw new Error("Paid-ads issuance run mismatch; do not dispatch");
    return structuredClone(run);
  };
}
export function paidStartClaim(db: DbClient): NonNullable<RunOptions["claimPaidShadowStart"]> {
  return async run => {
    paidContractForRun(run);
    const scope = paidScope({ accountId: run.accountId, contextGeneration: run.contextGeneration ?? 0, runId: run.id });
    return await unwrap<unknown>("paid.start", db.rpc("transition_paid_shadow", { input: { ...scope, operation: "start", run } })) === true;
  };
}
