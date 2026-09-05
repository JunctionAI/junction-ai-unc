/** Meta budget observations, never a spend forecast or authority to edit an ad.
 * Input amounts are already in currency units; do not divide stored rows again. */
export const META_BUDGET_CONTRACT = "unc.meta-budget.v2";
type Row = Record<string, unknown>;
type Metrics = Record<string, string | number | boolean | null>;
const inactive = new Set(["PAUSED", "ARCHIVED", "DELETED", "CAMPAIGN_PAUSED", "IN_PROCESS", "WITH_ISSUES"]);
const amount = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isSafeInteger(Math.round(v * 100)) ? v : null;
const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function activity(row: Row): "active" | "inactive" | "unknown" {
  if (row.effective_status === "ACTIVE") return row.status === "ACTIVE" ? "active" : "unknown";
  if (typeof row.effective_status === "string" && inactive.has(row.effective_status)) return "inactive";
  return "unknown";
}

function budget(row: Row): "daily" | "lifetime" | "unknown" {
  const daily = amount(row.daily_budget), lifetime = amount(row.lifetime_budget);
  if (daily !== null && daily > 0 && (row.lifetime_budget === undefined || lifetime === 0)) return "daily";
  if (lifetime !== null && lifetime > 0 && (row.daily_budget === undefined || daily === 0)) return "lifetime";
  // Zero/absent ad-set budgets may mean campaign-owned budgets, not zero spend.
  // Malformed values or simultaneous positive daily/lifetime values stay unknown.
  return "unknown";
}

export function metaBudgetMetrics(resource: "adsets" | "campaigns", rows: Row[]): Metrics {
  const active = rows.filter(row => activity(row) === "active");
  const daily = active.filter(row => budget(row) === "daily");
  const lifetime = active.filter(row => budget(row) === "lifetime");
  const unknownStatus = rows.filter(row => activity(row) === "unknown").length;
  const unknownBudget = active.length - daily.length - lifetime.length;
  const ids = new Set<string>();
  let identityIssues = 0;
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)) identityIssues++;
    else ids.add(row.id);
  }
  const total = daily.reduce((sum, row) => sum + (row.daily_budget as number), 0);
  const complete = !unknownStatus && !unknownBudget && !identityIssues && amount(total) !== null;
  const largest = complete ? [...daily].sort((a, b) => (b.daily_budget as number) - (a.daily_budget as number) || String(a.id).localeCompare(String(b.id)))[0] : undefined;
  return {
    budget_metric_contract: META_BUDGET_CONTRACT,
    budget_scope: resource === "adsets" ? "active_adset_daily_configurations" : "active_campaign_daily_configurations",
    count: rows.length,
    active_count: active.length,
    active_daily_budget_count: daily.length,
    active_lifetime_budget_count: lifetime.length,
    active_unknown_budget_count: unknownBudget,
    unknown_status_count: unknownStatus,
    identity_issue_count: identityIssues,
    active_daily_budget_total: complete && Number.isFinite(total) ? money(total) : null,
    // Retire the ambiguous alias. Existing consumers must not infer an account cap
    // or projection from an object-level subset, even when every row is active.
    daily_budget_total: null,
    projected_daily_spend: null,
    ...(resource === "adsets" ? {
      largest_adset_id: largest ? String(largest.id) : null,
      largest_adset_name: largest && typeof largest.name === "string" ? largest.name : null,
      largest_daily_budget: largest ? largest.daily_budget as number : null,
    } : {}),
  };
}

/** Meta's raw budget fields are unsigned integer minor units. Invalid is null,
 * never num(...)=0. Existing reader currency support assumes two minor decimals. */
export function metaBudgetMinorUnits(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && !/^\d+$/.test(value))) return null;
  const minor = Number(value);
  return Number.isSafeInteger(minor) && minor >= 0 ? money(minor / 100) : null;
}
