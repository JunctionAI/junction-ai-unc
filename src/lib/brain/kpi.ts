/* KPI snapshots — a fixed metric set per account, read through the same certified
   ConnectorReader the routines use, written to kpi_snapshots (migration 0010), and the
   week-over-week deltas Unc's brief and decisions may cite.

   snapshotKpis({ db, reader, accountId, account, now })
     connected platforms (connectors.status = 'connected') decide WHICH metrics are asked;
     each read is one certified platform read (fixture credentials → provenance "fixture",
     never mistakable for a live number). A read the platform couldn't answer writes NO row
     and one notification receipt ("couldn't ask …") — never a zero, never a guess.
     Upsert on (account_id, metric_key, window_end); re-running the same day rewrites the
     same rows. The window ends at the start of the measuring day (UTC), like outcomes.ts.

   kpiDeltas(db, accountId, now)          latest value vs the value a week earlier, per key
   computeDeltas(rows, now)               the pure part (tests)
   NOTABLE_DELTA_PCT = 15                 |Δ| ≥ 15 % is "notable" — the brief's one "noticed"

   Relative imports only: compiled into the worker (tsconfig.worker.json). The other brain
   modules (memory / profile …) are not imported here — this file reads its tables directly. */

import { unwrap, type DbClient, type Row } from "../db/types";
import { assertRuntimeContext } from "../db/runtimeContext";
import { runtimeGeneration } from "../runtime/contextFence";
import { newId } from "../runtime/context";
import type { AccountContext, ConnectorReader, Platform, ReadQuery, ReadResult, RunContext } from "../runtime/types";

export type KpiMetricKey = "revenue_28d" | "revenue_7d" | "orders_7d" | "aov_28d" | "sessions_7d" | "roas_7d" | "email_revenue_28d" | "repeat_rate_90d";

export type KpiProvenance = "live" | "fixture";

export interface KpiMetricDef {
  key: KpiMetricKey;
  label: string;
  platform: Platform;
  /** The read that answers it (resource + window + extra query); reads are shared across
      metrics with the same (platform, resource, window). */
  read: ReadQuery;
  /** ReadResult.metrics key, or "count" for the row count. */
  metric: string;
  /** Divide by this metric ("count" allowed) and multiply by `scale` (a percentage). */
  per?: string;
  scale?: number;
  windowDays: number;
  /** True when the value is money in the account's currency. */
  money: boolean;
  unit: string;
}

/** The fixed set. Only metrics whose platform is connected are asked; the rest are absent
    (not zero). Email revenue is Klaviyo-attributed Placed Order value (metric-aggregates by
    $attributed_channel; the reader resolves the metric id from the account's metric list). */
export const KPI_METRICS: KpiMetricDef[] = [
  { key: "revenue_28d", label: "Revenue (28d)", platform: "shopify", read: { resource: "orders", window: "28d" }, metric: "revenue", windowDays: 28, money: true, unit: "" },
  { key: "revenue_7d", label: "Revenue (7d)", platform: "shopify", read: { resource: "orders", window: "7d" }, metric: "revenue", windowDays: 7, money: true, unit: "" },
  { key: "orders_7d", label: "Orders (7d)", platform: "shopify", read: { resource: "orders", window: "7d" }, metric: "count", windowDays: 7, money: false, unit: "orders" },
  { key: "aov_28d", label: "Average order (28d)", platform: "shopify", read: { resource: "orders", window: "28d" }, metric: "aov", windowDays: 28, money: true, unit: "" },
  { key: "sessions_7d", label: "Sessions (7d)", platform: "ga4", read: { resource: "report", window: "7d", fields: ["sessions"] }, metric: "sessions", windowDays: 7, money: false, unit: "sessions" },
  { key: "roas_7d", label: "ROAS (7d)", platform: "meta_ads", read: { resource: "insights", window: "7d" }, metric: "roas", windowDays: 7, money: false, unit: "×" },
  { key: "email_revenue_28d", label: "Email revenue (28d)", platform: "klaviyo", read: { resource: "metrics", window: "28d", filter: { metric: "Placed Order", attributed: true } }, metric: "revenue", windowDays: 28, money: true, unit: "" },
  { key: "repeat_rate_90d", label: "Repeat rate (90d)", platform: "shopify", read: { resource: "customers", window: "90d" }, metric: "repeat_count", per: "count", scale: 100, windowDays: 90, money: false, unit: "%" },
];

export const KPI_METRIC_BY_KEY: Record<KpiMetricKey, KpiMetricDef> = Object.fromEntries(KPI_METRICS.map((m) => [m.key, m])) as Record<KpiMetricKey, KpiMetricDef>;

/** Which of the fixed set the connected platforms can answer (pure). */
export function metricsForPlatforms(connected: Iterable<Platform | string>): KpiMetricDef[] {
  const set = new Set([...connected]);
  return KPI_METRICS.filter((m) => set.has(m.platform));
}

// ---------- reading ----------

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

function metricValue(result: ReadResult, name: string): number | null {
  if (name === "count") return result.rows.length;
  const v = result.metrics[name];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Resolve a metric from a read (pure; exported for tests). null = the read has no such number. */
export function valueFromRead(def: KpiMetricDef, result: ReadResult): number | null {
  const base = metricValue(result, def.metric);
  if (base === null) return null;
  if (def.per) {
    const denom = metricValue(result, def.per);
    if (denom === null || denom === 0) return def.metric === "count" || base === 0 ? 0 : null;
    return round2((base / denom) * (def.scale ?? 1));
  }
  return round2(base * (def.scale ?? 1));
}

/** YYYY-MM-DD of the UTC day `now` falls in — the snapshot's window_end. */
export function windowEndDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function windowStartDate(windowEnd: string, days: number): string {
  return new Date(new Date(`${windowEnd}T00:00:00.000Z`).getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

export interface KpiSnapshotRow {
  account_id: string;
  context_generation: number;
  metric_key: KpiMetricKey;
  value: number;
  currency: string | null;
  window_start: string;
  window_end: string;
  platform: Platform;
  provenance: KpiProvenance;
  captured_at: string;
}

export interface SnapshotReport {
  accountId: string;
  connected: string[];
  written: KpiSnapshotRow[];
  /** Metrics the platform couldn't answer (a receipt was written for each) or that the read lacked. */
  couldntAsk: { key: KpiMetricKey; platform: Platform; reason: string }[];
  /** Metrics skipped because their platform is not connected. */
  notConnected: KpiMetricKey[];
}

export interface SnapshotDeps {
  db: DbClient;
  reader: ConnectorReader;
  accountId: string;
  account?: Omit<AccountContext, "accountId">;
  now?: () => Date;
  /** Override the connected platforms (tests); default: connectors.status = 'connected'. */
  connected?: string[];
  log?: (event: string, fields: Record<string, unknown>) => void;
}

/** connectors.status = 'connected' for the account — the only platforms a snapshot may ask. */
export async function connectedPlatforms(db: DbClient, accountId: string): Promise<string[]> {
  const rows = await unwrap<{ platform: string }[]>("connectors.select", db.from("connectors").select("platform").eq("account_id", accountId).eq("status", "connected"));
  return [...new Set(rows.map((r) => r.platform))];
}

/** Every account with ≥ 1 connected platform (the job's target list). */
export async function accountsWithConnectors(db: DbClient): Promise<string[]> {
  const rows = await unwrap<{ account_id: string }[]>("connectors.select", db.from("connectors").select("account_id").eq("status", "connected"));
  return [...new Set(rows.map((r) => r.account_id))];
}

function syntheticContext(accountId: string, account: SnapshotDeps["account"], now: Date, key: string): RunContext {
  const acct: AccountContext = { accountId, contextGeneration: runtimeGeneration(account?.contextGeneration), currency: account?.currency ?? "NZD", budgetMonthly: account?.budgetMonthly ?? 0, approver: account?.approver };
  return { runId: `kpi-${key}`, routineId: "kpi_snapshot", version: 0, mode: "dry_run", startedAt: now.toISOString(), account: acct, caps: { currency: acct.currency, perDay: 0, perMonth: 0 }, triggeredBy: "schedule", vars: {}, reads: {}, checks: {} };
}

const readKey = (m: KpiMetricDef) => `${m.platform}:${m.read.resource}:${m.read.window ?? ""}`;

export async function snapshotKpis(deps: SnapshotDeps): Promise<SnapshotReport> {
  const context = Object.freeze({ accountId: deps.accountId, contextGeneration: runtimeGeneration(deps.account?.contextGeneration) });
  const account = deps.account ? { ...deps.account, contextGeneration: context.contextGeneration } : { contextGeneration: 0, currency: "NZD", budgetMonthly: 0 };
  const { accountId, contextGeneration } = context;
  const guard = () => assertRuntimeContext(deps.db, context);
  await guard();
  const now = (deps.now ?? (() => new Date()))();
  const connected = deps.connected ?? (await connectedPlatforms(deps.db, accountId));
  const wanted = metricsForPlatforms(connected);
  const report: SnapshotReport = { accountId, connected, written: [], couldntAsk: [], notConnected: KPI_METRICS.filter((m) => !wanted.includes(m)).map((m) => m.key) };
  const windowEnd = windowEndDate(now);
  const currency = account.currency;

  // one certified read per (platform, resource, window), shared by the metrics that need it
  const reads = new Map<string, Promise<{ ok: true; result: ReadResult } | { ok: false; reason: string }>>();
  const readFor = (m: KpiMetricDef) => {
    const k = readKey(m);
    let p = reads.get(k);
    if (!p) {
      p = deps.reader
        .read(m.platform, m.read, syntheticContext(accountId, account, now, m.key))
        .then((result) => ({ ok: true as const, result }))
        .catch((err: unknown) => ({ ok: false as const, reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) }));
      reads.set(k, p);
    }
    return p;
  };

  const rows: KpiSnapshotRow[] = [];
  for (const m of wanted) {
    await guard();
    const r = await readFor(m);
    await guard();
    if (!r.ok) {
      report.couldntAsk.push({ key: m.key, platform: m.platform, reason: r.reason });
      continue;
    }
    const value = valueFromRead(m, r.result);
    if (value === null) {
      report.couldntAsk.push({ key: m.key, platform: m.platform, reason: `metric "${m.metric}" not in the read` });
      continue;
    }
    rows.push({
      account_id: accountId,
      context_generation: contextGeneration,
      metric_key: m.key,
      value,
      currency: m.money ? currency : null,
      window_start: windowStartDate(windowEnd, m.windowDays),
      window_end: windowEnd,
      platform: m.platform,
      provenance: r.result.provenance === "fixture" ? "fixture" : "live",
      captured_at: now.toISOString(),
    });
  }

  if (rows.length) {
    await guard();
    await unwrap("kpi_snapshots.upsert", deps.db.from("kpi_snapshots").upsert(rows as unknown as Row[], { onConflict: "account_id,context_generation,metric_key,window_end" }));
    await guard();
    report.written = rows;
  }
  // "couldn't ask" → no row + a notification receipt (run_id null: no routine run owns it)
  for (const c of report.couldntAsk) {
    await guard();
    await unwrap(
      "receipts.insert",
      deps.db.from("receipts").insert({
        id: newId(),
        account_id: accountId,
        context_generation: contextGeneration,
        run_id: null,
        kind: "notification",
        platform: c.platform,
        description: `Couldn't ask ${c.platform} for ${KPI_METRIC_BY_KEY[c.key].label.toLowerCase()}: ${c.reason}`,
        payload: { source: "kpi_snapshot", metricKey: c.key, reason: c.reason, windowEnd },
        created_at: now.toISOString(),
      }),
    );
  }
  await guard();
  deps.log?.("kpi.snapshot", { accountId: deps.accountId, connected, written: rows.map((r) => r.metric_key), couldntAsk: report.couldntAsk.map((c) => c.key) });
  return report;
}

// ---------- deltas (pure over the table) ----------

export const NOTABLE_DELTA_PCT = 15;

export interface KpiDelta {
  key: KpiMetricKey;
  label: string;
  unit: string;
  currency: string | null;
  latest: number;
  latestWindowEnd: string;
  /** The snapshot ~7 days before the latest (nearest at or before that date); null = no comparison yet. */
  previous: number | null;
  previousWindowEnd: string | null;
  /** Percentage change, rounded to one decimal; null when there is no previous or it was 0. */
  deltaPct: number | null;
  notable: boolean;
  provenance: KpiProvenance;
}

export interface KpiSnapshotRead {
  metric_key: string;
  value: number | string;
  currency: string | null;
  window_end: string;
  provenance: string;
}

/** Latest row per key vs the row a week earlier. Rows may be in any order. */
export function computeDeltas(rows: KpiSnapshotRead[], now: Date = new Date()): KpiDelta[] {
  const today = windowEndDate(now);
  const byKey = new Map<string, KpiSnapshotRead[]>();
  for (const r of rows) {
    if (r.window_end > today) continue;
    if (!byKey.has(r.metric_key)) byKey.set(r.metric_key, []);
    byKey.get(r.metric_key)!.push(r);
  }
  const out: KpiDelta[] = [];
  for (const def of KPI_METRICS) {
    const list = byKey.get(def.key);
    if (!list?.length) continue;
    list.sort((a, b) => (a.window_end < b.window_end ? 1 : a.window_end > b.window_end ? -1 : 0));
    const latest = list[0];
    const target = windowStartDate(latest.window_end, 7);
    const previous = list.find((r) => r.window_end <= target) ?? null;
    const lv = Number(latest.value);
    const pv = previous ? Number(previous.value) : null;
    const deltaPct = pv !== null && pv !== 0 && Number.isFinite(pv) ? Math.round(((lv - pv) / Math.abs(pv)) * 1000) / 10 : null;
    // both ends live or both fixture: a fixture-vs-live comparison is never a real delta
    const comparable = !previous || previous.provenance === latest.provenance;
    out.push({
      key: def.key,
      label: def.label,
      unit: def.unit,
      currency: latest.currency ?? null,
      latest: lv,
      latestWindowEnd: latest.window_end,
      previous: comparable ? pv : null,
      previousWindowEnd: comparable && previous ? previous.window_end : null,
      deltaPct: comparable ? deltaPct : null,
      notable: comparable && deltaPct !== null && Math.abs(deltaPct) >= NOTABLE_DELTA_PCT,
      provenance: latest.provenance === "fixture" ? "fixture" : "live",
    });
  }
  return out;
}

/** The last ~5 weeks of snapshots for the account → deltas. */
export async function kpiDeltas(db: DbClient, accountId: string, now: Date = new Date(), contextGeneration = 0): Promise<KpiDelta[]> {
  const context = Object.freeze({ accountId, contextGeneration: runtimeGeneration(contextGeneration) });
  await assertRuntimeContext(db, context, { allowPaused: true });
  const since = windowStartDate(windowEndDate(now), 35);
  const rows = await unwrap<KpiSnapshotRead[]>(
    "kpi_snapshots.select",
    db.from("kpi_snapshots").select("metric_key, value, currency, window_end, provenance").eq("account_id", accountId).eq("context_generation", contextGeneration).gte("window_end", since).order("window_end", { ascending: false }).limit(400),
  );
  await assertRuntimeContext(db, context, { allowPaused: true });
  return computeDeltas(rows, now);
}

/** "Revenue (7d) NZ$4,120 ▲ 18.2% vs a week ago" — the one line a brief may quote. */
export function describeDelta(d: KpiDelta): string {
  const money = d.currency ? `${d.currency} ${d.latest.toLocaleString("en-NZ", { maximumFractionDigits: 2 })}` : `${d.latest}${d.unit === "%" || d.unit === "×" ? d.unit : d.unit ? ` ${d.unit}` : ""}`;
  if (d.deltaPct === null) return `${d.label} ${money} (no comparison yet)`;
  const arrow = d.deltaPct > 0 ? "up" : d.deltaPct < 0 ? "down" : "flat";
  return `${d.label} ${money}, ${arrow} ${Math.abs(d.deltaPct)}% on a week ago${d.provenance === "fixture" ? " (fixture data)" : ""}`;
}
