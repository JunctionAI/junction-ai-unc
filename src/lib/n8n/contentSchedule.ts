/** Proposed Content weekly schedule — not wired into the worker loop.
 * Reuses dueRoutines' lookback/in-flight/enabled ideas and the brief timezone helpers.
 * Does not replace src/worker/scheduler.ts. */
import { isValidTimezone, localDay } from "../brain/brief";
import { AVGAR_PILOT_ACCOUNT } from "./shadowContract";
import { CONTENT_MARKETS, type ContentRoutineId } from "./contentShadowContract";
import type { ContentApproval } from "./contentAdmission";

export const CONTENT_SCHEDULE = Object.freeze({
  accountId: AVGAR_PILOT_ACCOUNT,
  routines: ["D01-W02", "D01-W03"] as const,
  weekday: 1,
  hour: 8,
  minute: 0,
  lookbackMs: 15 * 60_000,
});

export interface ContentScheduleCandidate {
  accountId: string;
  contextGeneration: number;
  routineId: ContentRoutineId;
  enabled: boolean;
  /** account_profiles.cadence.timezone; null/invalid → UTC. */
  timezone: string | null;
  market: keyof typeof CONTENT_MARKETS;
  lastRunStartedAt?: string;
  lastRunInFlight?: boolean;
  lastServedSlot?: string;
}

export interface ContentScheduleDue {
  accountId: string;
  contextGeneration: number;
  routineId: ContentRoutineId;
  market: keyof typeof CONTENT_MARKETS;
  timezone: string | null;
  slot: Date;
  idempotencyKey: string;
}

function localParts(now: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

function offsetMs(now: Date, zone: string): number {
  const p = localParts(now, zone);
  const hm = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const h = Number(hm.find((x) => x.type === "hour")?.value ?? "0") % 24;
  const min = Number(hm.find((x) => x.type === "minute")?.value ?? "0");
  const localAsUtc = Date.UTC(p.y, p.m - 1, p.d, h, min);
  return localAsUtc - Math.floor(now.getTime() / 60_000) * 60_000;
}

/** Local Monday 08:00 of the week containing `now`, as UTC. */
export function contentWeeklySlotUtc(now: Date, timezone: string | null | undefined): Date {
  const zone = isValidTimezone(timezone) ? timezone : "UTC";
  const p = localParts(now, zone);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const monday = new Date(Date.UTC(p.y, p.m - 1, p.d) - ((dow + 6) % 7) * 86_400_000);
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), CONTENT_SCHEDULE.hour, CONTENT_SCHEDULE.minute) - offsetMs(now, zone));
}

export function contentScheduleIdempotencyKey(routineId: ContentRoutineId, market: keyof typeof CONTENT_MARKETS, slot: Date): string {
  return `content-schedule:${routineId}:${market}:${slot.toISOString()}`;
}

/** Pure due-selection for AVGAR Content. Caller must still go through issue_content_shadow_run.
 * Generic dueRoutines() will not see these: the adapter spec is cadence=manual. */
export function contentScheduleDue(now: Date, candidates: ContentScheduleCandidate[], lookbackMs = CONTENT_SCHEDULE.lookbackMs): ContentScheduleDue[] {
  const due: ContentScheduleDue[] = [];
  for (const c of candidates) {
    if (c.accountId !== CONTENT_SCHEDULE.accountId) continue;
    if (!CONTENT_SCHEDULE.routines.includes(c.routineId)) continue;
    if (!c.enabled || c.lastRunInFlight) continue;
    const slot = contentWeeklySlotUtc(now, c.timezone);
    if (slot.getTime() > now.getTime()) continue;
    if (now.getTime() - slot.getTime() > lookbackMs) continue;
    if (c.lastServedSlot && new Date(c.lastServedSlot).getTime() >= slot.getTime()) continue;
    if (c.lastRunStartedAt && new Date(c.lastRunStartedAt).getTime() >= slot.getTime()) continue;
    due.push({
      accountId: c.accountId, contextGeneration: c.contextGeneration, routineId: c.routineId, market: c.market,
      timezone: isValidTimezone(c.timezone) ? c.timezone : null, slot,
      idempotencyKey: contentScheduleIdempotencyKey(c.routineId, c.market, slot),
    });
  }
  return due;
}

/** Proposed worker seam — do not call from loop.ts until receivers and SQL apply are accepted.
 * 1. Filter AVGAR D01-W02/D01-W03 out of generic dueRoutines (they are manual on the adapter spec).
 * 2. Build ContentScheduleCandidate from enabled liveSpec + readTimezone + saved market.
 * 3. For each contentScheduleDue row, mint ContentApproval {..., approvalReference:`content-schedule:${slot}`, idempotencyKey}.
 * 4. issue_content_shadow_run; duplicate key returns created:false — that is the durable dedup.
 * 5. On verified completion, reuse existing TickRunReport + draft receipts. No new Slack/outbox.
 * Completion notification shape (not implemented):
 *   { accountId, routineId, runId, slot, artifactId, status: "done"|"uncertain", channel: "app" }
 */
export function contentScheduleApproval(due: ContentScheduleDue, authorizedBy: string, now: Date): ContentApproval {
  const expiresAt = new Date(now.getTime() + 600_000).toISOString();
  return {
    authorizedBy, approvalReference: due.idempotencyKey, idempotencyKey: due.idempotencyKey,
    contextGeneration: due.contextGeneration, market: due.market, routineId: due.routineId,
    maxProviderCalls: 1, expiresAt,
  };
}

export function contentScheduleDay(now: Date, timezone: string | null | undefined): string {
  return localDay(now, timezone);
}
