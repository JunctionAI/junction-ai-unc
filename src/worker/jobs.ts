/* The worker's in-loop scheduler for the telemetry one-shots (docs/IMPROVEMENT-LOOP.md).

   The daemon already ticks once a minute, so instead of Fly scheduled machines / a cron
   sidecar the loop runs the three jobs itself at their UTC slots, through the same
   functions the CLI flags call:

     kpi_snapshot  30 1 * * *   daily 01:30 UTC        runKpiSnapshot  (--kpi-snapshot)
     measure       0 2 * * *    daily 02:00 UTC        runMeasure      (--measure)
     benchmarks    0 3 * * 1    Mondays 03:00 UTC      runBenchmarks   (--benchmarks)
     self_review   0 6 * * 1    Mondays 06:00 UTC      runSelfReview   (--self-review)

   The daily brief is NOT on this UTC list: it runs at 06:30 in each account's own timezone
   (account_profiles.cadence.timezone, else UTC) — see dueBriefs() below, which the loop
   calls per account with a per-account marker (BriefMarkers) on the same heartbeat file.

   "Already ran" markers: one per job — the slot it last served — kept on the heartbeat
   file (src/worker/health.ts Heartbeat.jobs) and reloaded on start, so a restart inside the
   look-back window does not double-run. A slot inside the look-back that no marker covers
   runs on the first tick that sees it (a deploy at 07:00 Monday runs all three, in this
   order — measure before benchmarks, which aggregate it). Every job is idempotent anyway
   (measure rewrites the same windows, self-review is per ISO week, benchmarks recompute),
   so the markers are about not wasting reads, not about correctness.

   Pure: no I/O, no clock of its own. */

import { briefSlotUtc, localDay } from "../lib/brain/brief";
import { latestSlotBetween } from "./cron";

export type JobId = "kpi_snapshot" | "measure" | "benchmarks" | "self_review";

export interface ScheduledJob {
  id: JobId;
  /** 5-field UTC cron (src/worker/cron.ts). */
  cron: string;
  /** The CLI flag that runs the same thing by hand. */
  flag: string;
}

/** In run order for a tick that finds several due at once. */
export const SCHEDULED_JOBS: ScheduledJob[] = [
  { id: "kpi_snapshot", cron: "30 1 * * *", flag: "--kpi-snapshot" },
  { id: "measure", cron: "0 2 * * *", flag: "--measure" },
  { id: "benchmarks", cron: "0 3 * * 1", flag: "--benchmarks" },
  { id: "self_review", cron: "0 6 * * 1", flag: "--self-review" },
];

export interface JobMarker {
  /** The slot (UTC minute, ISO) this job last served — including failed attempts. */
  lastSlot: string;
  ranAt: string;
  ok: boolean;
  error?: string;
  ms?: number;
}

export type JobMarkers = Partial<Record<JobId, JobMarker>>;

/** A missed slot is still picked up this long after it (a restart later in the morning
    still runs the day's measure). */
export const DEFAULT_JOB_LOOKBACK_MS = 6 * 3_600_000;

export interface DueJob {
  job: ScheduledJob;
  slot: Date;
}

/** Jobs whose latest slot inside (now - lookback, now] no marker has served yet. */
export function dueJobs(now: Date, markers: JobMarkers, lookbackMs = DEFAULT_JOB_LOOKBACK_MS): DueJob[] {
  const from = new Date(now.getTime() - lookbackMs);
  const out: DueJob[] = [];
  for (const job of SCHEDULED_JOBS) {
    const slot = latestSlotBetween(job.cron, from, now);
    if (!slot) continue;
    const marker = markers[job.id];
    if (marker && new Date(marker.lastSlot).getTime() >= slot.getTime()) continue;
    out.push({ job, slot });
  }
  return out;
}

/** Only well-formed markers survive a reload from the heartbeat file. */
export function sanitiseMarkers(raw: unknown): JobMarkers {
  const out: JobMarkers = {};
  if (!raw || typeof raw !== "object") return out;
  for (const job of SCHEDULED_JOBS) {
    const m = (raw as Record<string, unknown>)[job.id];
    if (!m || typeof m !== "object") continue;
    const { lastSlot, ranAt, ok } = m as Record<string, unknown>;
    if (typeof lastSlot !== "string" || Number.isNaN(new Date(lastSlot).getTime())) continue;
    out[job.id] = { lastSlot, ranAt: typeof ranAt === "string" ? ranAt : lastSlot, ok: ok === true };
  }
  return out;
}

// ---------- the daily brief: account-local 06:30 ----------

export const BRIEF_HOUR_LOCAL = 6;
export const BRIEF_MINUTE_LOCAL = 30;

export interface BriefMarker {
  contextGeneration?: number;
  /** The local day (YYYY-MM-DD in the account's zone) last served — including failed attempts. */
  day: string;
  ranAt: string;
  ok: boolean;
  error?: string;
}

/** accountId → marker. Rides on the heartbeat file next to `jobs`. */
export type BriefMarkers = Record<string, BriefMarker>;

export interface BriefCandidate {
  accountId: string;
  contextGeneration?: number;
  /** null / invalid → UTC. */
  timezone: string | null;
}

export interface DueBrief {
  accountId: string;
  contextGeneration?: number;
  timezone: string | null;
  /** The local day being served. */
  day: string;
  /** The UTC instant of 06:30 local that day. */
  slot: Date;
}

/** Accounts whose 06:30-local slot for today (their day) is inside (now - lookback, now] and
    whose marker does not already name that day. The DB row (daily_briefs unique per account +
    day) is the durable dedup; the marker just saves the read. */
export function dueBriefs(now: Date, candidates: BriefCandidate[], markers: BriefMarkers, lookbackMs = DEFAULT_JOB_LOOKBACK_MS): DueBrief[] {
  const out: DueBrief[] = [];
  for (const c of candidates) {
    const day = localDay(now, c.timezone);
    const slot = briefSlotUtc(now, c.timezone, BRIEF_HOUR_LOCAL, BRIEF_MINUTE_LOCAL);
    if (slot.getTime() > now.getTime()) continue; // not yet today
    if (now.getTime() - slot.getTime() > lookbackMs) continue; // missed by more than the look-back: wait for tomorrow
    if (markers[c.accountId]?.day === day && (markers[c.accountId].contextGeneration ?? 0) === (c.contextGeneration ?? 0)) continue;
    out.push({ ...c, day, slot });
  }
  return out;
}

export function sanitiseBriefMarkers(raw: unknown): BriefMarkers {
  const out: BriefMarkers = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [accountId, m] of Object.entries(raw as Record<string, unknown>)) {
    if (!m || typeof m !== "object") continue;
    const { day, ranAt, ok, contextGeneration } = m as Record<string, unknown>;
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (contextGeneration !== undefined && (!Number.isSafeInteger(contextGeneration) || (contextGeneration as number) < 0)) continue;
    out[accountId] = { day, ranAt: typeof ranAt === "string" ? ranAt : day, ok: ok === true, ...(contextGeneration !== undefined ? { contextGeneration: contextGeneration as number } : {}) };
  }
  return out;
}
