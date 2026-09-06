/** Content schedule reuse — not a second scheduler.
 * The shared saved-schedule path (`routine_schedules` + `routine_schedule_claims` +
 * existing worker command queue) already ran AVGAR keyword automatically
 * (n8n execution #100). Content must reuse that path with customer-selected
 * timezone/hour/weekday/on_date, routine-switch checks and claim-per-local-date
 * duplicate protection. This module does not select slots and does not assume
 * Monday 08:00. Do not call it from loop.ts. */
import { AVGAR_PILOT_ACCOUNT } from "./shadowContract";
import { CONTENT_MARKETS, type ContentRoutineId } from "./contentShadowContract";
import type { ContentApproval } from "./contentAdmission";

export const CONTENT_SCHEDULE_REUSE = Object.freeze({
  accountId: AVGAR_PILOT_ACCOUNT,
  routines: ["D01-W02", "D01-W03"] as const,
  table: "routine_schedules",
  claims: "routine_schedule_claims",
  requestIdPrefix: "schedule:",
  workerPath: "existing command queue; no per-lane loop",
  timing: "customer-selected IANA timezone, hour, minute, optional weekday, optional on_date",
  doNotAssume: { weekday: 1, hour: 8, cadence: "0 8 * * 1" },
});

export interface SavedContentScheduleClaim {
  scheduleId: string;
  revision: number;
  localDate: string;
  slotAt: string;
  routineId: ContentRoutineId;
  market: keyof typeof CONTENT_MARKETS;
  contextGeneration: number;
  enabled: boolean;
  timezone: string;
}

/** Map an already-claimed saved-schedule slot onto Content admission.
 * Caller must have passed owner/switch/context/budget checks on the shared path. */
export function contentApprovalFromSavedSchedule(claim: SavedContentScheduleClaim, authorizedBy: string, now: Date): ContentApproval {
  if (!claim.enabled) throw new Error("Saved Content schedule is switched off");
  if (claim.routineId !== "D01-W02" && claim.routineId !== "D01-W03") throw new Error("Saved schedule is not a Content routine");
  const idempotencyKey = `${CONTENT_SCHEDULE_REUSE.requestIdPrefix}${claim.scheduleId}:${claim.revision}:${claim.localDate}`;
  return {
    authorizedBy, approvalReference: idempotencyKey, idempotencyKey,
    contextGeneration: claim.contextGeneration, market: claim.market, routineId: claim.routineId,
    maxProviderCalls: 1, expiresAt: new Date(now.getTime() + 600_000).toISOString(),
  };
}
