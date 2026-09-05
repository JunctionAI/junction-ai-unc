/** First external shadow contract. Deliberately supports one routine until its real
 * end-to-end acceptance passes. Configuration is server-owned, not model-selected. */
export const KEYWORD_SHADOW_CONTRACT = "unc.keyword-shadow.v1" as const;
export const AVGAR_PILOT_ACCOUNT = "aa5cfc84-2569-4c99-9b40-67003ae55eda";
export const AVGAR_SEO_WORKFLOW = "OUerIfgAkMnhkuen";

export interface KeywordShadowContract {
  contract: typeof KEYWORD_SHADOW_CONTRACT;
  accountId: string;
  workflowId: string;
  /** Expected frozen revision, pinned by Unc; never an executing-workflow attestation. */
  workflowVersion: string;
  routineId: "D03-W01";
  routineKey: "keyword_opportunity";
  client: {
    id: "avgar";
    primaryDomain: string;
    seedKeyword: string;
    locationCode: number;
    languageCode: string;
  };
}

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

export function shadowContractProblem(value: unknown): string | null {
  const c = object(value);
  if (!c || c.contract !== KEYWORD_SHADOW_CONTRACT) return "unsupported shadow contract";
  if (c.accountId !== AVGAR_PILOT_ACCOUNT) return "shadow pilot must bind the AVGAR account";
  // A dedicated keyword wrapper may have its own ID. The server-owned spec pins it;
  // the response and independent execution record must match that exact ID.
  if (typeof c.workflowId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(c.workflowId)) return "an explicit executing workflow ID is required";
  if (c.routineId !== "D03-W01" || c.routineKey !== "keyword_opportunity") return "only keyword opportunity is supported by this shadow contract";
  if (!text(c.workflowVersion, 128)) return "a tested workflow revision is required";
  const client = object(c.client);
  if (!client || client.id !== "avgar") return "AVGAR client configuration is required";
  if (typeof client.primaryDomain !== "string" || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(client.primaryDomain)) return "primaryDomain must be a bare public domain";
  if (!text(client.seedKeyword, 200)) return "an explicit seed keyword is required";
  if (!Number.isInteger(client.locationCode) || (client.locationCode as number) <= 0) return "an explicit provider location code is required";
  if (typeof client.languageCode !== "string" || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(client.languageCode)) return "an explicit language code is required";
  return null;
}

export interface ShadowRunIdentity { accountId: string; runId: string; routineId: string; mode: string; startedAt: string }

export function assertShadowRequest(contract: KeywordShadowContract, run: ShadowRunIdentity): void {
  const problem = shadowContractProblem(contract);
  if (problem) throw new Error(problem);
  if (run.mode !== "dry_run") throw new Error("shadow integration refuses live mode");
  if (run.accountId !== contract.accountId || run.routineId !== contract.routineId) throw new Error("shadow integration account/routine mismatch");
}

/** Validates the reported result only. A workflow cannot attest its own internal revision.
 * The bridge must independently resolve the named execution before storing a verified draft. */
export function validateShadowReceipt(value: unknown, contract: KeywordShadowContract, run: ShadowRunIdentity, now: Date): Record<string, unknown> {
  assertShadowRequest(contract, run);
  const receipt = object(value);
  if (!receipt) throw new Error("shadow reply requires executionReceipt");
  const expected: Record<string, unknown> = {
    contract: contract.contract, accountId: run.accountId, runId: run.runId,
    routineId: run.routineId, routineKey: contract.routineKey,
    workflowId: contract.workflowId,
    mode: "dry_run", status: "succeeded", executedAction: "none",
  };
  for (const [key, val] of Object.entries(expected)) {
    if (receipt[key] !== val) throw new Error(`shadow receipt ${key} mismatch`);
  }
  if (receipt.workflowVersion !== null || receipt.revisionEvidence !== "pending_unc_verification")
    throw new Error("shadow receipt revision must be null and pending Unc verification; an echoed version is not proof");
  if (typeof receipt.executionId !== "string" || !/^\d{1,30}$/.test(receipt.executionId)) throw new Error("shadow receipt requires an n8n execution ID");
  const client = object(receipt.client);
  for (const [key, val] of Object.entries(contract.client)) {
    if (client?.[key] !== val) throw new Error(`shadow receipt client.${key} mismatch`);
  }
  const startedAt = Date.parse(String(receipt.startedAt));
  const finishedAt = Date.parse(String(receipt.finishedAt));
  const runStarted = Date.parse(run.startedAt);
  if (![startedAt, finishedAt, runStarted, now.getTime()].every(Number.isFinite) ||
      startedAt < runStarted - 30_000 || finishedAt < startedAt || finishedAt > now.getTime() + 30_000 ||
      now.getTime() - finishedAt > 15 * 60_000) throw new Error("shadow receipt timing is stale or invalid");
  const provider = object(receipt.provider);
  if (!provider || provider.name !== "dataforseo" || provider.statusCode !== 20000 || provider.taskStatusCode !== 20000 ||
      !text(provider.taskId, 200) || !Number.isInteger(provider.itemsCount) || (provider.itemsCount as number) < 1)
    throw new Error("shadow receipt lacks successful DataForSEO task evidence");
  const fetchedAt = Date.parse(String(provider.fetchedAt));
  if (!Number.isFinite(fetchedAt) || fetchedAt < startedAt - 30_000 || fetchedAt > finishedAt + 30_000)
    throw new Error("shadow provider evidence is outside this execution");
  // Only preserve validated fields; tokens and unrelated raw response data are not receipts.
  return { ...expected, workflowVersion: null, expectedWorkflowVersion: contract.workflowVersion, revisionEvidence: "pending_unc_verification",
    executionId: receipt.executionId, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt,
    client: { ...contract.client }, provider: { name: "dataforseo", statusCode: 20000, taskStatusCode: 20000,
      taskId: provider.taskId, itemsCount: provider.itemsCount, fetchedAt: provider.fetchedAt } };
}

/** Projection from an independently authenticated n8n execution read, NOT the webhook
 * response, current workflow metadata or user input. Reader integration must derive
 * request identity from that execution's saved trigger input, stripping credentials. */
export interface ShadowExecutionObservation {
  source: "n8n_execution_record";
  executionId: string;
  workflowId: string;
  workflowVersion: string;
  status: "success";
  finished: true;
  startedAt: string;
  stoppedAt: string;
  request: { accountId: string; runId: string; routineId: string };
  requestDigest: string;
}

export function verifyShadowExecution(value: unknown, observation: unknown, contract: KeywordShadowContract, run: ShadowRunIdentity, now: Date, expectedRequestDigest: string): Record<string, unknown> {
  const receipt = validateShadowReceipt(value, contract, run, now);
  const seen = object(observation);
  if (!seen || seen.source !== "n8n_execution_record") throw new Error("independent n8n execution evidence is unavailable");
  for (const [key, expected] of Object.entries({ executionId: receipt.executionId, workflowId: contract.workflowId,
    workflowVersion: contract.workflowVersion, status: "success", finished: true })) {
    if (seen[key] !== expected) throw new Error(`independent n8n execution ${key} mismatch`);
  }
  const request = object(seen.request);
  for (const [key, expected] of Object.entries({ accountId: run.accountId, runId: run.runId, routineId: run.routineId })) {
    if (request?.[key] !== expected) throw new Error(`independent n8n execution request.${key} mismatch`);
  }
  if (!/^[a-f0-9]{64}$/.test(expectedRequestDigest) || seen.requestDigest !== expectedRequestDigest)
    throw new Error("independent n8n execution request digest mismatch");
  const started = Date.parse(String(seen.startedAt)), stopped = Date.parse(String(seen.stoppedAt));
  if (![started, stopped, now.getTime()].every(Number.isFinite) || stopped < started ||
      Math.abs(started - Date.parse(String(receipt.startedAt))) > 30_000 ||
      stopped < Date.parse(String(receipt.finishedAt)) - 30_000 || stopped > now.getTime() + 30_000 ||
      now.getTime() - stopped > 15 * 60_000) throw new Error("independent n8n execution timing is stale or invalid");
  return { ...receipt, workflowVersion: seen.workflowVersion, revisionEvidence: "verified_execution_record",
    revisionVerification: { source: "n8n_execution_record", verifiedAt: now.toISOString(),
      startedAt: seen.startedAt, stoppedAt: seen.stoppedAt, requestDigest: expectedRequestDigest } };
}
