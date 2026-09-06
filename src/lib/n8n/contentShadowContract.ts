/** AVGAR Content search-shadow. Search-derived drafts only; never native social
 * performance or first-party tickets. Does not reuse the keyword or calendar ledgers. */
import { z } from "zod";
import { validateArtifactObject } from "../artifacts/validate";
import type { ArtifactDraft, ArtifactKind } from "../runtime/types";
import { AVGAR_PILOT_ACCOUNT, type ShadowRunIdentity } from "./shadowContract";

export const CONTENT_SHADOW_CONTRACT = "unc.content-search-shadow.v1" as const;
export const CONTENT_WORKFLOW_ID = "lMXjTgd3Qh4vZaMp";
export const CONTENT_WORKFLOW_VERSION = "c8d6955d-0033-47ce-9672-399f7f10118c";
export const CONTENT_SEED = "golf travel bag";
export const CONTENT_HOOKS_RECEIVER_URL = "https://junctionai8.app.n8n.cloud/webhook/unc/d01-w02/hooks-shadow";
export const CONTENT_QUESTIONS_RECEIVER_URL = "https://junctionai8.app.n8n.cloud/webhook/unc/d01-w03/questions-shadow";
export const CONTENT_ROUTINES = {
  "D01-W02": { routineKey: "viral_hooks", kind: "hook_list" as const, maxItems: 8, receiverUrl: CONTENT_HOOKS_RECEIVER_URL, endpoint: "serp_organic" },
  "D01-W03": { routineKey: "customer_questions", kind: "question_list" as const, maxItems: 10, receiverUrl: CONTENT_QUESTIONS_RECEIVER_URL, endpoint: "people_also_ask" },
} as const;
export type ContentRoutineId = keyof typeof CONTENT_ROUTINES;
export const CONTENT_MARKETS = Object.freeze({ US: 2840, NZ: 2554, AU: 2036 });

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const contentShadowSchema = z.object({
  contract: z.literal(CONTENT_SHADOW_CONTRACT),
  accountId: z.literal(AVGAR_PILOT_ACCOUNT),
  workflowId: id,
  workflowVersion: z.string().uuid(),
  routineId: z.enum(["D01-W02", "D01-W03"]),
  routineKey: z.enum(["viral_hooks", "customer_questions"]),
  client: z.object({
    id: z.literal("avgar"),
    primaryDomain: z.literal("avgarsport.com"),
    seedKeyword: z.literal(CONTENT_SEED),
    locationCode: z.number().int().positive(),
    languageCode: z.literal("en"),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const lane = CONTENT_ROUTINES[value.routineId];
  if (value.routineKey !== lane.routineKey) ctx.addIssue({ code: "custom", message: "content routineKey must match routineId" });
  if (value.client.locationCode !== CONTENT_MARKETS.US && value.client.locationCode !== CONTENT_MARKETS.NZ
    && value.client.locationCode !== CONTENT_MARKETS.AU)
    ctx.addIssue({ code: "custom", message: "content location must be an approved AVGAR market" });
});
export type ContentShadowContract = z.infer<typeof contentShadowSchema>;

export function isContentShadow(value: unknown): value is ContentShadowContract {
  return contentShadowSchema.safeParse(value).success;
}
export function contentShadowProblem(value: unknown): string | null {
  return contentShadowSchema.safeParse(value).success ? null : "invalid content search shadow contract";
}
export function contentReceiverUrl(contract: ContentShadowContract): string {
  return CONTENT_ROUTINES[contract.routineId].receiverUrl;
}
export function assertContentShadowRequest(contract: ContentShadowContract, run: ShadowRunIdentity): void {
  if (contentShadowProblem(contract)) throw new Error("invalid content search shadow contract");
  if (run.mode !== "dry_run" || run.accountId !== contract.accountId || run.routineId !== contract.routineId)
    throw new Error("content shadow account, routine or dry-run authority mismatch");
}

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function lane(contract: ContentShadowContract) {
  return CONTENT_ROUTINES[contract.routineId];
}

/** Structural + source-semantics validation. Search output is always a hypothesis. */
export function contentShadowArtifact(value: unknown, contract: ContentShadowContract, run: ShadowRunIdentity): ArtifactDraft {
  assertContentShadowRequest(contract, run);
  const expected = lane(contract);
  if (object(value)?.kind && object(value)?.kind !== expected.kind)
    throw new Error(`content artifact kind must be ${expected.kind}; packaged content_hooks/content_questions are not Unc kinds`);
  const parsed = validateArtifactObject(value, { kind: expected.kind as ArtifactKind, maxItems: expected.maxItems, allowedNumbers: null });
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.artifact.body.toLowerCase();
  if (!/search|serp|people also ask|paa|hypothesis/.test(body))
    throw new Error("content body must label search-derived hypotheses");
  if (/\b(tiktok|instagram)\b/.test(body) && /\b(views?|plays?|viral performance)\b/.test(body))
    throw new Error("search hooks cannot claim native social performance");
  if (expected.kind === "question_list" && /\b(ticket|gorgias|support dm|review frequency)\b/.test(body) && !/not (?:from |yet )?(?:tickets|support)/.test(body))
    throw new Error("search questions cannot be labelled as first-party tickets");
  const evidence = (parsed.artifact.evidence ?? []).filter(row =>
    (row.source === "dataforseo_serp" || row.source === "n8n_execution" || row.source === "search_query") && row.ref.trim());
  if (!evidence.some(row => row.source === "dataforseo_serp" && row.ref.includes(contract.client.seedKeyword)
    && row.ref.includes(String(contract.client.locationCode))))
    throw new Error("content artifact requires DataForSEO SERP evidence for the contracted seed and location");
  for (const item of parsed.artifact.items ?? []) {
    const meta = item.meta ?? {};
    if (expected.kind === "hook_list") {
      if (meta.status !== "hypothesis" || meta.measured === true || (meta.views !== undefined && meta.views !== null)
        || (typeof meta.source === "string" && ["tiktok", "instagram"].includes(meta.source) && meta.status !== "hypothesis"))
        throw new Error("search hooks must stay unmeasured hypotheses");
      item.meta = { status: "hypothesis", source: "search",
        ...(typeof meta.mechanic === "string" ? { mechanic: meta.mechanic.slice(0, 200) } : {}),
        ...(typeof meta.domain === "string" ? { domain: meta.domain.slice(0, 200) } : {}),
        ...(Number.isInteger(meta.rank) ? { rank: meta.rank } : {}), views: null, measured: false };
    } else {
      if (meta.frequency !== undefined && meta.frequency !== null)
        throw new Error("search questions cannot invent frequency");
      if (meta.question_source_type && meta.question_source_type !== "search_paa")
        throw new Error("search questions must declare search_paa, not tickets or reviews");
      item.meta = { frequency: null, question_source_type: "search_paa", source: "search",
        ...(typeof meta.format === "string" ? { format: meta.format.slice(0, 80) } : {}),
        ...(typeof meta.stage === "string" ? { stage: meta.stage.slice(0, 80) } : {}),
        ...(Number.isInteger(meta.rank) ? { rank: meta.rank } : {}) };
    }
    if (meta.scheduled === true || (meta.executed_action !== undefined && meta.executed_action !== "none"))
      throw new Error("content shadow cannot claim publishing or execution");
  }
  if (parsed.artifact.meta?.scheduled === true || (parsed.artifact.meta?.executed_action !== undefined && parsed.artifact.meta.executed_action !== "none"))
    throw new Error("content shadow cannot claim publishing or execution");
  return { ...parsed.artifact, evidence, meta: {} };
}

export function validateContentShadowReceipt(value: unknown, contract: ContentShadowContract, run: ShadowRunIdentity, now: Date): Record<string, unknown> {
  assertContentShadowRequest(contract, run);
  const receipt = object(value);
  const expected = {
    contract: contract.contract, accountId: run.accountId, runId: run.runId, routineId: run.routineId,
    routineKey: contract.routineKey, workflowId: contract.workflowId, mode: "dry_run", status: "succeeded", executedAction: "none",
  };
  for (const [key, val] of Object.entries(expected)) if (receipt?.[key] !== val) throw new Error(`content receipt ${key} mismatch`);
  if (!receipt || receipt.workflowVersion !== null || receipt.revisionEvidence !== "pending_unc_verification"
    || typeof receipt.executionId !== "string" || !/^[1-9]\d{0,29}$/.test(receipt.executionId))
    throw new Error("content receipt requires actual execution and pending independent revision verification");
  for (const [key, val] of Object.entries(contract.client))
    if (object(receipt.client)?.[key] !== val) throw new Error(`content receipt client.${key} mismatch`);
  const started = Date.parse(String(receipt.startedAt)), finished = Date.parse(String(receipt.finishedAt));
  const runStart = Date.parse(run.startedAt), clock = now.getTime();
  if (![started, finished, runStart, clock].every(Number.isFinite) || started < runStart - 30_000
    || finished < started || finished > clock + 30_000 || clock - finished > 15 * 60_000)
    throw new Error("content receipt timing is stale or invalid");
  const provider = object(receipt.provider);
  const expectedEndpoint = lane(contract).endpoint;
  if (!provider || provider.name !== "dataforseo" || provider.endpoint !== expectedEndpoint
    || provider.statusCode !== 20000 || provider.taskStatusCode !== 20000
    || !text(provider.taskId, 200) || !Number.isInteger(provider.itemsCount) || (provider.itemsCount as number) < 1
    || provider.seedKeyword !== contract.client.seedKeyword || provider.locationCode !== contract.client.locationCode
    || provider.languageCode !== contract.client.languageCode)
    throw new Error("content receipt lacks successful DataForSEO SERP task evidence");
  const fetchedAt = Date.parse(String(provider.fetchedAt));
  if (!Number.isFinite(fetchedAt) || fetchedAt < started - 30_000 || fetchedAt > finished + 30_000)
    throw new Error("content provider evidence is outside this execution");
  return { ...expected, workflowVersion: null, expectedWorkflowVersion: contract.workflowVersion,
    revisionEvidence: "pending_unc_verification", executionId: receipt.executionId,
    startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, client: { ...contract.client },
    provider: { name: "dataforseo", endpoint: expectedEndpoint, statusCode: 20000, taskStatusCode: 20000,
      taskId: provider.taskId, itemsCount: provider.itemsCount, fetchedAt: provider.fetchedAt,
      seedKeyword: contract.client.seedKeyword, locationCode: contract.client.locationCode, languageCode: "en" } };
}

export function verifyContentShadowExecution(value: unknown, observation: unknown, contract: ContentShadowContract,
  run: ShadowRunIdentity, now: Date, expectedDigest: string, expectedResultDigest: string): Record<string, unknown> {
  const receipt = validateContentShadowReceipt(value, contract, run, now), seen = object(observation);
  for (const [key, expected] of Object.entries({ source: "n8n_execution_record", executionId: receipt.executionId,
    workflowId: contract.workflowId, workflowVersion: contract.workflowVersion, status: "success", finished: true }))
    if (seen?.[key] !== expected) throw new Error(`independent content execution ${key} mismatch`);
  for (const [key, expected] of Object.entries({ accountId: run.accountId, runId: run.runId, routineId: run.routineId }))
    if (object(seen?.request)?.[key] !== expected) throw new Error(`independent content request ${key} mismatch`);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || seen?.requestDigest !== expectedDigest)
    throw new Error("independent content request digest mismatch");
  if (!/^[a-f0-9]{64}$/.test(expectedResultDigest) || seen?.resultDigest !== expectedResultDigest)
    throw new Error("independent content result digest mismatch");
  const started = Date.parse(String(seen?.startedAt)), stopped = Date.parse(String(seen?.stoppedAt));
  if (![started, stopped].every(Number.isFinite) || stopped < started
    || Math.abs(started - Date.parse(String(receipt.startedAt))) > 30_000
    || stopped < Date.parse(String(receipt.finishedAt)) - 30_000 || stopped > now.getTime() + 30_000
    || now.getTime() - stopped > 15 * 60_000)
    throw new Error("independent content execution timing is invalid");
  return { ...receipt, workflowVersion: contract.workflowVersion, revisionEvidence: "verified_execution_record",
    revisionVerification: { source: "n8n_execution_record", verifiedAt: now.toISOString(),
      startedAt: seen!.startedAt, stoppedAt: seen!.stoppedAt, requestDigest: expectedDigest, resultDigest: expectedResultDigest } };
}
