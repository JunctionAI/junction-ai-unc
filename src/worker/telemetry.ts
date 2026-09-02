/* The worker's telemetry jobs — one-shot flags on the CLI (src/worker/main.ts):

     --measure       measureOutcomes for every account (daily; suggested 02:00 UTC)
     --self-review   generateSelfReview for every account without this week's review
                     (weekly; suggested Mondays 06:00 — account-local scheduling is a
                     follow-up, the worker runs UTC)
     --benchmarks    computeBenchmarks over opted-in accounts → benchmarks table (weekly)

   Everything is injected (store, accounts, reader, db, llm) so the jobs run on MemoryStore
   + fixtures in tests and on SupabaseStore + real readers in production. The reader is the
   same WorkerConnectorReader the routines use, so an outcome is only ever measured from a
   certified read. See docs/IMPROVEMENT-LOOP.md. */

import type { DbClient } from "../lib/db/types";
import type { Store } from "../lib/runtime/store/interface";
import type { ConnectorReader } from "../lib/runtime/types";
import { computeBenchmarks, type AccountBenchmarkRows } from "../lib/telemetry/benchmarks";
import { measureOutcomes, type MeasureReport } from "../lib/telemetry/outcomes";
import { segmentsForAccount } from "../lib/telemetry/segments";
import { generateSelfReview, weekStartUtc, type SelfReviewLlm } from "../lib/telemetry/selfReview";
import type { AccountsSource, WorkerAccount } from "./accounts";
import type { Logger } from "./log";

export interface TelemetryDeps {
  store: Store;
  accounts: AccountsSource;
  reader: ConnectorReader;
  /** Service-role client; null in demo/fixture mode (segments then stay "all"). */
  db?: DbClient | null;
  llm?: SelfReviewLlm | null;
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
