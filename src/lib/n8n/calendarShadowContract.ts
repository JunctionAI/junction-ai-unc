/** D05-W07 is a calendar proposal, never a send schedule. This contract deliberately
 * does not reuse the keyword pilot's tenant, provider semantics or credential pin. */
import { z } from "zod";
import { validateArtifactObject } from "../artifacts/validate";
import type { ArtifactDraft } from "../runtime/types";
import type { ShadowRunIdentity } from "./shadowContract";
import { calendarWeekStarts } from "./calendarDates";
export { calendarWeekStarts } from "./calendarDates";

export const CALENDAR_SHADOW_CONTRACT = "unc.campaign-calendar-shadow.v1" as const;
export const CALENDAR_SHADOW_RECEIVER_URL = "https://junctionai8.app.n8n.cloud/webhook/unc/d05-w07/calendar-shadow";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timezone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
});

export const calendarShadowSchema = z.object({
  contract: z.literal(CALENDAR_SHADOW_CONTRACT), accountId: z.string().uuid(),
  workflowId: id, workflowVersion: z.string().uuid(),
  routineId: z.literal("D05-W07"), routineKey: z.literal("campaign_calendar"),
  client: z.object({
    primaryDomain: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/),
    timezone, currency: z.string().regex(/^[A-Z]{3}$/),
    // Identifiers only. Admission must verify the tenant owns this asset/binding.
    bindingId: z.string().uuid(), klaviyoAccountId: id,
  }).strict(),
  data: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("provider"), queryHash: hash }).strict(),
    z.object({ mode: z.literal("stored"), queryHash: hash, snapshotId: z.string().uuid(),
      fetchedAt: timestamp, maxAgeSeconds: z.number().int().min(1).max(86400) }).strict(),
  ]),
}).strict();
export type CalendarShadowContract = z.infer<typeof calendarShadowSchema>;
export function calendarShadowProblem(value: unknown): string | null {
  return calendarShadowSchema.safeParse(value).success ? null : "invalid campaign calendar shadow contract";
}
export function assertCalendarShadowRequest(contract: CalendarShadowContract, run: ShadowRunIdentity): void {
  if (calendarShadowProblem(contract)) throw new Error("invalid campaign calendar shadow contract");
  if (run.mode !== "dry_run" || run.accountId !== contract.accountId || run.routineId !== contract.routineId)
    throw new Error("calendar shadow account, routine or dry-run authority mismatch");
}
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Structural validation is not copy quality acceptance. Require explicit uncertainty
 * and provenance so historical campaign metadata cannot become measured performance. */
export function calendarShadowArtifact(value: unknown, contract: CalendarShadowContract, run: ShadowRunIdentity): ArtifactDraft {
  assertCalendarShadowRequest(contract, run);
  const parsed = validateArtifactObject(value, { kind: "calendar", maxItems: 6, allowedNumbers: null });
  if (!parsed.ok || parsed.artifact.items?.length !== 6) throw new Error("calendar requires exactly six proposal weeks");
  if (parsed.artifact.meta?.scheduled === true || (parsed.artifact.meta?.executed_action !== undefined && parsed.artifact.meta.executed_action !== "none"))
    throw new Error("calendar shadow cannot claim scheduling or execution");
  const weeks = calendarWeekStarts(run.startedAt, contract.client.timezone);
  for (const [index, item] of parsed.artifact.items.entries()) {
    const meta = item.meta;
    if (meta?.week_start !== weeks[index] || !["email", "sms", "email+sms"].includes(String(meta.channel)) ||
        typeof meta.theme !== "string" || !meta.theme.trim() ||
        !["hypothesis", "observed_campaign_history"].includes(String(meta.timing_basis)))
      throw new Error("calendar proposal dates, channels or timing basis are invalid");
    if (meta.timing_basis !== "hypothesis" && (!Array.isArray(meta.anchor_refs) || !meta.anchor_refs.length ||
        meta.anchor_refs.length > 10 || meta.anchor_refs.some(ref => typeof ref !== "string" ||
          !ref.startsWith(`klaviyo:${contract.client.klaviyoAccountId}:campaign:`) ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(ref.split(":").at(-1) ?? "") ||
          !parsed.artifact.evidence?.some(e => e.source === "klaviyo_campaign" && e.ref === ref))))
      throw new Error("calendar known timing anchor requires matching evidence references");
    if (meta.scheduled === true || (meta.executed_action !== undefined && meta.executed_action !== "none"))
      throw new Error("calendar shadow cannot claim scheduling or execution");
    // Do not checkpoint arbitrary provider fields, private notes or raw payloads.
    item.meta = { week_start: meta.week_start, channel: meta.channel, theme: meta.theme, timing_basis: meta.timing_basis,
      ...(typeof meta.phase === "string" ? { phase: meta.phase.slice(0, 200) } : {}),
      ...(Array.isArray(meta.anchor_refs) ? { anchor_refs: meta.anchor_refs.filter((r): r is string => typeof r === "string").slice(0, 10).map(r => r.slice(0, 400)) } : {}) };
  }
  return { ...parsed.artifact, meta: {} };
}

export function validateCalendarShadowReceipt(value: unknown, contract: CalendarShadowContract, run: ShadowRunIdentity, now: Date): Record<string, unknown> {
  assertCalendarShadowRequest(contract, run);
  const receipt = object(value);
  const expected = { contract: contract.contract, accountId: run.accountId, runId: run.runId,
    routineId: run.routineId, routineKey: contract.routineKey, workflowId: contract.workflowId,
    mode: "dry_run", status: "succeeded", executedAction: "none" };
  for (const [key, val] of Object.entries(expected)) if (receipt?.[key] !== val) throw new Error(`calendar receipt ${key} mismatch`);
  if (!receipt || receipt.workflowVersion !== null || receipt.revisionEvidence !== "pending_unc_verification" ||
      typeof receipt.executionId !== "string" || !/^[1-9]\d{0,29}$/.test(receipt.executionId))
    throw new Error("calendar receipt requires actual execution and pending independent revision verification");
  for (const [key, val] of Object.entries(contract.client))
    if (object(receipt.client)?.[key] !== val) throw new Error(`calendar receipt client.${key} mismatch`);
  const started = Date.parse(String(receipt.startedAt)), finished = Date.parse(String(receipt.finishedAt));
  const runStart = Date.parse(run.startedAt), clock = now.getTime();
  if (![started, finished, runStart, clock].every(Number.isFinite) || started < runStart - 30000 ||
      finished < started || finished > clock + 30000 || clock - finished > 900000)
    throw new Error("calendar receipt timing is stale or invalid");
  const provider = object(receipt.provider);
  if (!provider || provider.name !== "klaviyo" || provider.accountId !== contract.client.klaviyoAccountId ||
      provider.bindingId !== contract.client.bindingId || provider.queryHash !== contract.data.queryHash ||
      provider.source !== contract.data.mode || provider.complete !== true || provider.dataset !== "campaign_metadata" ||
      !Number.isSafeInteger(provider.itemsCount) || Number(provider.itemsCount) < 0)
    throw new Error("calendar provider evidence is incomplete or bound to another source");
  const fetched = Date.parse(String(provider.fetchedAt));
  if (!Number.isFinite(fetched)) throw new Error("calendar source timestamp missing");
  if (contract.data.mode === "provider") {
    if (provider.statusCode !== 200 || fetched < started - 30000 || fetched > finished + 30000)
      throw new Error("calendar provider read is outside this execution");
  } else if (provider.snapshotId !== contract.data.snapshotId || provider.fetchedAt !== contract.data.fetchedAt ||
      fetched > runStart + 30000 || finished - fetched > contract.data.maxAgeSeconds * 1000)
    throw new Error("calendar stored data is stale or does not match the pinned snapshot");
  return { ...expected, workflowVersion: null, expectedWorkflowVersion: contract.workflowVersion,
    revisionEvidence: "pending_unc_verification", executionId: receipt.executionId,
    startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, client: { ...contract.client },
    provider: { name: "klaviyo", dataset: "campaign_metadata", accountId: provider.accountId,
      bindingId: provider.bindingId, queryHash: provider.queryHash, source: provider.source,
      complete: true, itemsCount: provider.itemsCount, fetchedAt: provider.fetchedAt,
      ...(contract.data.mode === "provider" ? { statusCode: 200 } : { snapshotId: contract.data.snapshotId }) } };
}

export function verifyCalendarShadowExecution(value: unknown, observation: unknown, contract: CalendarShadowContract,
  run: ShadowRunIdentity, now: Date, expectedDigest: string, expectedResultDigest: string): Record<string, unknown> {
  const receipt = validateCalendarShadowReceipt(value, contract, run, now), seen = object(observation);
  for (const [key, expected] of Object.entries({ source: "n8n_execution_record", executionId: receipt.executionId,
    workflowId: contract.workflowId, workflowVersion: contract.workflowVersion, status: "success", finished: true }))
    if (seen?.[key] !== expected) throw new Error(`independent calendar execution ${key} mismatch`);
  for (const [key, expected] of Object.entries({ accountId: run.accountId, runId: run.runId, routineId: run.routineId }))
    if (object(seen?.request)?.[key] !== expected) throw new Error(`independent calendar request ${key} mismatch`);
  if (!hash.safeParse(expectedDigest).success || seen?.requestDigest !== expectedDigest)
    throw new Error("independent calendar request digest mismatch");
  if (!hash.safeParse(expectedResultDigest).success || seen?.resultDigest !== expectedResultDigest)
    throw new Error("independent calendar result digest mismatch");
  const started = Date.parse(String(seen?.startedAt)), stopped = Date.parse(String(seen?.stoppedAt));
  if (![started, stopped].every(Number.isFinite) || stopped < started ||
      Math.abs(started - Date.parse(String(receipt.startedAt))) > 30000 ||
      stopped < Date.parse(String(receipt.finishedAt)) - 30000 || stopped > now.getTime() + 30000 || now.getTime() - stopped > 900000)
    throw new Error("independent calendar execution timing is invalid");
  return { ...receipt, workflowVersion: contract.workflowVersion, revisionEvidence: "verified_execution_record",
    revisionVerification: { source: "n8n_execution_record", verifiedAt: now.toISOString(),
      startedAt: seen!.startedAt, stoppedAt: seen!.stoppedAt, requestDigest: expectedDigest, resultDigest: expectedResultDigest } };
}

/** Historical recovery never extends a provider allowance or refreshes source time. */
export function verifyHistoricalCalendarShadowExecution(value: unknown, observation: unknown, contract: CalendarShadowContract,
  run: ShadowRunIdentity, now: Date, requestDigest: string, resultDigest: string,
  admission: { dispatchedAt: string; authorizedAt: string }): Record<string, unknown> {
  const seen = object(observation), start = Date.parse(String(seen?.startedAt)), end = Date.parse(String(seen?.stoppedAt));
  const runStart = Date.parse(run.startedAt), dispatch = Date.parse(admission.dispatchedAt), auth = Date.parse(admission.authorizedAt);
  const clock = now.getTime();
  if (![start, end, runStart, dispatch, auth, clock].every(Number.isFinite) || dispatch < runStart - 30000 ||
      dispatch > runStart + 900000 || auth < dispatch || auth > dispatch + 900000 || start < dispatch - 30000 ||
      start > auth + 30000 || end < start || end < auth - 30000 || end > start + 900000 || end > clock + 30000)
    throw new Error("calendar recovery is outside its original authorized window");
  const verified = verifyCalendarShadowExecution(value, seen, contract, run, new Date(end), requestDigest, resultDigest);
  return { ...verified, revisionVerification: { ...(verified.revisionVerification as Record<string, unknown>),
    verifiedAt: now.toISOString(), method: "historical_reconciliation", dispatchedAt: admission.dispatchedAt, authorizedAt: admission.authorizedAt } };
}
