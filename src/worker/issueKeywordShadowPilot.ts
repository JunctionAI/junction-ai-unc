/** Server/operator-only first-pilot entry. This module is intentionally not imported by
 * any browser route, model tool, channel handler or scheduler. No approval is inferred. */
import { type DbClient } from "../lib/db/types";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { SupabaseStore } from "../lib/runtime/store/supabase";
import { resumePreparedKeywordShadowRun, runRoutine } from "../lib/runtime/engine";
import { keywordShadowSpec } from "../lib/n8n/keywordShadowSpec";
import { AVGAR_PILOT_ACCOUNT } from "../lib/n8n/shadowContract";
import { DbAccountsSource } from "./accounts";
import { buildAdapters, type ServiceDeps } from "./service";
import { assertKeywordRuntimeAccess } from "./providers/keywordRuntime";

import { captureApproval, keywordPilotContract, keywordPilotReservation, keywordPilotStartClaim, type KeywordPilotApproval } from "../lib/n8n/keywordAdmission";
export { KEYWORD_PILOT_PIN, KEYWORD_PILOT_MARKETS, KeywordPilotAlreadyIssued, keywordPilotContract, keywordPilotReservation, keywordPilotStartClaim, type KeywordPilotApproval } from "../lib/n8n/keywordAdmission";

async function readyPilotAccount(deps: ServiceDeps & { db: DbClient }, generation: number) {
  assertKeywordRuntimeAccess();
  const account = await new DbAccountsSource(deps.db).getAccount(AVGAR_PILOT_ACCOUNT);
  if (!account || account.automationPaused || account.account.contextGeneration !== generation ||
      !["avgarsport.com", "https://avgarsport.com", "https://avgarsport.com/"].includes(String(account.vars?.website)))
    throw new Error("Current unpaused AVGAR context is required");
  await assertRuntimeContext(deps.db, account.account);
  return account;
}

/** For an explicitly approved operator run AFTER release and saved-execution API proof.
 * Configuration validation below is necessary, not proof that the API key works. */
export async function runKeywordShadowPilot(deps: ServiceDeps & { db: DbClient }, approval: KeywordPilotApproval) {
  const now = deps.now ?? (() => new Date()), captured = captureApproval(approval);
  const contract = keywordPilotContract(captured, now());
  const account = await readyPilotAccount(deps, captured.contextGeneration);
  // Explicit snapshot, not a promoted spec: no routine switch, scheduler, live spec,
  // ordinary account settings or credentials are changed by this entry point.
  const spec = keywordShadowSpec(contract, 2);
  const adapters = buildAdapters({ ...deps, store: new SupabaseStore(deps.db) });
  return runRoutine(spec, { account: account.account, vars: account.vars, triggeredBy: "manual" }, adapters, {
    mode: "dry_run", reserveKeywordShadowRun: keywordPilotReservation(deps.db, captured, now),
    claimKeywordShadowStart: keywordPilotStartClaim(deps.db),
  });
}

/** Explicit operator recovery only. The original owner approval, expiry, country,
 * registration and unused permit are rechecked atomically by the start RPC. */
export async function recoverPreparedKeywordShadowPilot(deps: ServiceDeps & { db: DbClient },
  runId: string, originalGeneration: number) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(runId) || !Number.isSafeInteger(originalGeneration) || originalGeneration < 0)
    throw new Error("Original keyword run and generation required");
  await readyPilotAccount(deps, originalGeneration);
  const store = new SupabaseStore(deps.db), run = await store.getRun(runId);
  if (!run || run.accountId !== AVGAR_PILOT_ACCOUNT || run.contextGeneration !== originalGeneration)
    throw new Error("Original AVGAR keyword run unavailable");
  return resumePreparedKeywordShadowRun(runId, buildAdapters({ ...deps, store }), keywordPilotStartClaim(deps.db));
}
