/** Shared server-only admission primitives. Customer callers use the command-bound RPCs; operator callers retain their original protocol. */
import { unwrap, type DbClient } from "../db/types";
import type { RunOptions } from "../runtime/engine";
import type { RunRecord } from "../runtime/store/interface";
import { isDeepStrictEqual } from "node:util";
import { keywordShadowSpec } from "./keywordShadowSpec";
import { AVGAR_PILOT_ACCOUNT, KEYWORD_SHADOW_RECEIVER_URL, type KeywordShadowContract } from "./shadowContract";

export const KEYWORD_PILOT_PIN = Object.freeze({ workflowId: "XiXJKuph1fAeH9pe",
  workflowVersion: "ac771cd3-8899-4401-915c-40d4477e48e2",
  receiverUrl: KEYWORD_SHADOW_RECEIVER_URL });
export const KEYWORD_PILOT_MARKETS = Object.freeze({ US: 2840, NZ: 2554, AU: 2036 });
export interface KeywordPilotApproval {
  /** Existing owner identity and explicit approval reference/key; never model-generated. */
  authorizedBy: string;
  approvalReference: string;
  idempotencyKey: string;
  market: keyof typeof KEYWORD_PILOT_MARKETS;
  contextGeneration: number;
  /** One DataForSEO task admission, not a monetary cap or permission for ad spend. */
  maxProviderCalls: 1;
  expiresAt: string;
}
interface Issuance { created: boolean; runId: string; permitId: string; registrationId: string }
export class KeywordPilotAlreadyIssued extends Error {
  constructor(readonly original: Issuance) {
    super("This keyword allowance was already issued; inspect/reconcile its original run, never redispatch");
  }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const captureApproval = (a: KeywordPilotApproval): KeywordPilotApproval => ({ authorizedBy: a.authorizedBy,
  approvalReference: a.approvalReference, idempotencyKey: a.idempotencyKey, market: a.market,
  contextGeneration: a.contextGeneration, maxProviderCalls: a.maxProviderCalls, expiresAt: a.expiresAt });
export interface KeywordCommandBinding { id: string; workflowJson: string }
function commandEnvelope(run: RunRecord, command?: KeywordCommandBinding) {
  if (!command) return {};
  if (!uuid.test(command.id) || run.id !== command.id || command.workflowJson.length > 4096)
    throw new Error("Command allowance must use its original run and workflow");
  return { commandId: command.id, commandSpecJson: JSON.stringify(run.snapshot?.spec), commandWorkflowJson: command.workflowJson };
}
export function keywordPilotContract(approval: KeywordPilotApproval, now: Date): KeywordShadowContract {
  if (!uuid.test(approval.authorizedBy) || !Number.isSafeInteger(approval.contextGeneration) || approval.contextGeneration < 0 ||
      !Object.hasOwn(KEYWORD_PILOT_MARKETS, approval.market) || approval.maxProviderCalls !== 1 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(approval.approvalReference) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(approval.idempotencyKey))
    throw new Error("An explicit owned, single-market, single-call pilot approval is required");
  const expiry = Date.parse(approval.expiresAt), clock = now.getTime();
  if (!Number.isFinite(expiry) || !Number.isFinite(clock) || expiry <= clock || expiry > clock + 600_000)
    throw new Error("Pilot approval must expire within ten minutes");
  return { contract: "unc.keyword-shadow.v1", accountId: AVGAR_PILOT_ACCOUNT,
    workflowId: KEYWORD_PILOT_PIN.workflowId, workflowVersion: KEYWORD_PILOT_PIN.workflowVersion,
    routineId: "D03-W01", routineKey: "keyword_opportunity", client: { id: "avgar", primaryDomain: "avgarsport.com",
      seedKeyword: "golf travel bag", locationCode: KEYWORD_PILOT_MARKETS[approval.market], languageCode: "en" } };
}

/** Only a newly committed transaction may begin engine work. A duplicate returns its
 * original IDs; even a still-reserved permit is not silently resumed after a lost reply. */
export function keywordPilotReservation(db: DbClient, approval: KeywordPilotApproval,
  now: () => Date = () => new Date(), command?: KeywordCommandBinding): NonNullable<RunOptions["reserveKeywordShadowRun"]> {
  const captured = captureApproval(approval);
  command = command ? Object.freeze({ ...command }) : undefined;
  return async run => {
    const contract = keywordPilotContract(captured, now());
    const binding = commandEnvelope(run, command);
    if (run.accountId !== AVGAR_PILOT_ACCOUNT || run.contextGeneration !== captured.contextGeneration ||
        run.snapshot?.spec.nodes.find(n => n.kind === "n8n")?.kind !== "n8n")
      throw new Error("Pilot reservation context mismatch");
    const node = run.snapshot.spec.nodes.find(n => n.kind === "n8n");
    if (!node || node.kind !== "n8n" || !isDeepStrictEqual(node.shadowContract, contract))
      throw new Error("Pilot reservation contract mismatch");
    if (!isDeepStrictEqual(run.snapshot.spec, keywordShadowSpec(contract, 2)))
      throw new Error("Pilot reservation must retain the reviewed keyword specification");
    const issued = await unwrap<Issuance>("shadow.issue", db.rpc(command ? "issue_keyword_shadow_command" : "issue_keyword_shadow_pilot", {
      input: { run, contract, receiverUrl: KEYWORD_PILOT_PIN.receiverUrl, approval: captured, ...binding },
    }));
    if (!issued || !uuid.test(issued.runId) || !uuid.test(issued.permitId) || !uuid.test(issued.registrationId) || typeof issued.created !== "boolean")
      throw new Error("Pilot issuance response uncertain; inspect the approved key before doing anything else");
    if (!issued.created) throw new KeywordPilotAlreadyIssued(issued);
    if (issued.runId !== run.id) throw new Error("Pilot issuance run mismatch; do not dispatch");
    return structuredClone(run);
  };
}

/** The RPC compares and claims the exact original snapshot, not merely its run ID. */
export function keywordPilotStartClaim(db: DbClient, command?: KeywordCommandBinding): NonNullable<RunOptions["claimKeywordShadowStart"]> {
  command = command ? Object.freeze({ ...command }) : undefined;
  return async run => {
    const node = run.snapshot?.spec.nodes.find(n => n.kind === "n8n");
    if (!node || node.kind !== "n8n" || !node.shadowContract || node.shadowContract.contract !== "unc.keyword-shadow.v1" || run.accountId !== AVGAR_PILOT_ACCOUNT ||
        !isDeepStrictEqual(run.snapshot!.spec, keywordShadowSpec(node.shadowContract, 2)))
      throw new Error("Original reviewed keyword start specification required");
    return await unwrap<boolean>("shadow.start", db.rpc(command ? "claim_keyword_shadow_command_start" : "claim_keyword_shadow_start", { input: { run, ...commandEnvelope(run, command) } })) === true;
  };
}
