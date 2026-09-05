/** Server/operator-only first-pilot entry. This module is intentionally not imported by
 * any browser route, model tool, channel handler or scheduler. No approval is inferred. */
import { unwrap, type DbClient } from "../lib/db/types";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { SupabaseStore } from "../lib/runtime/store/supabase";
import { runRoutine, type RunOptions } from "../lib/runtime/engine";
import { keywordShadowSpec } from "../lib/n8n/keywordShadowSpec";
import { AVGAR_PILOT_ACCOUNT, KEYWORD_SHADOW_RECEIVER_URL, type KeywordShadowContract } from "../lib/n8n/shadowContract";
import { DbAccountsSource } from "./accounts";
import { buildAdapters, type ServiceDeps } from "./service";
import { createShadowExecutionReader } from "./providers/n8nExecutionReader";

export const KEYWORD_PILOT_PIN = Object.freeze({ workflowId: "XiXJKuph1fAeH9pe",
  workflowVersion: "1bce8c54-637e-4770-af90-2da36f38369a",
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
const captureApproval = (a: KeywordPilotApproval): KeywordPilotApproval => ({ authorizedBy: a.authorizedBy,
  approvalReference: a.approvalReference, idempotencyKey: a.idempotencyKey, market: a.market,
  contextGeneration: a.contextGeneration, maxProviderCalls: a.maxProviderCalls, expiresAt: a.expiresAt });
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
  now: () => Date = () => new Date()): NonNullable<RunOptions["reserveKeywordShadowRun"]> {
  const captured = captureApproval(approval);
  return async run => {
    const contract = keywordPilotContract(captured, now());
    if (run.accountId !== AVGAR_PILOT_ACCOUNT || run.contextGeneration !== captured.contextGeneration ||
        run.snapshot?.spec.nodes.find(n => n.kind === "n8n")?.kind !== "n8n")
      throw new Error("Pilot reservation context mismatch");
    const node = run.snapshot.spec.nodes.find(n => n.kind === "n8n");
    if (!node || node.kind !== "n8n" || JSON.stringify(node.shadowContract) !== JSON.stringify(contract))
      throw new Error("Pilot reservation contract mismatch");
    if (JSON.stringify(run.snapshot.spec) !== JSON.stringify(keywordShadowSpec(contract, 2)))
      throw new Error("Pilot reservation must retain the reviewed keyword specification");
    const issued = await unwrap<Issuance>("shadow.issue", db.rpc("issue_keyword_shadow_pilot", {
      input: { run, contract, receiverUrl: KEYWORD_PILOT_PIN.receiverUrl, approval: captured },
    }));
    if (!issued || !uuid.test(issued.runId) || !uuid.test(issued.permitId) || !uuid.test(issued.registrationId) || typeof issued.created !== "boolean")
      throw new Error("Pilot issuance response uncertain; inspect the approved key before doing anything else");
    if (!issued.created) throw new KeywordPilotAlreadyIssued(issued);
    if (issued.runId !== run.id) throw new Error("Pilot issuance run mismatch; do not dispatch");
    return structuredClone(run);
  };
}

/** For an explicitly approved operator run AFTER release and saved-execution API proof.
 * Configuration validation below is necessary, not proof that the API key works. */
export async function runKeywordShadowPilot(deps: ServiceDeps & { db: DbClient }, approval: KeywordPilotApproval) {
  const env = process.env;
  const now = deps.now ?? (() => new Date()), captured = captureApproval(approval);
  const contract = keywordPilotContract(captured, now());
  const receiver = env.N8N_SHADOW_RECEIVER_TOKEN ?? "", signing = env.N8N_SIGNING_SECRET ?? "";
  if (env.N8N_SHADOW_RECEIVER_URL !== KEYWORD_PILOT_PIN.receiverUrl || env.N8N_DATA_BASE_URL !== "https://junction-unc.vercel.app" ||
      !signing.trim() || receiver.trim() !== receiver || receiver.length < 24 || /\s/.test(receiver) || receiver === signing ||
      !createShadowExecutionReader(env, contract.workflowId)) throw new Error("Pilot server access configuration is not ready");
  const account = await new DbAccountsSource(deps.db).getAccount(AVGAR_PILOT_ACCOUNT);
  if (!account || account.automationPaused || account.account.contextGeneration !== captured.contextGeneration ||
      !["avgarsport.com", "https://avgarsport.com", "https://avgarsport.com/"].includes(String(account.vars?.website)))
    throw new Error("Current unpaused AVGAR context is required");
  await assertRuntimeContext(deps.db, account.account);
  // Explicit snapshot, not a promoted spec: no routine switch, scheduler, live spec,
  // ordinary account settings or credentials are changed by this entry point.
  const spec = keywordShadowSpec(contract, 2);
  const adapters = buildAdapters({ ...deps, store: new SupabaseStore(deps.db) });
  return runRoutine(spec, { account: account.account, vars: account.vars, triggeredBy: "manual" }, adapters, {
    mode: "dry_run", reserveKeywordShadowRun: keywordPilotReservation(deps.db, captured, now),
  });
}
