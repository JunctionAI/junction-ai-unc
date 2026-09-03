/* Verified metric catalog — locked definitions. `getMetric` is the only number Unc and skills
   may cite: it reads a certified kpi_snapshots row, never a live ad-hoc read, never a guess,
   never a zero for a missing row.

   Definitions live in src/lib/brain/kpi.ts (KPI_METRICS). This module is the read path:
   one key → one snapshot, with the definition attached so a caller cannot reinterpret it. */

import { unwrap, type DbClient } from "../db/types";
import { KPI_METRIC_BY_KEY, KPI_METRICS, type KpiMetricDef, type KpiMetricKey, type KpiProvenance } from "../brain/kpi";

export type MetricKey = KpiMetricKey;
export type MetricDef = KpiMetricDef;

export const METRIC_CATALOG: readonly MetricDef[] = KPI_METRICS;
export const METRIC_BY_KEY = KPI_METRIC_BY_KEY;

export function isMetricKey(k: string): k is MetricKey {
  return k in METRIC_BY_KEY;
}

export function getMetricDef(key: string): MetricDef | null {
  return isMetricKey(key) ? METRIC_BY_KEY[key] : null;
}

export interface CertifiedMetric {
  key: MetricKey;
  label: string;
  value: number;
  unit: string;
  money: boolean;
  currency: string | null;
  windowStart: string;
  windowEnd: string;
  platform: string;
  provenance: KpiProvenance;
  capturedAt: string;
  /** The locked definition this value was computed under. */
  definition: MetricDef;
}

interface SnapshotRow {
  metric_key: string;
  value: number | string;
  currency: string | null;
  window_start: string;
  window_end: string;
  platform: string;
  provenance: string;
  captured_at: string;
}

/** Latest certified snapshot for `key`, or null if none exists (never 0, never invented). */
export async function getMetric(db: DbClient, accountId: string, key: string): Promise<CertifiedMetric | null> {
  const def = getMetricDef(key);
  if (!def) return null;
  const rows = await unwrap<SnapshotRow[]>(
    "kpi_snapshots.select",
    db.from("kpi_snapshots").select("metric_key, value, currency, window_start, window_end, platform, provenance, captured_at").eq("account_id", accountId).eq("metric_key", def.key).order("window_end", { ascending: false }).limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  const value = typeof row.value === "number" ? row.value : Number(row.value);
  if (!Number.isFinite(value)) return null;
  const provenance: KpiProvenance = row.provenance === "live" ? "live" : "fixture";
  return {
    key: def.key,
    label: def.label,
    value,
    unit: def.unit,
    money: def.money,
    currency: row.currency,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    platform: row.platform,
    provenance,
    capturedAt: row.captured_at,
    definition: def,
  };
}

/** Every catalog key that currently has a certified row. Missing keys are absent, not zero. */
export async function getMetrics(db: DbClient, accountId: string, keys?: readonly string[]): Promise<CertifiedMetric[]> {
  const want = keys && keys.length ? keys.filter(isMetricKey) : METRIC_CATALOG.map((m) => m.key);
  const out: CertifiedMetric[] = [];
  for (const k of want) {
    const m = await getMetric(db, accountId, k);
    if (m) out.push(m);
  }
  return out;
}
