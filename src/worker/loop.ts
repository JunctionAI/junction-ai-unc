/* The always-on worker loop.

   Every `intervalSec` (default 60): for each account → collect schedule
   candidates → pick the due ones → dry-run each through the shared service
   (src/worker/service.ts — the same code path as POST /api/routines/run).
   Structured JSON logs, a heartbeat file, a per-tick time budget, graceful
   SIGTERM/SIGINT.

   DRY-RUN ONLY: see LIVE_MODE_ENABLED in service.ts. The executor refuses
   every mutation regardless. Credentials are fixture markers unless a real
   CredentialProvider is injected (none is shipped).

   Deps are injected (WorkerDeps) so tests run a tick against MemoryStore and
   a static accounts source with no timers, files or signals. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RunStatus } from "../lib/runtime/types";
import type { Heartbeat } from "./health";
import { createLogger, type Logger } from "./log";
import { dueRoutines, type DueRoutine } from "./scheduler";
import { buildAdapters, collectCandidates, LIVE_MODE_ENABLED, triggerRun, WORKER_RUN_MODE, type BuiltAdapters, type ServiceDeps } from "./service";

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
}

export type WorkerDeps = ServiceDeps;

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
  at: string;
  accounts: number;
  candidates: number;
  due: number;
  started: TickRunReport[];
  /** Due routines not started because the tick budget ran out. */
  deferred: number;
  ms: number;
}

export interface WorkerStats {
  startedAt: string;
  ticks: number;
  runsStarted: number;
  lastTickAt: string | null;
  lastTickMs: number | null;
  lastError?: string;
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
    this.stats = { startedAt: this.now().toISOString(), ticks: 0, runsStarted: 0, lastTickAt: null, lastTickMs: null };
  }

  // ----- one tick -----

  /** Run one scheduling pass. Safe to call directly (tests, --once). */
  async tick(now: Date = this.now()): Promise<TickReport> {
    const t0 = Date.now();
    const report: TickReport = { at: now.toISOString(), accounts: 0, candidates: 0, due: 0, started: [], deferred: 0, ms: 0 };
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
        report.started.push(await this.runOne(due[i]));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.stats.lastError = message;
      this.log.error("tick.error", { error: message });
    }
    report.ms = Date.now() - t0;
    this.stats.ticks += 1;
    this.stats.lastTickAt = report.at;
    this.stats.lastTickMs = report.ms;
    this.log.info("tick.end", { at: report.at, started: report.started.length, deferred: report.deferred, ms: report.ms });
    this.writeHeartbeat();
    return report;
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
      ...(this.stats.lastError ? { lastError: this.stats.lastError } : {}),
    };
  }

  writeHeartbeat(): void {
    const path = this.opts.heartbeatPath;
    if (!path) return;
    try {
      writeHeartbeatFile(path, this.heartbeat());
    } catch (err) {
      this.log.warn("heartbeat.write_failed", { path, error: err instanceof Error ? err.message : String(err) });
    }
  }
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
