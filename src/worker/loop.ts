/* The always-on worker loop.

   Every `intervalSec` (default 60): for each account → collect schedule
   candidates → pick the due ones → dry-run each through the shared service
   (src/worker/service.ts — the same code path as POST /api/routines/run).
   Structured JSON logs, a heartbeat file, a per-tick time budget, graceful
   SIGTERM/SIGINT.

   DRY-RUN ONLY: see LIVE_MODE_ENABLED in service.ts. The executor refuses
   every mutation regardless. Credentials are fixture markers unless a real
   CredentialProvider is injected (none is shipped).

   Housekeeping the same tick does, after the routines (all env-gated on a DB):
     - the telemetry jobs at their UTC slots (src/worker/jobs.ts: kpi snapshot daily 01:30,
       measure daily 02:00, benchmarks Mondays 03:00, self-review Mondays 06:00) with per-job
       "already ran" markers on the heartbeat file so a restart doesn't double-run;
     - Unc's daily brief at 06:30 in each account's own timezone (jobs.ts dueBriefs, one
       marker per account on the same heartbeat; the daily_briefs row is the durable dedup);
     - sweepOauthStates() once an hour (expired 10-minute Connect states).

   Deps are injected (WorkerDeps) so tests run a tick against MemoryStore and
   a static accounts source with no timers, files or signals. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sweepOauthStates } from "../lib/connectors/store";
import type { DbClient } from "../lib/db/types";
import { BUDGET_EXHAUSTED_LINE, checkBudget } from "../lib/llm/budget";
import { CATALOG_SPEC_BY_ID } from "../lib/runtime/catalog-specs";
import type { RunStatus } from "../lib/runtime/types";
import type { Heartbeat } from "./health";
import { DEFAULT_JOB_LOOKBACK_MS, dueBriefs, dueJobs, sanitiseBriefMarkers, sanitiseMarkers, type BriefCandidate, type BriefMarkers, type JobId, type JobMarkers } from "./jobs";
import { createLogger, type Logger } from "./log";
import { dueRoutines, type DueRoutine } from "./scheduler";
import { buildAdapters, collectCandidates, LIVE_MODE_ENABLED, triggerRun, WORKER_RUN_MODE, type BuiltAdapters, type ServiceDeps } from "./service";
import { runBenchmarks, runDailyBrief, runKpiSnapshot, runMeasure, runSelfReview, type TelemetryDeps } from "./telemetry";
import { runDatasetSyncTick } from "./datasets";
import { runChannelsTick, type ChannelsTickReport } from "./channels";
import { keyringFromEnv } from "../lib/connectors/crypto";
import type { SelfReviewLlm } from "../lib/telemetry/selfReview";
import { readTimezone, type BriefLlm } from "../lib/brain/brief";
import { runCommandsTick } from "./commands";

export interface WorkerOptions {
  /** Seconds between ticks. Default 60. */
  intervalSec?: number;
  /** Stop starting new runs once a tick has used this much time; the rest
      stay due for the next tick. Default 80% of the interval. */
  tickBudgetMs?: number;
  /** Scheduler look-back for missed slots (see scheduler.ts). */
  lookbackMs?: number;
  /** Where the heartbeat JSON is written; null disables the file. */
  heartbeatPath?: string | null;
  /** Install SIGTERM/SIGINT handlers in start(). Default true; tests pass false. */
  handleSignals?: boolean;
  /** Run the scheduled telemetry jobs inside the loop (jobs.ts). Default true. */
  jobs?: boolean;
  /** How long a missed job slot is still picked up. Default 6 h. */
  jobLookbackMs?: number;
  /** How often expired oauth_states are swept (needs deps.db). Default 1 h. */
  sweepIntervalMs?: number;
  /** Run the account-local daily brief inside the loop (needs deps.db). Default true. */
  briefs?: boolean;
}

export interface WorkerDeps extends ServiceDeps {
  /** Service-role client for housekeeping (oauth_states sweep, benchmark segments).
      null / absent in demo mode: nothing DB-shaped runs. */
  db?: DbClient | null;
  /** Model client for the weekly self-review (task "self_review"); falls back to `llm`
      so existing fixtures keep working. null = deterministic review. */
  reviewLlm?: SelfReviewLlm | null;
  /** Model client for the daily brief (task "daily_brief"); null = deterministic brief. */
  briefLlm?: BriefLlm | null;
}

export const DEFAULT_SWEEP_INTERVAL_MS = 3_600_000;

export interface TickRunReport {
  accountId: string;
  routineId: string;
  slot: string;
  runId?: string;
  status: RunStatus | "error";
  summary?: string;
  error?: string;
}

export interface TickReport {
  /** Channel pushes (briefs, drafts, approvals, reminders) sent this tick; undefined in demo mode. */
  channels?: ChannelsTickReport;
  at: string;
  accounts: number;
  candidates: number;
  due: number;
  started: TickRunReport[];
  /** Due routines not started because the tick budget ran out. */
  deferred: number;
  /** Due produce routines skipped because their account is over its monthly model-spend cap. */
  budgetSkipped: number;
  /** Scheduled telemetry jobs this tick ran (jobs.ts), in order. */
  jobs: JobId[];
  /** Accounts whose daily brief this tick served (account-local 06:30). */
  briefs: string[];
  /** True when the hourly oauth_states sweep ran this tick. */
  swept: boolean;
  ms: number;
}

export interface WorkerStats {
  startedAt: string;
  ticks: number;
  runsStarted: number;
  lastTickAt: string | null;
  lastTickMs: number | null;
  lastError?: string;
  jobs: JobMarkers;
  briefs: BriefMarkers;
  lastSweepAt: string | null;
}

export class Worker {
  readonly log: Logger;
  readonly adapters: BuiltAdapters;
  readonly stats: WorkerStats;
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly tickBudgetMs: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<TickReport> | null = null;
  private stopping = false;
  private removeSignalHandlers: (() => void) | null = null;

  constructor(
    private readonly deps: WorkerDeps,
    private readonly opts: WorkerOptions = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? createLogger(undefined, { worker: "unc", mode: WORKER_RUN_MODE }, this.now);
    this.adapters = buildAdapters({ ...deps, log: this.log });
    this.intervalMs = Math.max(1, opts.intervalSec ?? 60) * 1000;
    this.tickBudgetMs = opts.tickBudgetMs ?? Math.floor(this.intervalMs * 0.8);
    // Job markers survive a restart through the heartbeat file (a restart inside the
    // look-back window must not re-run the day's jobs).
    const previous = opts.heartbeatPath ? readHeartbeatFile(opts.heartbeatPath) : null;
    this.stats = { startedAt: this.now().toISOString(), ticks: 0, runsStarted: 0, lastTickAt: null, lastTickMs: null, jobs: sanitiseMarkers(previous?.jobs), briefs: sanitiseBriefMarkers(previous?.briefs), lastSweepAt: null };
  }

  // ----- one tick -----

  /** Run one scheduling pass. Safe to call directly (tests, --once). */
  async tick(now: Date = this.now()): Promise<TickReport> {
    const t0 = Date.now();
    const report: TickReport = { at: now.toISOString(), accounts: 0, candidates: 0, due: 0, started: [], deferred: 0, budgetSkipped: 0, jobs: [], briefs: [], swept: false, ms: 0 };
    try {
      await runCommandsTick(this.deps, this.adapters, this.tickBudgetMs);
    } catch {
      this.log.warn("commands.tick_failed", { reason: "command queue unavailable; queued work was not acknowledged as complete" });
    }
    try {
      const accounts = await this.deps.accounts.listAccounts();
      report.accounts = accounts.length;
      const due: DueRoutine[] = [];
      for (const a of accounts) {
        const candidates = await collectCandidates(this.deps.store, a.account.accountId);
        report.candidates += candidates.length;
        due.push(...dueRoutines(now, candidates, { lookbackMs: this.opts.lookbackMs }));
      }
      report.due = due.length;
      this.log.info("tick.start", { at: report.at, accounts: report.accounts, candidates: report.candidates, due: report.due });

      // Accounts over their monthly model-spend cap (src/lib/llm/budget.ts): their produce
      // routines wait; everything deterministic still runs.
      const overCap = await this.overCapAccounts(due, now);
      for (let i = 0; i < due.length; i++) {
        if (this.stopping) {
          report.deferred = due.length - i;
          this.log.warn("tick.stopping", { deferred: report.deferred });
          break;
        }
        if (Date.now() - t0 > this.tickBudgetMs) {
          report.deferred = due.length - i;
          this.log.warn("tick.budget_exhausted", { budgetMs: this.tickBudgetMs, deferred: report.deferred });
          break;
        }
        const d = due[i];
        if (overCap.has(d.accountId) && routineProduces(d.routineId)) {
          report.budgetSkipped += 1;
          this.log.info("run.budget_skipped", { accountId: d.accountId, routineId: d.routineId, slot: d.slot.toISOString() });
          report.started.push({ accountId: d.accountId, routineId: d.routineId, slot: d.slot.toISOString(), status: "skipped", summary: BUDGET_EXHAUSTED_LINE });
          continue;
        }
        report.started.push(await this.runOne(d));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.stats.lastError = message;
      this.log.error("tick.error", { error: message });
    }
    // Housekeeping after the routines: each part isolates its own failures.
    try { await runDatasetSyncTick(this.deps); } catch { this.log.warn("dataset.scheduler_failed", { reason: "data sync unavailable" }); }
    if (this.opts.jobs ?? true) report.jobs = await this.runDueJobs(now);
    if (this.opts.briefs ?? true) report.briefs = await this.runDueBriefs(now);
    if (this.deps.db) {
      try {
        report.channels = await runChannelsTick({ store: this.deps.store, db: this.deps.db, now: this.now, log: this.log, env: process.env, keyring: keyringFromEnv(process.env) });
      } catch (err) {
        this.log.warn("channels.tick_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    report.swept = await this.sweepIfDue(now);
    report.ms = Date.now() - t0;
    this.stats.ticks += 1;
    this.stats.lastTickAt = report.at;
    this.stats.lastTickMs = report.ms;
    this.log.info("tick.end", { at: report.at, started: report.started.length, deferred: report.deferred, ms: report.ms });
    this.writeHeartbeat();
    return report;
  }

  /** Which of the due accounts are over their cap this month (needs deps.db; else none). */
  private async overCapAccounts(due: DueRoutine[], now: Date): Promise<Set<string>> {
    const out = new Set<string>();
    const db = this.deps.db;
    if (!db) return out;
    for (const accountId of new Set(due.map((d) => d.accountId))) {
      try {
        const b = await checkBudget(db, accountId, { now: () => now, log: (event, fields) => this.log.warn(event, fields) });
        if (!b.ok) out.add(accountId);
      } catch (err) {
        this.log.warn("budget.check_failed", { accountId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  }

  private async runOne(d: DueRoutine): Promise<TickRunReport> {
    const base = { accountId: d.accountId, routineId: d.routineId, slot: d.slot.toISOString() };
    try {
      const result = await triggerRun(this.deps, { accountId: d.accountId, routineId: d.routineId, mode: WORKER_RUN_MODE, triggeredBy: "schedule" }, this.adapters);
      this.stats.runsStarted += 1;
      return { ...base, runId: result.runId, status: result.status, summary: result.summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.stats.lastError = message;
      this.log.error("run.error", { ...base, error: message });
      return { ...base, status: "error", error: message };
    }
  }

  // ----- scheduled telemetry jobs (jobs.ts) -----

  private telemetryDeps(): TelemetryDeps {
    return { store: this.deps.store, accounts: this.deps.accounts, reader: this.adapters.reader, db: this.deps.db ?? null, llm: this.deps.reviewLlm ?? this.deps.llm ?? null, briefLlm: this.deps.briefLlm ?? null, now: this.now, log: this.log };
  }

  /** Run every job whose slot is due and unserved; the marker is written whatever
      happened, so a failing job waits for its next slot instead of retrying every minute. */
  private async runDueJobs(now: Date): Promise<JobId[]> {
    const ran: JobId[] = [];
    for (const { job, slot } of dueJobs(now, this.stats.jobs, this.opts.jobLookbackMs ?? DEFAULT_JOB_LOOKBACK_MS)) {
      if (this.stopping) break;
      const t0 = Date.now();
      const base = { job: job.id, slot: slot.toISOString() };
      this.log.info("job.start", base);
      try {
        const deps = this.telemetryDeps();
        if (job.id === "kpi_snapshot") {
          const r = await runKpiSnapshot(deps);
          this.log.info("job.finish", { ...base, accounts: r.accounts, written: r.written, couldntAsk: r.couldntAsk, skipped: r.skipped, ms: Date.now() - t0 });
        } else if (job.id === "measure") {
          const r = await runMeasure(deps);
          this.log.info("job.finish", { ...base, accounts: r.accounts, measured: r.measured, skipped: r.skipped, ms: Date.now() - t0 });
        } else if (job.id === "benchmarks") {
          const r = await runBenchmarks(deps);
          this.log.info("job.finish", { ...base, ...r, ms: Date.now() - t0 });
        } else {
          const r = await runSelfReview(deps);
          this.log.info("job.finish", { ...base, accounts: r.accounts, written: r.written.length, alreadyDone: r.alreadyDone.length, ms: Date.now() - t0 });
        }
        this.stats.jobs[job.id] = { lastSlot: base.slot, ranAt: this.now().toISOString(), ok: true, ms: Date.now() - t0 };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.stats.lastError = message;
        this.log.error("job.error", { ...base, error: message });
        this.stats.jobs[job.id] = { lastSlot: base.slot, ranAt: this.now().toISOString(), ok: false, error: message, ms: Date.now() - t0 };
      }
      ran.push(job.id);
    }
    return ran;
  }

  // ----- the daily brief (account-local 06:30) -----

  /** Every account whose local 06:30 slot is inside the look-back and not yet served today.
      No DB → nothing (demo mode has no briefs). A failing brief is marked served for the day. */
  private async runDueBriefs(now: Date): Promise<string[]> {
    const db = this.deps.db;
    if (!db) return [];
    const served: string[] = [];
    let candidates: BriefCandidate[];
    try {
      const accounts = await this.deps.accounts.listAccounts();
      candidates = [];
      for (const a of accounts) {
        const id = a.account.accountId;
        let timezone: string | null = null;
        try {
          timezone = await readTimezone(db, id);
        } catch (err) {
          this.log.warn("brief.timezone_failed", { accountId: id, error: err instanceof Error ? err.message : String(err) });
        }
        candidates.push({ accountId: id, timezone });
      }
    } catch (err) {
      this.log.warn("brief.candidates_failed", { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
    for (const d of dueBriefs(now, candidates, this.stats.briefs, this.opts.jobLookbackMs ?? DEFAULT_JOB_LOOKBACK_MS)) {
      if (this.stopping) break;
      const t0 = Date.now();
      const base = { job: "daily_brief", accountId: d.accountId, day: d.day, slot: d.slot.toISOString(), timezone: d.timezone ?? "UTC" };
      this.log.info("job.start", base);
      try {
        const r = await runDailyBrief(this.telemetryDeps(), { accountId: d.accountId, timezone: d.timezone });
        this.log.info("job.finish", { ...base, written: r.written.length, alreadyDone: r.alreadyDone.length, ms: Date.now() - t0 });
        this.stats.briefs[d.accountId] = { day: d.day, ranAt: this.now().toISOString(), ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.stats.lastError = message;
        this.log.error("job.error", { ...base, error: message });
        this.stats.briefs[d.accountId] = { day: d.day, ranAt: this.now().toISOString(), ok: false, error: message };
      }
      served.push(d.accountId);
    }
    return served;
  }

  // ----- oauth_states sweep -----

  private async sweepIfDue(now: Date): Promise<boolean> {
    const db = this.deps.db;
    if (!db) return false;
    const every = this.opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    const last = this.stats.lastSweepAt ? new Date(this.stats.lastSweepAt).getTime() : null;
    if (last !== null && now.getTime() - last < every) return false;
    try {
      await sweepOauthStates(db, now.toISOString());
      this.log.info("sweep.oauth_states", { at: now.toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn("sweep.failed", { error: message });
    }
    // Either way the next attempt is an interval away — a broken DB must not be hammered per tick.
    this.stats.lastSweepAt = now.toISOString();
    return true;
  }

  // ----- lifecycle -----

  start(): void {
    if (this.timer) return;
    this.log.info("worker.start", { intervalMs: this.intervalMs, tickBudgetMs: this.tickBudgetMs, liveModeEnabled: LIVE_MODE_ENABLED, heartbeatPath: this.opts.heartbeatPath ?? null });
    this.writeHeartbeat();
    const fire = () => {
      if (this.inFlight || this.stopping) return; // never overlap ticks
      this.inFlight = this.tick().finally(() => {
        this.inFlight = null;
      });
    };
    this.timer = setInterval(fire, this.intervalMs);
    fire();
    if (this.opts.handleSignals ?? true) {
      const onSignal = (signal: string) => {
        this.log.info("worker.signal", { signal });
        void this.stop().then(() => process.exit(0));
      };
      const term = () => onSignal("SIGTERM");
      const int = () => onSignal("SIGINT");
      process.once("SIGTERM", term);
      process.once("SIGINT", int);
      this.removeSignalHandlers = () => {
        process.off("SIGTERM", term);
        process.off("SIGINT", int);
      };
    }
  }

  /** Stop the timer, let the in-flight tick finish, write a final heartbeat. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.removeSignalHandlers?.();
    this.removeSignalHandlers = null;
    if (this.inFlight) await this.inFlight;
    this.writeHeartbeat();
    this.log.info("worker.stop", { ticks: this.stats.ticks, runsStarted: this.stats.runsStarted });
  }

  get isStopping() {
    return this.stopping;
  }

  /** Resolves once no tick is in flight (tests, orderly shutdown). */
  async whenIdle(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  // ----- heartbeat -----

  heartbeat(): Heartbeat {
    return {
      pid: process.pid,
      startedAt: this.stats.startedAt,
      lastTickAt: this.stats.lastTickAt,
      lastTickMs: this.stats.lastTickMs,
      ticks: this.stats.ticks,
      runsStarted: this.stats.runsStarted,
      mode: "dry_run",
      liveModeEnabled: false,
      stopping: this.stopping,
      jobs: this.stats.jobs,
      briefs: this.stats.briefs,
      lastSweepAt: this.stats.lastSweepAt,
      ...(this.stats.lastError ? { lastError: this.stats.lastError } : {}),
    };
  }

  writeHeartbeat(): void {
    const hb = this.heartbeat();
    void this.upsertHeartbeatRow(hb);
    const path = this.opts.heartbeatPath;
    if (!path) return;
    try {
      writeHeartbeatFile(path, hb);
    } catch (err) {
      this.log.warn("heartbeat.write_failed", { path, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** worker_heartbeats (migration 0014): the same heartbeat, one row, so GET /api/health can
      say "worker last seen …". Best effort; never blocks a tick. */
  private async upsertHeartbeatRow(hb: Heartbeat): Promise<void> {
    const db = this.deps.db;
    if (!db) return;
    try {
      const { error } = await db
        .from("worker_heartbeats")
        .upsert({ worker: WORKER_HEARTBEAT_NAME, pid: hb.pid, started_at: hb.startedAt, last_tick_at: hb.lastTickAt, last_tick_ms: hb.lastTickMs, ticks: hb.ticks, runs_started: hb.runsStarted, stopping: hb.stopping, last_error: hb.lastError ?? null, updated_at: this.now().toISOString() }, { onConflict: "worker" });
      if (error) this.log.warn("heartbeat.row_failed", { error: error.message });
    } catch (err) {
      this.log.warn("heartbeat.row_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export const WORKER_HEARTBEAT_NAME = "unc";

function routineProduces(routineId: string): boolean {
  return !!CATALOG_SPEC_BY_ID[routineId]?.nodes.some((n) => n.kind === "produce" || n.kind === "n8n");
}

// ---------- heartbeat file helpers ----------

export function writeHeartbeatFile(path: string, hb: Heartbeat): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(hb, null, 2));
  renameSync(tmp, path); // atomic on POSIX
}

export function readHeartbeatFile(path: string): Heartbeat | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Heartbeat;
  } catch {
    return null;
  }
}
