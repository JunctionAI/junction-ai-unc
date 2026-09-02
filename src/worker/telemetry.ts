/* The worker's telemetry jobs — one-shot flags on the CLI (src/worker/main.ts):

     --measure       measureOutcomes for every account (daily; suggested 02:00 UTC)
     --self-review   generateSelfReview for every account without this week's review
                     (weekly; suggested Mondays 06:00 — account-local scheduling is a
                     follow-up, the worker runs UTC)
     --benchmarks    computeBenchmarks over opted-in accounts → benchmarks table (weekly)
     --kpi-snapshot  snapshotKpis for every account with a connected platform → kpi_snapshots
                     (daily 01:30 UTC; docs/PROACTIVE.md)
     --daily-brief   refresh taste patterns → account_profiles.decision_style, then Unc's
                     daily brief → daily_briefs (06:30 account-local in the loop; the flag runs
                     it now, idempotent per local day)

   Everything is injected (store, accounts, reader, db, llm) so the jobs run on MemoryStore
   + fixtures in tests and on SupabaseStore + real readers in production. The reader is the
   same WorkerConnectorReader the routines use, so an outcome is only ever measured from a
   certified read. See docs/IMPROVEMENT-LOOP.md. */

import { generateDailyBrief, readTimezone, type BriefLlm } from "../lib/brain/brief";
import { accountsWithConnectors, snapshotKpis, type SnapshotReport } from "../lib/brain/kpi";
import { deriveDecisionStyle, tastePatterns, writeDecisionStyle } from "../lib/brain/taste";
import type { DbClient } from "../lib/db/types";
import type { Store } from "../lib/runtime/store/interface";
import type { ConnectorReader } from "../lib/runtime/types";
import { computeBenchmarks, type AccountBenchmarkRows } from "../lib/telemetry/benchmarks";
import { measureOutcomes, type MeasureReport } from "../lib/telemetry/outcomes";
import { segmentsForAccount } from "../lib/telemetry/segments";
import { generateSelfReview, weekStartUtc, type SelfReviewLlm } from "../lib/telemetry/selfReview";
import { afterSelfReview } from "../lib/brain/hooks";
import type { AccountsSource, WorkerAccount } from "./accounts";
import type { Logger } from "./log";

export interface TelemetryDeps {
  store: Store;
  accounts: AccountsSource;
  reader: ConnectorReader;
  /** Service-role client; null in demo/fixture mode (segments then stay "all"). */
  db?: DbClient | null;
  llm?: SelfReviewLlm | null;
  /** Model client for the daily brief (task "daily_brief"); null = deterministic brief. */
  briefLlm?: BriefLlm | null;
  now?: () => Date;
  log?: Logger;
}

const DAY_MS = 86_400_000;

async function targets(deps: TelemetryDeps, accountId?: string): Promise<WorkerAccount[]> {
  if (accountId) {
    const a = await deps.accounts.getAccount(accountId);
    return a ? [a] : [];
  }
  return deps.accounts.listAccounts();
}

// ---------- --measure ----------

export interface MeasureJobReport {
  accounts: number;
  measured: number;
  skipped: number;
  perAccount: { accountId: string; report: MeasureReport }[];
}

export async function runMeasure(deps: TelemetryDeps, opts: { accountId?: string } = {}): Promise<MeasureJobReport> {
  const out: MeasureJobReport = { accounts: 0, measured: 0, skipped: 0, perAccount: [] };
  for (const acct of await targets(deps, opts.accountId)) {
    out.accounts++;
    const report = await measureOutcomes(acct.account.accountId, deps.store, deps.reader, {
      account: acct.account,
      now: deps.now,
      log: deps.log ? (event, fields) => deps.log!.info(event, fields) : undefined,
    });
    out.measured += report.measured.length;
    out.skipped += report.skipped.length;
    out.perAccount.push({ accountId: acct.account.accountId, report });
  }
  deps.log?.info("measure.done", { accounts: out.accounts, measured: out.measured, skipped: out.skipped });
  return out;
}

// ---------- --self-review ----------

export interface SelfReviewJobReport {
  accounts: number;
  written: { accountId: string; weekStart: string; author: string; liveFields: number; changes: number }[];
  /** Accounts that already had this week's review (idempotent — nothing rewritten). */
  alreadyDone: string[];
}

export async function runSelfReview(deps: TelemetryDeps, opts: { accountId?: string; force?: boolean } = {}): Promise<SelfReviewJobReport> {
  const now = (deps.now ?? (() => new Date()))();
  const thisWeek = weekStartUtc(now);
  const out: SelfReviewJobReport = { accounts: 0, written: [], alreadyDone: [] };
  for (const acct of await targets(deps, opts.accountId)) {
    out.accounts++;
    const id = acct.account.accountId;
    if (!opts.force) {
      const latest = await deps.store.getLatestSelfReview(id);
      if (latest && latest.weekStart === thisWeek) {
        out.alreadyDone.push(id);
        continue;
      }
    }
    const g = await generateSelfReview({ store: deps.store, accountId: id, now: deps.now, llm: deps.llm ?? null, log: deps.log ? (event, fields) => deps.log!.info(event, fields) : undefined });
    out.written.push({ accountId: id, weekStart: g.record.weekStart, author: g.author, liveFields: g.liveFields, changes: g.record.changes.length });
    // Client Brain: the review's lessons become memories; failures are logged, never fatal for the job.
    try { await afterSelfReview(g.record); } catch (err) { deps.log?.warn?.("self_review.memory_hook_failed", { accountId: id, error: err instanceof Error ? err.message : String(err) }); }
  }
  deps.log?.info("self_review.done", { accounts: out.accounts, written: out.written.length, alreadyDone: out.alreadyDone.length });
  return out;
}

// ---------- --benchmarks ----------

export interface BenchmarkJobReport {
  /** Accounts with ≥ 1 outcome in the look-back (opted in or not). */
  accounts: number;
  optedIn: number;
  published: number;
  /** metric/segment pairs suppressed because n < 5. */
  suppressed: number;
}

/** Look-back for "latest measured value per account": 35 days covers the 28-day contracts. */
export const BENCHMARK_LOOKBACK_DAYS = 35;

export async function runBenchmarks(deps: TelemetryDeps): Promise<BenchmarkJobReport> {
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - BENCHMARK_LOOKBACK_DAYS * DAY_MS).toISOString();
  const [outcomes, optins] = await Promise.all([deps.store.listOutcomesAcrossAccounts(since), deps.store.listBenchmarkOptins()]);
  const optinById = new Map(optins.map((o) => [o.accountId, o.optedIn]));
  const byAccount = new Map<string, AccountBenchmarkRows>();
  for (const o of outcomes) {
    let row = byAccount.get(o.accountId);
    if (!row) {
      // no opt-in row = the default (opted in); an explicit false opts out
      row = { accountId: o.accountId, optedIn: optinById.get(o.accountId) ?? true, segments: [], outcomes: [] };
      byAccount.set(o.accountId, row);
    }
    row.outcomes.push(o);
  }
  if (deps.db) {
    for (const row of byAccount.values()) {
      if (!row.optedIn) continue;
      try {
        row.segments = await segmentsForAccount(deps.db, row.accountId);
      } catch (err) {
        deps.log?.warn("benchmarks.segments_failed", { accountId: row.accountId, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  const rows = [...byAccount.values()];
  const published = computeBenchmarks(rows, { now: deps.now });
  // how many metric/segment pairs existed at all, for the log
  const pairs = new Set<string>();
  for (const r of rows) if (r.optedIn) for (const o of r.outcomes) for (const s of ["all", ...r.segments]) pairs.add(`${o.kpiKey}:${s}`);
  await deps.store.putBenchmarks(published);
  const report = { accounts: rows.length, optedIn: rows.filter((r) => r.optedIn).length, published: published.length, suppressed: Math.max(0, pairs.size - published.length) };
  deps.log?.info("benchmarks.done", report);
  return report;
}

// ---------- --kpi-snapshot ----------

export interface KpiSnapshotJobReport {
  /** Accounts with ≥ 1 connected platform (or the one account asked for). */
  accounts: number;
  written: number;
  couldntAsk: number;
  /** True when there is no database — nothing to read connectors from or write to. */
  skipped: boolean;
  perAccount: SnapshotReport[];
}

/** Every account with a connected platform → one snapshot each. Demo mode (no DB) does nothing:
    there is no connectors table to consult and no kpi_snapshots table to write. */
export async function runKpiSnapshot(deps: TelemetryDeps, opts: { accountId?: string } = {}): Promise<KpiSnapshotJobReport> {
  const out: KpiSnapshotJobReport = { accounts: 0, written: 0, couldntAsk: 0, skipped: false, perAccount: [] };
  if (!deps.db) {
    out.skipped = true;
    deps.log?.info("kpi_snapshot.skipped", { reason: "no database" });
    return out;
  }
  const ids = opts.accountId ? [opts.accountId] : await accountsWithConnectors(deps.db);
  for (const accountId of ids) {
    out.accounts++;
    const acct = await deps.accounts.getAccount(accountId);
    const report = await snapshotKpis({ db: deps.db, reader: deps.reader, accountId, account: acct?.account, now: deps.now, log: deps.log ? (event, fields) => deps.log!.info(event, fields) : undefined });
    out.written += report.written.length;
    out.couldntAsk += report.couldntAsk.length;
    out.perAccount.push(report);
  }
  deps.log?.info("kpi_snapshot.done", { accounts: out.accounts, written: out.written, couldntAsk: out.couldntAsk });
  return out;
}

// ---------- --daily-brief ----------

export interface DailyBriefJobReport {
  accounts: number;
  written: { accountId: string; day: string; author: string; items: number }[];
  /** Accounts that already had today's brief (idempotent — nothing rewritten). */
  alreadyDone: string[];
  skipped: boolean;
}

/** Refresh this account's taste patterns into account_profiles.decision_style (jsonb merge on
    that one key). Separate so a brief still lands when the profile write fails. */
export async function refreshDecisionStyle(deps: TelemetryDeps, accountId: string, currency: string): Promise<void> {
  if (!deps.db) return;
  const now = (deps.now ?? (() => new Date()))();
  const patterns = await tastePatterns(deps.store, accountId, { now: deps.now, currency });
  await writeDecisionStyle(deps.db, accountId, deriveDecisionStyle(patterns, now), now);
  deps.log?.info("taste.decision_style", { accountId, decided: patterns.decided, approvalRatePct: patterns.approvalRatePct, ceiling: patterns.maxApprovedPerDay });
}

/** One brief per account per local day. `force` regenerates today's. Demo mode does nothing. */
export async function runDailyBrief(deps: TelemetryDeps, opts: { accountId?: string; force?: boolean; timezone?: string | null } = {}): Promise<DailyBriefJobReport> {
  const out: DailyBriefJobReport = { accounts: 0, written: [], alreadyDone: [], skipped: false };
  if (!deps.db) {
    out.skipped = true;
    deps.log?.info("daily_brief.skipped", { reason: "no database" });
    return out;
  }
  const db = deps.db;
  for (const acct of await targets(deps, opts.accountId)) {
    out.accounts++;
    const id = acct.account.accountId;
    try {
      await refreshDecisionStyle(deps, id, acct.account.currency);
    } catch (err) {
      deps.log?.warn("taste.refresh_failed", { accountId: id, error: err instanceof Error ? err.message : String(err) });
    }
    const timezone = opts.timezone !== undefined ? opts.timezone : await readTimezone(db, id);
    const g = await generateDailyBrief({ store: deps.store, db, accountId: id, now: deps.now, llm: deps.briefLlm ?? null, timezone, force: opts.force, log: deps.log ? (event, fields) => deps.log!.info(event, fields) : undefined });
    if (g.existed) out.alreadyDone.push(id);
    else out.written.push({ accountId: id, day: g.record.day, author: g.author, items: g.record.items.length });
  }
  deps.log?.info("daily_brief.done", { accounts: out.accounts, written: out.written.length, alreadyDone: out.alreadyDone.length });
  return out;
}
