/** Explicit supported protocols. Unknown contracts never fall through to a provider. */
import { assertShadowRequest, shadowContractProblem, validateShadowReceipt, verifyShadowExecution,
  KEYWORD_SHADOW_RECEIVER_URL, type KeywordShadowContract, type ShadowRunIdentity } from "./shadowContract";
import { assertCalendarShadowRequest, calendarShadowArtifact, calendarShadowProblem, calendarShadowSchema,
  validateCalendarShadowReceipt, verifyCalendarShadowExecution, CALENDAR_SHADOW_RECEIVER_URL,
  CALENDAR_SHADOW_CONTRACT, type CalendarShadowContract } from "./calendarShadowContract";
import { assertContentShadowRequest, contentReceiverUrl, contentShadowArtifact, contentShadowProblem,
  contentShadowSchema, validateContentShadowReceipt, verifyContentShadowExecution, CONTENT_SHADOW_CONTRACT,
  CONTENT_HOOKS_RECEIVER_URL, CONTENT_QUESTIONS_RECEIVER_URL, type ContentShadowContract } from "./contentShadowContract";
import { shadowCandidate, type ShadowCandidate } from "./shadowCandidate";

export type ShadowContract = KeywordShadowContract | CalendarShadowContract | ContentShadowContract;
export type ShadowProtocolKind = "keyword" | "calendar" | "content";
export const isCalendarShadow = (c: ShadowContract): c is CalendarShadowContract => c.contract === CALENDAR_SHADOW_CONTRACT;
export const isContentShadow = (c: ShadowContract): c is ContentShadowContract => c.contract === CONTENT_SHADOW_CONTRACT;
export function shadowProtocol(c: ShadowContract): ShadowProtocolKind {
  if (isCalendarShadow(c)) return "calendar";
  if (isContentShadow(c)) return "content";
  return "keyword";
}
export function protocolProblem(value: unknown): string | null {
  if (value && typeof value === "object" && "contract" in value) {
    if (value.contract === CALENDAR_SHADOW_CONTRACT) return calendarShadowProblem(value);
    if (value.contract === CONTENT_SHADOW_CONTRACT) return contentShadowProblem(value);
  }
  return shadowContractProblem(value);
}
export function assertProtocolRequest(c: ShadowContract, run: ShadowRunIdentity): void {
  if (isCalendarShadow(c)) assertCalendarShadowRequest(c, run);
  else if (isContentShadow(c)) assertContentShadowRequest(c, run);
  else assertShadowRequest(c, run);
}
export const protocolReceiver = (c: ShadowContract) =>
  isCalendarShadow(c) ? CALENDAR_SHADOW_RECEIVER_URL : isContentShadow(c) ? contentReceiverUrl(c) : KEYWORD_SHADOW_RECEIVER_URL;
export const protocolEnvPrefix = (c: ShadowContract) => {
  if (isCalendarShadow(c)) return "N8N_CALENDAR_SHADOW";
  if (isContentShadow(c)) return c.routineId === "D01-W02" ? "N8N_CONTENT_HOOKS_SHADOW" : "N8N_CONTENT_QUESTIONS_SHADOW";
  return "N8N_SHADOW";
};
export const CONTENT_RECEIVER_URLS = [CONTENT_HOOKS_RECEIVER_URL, CONTENT_QUESTIONS_RECEIVER_URL] as const;
export function validateProtocolReceipt(value: unknown, c: ShadowContract, run: ShadowRunIdentity, now: Date) {
  if (isCalendarShadow(c)) return validateCalendarShadowReceipt(value, c, run, now);
  if (isContentShadow(c)) return validateContentShadowReceipt(value, c, run, now);
  return validateShadowReceipt(value, c, run, now);
}
export function verifyProtocolExecution(value: unknown, seen: unknown, c: ShadowContract, run: ShadowRunIdentity, now: Date, digest: string, resultDigest?: string) {
  if (isCalendarShadow(c)) return verifyCalendarShadowExecution(value, seen, c, run, now, digest, resultDigest ?? "");
  if (isContentShadow(c)) return verifyContentShadowExecution(value, seen, c, run, now, digest, resultDigest ?? "");
  return verifyShadowExecution(value, seen, c, run, now, digest);
}
export function protocolCandidate(value: unknown, receipt: Record<string, unknown>, c: ShadowContract, run: ShadowRunIdentity, resultDigest?: string): ShadowCandidate {
  if (isContentShadow(c)) {
    if (!resultDigest || !/^[a-f0-9]{64}$/.test(resultDigest)) throw new Error("content response fingerprint required");
    const candidate = { artifact: contentShadowArtifact(value, c, run), executionReceipt: receipt, resultDigest };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > 256000) throw new Error("content recovery artifact is too large");
    return candidate;
  }
  if (!isCalendarShadow(c)) return shadowCandidate(value, receipt);
  if (!resultDigest || !/^[a-f0-9]{64}$/.test(resultDigest)) throw new Error("calendar response fingerprint required");
  const candidate = { artifact: calendarShadowArtifact(value, c, run), executionReceipt: receipt, resultDigest };
  const provider = receipt.provider as Record<string, unknown> | undefined;
  if (provider?.itemsCount === 0 && candidate.artifact.items?.some(item => item.meta?.timing_basis === "observed_campaign_history"))
    throw new Error("Empty campaign history cannot evidence a known timing anchor");
  if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > 256000) throw new Error("calendar recovery artifact is too large");
  return candidate;
}
export function projectProtocolContract(c: ShadowContract): ShadowContract {
  if (isCalendarShadow(c)) return calendarShadowSchema.parse(c);
  if (isContentShadow(c)) return contentShadowSchema.parse(c);
  return { contract: c.contract, accountId: c.accountId, routineId: c.routineId, routineKey: c.routineKey,
    workflowId: c.workflowId, workflowVersion: c.workflowVersion, client: { id: c.client.id,
      primaryDomain: c.client.primaryDomain, seedKeyword: c.client.seedKeyword,
      locationCode: c.client.locationCode, languageCode: c.client.languageCode } };
}
