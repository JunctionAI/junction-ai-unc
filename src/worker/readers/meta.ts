/* Meta Marketing API reader (read-only). Graph API {version}/act_{id}/… with the token in
   `Authorization: Bearer` (never in the query string).

   Resources:
     insights   GET act_{id}/insights?level=…&fields=…&time_range={since,until}&limit=…
                (an exact window from `window`; date_preset only when there is no window)
     ads        GET act_{id}/ads?fields=id,name,status,effective_status,creative&filtering=…
     campaigns  GET act_{id}/campaigns?fields=id,name,status,effective_status,daily_budget,lifetime_budget
     adsets     GET act_{id}/adsets?fields=id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget
                (budgets in currency units; the typed action library's rules read these)

   The catalog names convenience fields (roas, purchases, purchase_value, cpa, daily_budget).
   Insights carry purchase_roas / actions / action_values for the first three (omni_purchase
   preferred, purchase accepted); cpa is derived; daily_budget lives on the ad set / campaign
   object, so it is dropped from an insights request and noted in provenance. Budgets come
   back in minor units (cents) as strings → converted to currency units. Paging follows
   paging.cursors.after for up to MAX_PAGES pages, re-requesting our own URL shape. */

import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { dateRange, fetchJson, num, round2, sum, windowDays } from "./http";
import { fail, ok, type Metrics, type ReaderOptions, type ReaderResult, type Row } from "./types";

export const META_GRAPH_VERSION = "v23.0";
const BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const PLATFORM = "meta_ads" as const;
const MAX_PAGES = 5;

const FIXTURE_ROWS: Record<string, Row[]> = {
  insights: [
    { adset_id: "as-1", adset_name: "Prospecting NZ", spend: 420, purchases: 19, purchase_value: 1302, roas: 3.1, daily_budget: 100, frequency: 1.8, ctr: 1.9, cpa: 22.1 },
    { adset_id: "as-2", adset_name: "Retargeting 30d", spend: 260, purchases: 9, purchase_value: 546, roas: 2.1, daily_budget: 60, frequency: 4.6, ctr: 1.1, cpa: 28.9 },
  ],
  ads: [
    { ad_id: "ad-9", id: "ad-9", creative_id: "cr-9", name: "Hook v4 — founder", status: "PAUSED" },
    { ad_id: "ad-10", id: "ad-10", creative_id: "cr-10", name: "Hook v5 — testimonial", status: "PAUSED" },
    { ad_id: "ad-11", id: "ad-11", creative_id: "cr-11", name: "Hook v6 — unboxing", status: "PAUSED" },
  ],
  campaigns: [
    { id: "cmp-1", name: "Always-on prospecting", status: "ACTIVE", daily_budget: 100 },
    { id: "cmp-2", name: "Retargeting", status: "ACTIVE", daily_budget: 60 },
  ],
  adsets: [
    { id: "as-1", ad_id: "as-1", name: "Prospecting NZ", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "cmp-1", daily_budget: 100 },
    { id: "as-2", ad_id: "as-2", name: "Retargeting 30d", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "cmp-2", daily_budget: 60 },
  ],
};

const FIELD_ALIASES: Record<string, string | null> = {
  roas: "purchase_roas",
  purchases: "actions",
  purchase_value: "action_values",
  cpa: "actions", // derived: spend / purchases
  daily_budget: null, // ad set / campaign property, not an insights field
  thumbstop: null,
  ctr_trend: null,
  cpa_trend: null,
  days_live: null,
  hook: null,
  format: null,
  offer: null,
};

export function metaMetrics(resource: string, rows: Row[]): Metrics {
  if (resource !== "insights") {
    if (resource === "campaigns") return { daily_budget_total: sum(rows, "daily_budget"), count: rows.length };
    if (resource === "adsets") {
      const largest = [...rows].sort((a, b) => num(b.daily_budget) - num(a.daily_budget))[0];
      return {
        daily_budget_total: sum(rows, "daily_budget"),
        count: rows.length,
        largest_adset_id: largest ? String(largest.id ?? "") : null,
        largest_adset_name: largest ? String(largest.name ?? "") : null,
        largest_daily_budget: largest ? num(largest.daily_budget) : null,
      };
    }
    return { count: rows.length };
  }
  const spend = sum(rows, "spend");
  const purchases = sum(rows, "purchases");
  const value = sum(rows, "purchase_value");
  const top = [...rows].sort((a, b) => num(b.roas) - num(a.roas))[0];
  const worst = [...rows].sort((a, b) => num(b.frequency) - num(a.frequency))[0];
  const dailyBudgetTotal = sum(rows, "daily_budget");
  return {
    spend,
    purchases,
    purchase_value: value,
    roas: spend ? round2(value / spend) : 0,
    cpa: purchases ? round2(spend / purchases) : null,
    impressions: sum(rows, "impressions"),
    clicks: sum(rows, "clicks"),
    top_adset_id: top ? String(top.adset_id ?? top.campaign_id ?? "") : null,
    top_adset_name: top ? String(top.adset_name ?? top.campaign_name ?? "") : null,
    top_adset_roas: top ? round2(num(top.roas)) : null,
    top_adset_daily_budget: top ? num(top.daily_budget) : null,
    worst_ad_id: worst ? String(worst.ad_id ?? worst.adset_id ?? worst.campaign_id ?? "") : null,
    worst_ad_name: worst ? String(worst.ad_name ?? worst.adset_name ?? worst.campaign_name ?? "") : null,
    worst_frequency: worst ? round2(num(worst.frequency)) : null,
    worst_spend: worst ? num(worst.spend) : null,
    daily_budget_total: dailyBudgetTotal,
    projected_daily_spend: dailyBudgetTotal,
    reconciliation_pct: null, // Shopify-vs-platform reconciliation is a warehouse view, not a platform read
  };
}

function datePreset(window: string | undefined): string {
  const days = windowDays(window, 7);
  if (days <= 1) return "today";
  if (days <= 7) return "last_7d";
  if (days <= 14) return "last_14d";
  if (days <= 28) return "last_28d";
  if (days <= 30) return "last_30d";
  return "last_90d";
}

const INSIGHT_BASE_FIELDS = ["spend", "impressions", "clicks", "ctr", "frequency", "purchase_roas", "actions", "action_values"];
const LEVELS = new Set(["account", "campaign", "adset", "ad"]);

export function metaRequest(query: ReadQuery, adAccountId: string, accessToken: string, now: Date = new Date()): { url: string; init: RequestInit; note: string } | { error: string } {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  const act = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(Math.max(1, query.limit ?? 100), 500)));
  switch (query.resource) {
    case "insights": {
      const level = typeof filter.level === "string" && LEVELS.has(filter.level) ? filter.level : "campaign";
      const dropped: string[] = [];
      const fields = new Set<string>(INSIGHT_BASE_FIELDS);
      for (const f of query.fields ?? []) {
        if (f in FIELD_ALIASES) {
          const mapped = FIELD_ALIASES[f];
          if (mapped) fields.add(mapped);
          else dropped.push(f);
        } else fields.add(f);
      }
      if (level === "campaign") fields.add("campaign_id").add("campaign_name");
      if (level === "adset") fields.add("adset_id").add("adset_name");
      if (level === "ad") fields.add("ad_id").add("ad_name").add("adset_id");
      params.set("level", level);
      params.set("fields", [...fields].join(","));
      let windowNote: string;
      if (query.window) {
        const r = dateRange(query.window, now);
        params.set("time_range", JSON.stringify({ since: r.since, until: r.until }));
        windowNote = `time_range ${r.since}..${r.until}`;
      } else {
        params.set("date_preset", datePreset(undefined));
        windowNote = "date_preset last_7d";
      }
      return { url: `${BASE}/${act}/insights?${params}`, init: { method: "GET", headers }, note: `GET ${act}/insights level=${level} ${windowNote}${dropped.length ? `; dropped non-insights fields: ${dropped.join(", ")}` : ""}` };
    }
    case "ads":
    case "adsets":
    case "campaigns": {
      params.set("fields", query.resource === "ads" ? "id,name,status,effective_status,adset_id,creative" : query.resource === "adsets" ? "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget" : "id,name,status,effective_status,objective,daily_budget,lifetime_budget");
      if (typeof filter.status === "string") params.set("filtering", JSON.stringify([{ field: "effective_status", operator: "IN", value: [filter.status] }]));
      return { url: `${BASE}/${act}/${query.resource}?${params}`, init: { method: "GET", headers }, note: `GET ${act}/${query.resource}` };
    }
    default:
      return { error: `meta_ads resource "${query.resource}" has no reader` };
  }
}

/** Value of one action type from an actions / action_values list. omni_purchase (all
    purchase events, deduplicated) wins over purchase when both are present. */
export function actionValue(list: unknown, type: string): number {
  if (!Array.isArray(list)) return 0;
  const find = (t: string) => list.find((a) => a && typeof a === "object" && (a as Row).action_type === t);
  const hit = find(`omni_${type}`) ?? find(type);
  return hit ? num((hit as Row).value) : 0;
}

/** purchase_roas is a list like actions; a single untyped entry (older responses) is accepted too. */
export function roasValue(list: unknown): number | null {
  if (!Array.isArray(list) || !list.length) return null;
  const typed = actionValue(list, "purchase");
  if (typed) return typed;
  const first = list[0] as Row | undefined;
  return first && first.action_type === undefined ? num(first.value) : 0;
}

/** Insights rows → the convenience fields the catalog addresses. */
export function normaliseInsightRow(r: Row): Row {
  const spend = num(r.spend);
  const purchases = r.purchases !== undefined ? num(r.purchases) : actionValue(r.actions, "purchase");
  const purchase_value = r.purchase_value !== undefined ? num(r.purchase_value) : actionValue(r.action_values, "purchase");
  const roas = r.roas !== undefined ? num(r.roas) : (roasValue(r.purchase_roas) ?? (spend ? round2(purchase_value / spend) : 0));
  return {
    ...r,
    spend,
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    ctr: num(r.ctr),
    purchases,
    purchase_value,
    roas,
    cpa: purchases ? round2(spend / purchases) : null,
    frequency: num(r.frequency),
  };
}

/** Budgets arrive as minor-unit strings ("10000" = 100.00). */
export function normaliseBudgetRow(r: Row): Row {
  const cents = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : round2(num(v) / 100));
  return { ad_id: r.id, ...r, ...(r.daily_budget !== undefined ? { daily_budget: cents(r.daily_budget) } : {}), ...(r.lifetime_budget !== undefined ? { lifetime_budget: cents(r.lifetime_budget) } : {}) };
}

/** Our own URL shape with the next cursor (Meta's paging.next carries the token in its query — never re-request it). */
export function nextCursorUrl(url: string, json: unknown): string | null {
  const after = (json as { paging?: { cursors?: { after?: unknown }; next?: unknown } })?.paging;
  if (!after || typeof after.next !== "string") return null;
  const cursor = typeof after.cursors?.after === "string" ? after.cursors.after : null;
  if (!cursor) return null;
  const u = new URL(url);
  u.searchParams.set("after", cursor);
  return u.toString();
}

export function missingInsightFields(rows: Row[]): string[] {
  if (!rows.length) return [];
  return ["spend", "actions", "action_values", "purchase_roas"].filter((f) => rows.every((r) => r[f] === undefined));
}

export async function read(query: ReadQuery, creds: PlatformCredential, opts: ReaderOptions = {}): Promise<ReaderResult> {
  const now = opts.now ?? (() => new Date());
  if (creds.kind === "fixture") {
    const rows = FIXTURE_ROWS[query.resource];
    if (!rows) return fail(`meta_ads resource "${query.resource}" has no reader`);
    return ok(PLATFORM, rows, metaMetrics(query.resource, rows), now().toISOString(), "fixture", "fixture rows; no request made");
  }
  if (creds.kind !== "meta_ads") return fail(`meta_ads reader was given ${creds.kind} credentials`);
  const shaped = metaRequest(query, creds.adAccountId, creds.accessToken, now());
  if ("error" in shaped) return fail(shaped.error);
  const raw: Row[] = [];
  let url: string | null = shaped.url;
  let pages = 0;
  while (url && pages < MAX_PAGES) {
    const res = await fetchJson(url, shaped.init, opts);
    if (!res.ok) return pages === 0 ? fail(res.reason) : fail(`page ${pages + 1}: ${res.reason}`);
    const data = (res.json as { data?: unknown })?.data;
    if (!Array.isArray(data)) return fail(`meta_ads ${query.resource}: response had no data array`);
    raw.push(...(data as Row[]));
    pages++;
    const paging = (res.json as { paging?: { next?: unknown; cursors?: { after?: unknown } } }).paging;
    if (paging?.next && (typeof paging.next !== "string" || typeof paging.cursors?.after !== "string" || !paging.cursors.after.trim())) return fail("Meta pagination is incomplete: next page has no usable cursor");
    url = nextCursorUrl(url, res.json);
  }
  if (url) return fail(`Meta pagination is incomplete after ${MAX_PAGES} pages; narrow the query or use a complete ingestion job`);
  const rows = query.resource === "insights" ? raw.map(normaliseInsightRow) : raw.map(normaliseBudgetRow);
  const missing = query.resource === "insights" ? missingInsightFields(rows) : [];
  const note = `${shaped.note} (${pages} page${pages === 1 ? "" : "s"})${missing.length ? `; fields absent from every row: ${missing.join(", ")}; purchase metrics require source validation` : ""}${query.resource === "campaigns" || query.resource === "adsets" ? "; budgets converted from minor units" : ""}`;
  if (query.resource === "insights" && raw.some(r => r.spend === undefined || r.spend === null || r.spend === "" || !Number.isFinite(Number(r.spend)))) return fail("Meta insights are incomplete: spend is missing or invalid");
  const metrics = metaMetrics(query.resource, rows);
  if (query.resource === "insights") {
    // Budgets require a separate object read. A campaign-level report cannot identify
    // an ad set or an ad to mutate, even if a campaign has a similar name.
    metrics.daily_budget_total = null;
    metrics.projected_daily_spend = null;
    metrics.top_adset_daily_budget = null;
    if (raw.some(r => !r.adset_id)) {
      metrics.top_adset_id = null; metrics.top_adset_name = null; metrics.top_adset_roas = null;
    }
    if (raw.some(r => !r.ad_id)) {
      metrics.worst_ad_id = null; metrics.worst_ad_name = null; metrics.worst_frequency = null; metrics.worst_spend = null;
    }
  }
  if (query.resource === "insights" && raw.some(r => !Array.isArray(r.actions) && r.purchases === undefined)) {
    for (const row of rows) { if (!Array.isArray(row.actions)) { row.purchases = null; row.cpa = null; } }
    metrics.purchases = null; metrics.cpa = null;
  }
  if (query.resource === "insights" && raw.some(r => !Array.isArray(r.action_values) && r.purchase_value === undefined)) {
    for (const row of rows) { if (!Array.isArray(row.action_values)) { row.purchase_value = null; if (!Array.isArray(row.purchase_roas)) row.roas = null; } }
    metrics.purchase_value = null; metrics.roas = null;
  }
  return ok(PLATFORM, rows, metrics, now().toISOString(), "live", note);
}
