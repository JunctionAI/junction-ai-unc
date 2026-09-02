/* Pure due-selection for the worker loop.

   Given `now`, the enabled routine states (with the effective spec's trigger
   cadence) and each routine's latest run, return the routines whose cron slot
   fell inside the look-back window and has not been served yet.

   Cadence kinds (src/lib/runtime/types.ts TriggerNode.cadence):
     "manual"              never scheduled — only /api/routines/run fires it
     "event:<p>:<e>"       never scheduled — delivered by webhooks (not built)
     5-field cron (UTC)    scheduled here

   Dedup: the engine's own per-day dedup (engine.ts trigger node) applies to
   LIVE runs only. Dry runs — the only mode this worker issues — are deduped
   here instead, durably, by comparing the routine's latest run start against
   the slot: a run that started at/after the slot has served it. With a
   persistent Store this survives restarts; with MemoryStore it holds for the
   life of the process (a slot inside the look-back window fires once more
   after a restart, which is harmless for a dry run). Nothing here does I/O. */

import { latestSlotBetween, parseCron } from "./cron";

export type CadenceKind = "manual" | "event" | "cron" | "invalid";

export function cadenceKind(cadence: string): CadenceKind {
  if (cadence === "manual") return "manual";
  if (cadence.startsWith("event:")) return "event";
  try {
    parseCron(cadence);
    return "cron";
  } catch {
    return "invalid";
  }
}

export interface ScheduleCandidate {
  accountId: string;
  routineId: string;
  /** routine_states.enabled — disabled routines are never due. */
  enabled: boolean;
  /** The effective spec's trigger cadence. */
  cadence: string;
  /** ISO start of the routine's newest run in the store (any mode), if any. */
  lastRunStartedAt?: string;
  /** True when the newest run is still `running` — never stack a second one. */
  lastRunInFlight?: boolean;
}

export interface DueRoutine {
  accountId: string;
  routineId: string;
  /** The cron slot (UTC minute) being served. */
  slot: Date;
  cadence: string;
}

export interface DueOptions {
  /** How far back a missed slot is still served. Default 15 minutes: covers a
      slow tick or a brief restart without replaying hours of history. */
  lookbackMs?: number;
}

export const DEFAULT_LOOKBACK_MS = 15 * 60_000;

/** Which candidates are due at `now`? Deterministic and side-effect free. */
export function dueRoutines(now: Date, candidates: ScheduleCandidate[], opts: DueOptions = {}): DueRoutine[] {
  const lookback = opts.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const from = new Date(now.getTime() - lookback);
  const due: DueRoutine[] = [];
  for (const c of candidates) {
    if (!c.enabled) continue;
    if (cadenceKind(c.cadence) !== "cron") continue;
    if (c.lastRunInFlight) continue;
    const slot = latestSlotBetween(c.cadence, from, now);
    if (!slot) continue;
    if (c.lastRunStartedAt && new Date(c.lastRunStartedAt).getTime() >= slot.getTime()) continue; // already served
    due.push({ accountId: c.accountId, routineId: c.routineId, slot, cadence: c.cadence });
  }
  return due;
}
