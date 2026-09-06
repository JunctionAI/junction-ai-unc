/** Explicit supported protocols. Unknown contracts never fall through to a provider. */
import { assertShadowRequest, shadowContractProblem, validateShadowReceipt, verifyShadowExecution,
  KEYWORD_SHADOW_RECEIVER_URL, KEYWORD_SHADOW_CONTRACT, type KeywordShadowContract, type ShadowRunIdentity } from "./shadowContract";
import { assertCalendarShadowRequest, calendarShadowArtifact, calendarShadowProblem, calendarShadowSchema,
  validateCalendarShadowReceipt, verifyCalendarShadowExecution, CALENDAR_SHADOW_RECEIVER_URL,
  CALENDAR_SHADOW_CONTRACT, type CalendarShadowContract } from "./calendarShadowContract";
import { assertPaidShadowRequest, paidShadowArtifact, paidShadowEnvPrefix, paidShadowProblem, paidShadowReceiver, paidShadowSchema,
  validatePaidShadowReceipt, verifyPaidShadowExecution, PAID_SHADOW_CONTRACT, type PaidShadowContract, type PaidTrustedEvidence } from "./paidShadowContract";
import { shadowCandidate, type ShadowCandidate } from "./shadowCandidate";
export type ShadowContract = KeywordShadowContract | CalendarShadowContract | PaidShadowContract;
/** keyword and calendar are single-routine pilots; paid covers AVGAR's Meta lanes and the Google Ads plan. */
export type ShadowKind = "keyword" | "calendar" | "paid";
const contractOf = (value: unknown): unknown => value && typeof value === "object" && "contract" in value ? (value as { contract: unknown }).contract : undefined;
export const isCalendarShadow = (c: ShadowContract): c is CalendarShadowContract => c.contract === CALENDAR_SHADOW_CONTRACT;
export const isPaidShadow = (c: ShadowContract): c is PaidShadowContract => c.contract === PAID_SHADOW_CONTRACT;
export const isKeywordShadow = (c: ShadowContract): c is KeywordShadowContract => c.contract === KEYWORD_SHADOW_CONTRACT;
export const shadowKind = (c: ShadowContract): ShadowKind => isCalendarShadow(c) ? "calendar" : isPaidShadow(c) ? "paid" : "keyword";
/** Every non-keyword protocol pins its own receiver, credential and result-node evidence. */
export const protocolBindsResult = (c: ShadowContract) => !isKeywordShadow(c);
export function protocolProblem(value: unknown): string | null {
  const contract = contractOf(value);
  if (contract === CALENDAR_SHADOW_CONTRACT) return calendarShadowProblem(value);
  if (contract === PAID_SHADOW_CONTRACT) return paidShadowProblem(value);
  return shadowContractProblem(value);
}
export function assertProtocolRequest(c: ShadowContract, run: ShadowRunIdentity): void {
  if (isCalendarShadow(c)) assertCalendarShadowRequest(c, run);
  else if (isPaidShadow(c)) assertPaidShadowRequest(c, run);
  else assertShadowRequest(c, run);
}
export const protocolReceiver = (c: ShadowContract) => isCalendarShadow(c) ? CALENDAR_SHADOW_RECEIVER_URL : isPaidShadow(c) ? paidShadowReceiver(c) : KEYWORD_SHADOW_RECEIVER_URL;
export const protocolEnvPrefix = (c: ShadowContract) => isCalendarShadow(c) ? "N8N_CALENDAR_SHADOW" : isPaidShadow(c) ? paidShadowEnvPrefix(c) : "N8N_SHADOW";
/** The execution reader's pin family; paid lanes are pinned per workflow, not per routine. */
export const protocolReaderKind = (c: ShadowContract): "keyword" | "calendar" | "meta" | "google_ads" =>
  isCalendarShadow(c) ? "calendar" : isPaidShadow(c) ? c.lane : "keyword";
export function validateProtocolReceipt(value: unknown, c: ShadowContract, run: ShadowRunIdentity, now: Date) {
  if (isCalendarShadow(c)) return validateCalendarShadowReceipt(value, c, run, now);
  if (isPaidShadow(c)) return validatePaidShadowReceipt(value, c, run, now);
  return validateShadowReceipt(value, c, run, now);
}
export function verifyProtocolExecution(value: unknown, seen: unknown, c: ShadowContract, run: ShadowRunIdentity, now: Date, digest: string, resultDigest?: string) {
  if (isCalendarShadow(c)) return verifyCalendarShadowExecution(value, seen, c, run, now, digest, resultDigest ?? "");
  if (isPaidShadow(c)) return verifyPaidShadowExecution(value, seen, c, run, now, digest, resultDigest ?? "");
  return verifyShadowExecution(value, seen, c, run, now, digest);
}
/** `trusted` is the server-supplied paid-ads evidence bundle (prices/FX); ignored by other protocols. */
export function protocolCandidate(value: unknown, receipt: Record<string, unknown>, c: ShadowContract, run: ShadowRunIdentity, resultDigest?: string,
  trusted: PaidTrustedEvidence | null = null): ShadowCandidate {
  if (isKeywordShadow(c)) return shadowCandidate(value, receipt);
  if (!resultDigest || !/^[a-f0-9]{64}$/.test(resultDigest)) throw new Error(`${isPaidShadow(c) ? "paid-ads" : "calendar"} response fingerprint required`);
  const artifact = isPaidShadow(c) ? paidShadowArtifact(value, c, run, trusted) : calendarShadowArtifact(value, c, run);
  const candidate = { artifact, executionReceipt: receipt, resultDigest };
  const provider = receipt.provider as Record<string, unknown> | undefined;
  if (isCalendarShadow(c) && provider?.itemsCount === 0 && candidate.artifact.items?.some(item => item.meta?.timing_basis === "observed_campaign_history"))
    throw new Error("Empty campaign history cannot evidence a known timing anchor");
  if (isPaidShadow(c) && c.lane === "meta" && provider?.itemsCount === 0 &&
      candidate.artifact.items?.some(item => item.meta?.status === "observed" || item.meta?.observed !== undefined))
    throw new Error("An empty Meta insights read cannot evidence observed ad metrics");
  if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > 256000) throw new Error("shadow recovery artifact is too large");
  return candidate;
}
export function projectProtocolContract(c: ShadowContract): ShadowContract {
  if (isCalendarShadow(c)) return calendarShadowSchema.parse(c);
  if (isPaidShadow(c)) return paidShadowSchema.parse(c);
  return { contract: c.contract, accountId: c.accountId, routineId: c.routineId, routineKey: c.routineKey,
    workflowId: c.workflowId, workflowVersion: c.workflowVersion, client: { id: c.client.id,
      primaryDomain: c.client.primaryDomain, seedKeyword: c.client.seedKeyword,
      locationCode: c.client.locationCode, languageCode: c.client.languageCode } };
}
