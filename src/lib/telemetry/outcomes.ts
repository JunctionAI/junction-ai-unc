/* Outcome telemetry — every routine's KPI contract measured against actuals.

   measureOutcomes(accountId, store, reader, opts)
     for each catalog routine with a KPI contract that has ≥ 1 completed run in the
     contract's window: read the actual (a certified platform read through the injected
     ConnectorReader — the same reader the routines use — or the routine's own run ledger),
     compare to the target, and upsert one routine_outcomes row per (routine, kpi, window).
     Re-running on the same day rewrites the same row (window_end = start of today, UTC).

   scoreRoutine(outcomes) → { hit, miss, unmeasured, trend, latest }   pure.

   Honesty rules:
     - a read the platform couldn't answer (no connector, reader error, no reader yet)
       is recorded with kpi_actual = null and provenance "error:<reason>" — never a guess;
     - fixture reads are recorded with provenance "fixture" and count as unmeasured for
       scoring, so demo data can never look like a measured outcome.

   Relative imports only: this module is compiled into the worker (tsconfig.worker.json). */

import { CATALOG_SPECS } from "../runtime/catalog-specs";
import { newId, startOfDayUtc } from "../runtime/context";
import type { OutcomeRecord, Store } from "../runtime/store/interface";
import type { AccountContext, ConnectorReader, KpiContract, ReadResult, RoutineSpec, RunContext } from "../runtime/types";

export interface MeasureOptions {
  /** The account's context for the read (currency/budget/approver). Defaults to a bare
      context — reads don't spend, so caps are irrelevant here. */
  account?: Omit<AccountContext, "accountId">;
  now?: () => Date;
  /** Restrict to these routine ids (worker `--measure` measures everything by default). */
  routineIds?: string[];
  /** Override the specs (tests). Default: the catalog. */
  specs?: RoutineSpec[];
  /** Also measure routines that are not enabled (default false: only enabled routines). */
  includeDisabled?: boolean;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface MeasureReport {
  measured: OutcomeRecord[];
  /** Routines with a contract but nothing to measure (no completed run in the window / disabled). */
  skipped: { routineId: string; reason: string }[];
}

const DAY_MS = 86_400_000;

/** [windowStart, windowEnd] for a contract: the window ends at the start of the measuring
    day (UTC) so a daily run measures whole days and re-runs are idempotent. */
export function windowFor(contract: KpiContract, now: Date): { windowStart: string; windowEnd: string } {
  const windowEnd = startOfDayUtc(now.toISOString());
  const windowStart = new Date(new Date(windowEnd).getTime() - contract.windowDays * DAY_MS).toISOString();
  return { windowStart, windowEnd };
}

/** Does `actual` satisfy the contract? null actual never hits. */
export function meetsTarget(op: KpiContract["op"], target: number, actual: number | null): boolean {
  if (actual === null || !Number.isFinite(actual)) return false;
  return op === "gte" ? actual >= target : actual <= target;
}

function metricValue(result: ReadResult, name: string): number | null {
  if (name === "count") return result.rows.length;
  const v = result.metrics[name];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Resolve a read-sourced actual from a ReadResult (pure; exported for tests). */
export function actualFromRead(source: Extract<KpiContract["source"], { kind: "read" }>, result: ReadResult): number | null {
  const base = metricValue(result, source.metric);
  if (base === null) return null;
  if (source.per) {
    const denom = metricValue(result, source.per);
    if (denom === null || denom === 0) return null;
    return round2((base / denom) * (source.scale ?? 1));
  }
  return round2(base * (source.scale ?? 1));
}

function syntheticContext(accountId: string, opts: MeasureOptions, now: Date, routineId: string): RunContext {
  const account: AccountContext = { accountId, currency: opts.account?.currency ?? "NZD", budgetMonthly: opts.account?.budgetMonthly ?? 0, approver: opts.account?.approver };
  return {
    runId: `measure-${routineId}`,
    routineId,
    version: 0,
    mode: "dry_run",
    startedAt: now.toISOString(),
    account,
    caps: { currency: account.currency, perDay: 0, perMonth: 0 },
    triggeredBy: "schedule",
    vars: {},
    reads: {},
    checks: {},
  };
}

export async function measureOutcomes(accountId: string, store: Store, reader: ConnectorReader, opts: MeasureOptions = {}): Promise<MeasureReport> {
  const now = opts.now ?? (() => new Date());
  const t = now();
  const specs = (opts.specs ?? CATALOG_SPECS).filter((s) => s.kpi && (!opts.routineIds || opts.routineIds.includes(s.id)));
  const measured: OutcomeRecord[] = [];
  const skipped: MeasureReport["skipped"] = [];

  for (const spec of specs) {
    const contract = spec.kpi!;
    const state = await store.getRoutineState(accountId, spec.id);
    if (!opts.includeDisabled && !state?.enabled) {
      skipped.push({ routineId: spec.id, reason: "not enabled" });
      continue;
    }
    const { windowStart, windowEnd } = windowFor(contract, t);
    const runs = (await store.listRuns(accountId, { routineId: spec.id, status: "done", since: windowStart })).filter((r) => r.startedAt < windowEnd);
    if (!runs.length) {
      skipped.push({ routineId: spec.id, reason: "no completed run in the window" });
      continue;
    }

    let kpiActual: number | null = null;
    let provenance = "ok";
    if (contract.source.kind === "runs") {
      const src = contract.source;
      provenance = "runs";
      let n = 0;
      if (src.metric === "completed_runs") n = runs.length;
      else if (src.metric === "approved") {
        const approvals = await store.listApprovals(accountId, "approved");
        n = approvals.filter((a) => a.routineId === spec.id && a.createdAt >= windowStart && a.createdAt < windowEnd).length;
      } else {
        const kind = src.metric === "draft_receipts" ? "draft" : "mutation";
        const receipts = await store.listReceipts(accountId, { kind, since: windowStart });
        const runIds = new Set(runs.map((r) => r.id));
        n = receipts.filter((r) => runIds.has(r.runId) && r.createdAt < windowEnd).length;
      }
      kpiActual = round2(n * (src.multiplier ?? 1));
    } else {
      const src = contract.source;
      try {
        const result = await reader.read(src.platform, { resource: src.resource, window: `${contract.windowDays}d`, ...(src.query ?? {}) }, syntheticContext(accountId, opts, t, spec.id));
        provenance = result.provenance === "fixture" ? "fixture" : result.provenance === "empty" ? "empty" : "ok";
        kpiActual = actualFromRead(src, result);
        if (kpiActual === null && provenance === "ok") provenance = `error:metric "${src.metric}" not in the read`;
      } catch (err) {
        provenance = `error:${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`;
        kpiActual = null;
      }
    }

    const record: OutcomeRecord = {
      id: newId(),
      accountId,
      routineId: spec.id,
      runId: runs[0].id,
      kpiKey: contract.key,
      kpiTarget: contract.target,
      kpiOp: contract.op,
      kpiActual,
      provenance,
      windowStart,
      windowEnd,
      measuredAt: t.toISOString(),
    };
    const saved = await store.upsertOutcome(record);
    measured.push(saved);
    opts.log?.("outcome.measured", { accountId, routineId: spec.id, kpi: contract.key, target: contract.target, actual: kpiActual, provenance });
  }
  return { measured, skipped };
}

// ---------- scoring (pure) ----------

export type Trend = "up" | "down" | "flat" | "unknown";

export interface RoutineScore {
  /** Windows where the actual met the target. */
  hit: number;
  /** Windows measured (real actual) that missed. */
  miss: number;
  /** Windows with no usable actual (couldn't ask, fixture). */
  unmeasured: number;
  /** Direction of the two most recent measured actuals, in the contract's good direction:
      "up" = improving, "down" = worsening. */
  trend: Trend;
  latest: OutcomeRecord | null;
}

/** A measured actual is one the platform (or the ledger) actually answered. */
export function isMeasured(o: OutcomeRecord): boolean {
  return o.kpiActual !== null && Number.isFinite(o.kpiActual) && (o.provenance === "ok" || o.provenance === "empty" || o.provenance === "runs");
}

export function scoreRoutine(outcomes: OutcomeRecord[]): RoutineScore {
  const sorted = [...outcomes].sort((a, b) => (a.windowEnd < b.windowEnd ? -1 : a.windowEnd > b.windowEnd ? 1 : 0));
  let hit = 0;
  let miss = 0;
  let unmeasured = 0;
  for (const o of sorted) {
    if (!isMeasured(o)) unmeasured++;
    else if (meetsTarget(o.kpiOp, o.kpiTarget, o.kpiActual)) hit++;
    else miss++;
  }
  const measured = sorted.filter(isMeasured);
  let trend: Trend = "unknown";
  if (measured.length >= 2) {
    const prev = measured[measured.length - 2].kpiActual!;
    const last = measured[measured.length - 1];
    const delta = last.kpiActual! - prev;
    const improving = last.kpiOp === "gte" ? delta > 0 : delta < 0;
    trend = delta === 0 ? "flat" : improving ? "up" : "down";
  }
  return { hit, miss, unmeasured, trend, latest: sorted.length ? sorted[sorted.length - 1] : null };
}

/** Latest outcome per routine (newest window wins). */
export function latestByRoutine(outcomes: OutcomeRecord[]): Map<string, OutcomeRecord> {
  const out = new Map<string, OutcomeRecord>();
  for (const o of outcomes) {
    const cur = out.get(o.routineId);
    if (!cur || o.windowEnd > cur.windowEnd) out.set(o.routineId, o);
  }
  return out;
}
