/** Explicit supported protocols. Unknown contracts never fall through to a provider. */
import { assertShadowRequest, shadowContractProblem, validateShadowReceipt, verifyShadowExecution,
  KEYWORD_SHADOW_RECEIVER_URL, type KeywordShadowContract, type ShadowRunIdentity } from "./shadowContract";
import { assertCalendarShadowRequest, calendarShadowArtifact, calendarShadowProblem, calendarShadowSchema,
  validateCalendarShadowReceipt, verifyCalendarShadowExecution, CALENDAR_SHADOW_RECEIVER_URL,
  CALENDAR_SHADOW_CONTRACT, type CalendarShadowContract } from "./calendarShadowContract";
import { shadowCandidate, type ShadowCandidate } from "./shadowCandidate";
export type ShadowContract = KeywordShadowContract | CalendarShadowContract;
export const isCalendarShadow = (c: ShadowContract): c is CalendarShadowContract => c.contract === CALENDAR_SHADOW_CONTRACT;
export function protocolProblem(value: unknown): string | null {
  return value && typeof value === "object" && "contract" in value && value.contract === CALENDAR_SHADOW_CONTRACT
    ? calendarShadowProblem(value) : shadowContractProblem(value);
}
export function assertProtocolRequest(c: ShadowContract, run: ShadowRunIdentity): void {
  if (isCalendarShadow(c)) assertCalendarShadowRequest(c, run); else assertShadowRequest(c, run);
}
export const protocolReceiver = (c: ShadowContract) => isCalendarShadow(c) ? CALENDAR_SHADOW_RECEIVER_URL : KEYWORD_SHADOW_RECEIVER_URL;
export const protocolEnvPrefix = (c: ShadowContract) => isCalendarShadow(c) ? "N8N_CALENDAR_SHADOW" : "N8N_SHADOW";
export function validateProtocolReceipt(value: unknown, c: ShadowContract, run: ShadowRunIdentity, now: Date) {
  return isCalendarShadow(c) ? validateCalendarShadowReceipt(value, c, run, now) : validateShadowReceipt(value, c, run, now);
}
export function verifyProtocolExecution(value: unknown, seen: unknown, c: ShadowContract, run: ShadowRunIdentity, now: Date, digest: string, resultDigest?: string) {
  return isCalendarShadow(c) ? verifyCalendarShadowExecution(value, seen, c, run, now, digest, resultDigest ?? "")
    : verifyShadowExecution(value, seen, c, run, now, digest);
}
export function protocolCandidate(value: unknown, receipt: Record<string, unknown>, c: ShadowContract, run: ShadowRunIdentity, resultDigest?: string): ShadowCandidate {
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
  return { contract: c.contract, accountId: c.accountId, routineId: c.routineId, routineKey: c.routineKey,
    workflowId: c.workflowId, workflowVersion: c.workflowVersion, client: { id: c.client.id,
      primaryDomain: c.client.primaryDomain, seedKeyword: c.client.seedKeyword,
      locationCode: c.client.locationCode, languageCode: c.client.languageCode } };
}
