/* The worker's in-loop scheduler for the telemetry one-shots (docs/IMPROVEMENT-LOOP.md).

   The daemon already ticks once a minute, so instead of Fly scheduled machines / a cron
   sidecar the loop runs the three jobs itself at their UTC slots, through the same
   functions the CLI flags call:

     measure       0 2 * * *    daily 02:00 UTC        runMeasure      (--measure)
     benchmarks    0 3 * * 1    Mondays 03:00 UTC      runBenchmarks   (--benchmarks)
     self_review   0 6 * * 1    Mondays 06:00 UTC      runSelfReview   (--self-review)

   "Already ran" markers: one per job — the slot it last served — kept on the heartbeat
   file (src/worker/health.ts Heartbeat.jobs) and reloaded on start, so a restart inside the
   look-back window does not double-run. A slot inside the look-back that no marker covers
   runs on the first tick that sees it (a deploy at 07:00 Monday runs all three, in this
   order — measure before benchmarks, which aggregate it). Every job is idempotent anyway
   (measure rewrites the same windows, self-review is per ISO week, benchmarks recompute),
   so the markers are about not wasting reads, not about correctness.

   Pure: no I/O, no clock of its own. */

import { latestSlotBetween } from "./cron";

export type JobId = "measure" | "benchmarks" | "self_review";

export interface ScheduledJob {
  id: JobId;
  /** 5-field UTC cron (src/worker/cron.ts). */
  cron: string;
  /** The CLI flag that runs the same thing by hand. */
  flag: string;
}

/** In run order for a tick that finds several due at once. */
export const SCHEDULED_JOBS: ScheduledJob[] = [
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
