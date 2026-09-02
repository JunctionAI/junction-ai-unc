/* The benchmark moat — "The bar" fed from anonymised cross-account aggregates.

   computeBenchmarks(rowsByAccount, opts) → BenchmarkRecord[]        pure
     Per metric_key × segment: p50 and p75 over the opted-in accounts' latest measured
     actual for that metric. A row is published ONLY when n ≥ 5 distinct accounts
     contributed (ANONYMISATION_FLOOR) — fewer than five and the aggregate could be
     reversed back to a business, so it is suppressed entirely, not rounded.

   Segments: every account is in "all"; the worker adds "shopify" (a connected Shopify
   store) and "revenue_band:<band>" (from the governing revenue goal's baseline, ×12 →
   annual). Segment membership is an input here, resolved by the caller (src/worker/telemetry.ts
   in production, fixtures in tests) — this module never reads the database.

   benchmarkFor(metricKey, segment, rows) picks the most specific published row, falling
   back to "all". barInput() is what the Home mapper consumes. */

import type { BenchmarkRecord, OutcomeRecord } from "../runtime/store/interface";
import { isMeasured, latestByRoutine } from "./outcomes";

export const ANONYMISATION_FLOOR = 5;

/** The three "The bar" cards, in Home order, and the KPI key each reads. */
export const BAR_METRICS = [
  { metricKey: "content_drafts_per_week", what: "Content output", unit: "drafts / week", op: "gte" as const, fixCategory: "Content" as const },
  { metricKey: "repeat_purchase_pct", what: "Repeat purchase", unit: "% of customers", op: "gte" as const, fixCategory: "Email & SMS" as const },
  { metricKey: "lead_response_hours", what: "Response speed", unit: "h to leads", op: "lte" as const, fixCategory: "Sales" as const },
] as const;

export type BarMetricKey = (typeof BAR_METRICS)[number]["metricKey"];

export interface AccountBenchmarkRows {
  accountId: string;
  optedIn: boolean;
  /** Segments this account belongs to besides "all". */
  segments: string[];
  outcomes: OutcomeRecord[];
}

/** Linear-interpolation percentile (numpy's default), q in [0, 1]. */
export function percentile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * frac) * 100) / 100;
}

/** Latest measured actual per metric for one account (one number per account per metric,
    so a busy account can't weigh more than a quiet one). */
export function latestActualsByMetric(outcomes: OutcomeRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of latestByRoutine(outcomes).values()) {
    if (!isMeasured(o)) continue;
    const cur = out.get(o.kpiKey);
    if (cur === undefined) out.set(o.kpiKey, o.kpiActual!);
  }
  return out;
}

export function computeBenchmarks(rowsByAccount: AccountBenchmarkRows[], opts: { now?: () => Date; floor?: number } = {}): BenchmarkRecord[] {
  const floor = opts.floor ?? ANONYMISATION_FLOOR;
  const computedAt = (opts.now ?? (() => new Date()))().toISOString();
  // metric → segment → accountId → value
  const buckets = new Map<string, Map<string, Map<string, number>>>();
  for (const acct of rowsByAccount) {
    if (!acct.optedIn) continue;
    const actuals = latestActualsByMetric(acct.outcomes);
    const segments = ["all", ...acct.segments.filter((s) => s && s !== "all")];
    for (const [metricKey, value] of actuals) {
      const bySeg = buckets.get(metricKey) ?? new Map<string, Map<string, number>>();
      buckets.set(metricKey, bySeg);
      for (const seg of segments) {
        const byAcct = bySeg.get(seg) ?? new Map<string, number>();
        bySeg.set(seg, byAcct);
        byAcct.set(acct.accountId, value);
      }
    }
  }
  const out: BenchmarkRecord[] = [];
  for (const [metricKey, bySeg] of buckets) {
    for (const [segment, byAcct] of bySeg) {
      const n = byAcct.size;
      if (n < floor) continue; // suppressed: too few accounts to be anonymous
      const values = [...byAcct.values()];
      out.push({ metricKey, segment, p50: percentile(values, 0.5), p75: percentile(values, 0.75), n, computedAt });
    }
  }
  return out.sort((a, b) => (a.metricKey < b.metricKey ? -1 : a.metricKey > b.metricKey ? 1 : a.segment < b.segment ? -1 : a.segment > b.segment ? 1 : 0));
}

/** The most specific published row for a metric: the requested segment, else "all". */
export function benchmarkFor(metricKey: string, segment: string, rows: BenchmarkRecord[]): BenchmarkRecord | null {
  const usable = rows.filter((r) => r.metricKey === metricKey && r.n >= ANONYMISATION_FLOOR);
  return usable.find((r) => r.segment === segment) ?? usable.find((r) => r.segment === "all") ?? null;
}

/** Revenue band for the segment key, from annual revenue in the account's currency. */
export function revenueBand(annualRevenue: number | null | undefined): string | null {
  if (annualRevenue === null || annualRevenue === undefined || !Number.isFinite(annualRevenue) || annualRevenue <= 0) return null;
  if (annualRevenue < 300_000) return "revenue_band:under-300k";
  if (annualRevenue < 2_000_000) return "revenue_band:300k-2m";
  if (annualRevenue < 10_000_000) return "revenue_band:2m-10m";
  return "revenue_band:10m-plus";
}

/** What the Home mapper needs per bar card: the published bar (if any) and the account's own latest value. */
export interface BarInput {
  metricKey: BarMetricKey;
  benchmark: BenchmarkRecord | null;
  own: number | null;
}

export function barInputs(benchmarks: BenchmarkRecord[], ownOutcomes: OutcomeRecord[], segment = "all"): BarInput[] {
  const own = latestActualsByMetric(ownOutcomes);
  return BAR_METRICS.map((m) => ({ metricKey: m.metricKey, benchmark: benchmarkFor(m.metricKey, segment, benchmarks), own: own.get(m.metricKey) ?? null }));
}
