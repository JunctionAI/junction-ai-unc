/* What Home needs from telemetry in DB mode, in one shape (GET /api/telemetry/home):
     review      Unc's latest weekly self-review for the account (or null)
     bar         the three "The bar" inputs: published benchmark (n ≥ 5) + the account's own
                 latest measured value, read against the account's most specific segment
     automation  hours saved over the last 7 days = Σ enabled routines' hoursSavedPerRun ×
                 completed runs (conservative constants in catalog-specs.ts)
   Pure over the Store (+ an optional segment list) so it runs on MemoryStore in tests. */

import { CATALOG_SPECS, hoursSavedPerRun } from "../runtime/catalog-specs";
import type { BenchmarkRecord, SelfReviewChange, Store } from "../runtime/store/interface";
import { barInputs, type BarMetricKey } from "./benchmarks";
import { primarySegment } from "./segments";
import { splitBody } from "./selfReview";

export interface HomeReviewView {
  weekStart: string;
  worked: string;
  changing: string;
  ask: string;
  changes: SelfReviewChange[];
  author: "sonnet" | "deterministic";
  createdAt: string;
}

export interface HomeBarView {
  metricKey: BarMetricKey;
  benchmark: Pick<BenchmarkRecord, "p50" | "p75" | "n" | "segment" | "computedAt"> | null;
  own: number | null;
}

export interface HomeTelemetry {
  review: HomeReviewView | null;
  segment: string;
  bar: HomeBarView[];
  automation: { hoursSavedWk: number; runsThisWeek: number; routinesOn: number };
}

const DAY_MS = 86_400_000;

export async function homeTelemetryForAccount(store: Store, accountId: string, opts: { now?: () => Date; segments?: string[] } = {}): Promise<HomeTelemetry> {
  const now = (opts.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const segment = primarySegment(opts.segments ?? []);
  const [review, benchmarks, own] = await Promise.all([store.getLatestSelfReview(accountId), store.listBenchmarks(), store.listOutcomes(accountId, { limit: 400 })]);

  let hours = 0;
  let runsThisWeek = 0;
  let routinesOn = 0;
  for (const spec of CATALOG_SPECS) {
    const state = await store.getRoutineState(accountId, spec.id);
    if (!state?.enabled) continue;
    routinesOn++;
    const done = await store.listRuns(accountId, { routineId: spec.id, status: "done", since });
    runsThisWeek += done.length;
    hours += done.length * hoursSavedPerRun(spec.id);
  }

  return {
    review: review
      ? (() => {
          const parts = splitBody(review.body);
          const ev = review.evidence as { ask?: unknown; author?: unknown };
          return {
            weekStart: review.weekStart,
            worked: parts.worked,
            changing: parts.changing,
            ask: parts.ask || (typeof ev.ask === "string" ? ev.ask : ""),
            changes: review.changes,
            author: ev.author === "sonnet" ? "sonnet" : "deterministic",
            createdAt: review.createdAt,
          };
        })()
      : null,
    segment,
    bar: barInputs(benchmarks, own, segment).map((b) => ({ metricKey: b.metricKey, benchmark: b.benchmark ? { p50: b.benchmark.p50, p75: b.benchmark.p75, n: b.benchmark.n, segment: b.benchmark.segment, computedAt: b.benchmark.computedAt } : null, own: b.own })),
    automation: { hoursSavedWk: Math.round(hours * 10) / 10, runsThisWeek, routinesOn },
  };
}
