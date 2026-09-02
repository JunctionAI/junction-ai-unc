/* Meta Marketing API reader (read-only). Graph API {version}/act_{id}/…
   with the token in `Authorization: Bearer` (never in the query string).

   Resources:
     insights   GET act_{id}/insights?level=…&fields=…&date_preset=…
     ads        GET act_{id}/ads?fields=id,name,status,creative&filtering=…
     campaigns  GET act_{id}/campaigns?fields=id,name,status,daily_budget

   The catalog names convenience fields (roas, purchases, purchase_value,
   daily_budget). Insights use purchase_roas / actions / action_values for
   the first three; daily_budget lives on the ad set object, so it is dropped
   from an insights request and noted in provenance. */

import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { fetchJson, num, round2, sum, windowDays } from "./http";
import { fail, ok, type Metrics, type ReaderOptions, type ReaderResult, type Row } from "./types";

export const META_GRAPH_VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const PLATFORM = "meta_ads" as const;

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
};

const FIELD_ALIASES: Record<string, string | null> = {
  roas: "purchase_roas",
  purchases: "actions",
  purchase_value: "action_values",
  daily_budget: null, // ad set property, not an insights field
  thumbstop: null,
  ctr_trend: null,
  cpa_trend: null,
  days_live: null,
  hook: null,
  format: null,
  offer: null,
};

export function metaMetrics(resource: string, rows: Row[]): Metrics {
  if (resource !== "insights") return {};
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
    top_adset_id: top ? String(top.adset_id ?? top.campaign_id ?? "") : null,
    top_adset_name: top ? String(top.adset_name ?? top.campaign_name ?? "") : null,
    top_adset_roas: top ? round2(num(top.roas)) : null,
    top_adset_daily_budget: top ? num(top.daily_budget) : null,
    worst_ad_id: worst ? String(worst.ad_id ?? worst.adset_id ?? "") : null,
    worst_ad_name: worst ? String(worst.ad_name ?? worst.adset_name ?? "") : null,
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

export function metaRequest(query: ReadQuery, adAccountId: string, accessToken: string): { url: string; init: RequestInit; note: string } | { error: string } {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  const act = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const params = new URLSearchParams();
  params.set("limit", String(query.limit ?? 100));
  switch (query.resource) {
    case "insights": {
      const level = typeof filter.level === "string" ? filter.level : "campaign";
      const dropped: string[] = [];
      const fields = new Set<string>(["spend"]);
      for (const f of query.fields ?? []) {
        if (f in FIELD_ALIASES) {
          const mapped = FIELD_ALIASES[f];
          if (mapped) fields.add(mapped);
          else dropped.push(f);
        } else fields.add(f);
      }
      if (level === "adset") fields.add("adset_id").add("adset_name");
      if (level === "ad") fields.add("ad_id").add("ad_name");
      params.set("level", level);
      params.set("fields", [...fields].join(","));
      params.set("date_preset", datePreset(query.window));
      return { url: `${BASE}/${act}/insights?${params}`, init: { method: "GET", headers }, note: `GET ${act}/insights level=${level}${dropped.length ? `; dropped non-insights fields: ${dropped.join(", ")}` : ""}` };
    }
    case "ads":
    case "campaigns": {
      params.set("fields", query.resource === "ads" ? "id,name,status,effective_status,creative" : "id,name,status,daily_budget");
      if (typeof filter.status === "string") params.set("filtering", JSON.stringify([{ field: "effective_status", operator: "IN", value: [filter.status] }]));
      return { url: `${BASE}/${act}/${query.resource}?${params}`, init: { method: "GET", headers }, note: `GET ${act}/${query.resource}` };
    }
    default:
      return { error: `meta_ads resource "${query.resource}" has no reader` };
  }
}

function actionValue(list: unknown, type: string): number {
  if (!Array.isArray(list)) return 0;
  const hit = list.find((a) => a && typeof a === "object" && ((a as Row).action_type === type || (a as Row).action_type === `omni_${type}`));
  return hit ? num((hit as Row).value) : 0;
}

/** Insights rows → the convenience fields the catalog addresses. */
export function normaliseInsightRow(r: Row): Row {
  return {
    ...r,
    spend: num(r.spend),
    purchases: r.purchases !== undefined ? num(r.purchases) : actionValue(r.actions, "purchase"),
    purchase_value: r.purchase_value !== undefined ? num(r.purchase_value) : actionValue(r.action_values, "purchase"),
    roas: r.roas !== undefined ? num(r.roas) : Array.isArray(r.purchase_roas) ? num((r.purchase_roas[0] as Row | undefined)?.value) : 0,
    frequency: num(r.frequency),
  };
}

export async function read(query: ReadQuery, creds: PlatformCredential, opts: ReaderOptions = {}): Promise<ReaderResult> {
  const now = opts.now ?? (() => new Date());
  if (creds.kind === "fixture") {
    const rows = FIXTURE_ROWS[query.resource];
    if (!rows) return fail(`meta_ads resource "${query.resource}" has no reader`);
    return ok(PLATFORM, rows, metaMetrics(query.resource, rows), now().toISOString(), "fixture", "fixture rows; no request made");
  }
  if (creds.kind !== "meta_ads") return fail(`meta_ads reader was given ${creds.kind} credentials`);
  const shaped = metaRequest(query, creds.adAccountId, creds.accessToken);
  if ("error" in shaped) return fail(shaped.error);
  const res = await fetchJson(shaped.url, shaped.init, opts);
  if (!res.ok) return fail(res.reason);
  const data = (res.json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return fail(`meta_ads ${query.resource}: response had no data array`);
  const rows = query.resource === "insights" ? (data as Row[]).map(normaliseInsightRow) : (data as Row[]).map((r) => ({ ad_id: r.id, ...r }));
  return ok(PLATFORM, rows, metaMetrics(query.resource, rows), now().toISOString(), "live", shaped.note);
}
