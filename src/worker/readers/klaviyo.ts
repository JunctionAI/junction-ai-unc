/* Klaviyo reader (read-only). API: https://a.klaviyo.com/api, pinned `revision` header.
   Auth: a private key (pk_…) rides as `Authorization: Klaviyo-API-Key …`, an OAuth access
   token as `Authorization: Bearer …` — the credential provider hands either as `apiKey`.

   Resources:
     flows      GET /api/flows?filter=equals(name,"…")&fields[flow]=…       (filter.name)
     segments   GET /api/segments?additional-fields[segment]=profile_count
     campaigns  GET /api/campaigns?filter=equals(messages.channel,'email')  (paged via links.next)
     metrics    two shapes, both needing the "Placed Order" metric id, resolved from
                GET /api/metrics (name match, Shopify integration preferred) unless the
                query carries filter.metricId:
                  filter.flowName  → POST /api/flow-values-reports  (per-message flow stats:
                                     recipients/opens/clicks/conversions/conversion_value)
                  otherwise        → POST /api/metric-aggregates    (count + sum_value by day,
                                     optionally by $attributed_channel → attributed revenue)

   Defensive parsing throughout: every measurement is num() (missing → 0 and named in the
   provenance note), a JSON:API shape without `data` is "couldn't ask", never a guess. */

import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { fetchJson, num, round2, sum, windowStartIso } from "./http";
import { fail, ok, type Metrics, type ReaderOptions, type ReaderResult, type Row } from "./types";
import { readCampaignHistory } from "./klaviyoCampaigns";

export const KLAVIYO_REVISION = "2025-07-15";
const BASE = "https://a.klaviyo.com/api";
const PLATFORM = "klaviyo" as const;
const MAX_PAGES = 5;
export const DEFAULT_CONVERSION_METRIC = "Placed Order";

// ---------- fixtures ----------

const FIXTURE_ROWS: Record<string, Row[]> = {
  flows: [{ id: "flow_welcome", name: "Welcome Series", status: "live", message_count: 3, delay_days: 7 }],
  segments: [
    { id: "seg_vip", name: "VIP", profile_count: 420 },
    { id: "seg_lapsed", name: "Lapsed 90d", profile_count: 1310 },
  ],
  campaigns: [
    { id: "cmp_1", name: "Spring restock", send_time: "2026-08-20T20:00:00Z", revenue: 2140, sends: 8200, clicks: 310 },
    { id: "cmp_2", name: "Founder note", send_time: "2026-08-27T20:00:00Z", revenue: 980, sends: 8150, clicks: 260 },
  ],
  metrics: [
    { message_id: "msg_1", sends: 410, opens: 220, clicks: 41, placed_orders: 12, revenue: 1080 },
    { message_id: "msg_2", sends: 380, opens: 170, clicks: 12, placed_orders: 4, revenue: 360 },
    { message_id: "msg_3", sends: 350, opens: 150, clicks: 20, placed_orders: 6, revenue: 540 },
  ],
};

// ---------- metrics ----------

export function klaviyoMetrics(resource: string, rows: Row[]): Metrics {
  switch (resource) {
    case "flows": {
      const f = rows[0];
      return f ? { id: String(f.id), status: String(f.status ?? ""), message_count: num(f.message_count), delay_days: num(f.delay_days) } : {};
    }
    case "metrics": {
      const sends = sum(rows, "sends");
      const opens = sum(rows, "opens");
      const clicks = sum(rows, "clicks");
      const weakest = [...rows]
        .filter((r) => r.message_id !== undefined)
        .map((r, i) => ({ r, i, ctor: num(r.opens) ? (num(r.clicks) / num(r.opens)) * 100 : 0 }))
        .sort((a, b) => a.ctor - b.ctor)[0];
      const attributed = rows.filter((r) => typeof r.attributed_channel === "string" && r.attributed_channel !== "");
      const hasChannel = rows.some((r) => r.attributed_channel !== undefined);
      return {
        sends,
        opens,
        clicks,
        placed_orders: sum(rows, "placed_orders"),
        // by $attributed_channel: `revenue` is Klaviyo-attributed; the whole metric is revenue_total
        revenue: hasChannel ? sum(attributed, "revenue") : sum(rows, "revenue"),
        revenue_total: sum(rows, "revenue"),
        ctor_pct: opens ? round2((clicks / opens) * 100) : 0,
        weakest_message_id: weakest ? String(weakest.r.message_id ?? "") : null,
        weakest_message_position: weakest ? weakest.i + 1 : null,
        weakest_ctor_pct: weakest ? round2(weakest.ctor) : null,
      };
    }
    case "campaigns":
      return { revenue: sum(rows, "revenue"), sends: sum(rows, "sends"), clicks: sum(rows, "clicks"), count: rows.length };
    case "segments":
      return { profile_count: sum(rows, "profile_count") };
    default:
      return {};
  }
}

// ---------- request shaping ----------

type Shaped = { url: string; init: RequestInit };

export function authHeader(apiKey: string): string {
  return apiKey.startsWith("pk_") ? `Klaviyo-API-Key ${apiKey}` : `Bearer ${apiKey}`;
}

export function klaviyoHeaders(apiKey: string): Record<string, string> {
  return { Authorization: authHeader(apiKey), revision: KLAVIYO_REVISION, Accept: "application/json", "Content-Type": "application/json" };
}

const quote = (s: string) => `"${s.replace(/["\\]/g, "")}"`;

export function klaviyoRequest(query: ReadQuery, apiKey: string, now: Date): Shaped | { error: string } {
  const headers = klaviyoHeaders(apiKey);
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  switch (query.resource) {
    case "flows": {
      const params = new URLSearchParams();
      if (typeof filter.name === "string") params.set("filter", `equals(name,${quote(filter.name)})`);
      params.set("fields[flow]", "name,status,trigger_type,created,updated");
      return { url: `${BASE}/flows?${params}`, init: { method: "GET", headers } };
    }
    case "segments": {
      const params = new URLSearchParams({ "additional-fields[segment]": "profile_count", "fields[segment]": "name,is_active,profile_count" });
      return { url: `${BASE}/segments?${params}`, init: { method: "GET", headers } };
    }
    case "campaigns": {
      const params = new URLSearchParams({ filter: "equals(messages.channel,'email')", "fields[campaign]": "name,status,send_time,created_at,updated_at,archived" });
      return { url: `${BASE}/campaigns?${params}`, init: { method: "GET", headers } };
    }
    case "metrics":
      return metricAggregatesRequest(query, apiKey, now, typeof filter.metricId === "string" ? filter.metricId : null);
    default:
      return { error: `klaviyo resource "${query.resource}" has no reader` };
  }
}

/** POST /api/metric-aggregates for one metric over the window; `by` from groupBy, or
    ["$attributed_channel"] when filter.attributed is set (attributed vs total revenue). */
export function metricAggregatesRequest(query: ReadQuery, apiKey: string, now: Date, metricId: string | null): Shaped | { error: string } {
  if (!metricId) return { error: "klaviyo metrics needs a metric id (none resolved for the metric name)" };
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  const since = windowStartIso(query.window, now) ?? new Date(now.getTime() - 28 * 86_400_000).toISOString();
  const by = query.groupBy?.length ? query.groupBy.filter((g) => g !== "message_id") : filter.attributed ? ["$attributed_channel"] : [];
  const body = {
    data: {
      type: "metric-aggregate",
      attributes: {
        metric_id: metricId,
        measurements: ["count", "sum_value"],
        interval: "day",
        filter: [`greater-or-equal(datetime,${since})`, `less-than(datetime,${now.toISOString()})`],
        timezone: "UTC",
        by,
      },
    },
  };
  return { url: `${BASE}/metric-aggregates`, init: { method: "POST", headers: klaviyoHeaders(apiKey), body: JSON.stringify(body) } };
}

/** POST /api/flow-values-reports — per-message statistics for one flow over the window. */
export function flowValuesRequest(query: ReadQuery, apiKey: string, now: Date, flowId: string, conversionMetricId: string): Shaped {
  const since = windowStartIso(query.window, now) ?? new Date(now.getTime() - 28 * 86_400_000).toISOString();
  const body = {
    data: {
      type: "flow-values-report",
      attributes: {
        timeframe: { start: since, end: now.toISOString() },
        conversion_metric_id: conversionMetricId,
        statistics: ["recipients", "opens", "clicks", "conversions", "conversion_value"],
        filter: `equals(flow_id,${quote(flowId)})`,
      },
    },
  };
  return { url: `${BASE}/flow-values-reports`, init: { method: "POST", headers: klaviyoHeaders(apiKey), body: JSON.stringify(body) } };
}

// ---------- response shaping ----------

/** JSON:API {data:[{id, attributes}]} → flat rows. */
export function flatten(json: unknown): Row[] | null {
  const data = (json as { data?: unknown })?.data;
  if (Array.isArray(data)) return data.map((d) => ({ id: (d as Row).id, ...((d as { attributes?: Row }).attributes ?? {}) }));
  if (data && typeof data === "object") return [{ id: (data as Row).id, ...((data as { attributes?: Row }).attributes ?? {}) }];
  return null;
}

function nextPage(json: unknown): string | null {
  const next = (json as { links?: { next?: unknown } })?.links?.next;
  return typeof next === "string" && next.startsWith(BASE) ? next : null;
}

/** Pick the metric id for a name from GET /api/metrics rows; a Shopify-integration metric wins ties. */
export function pickMetricId(rows: Row[], name: string): string | null {
  const matches = rows.filter((r) => typeof r.name === "string" && r.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (!matches.length) return null;
  const shopify = matches.find((r) => {
    const integ = r.integration as { name?: unknown } | undefined;
    return typeof integ?.name === "string" && /shopify/i.test(integ.name);
  });
  return String((shopify ?? matches[0]).id);
}

/** metric-aggregates → one row per dimension combination with the measurements summed over
    the interval buckets. Missing measurements read 0 and are named in `missing`. */
export function flattenAggregates(json: unknown, by: string[]): { rows: Row[]; missing: string[] } | null {
  const attrs = (json as { data?: { attributes?: { data?: unknown } } })?.data?.attributes;
  const series = attrs?.data;
  if (!Array.isArray(series)) return null;
  const missing = new Set<string>();
  const rows = series.map((s) => {
    const dims = Array.isArray((s as { dimensions?: unknown }).dimensions) ? ((s as { dimensions: unknown[] }).dimensions as unknown[]) : [];
    const m = ((s as { measurements?: Record<string, unknown> }).measurements ?? {}) as Record<string, unknown>;
    const total = (key: string) => {
      const v = m[key];
      if (!Array.isArray(v)) {
        missing.add(key);
        return 0;
      }
      return round2(v.reduce((a: number, x) => a + num(x), 0));
    };
    const row: Row = {};
    by.forEach((b, i) => (row[b.replace(/^\$/, "")] = dims[i] ?? null));
    row.placed_orders = total("count");
    row.revenue = total("sum_value");
    return row;
  });
  return { rows, missing: [...missing] };
}

/** flow-values-reports → one row per flow message in the catalog's names. */
export function flattenFlowValues(json: unknown): { rows: Row[]; missing: string[] } | null {
  const results = (json as { data?: { attributes?: { results?: unknown } } })?.data?.attributes?.results;
  if (!Array.isArray(results)) return null;
  const missing = new Set<string>();
  const rows = results.map((r) => {
    const g = ((r as { groupings?: Record<string, unknown> }).groupings ?? {}) as Record<string, unknown>;
    const s = ((r as { statistics?: Record<string, unknown> }).statistics ?? {}) as Record<string, unknown>;
    const stat = (key: string) => {
      if (s[key] === undefined) missing.add(key);
      return num(s[key]);
    };
    return { message_id: g.flow_message_id ?? null, flow_id: g.flow_id ?? null, channel: g.send_channel ?? null, sends: stat("recipients"), opens: stat("opens"), clicks: stat("clicks"), placed_orders: stat("conversions"), revenue: round2(stat("conversion_value")) };
  });
  return { rows, missing: [...missing] };
}

// ---------- reads ----------

async function getPaged(url: string, headers: Record<string, string>, opts: ReaderOptions): Promise<{ ok: true; rows: Row[]; pages: number } | { ok: false; reason: string }> {
  const rows: Row[] = [];
  let next: string | null = url;
  let pages = 0;
  while (next && pages < MAX_PAGES) {
    const res = await fetchJson(next, { method: "GET", headers }, opts);
    if (!res.ok) return { ok: false, reason: res.reason };
    const page = flatten(res.json);
    if (!page) return { ok: false, reason: "response had no data" };
    rows.push(...page);
    pages++;
    next = nextPage(res.json);
  }
  return { ok: true, rows, pages };
}

async function resolveMetricId(name: string, apiKey: string, opts: ReaderOptions): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const r = await getPaged(`${BASE}/metrics?fields[metric]=name,integration`, klaviyoHeaders(apiKey), opts);
  if (!r.ok) return { ok: false, reason: `metrics list: ${r.reason}` };
  const id = pickMetricId(r.rows, name);
  return id ? { ok: true, id } : { ok: false, reason: `no metric named "${name}" on this account (${r.rows.length} metrics listed)` };
}

async function readMetrics(query: ReadQuery, apiKey: string, now: Date, opts: ReaderOptions): Promise<ReaderResult> {
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  const metricName = typeof filter.metric === "string" ? filter.metric : DEFAULT_CONVERSION_METRIC;
  let metricId = typeof filter.metricId === "string" ? filter.metricId : null;
  if (!metricId) {
    const r = await resolveMetricId(metricName, apiKey, opts);
    if (!r.ok) return fail(r.reason);
    metricId = r.id;
  }

  if (typeof filter.flowName === "string") {
    const flows = await getPaged(`${BASE}/flows?${new URLSearchParams({ filter: `equals(name,${quote(filter.flowName)})`, "fields[flow]": "name,status" })}`, klaviyoHeaders(apiKey), opts);
    if (!flows.ok) return fail(`flow lookup: ${flows.reason}`);
    const flow = flows.rows[0];
    if (!flow) return fail(`no flow named "${filter.flowName}" on this account`);
    const shaped = flowValuesRequest(query, apiKey, now, String(flow.id), metricId);
    const res = await fetchJson(shaped.url, shaped.init, opts);
    if (!res.ok) return fail(res.reason);
    const flat = flattenFlowValues(res.json);
    if (!flat) return fail("flow-values-reports: response had no results");
    const note = `POST /api/flow-values-reports flow ${flow.id} (${metricName} ${metricId})${flat.missing.length ? `; statistics missing (read as 0): ${flat.missing.join(", ")}` : ""}`;
    return ok(PLATFORM, flat.rows, klaviyoMetrics("metrics", flat.rows), now.toISOString(), "live", note);
  }

  const shaped = metricAggregatesRequest(query, apiKey, now, metricId);
  if ("error" in shaped) return fail(shaped.error);
  const res = await fetchJson(shaped.url, shaped.init, opts);
  if (!res.ok) return fail(res.reason);
  const by = (JSON.parse(shaped.init.body as string) as { data: { attributes: { by: string[] } } }).data.attributes.by;
  const flat = flattenAggregates(res.json, by);
  if (!flat) return fail("metric-aggregates: response had no data");
  const note = `POST /api/metric-aggregates ${metricName} (${metricId}) by [${by.join(", ")}]${flat.missing.length ? `; measurements missing (read as 0): ${flat.missing.join(", ")}` : ""}; opens/clicks are per-message stats — not in this read`;
  return ok(PLATFORM, flat.rows, klaviyoMetrics("metrics", flat.rows), now.toISOString(), "live", note);
}

export async function read(query: ReadQuery, creds: PlatformCredential, opts: ReaderOptions = {}): Promise<ReaderResult> {
  const now = opts.now ?? (() => new Date());
  if (creds.kind === "fixture") {
    const rows = FIXTURE_ROWS[query.resource];
    if (!rows) return fail(`klaviyo resource "${query.resource}" has no reader`);
    return ok(PLATFORM, rows, klaviyoMetrics(query.resource, rows), now().toISOString(), "fixture", "fixture rows; no request made");
  }
  if (creds.kind !== "klaviyo") return fail(`klaviyo reader was given ${creds.kind} credentials`);
  if (query.resource === "campaigns") return readCampaignHistory(query, klaviyoHeaders(creds.apiKey), opts);
  if (query.resource === "metrics") return readMetrics(query, creds.apiKey, now(), opts);
  const shaped = klaviyoRequest(query, creds.apiKey, now());
  if ("error" in shaped) return fail(shaped.error);
  const r = await getPaged(shaped.url, shaped.init.headers as Record<string, string>, opts);
  if (!r.ok) return fail(r.reason.includes("no data") ? `klaviyo ${query.resource}: response had no data` : r.reason);
  return ok(PLATFORM, r.rows, klaviyoMetrics(query.resource, r.rows), now().toISOString(), "live", `GET ${new URL(shaped.url).pathname} (revision ${KLAVIYO_REVISION}, ${r.pages} page${r.pages === 1 ? "" : "s"})${query.resource === "campaigns" ? "; campaign revenue needs the campaign-values report — not in this read" : ""}`);
}
