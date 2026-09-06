/** Server-only Content admission. RPCs are defined in
 * supabase/migrations/20260906030000_content_shadow_admission.sql.
 * FakeSupabase tests remain simulated; real SQL is scripts/verify-content-shadow-admission.mjs. */
import { isDeepStrictEqual } from "node:util";
import { unwrap, type DbClient, type Row } from "../db/types";
import type { RunOptions } from "../runtime/engine";
import type { RunRecord } from "../runtime/store/interface";
import type { ShadowAdmission } from "./shadowAdmission";
import { contentShadowSchema, CONTENT_MARKETS, CONTENT_ROUTINES, CONTENT_SEED, type ContentRoutineId,
  type ContentShadowContract } from "./contentShadowContract";
import { contentShadowSpec } from "./contentShadowSpec";
import { AVGAR_PILOT_ACCOUNT } from "./shadowContract";

export interface ContentScope { accountId: string; contextGeneration: number; runId: string }
export interface ContentApproval {
  authorizedBy: string; approvalReference: string; idempotencyKey: string;
  contextGeneration: number; market: keyof typeof CONTENT_MARKETS; routineId: ContentRoutineId;
  maxProviderCalls: 1; expiresAt: string;
}
export interface ContentCommandBinding { id: string; workflowJson: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function contentScope(scope: ContentScope): ContentScope {
  if (!uuid.test(scope.accountId) || !uuid.test(scope.runId) || !Number.isSafeInteger(scope.contextGeneration) || scope.contextGeneration < 0)
    throw new Error("Original content account, generation and run required");
  return Object.freeze({ accountId: scope.accountId, contextGeneration: scope.contextGeneration, runId: scope.runId });
}
export function contentContractForRun(run: RunRecord): ContentShadowContract {
  const node = run.snapshot?.spec.nodes.find(n => n.kind === "n8n");
  const contract = contentShadowSchema.parse(node?.kind === "n8n" ? node.shadowContract : null);
  if (contract.accountId !== run.accountId || run.accountId !== AVGAR_PILOT_ACCOUNT || run.mode !== "dry_run"
    || (run.routineId !== "D01-W02" && run.routineId !== "D01-W03") || run.routineId !== contract.routineId
    || !isDeepStrictEqual(run.snapshot!.spec, contentShadowSpec(contract, run.version)))
    throw new Error("Original content run specification changed");
  return contract;
}
export class DbContentShadowAdmission implements ShadowAdmission {
  readonly scope: ContentScope;
  constructor(private readonly db: DbClient, scope: ContentScope) { this.scope = contentScope(scope); }
  private transition(operation: string, fields: Row) {
    return unwrap<unknown>("content." + operation, this.db.rpc("transition_content_shadow", { input: { ...fields, ...this.scope, operation } }));
  }
  private identity(input: Parameters<ShadowAdmission["claim"]>[0] | Parameters<ShadowAdmission["authorize"]>[0]) {
    if (!isDeepStrictEqual(contentScope(input), this.scope) || input.contract.contract !== "unc.content-search-shadow.v1"
      || input.contract.accountId !== this.scope.accountId)
      throw new Error("Content admission cannot cross its original scope or protocol");
  }
  async claim(input: Parameters<ShadowAdmission["claim"]>[0]): Promise<string> {
    this.identity(input);
    const id = await this.transition("dispatch", { ...input });
    if (typeof id !== "string" || !uuid.test(id)) throw new Error("Content dispatch already claimed or unavailable; reconcile without redispatch");
    return id;
  }
  async authorize(input: Parameters<ShadowAdmission["authorize"]>[0]): Promise<boolean> {
    this.identity(input); return await this.transition("authorize", { ...input }) === true;
  }
  async observe(permitId: string, executionId: string, candidate: Parameters<ShadowAdmission["observe"]>[2]): Promise<void> {
    if (!uuid.test(permitId) || await this.transition("checkpoint", { permitId, executionId, candidate }) !== true)
      throw new Error("Content checkpoint unavailable; preserve original execution and do not retry provider");
  }
  async finish(permitId: string, outcome: Parameters<ShadowAdmission["finish"]>[1], executionId?: string, result?: Parameters<ShadowAdmission["finish"]>[3]): Promise<void> {
    if (!uuid.test(permitId) || await this.transition("finish", { permitId, outcome, executionId: executionId ?? null, result: result ?? null }) !== true)
      throw new Error("Content outcome uncertain; reconcile original ledger without redispatch");
  }
}
export class ContentAlreadyIssued extends Error {
  constructor(readonly original: { runId: string; permitId: string }) { super("Content allowance already issued; reconcile the original run without redispatch"); }
}
export function contentPilotContract(approval: ContentApproval, now: Date): ContentShadowContract {
  if (!uuid.test(approval.authorizedBy) || !Number.isSafeInteger(approval.contextGeneration) || approval.contextGeneration < 0
    || !Object.hasOwn(CONTENT_MARKETS, approval.market) || approval.maxProviderCalls !== 1
    || !CONTENT_ROUTINES[approval.routineId]
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(approval.approvalReference)
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(approval.idempotencyKey))
    throw new Error("An explicit owned, single-market, single-call content approval is required");
  const expiry = Date.parse(approval.expiresAt), clock = now.getTime();
  if (!Number.isFinite(expiry) || !Number.isFinite(clock) || expiry <= clock || expiry > clock + 600_000)
    throw new Error("Pilot approval must expire within ten minutes");
  const lane = CONTENT_ROUTINES[approval.routineId];
  return { contract: "unc.content-search-shadow.v1", accountId: AVGAR_PILOT_ACCOUNT,
    workflowId: "lMXjTgd3Qh4vZaMp", workflowVersion: "c8d6955d-0033-47ce-9672-399f7f10118c",
    routineId: approval.routineId, routineKey: lane.routineKey,
    client: { id: "avgar", primaryDomain: "avgarsport.com", seedKeyword: CONTENT_SEED,
      locationCode: CONTENT_MARKETS[approval.market], languageCode: "en" } };
}
export function contentReservation(db: DbClient, approval: ContentApproval,
  now: () => Date = () => new Date(), command?: ContentCommandBinding): NonNullable<RunOptions["reserveContentShadowRun"]> {
  const captured = structuredClone(approval);
  command = command ? Object.freeze({ ...command }) : undefined;
  return async run => {
    const contract = contentContractForRun(run);
    if (contract.routineId !== captured.routineId || contract.client.locationCode !== CONTENT_MARKETS[captured.market])
      throw new Error("Content reservation contract mismatch");
    const expiry = Date.parse(captured.expiresAt), clock = now().getTime();
    if (!uuid.test(captured.authorizedBy) || captured.contextGeneration !== run.contextGeneration || captured.maxProviderCalls !== 1
      || !Number.isFinite(expiry) || !Number.isFinite(clock) || expiry <= clock || expiry > clock + 600_000
      || ![captured.approvalReference, captured.idempotencyKey].every(s => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(s)))
      throw new Error("Explicit current owner content allowance required");
    const issued = await unwrap<{ created: boolean; runId: string; permitId: string }>("content.issue",
      db.rpc("issue_content_shadow_run", { input: { run, approval: captured, ...(command ? { commandId: command.id, commandWorkflowJson: command.workflowJson } : {}) } }));
    if (!issued || typeof issued.created !== "boolean" || !uuid.test(issued.runId) || !uuid.test(issued.permitId))
      throw new Error("Content issuance response uncertain; inspect original key before dispatch");
    if (!issued.created) throw new ContentAlreadyIssued(issued);
    if (issued.runId !== run.id) throw new Error("Content issuance run mismatch; do not dispatch");
    return structuredClone(run);
  };
}
export function contentStartClaim(db: DbClient): NonNullable<RunOptions["claimContentShadowStart"]> {
  return async run => {
    contentContractForRun(run);
    return await unwrap<boolean>("content.start", db.rpc("transition_content_shadow", {
      input: { accountId: run.accountId, contextGeneration: run.contextGeneration, runId: run.id, operation: "start", run },
    })) === true;
  };
}
