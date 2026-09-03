/* Insights rows → the metrics the rules judge on. Pure; shared by the read action and the
   rules provider (which sees the worker reader's rows — same field names). */

export type Row = Record<string, unknown>;

export function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Value of one action type from an actions / action_values list; omni_<type> wins. */
export function actionValue(list: unknown, type: string): number {
  if (!Array.isArray(list)) return 0;
  const find = (t: string) => list.find((a) => a && typeof a === "object" && (a as Row).action_type === t);
  const hit = find(`omni_${type}`) ?? find(type);
  return hit ? num((hit as Row).value) : 0;
}

export function roasValue(list: unknown): number | null {
  if (!Array.isArray(list) || !list.length) return null;
  const typed = actionValue(list, "purchase");
  if (typed) return typed;
  const first = list[0] as Row | undefined;
  return first && first.action_type === undefined ? num(first.value) : 0;
}

/** One judged unit (an ad set, a campaign or an ad) over the read window. */
export interface PerformanceRow {
  id: string;
  name: string;
  level: "campaign" | "adset" | "ad";
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  frequency: number;
  purchases: number;
  purchaseValue: number;
  /** spend / purchases; null with no purchases. */
  cpa: number | null;
  roas: number;
  /** In currency units; null when the object's budget was not read. */
  dailyBudget: number | null;
  status?: string;
  campaignId?: string;
  adsetId?: string;
}

/** A raw Graph insights row (or a worker-reader row, already normalised) → PerformanceRow. */
export function toPerformanceRow(r: Row, level: "campaign" | "adset" | "ad"): PerformanceRow {
  const spend = num(r.spend);
  const purchases = r.purchases !== undefined ? num(r.purchases) : actionValue(r.actions, "purchase");
  const purchaseValue = r.purchase_value !== undefined ? num(r.purchase_value) : actionValue(r.action_values, "purchase");
  const roas = r.roas !== undefined ? num(r.roas) : (roasValue(r.purchase_roas) ?? (spend ? round2(purchaseValue / spend) : 0));
  const idKey = `${level}_id`;
  const nameKey = `${level}_name`;
  const id = String(r[idKey] ?? r.id ?? "");
  const name = String(r[nameKey] ?? r.name ?? id);
  const budget = r.daily_budget;
  return {
    id,
    name,
    level,
    spend: round2(spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    ctr: round2(num(r.ctr)),
    frequency: round2(num(r.frequency)),
    purchases,
    purchaseValue: round2(purchaseValue),
    cpa: purchases ? round2(spend / purchases) : null,
    roas: round2(roas),
    dailyBudget: budget === undefined || budget === null || budget === "" ? null : num(budget),
    ...(r.status !== undefined ? { status: String(r.status) } : {}),
    ...(r.campaign_id !== undefined ? { campaignId: String(r.campaign_id) } : {}),
    ...(r.adset_id !== undefined && level === "ad" ? { adsetId: String(r.adset_id) } : {}),
  };
}

export interface PerformanceSummary {
  spend: number;
  purchases: number;
  purchaseValue: number;
  cpa: number | null;
  roas: number;
  rows: number;
}

export function summarise(rows: PerformanceRow[]): PerformanceSummary {
  const spend = round2(rows.reduce((a, r) => a + r.spend, 0));
  const purchases = rows.reduce((a, r) => a + r.purchases, 0);
  const purchaseValue = round2(rows.reduce((a, r) => a + r.purchaseValue, 0));
  return { spend, purchases, purchaseValue, cpa: purchases ? round2(spend / purchases) : null, roas: spend ? round2(purchaseValue / spend) : 0, rows: rows.length };
}
