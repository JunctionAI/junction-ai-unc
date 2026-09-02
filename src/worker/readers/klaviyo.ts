/* Klaviyo reader (read-only). API: https://a.klaviyo.com/api, private key in
   `Authorization: Klaviyo-API-Key …`, pinned `revision` header.

   Resources:
     flows      GET /api/flows?filter=equals(name,"…")        (filter.name)
     segments   GET /api/segments
     campaigns  GET /api/campaigns?filter=equals(messages.channel,'email')
     metrics    POST /api/metric-aggregates — needs filter.metricId (the
                catalog specs name a flow, not a metric id; resolving
                "Placed Order" → id is a Wave 2 connector step, so a live
                metrics read without metricId is an honest "couldn't ask"). */

import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { fetchJson, num, round2, sum, windowStartIso } from "./http";
import { fail, ok, type Metrics, type ReaderOptions, type ReaderResult, type Row } from "./types";

export const KLAVIYO_REVISION = "2025-07-15";
const BASE = "https://a.klaviyo.com/api";
const PLATFORM = "klaviyo" as const;

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
        .map((r, i) => ({ r, i, ctor: num(r.opens) ? (num(r.clicks) / num(r.opens)) * 100 : 0 }))
        .sort((a, b) => a.ctor - b.ctor)[0];
      return {
        sends,
        opens,
        clicks,
        placed_orders: sum(rows, "placed_orders"),
        revenue: sum(rows, "revenue"),
        ctor_pct: opens ? round2((clicks / opens) * 100) : 0,
        weakest_message_id: weakest ? String(weakest.r.message_id ?? "") : null,
        weakest_message_position: weakest ? weakest.i + 1 : null,
        weakest_ctor_pct: weakest ? round2(weakest.ctor) : null,
      };
    }
    case "campaigns":
      return { revenue: sum(rows, "revenue"), sends: sum(rows, "sends"), clicks: sum(rows, "clicks") };
    case "segments":
      return { profile_count: sum(rows, "profile_count") };
    default:
      return {};
  }
}

// ---------- request shaping ----------

type Shaped = { url: string; init: RequestInit };

export function klaviyoRequest(query: ReadQuery, apiKey: string, now: Date): Shaped | { error: string } {
  const headers = { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: KLAVIYO_REVISION, Accept: "application/json", "Content-Type": "application/json" };
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  switch (query.resource) {
    case "flows": {
      const params = new URLSearchParams();
      if (typeof filter.name === "string") params.set("filter", `equals(name,"${filter.name.replace(/"/g, "")}")`);
      return { url: `${BASE}/flows${params.size ? `?${params}` : ""}`, init: { method: "GET", headers } };
    }
    case "segments":
      return { url: `${BASE}/segments`, init: { method: "GET", headers } };
    case "campaigns": {
      const params = new URLSearchParams({ filter: "equals(messages.channel,'email')" });
      return { url: `${BASE}/campaigns?${params}`, init: { method: "GET", headers } };
    }
    case "metrics": {
      if (typeof filter.metricId !== "string") return { error: "klaviyo metrics needs filter.metricId (resolve the metric name to an id first — Wave 2)" };
      const since = windowStartIso(query.window, now) ?? new Date(now.getTime() - 28 * 86_400_000).toISOString();
      const body = {
        data: {
          type: "metric-aggregate",
          attributes: { metric_id: filter.metricId, measurements: ["count", "sum_value", "unique"], interval: "day", filter: [`greater-or-equal(datetime,${since})`], timezone: "UTC", by: query.groupBy ?? [] },
        },
      };
      return { url: `${BASE}/metric-aggregates`, init: { method: "POST", headers, body: JSON.stringify(body) } };
    }
    default:
      return { error: `klaviyo resource "${query.resource}" has no reader` };
  }
}

/** JSON:API {data:[{id, attributes}]} → flat rows. */
function flatten(json: unknown): Row[] | null {
  const data = (json as { data?: unknown })?.data;
  if (Array.isArray(data)) return data.map((d) => ({ id: (d as Row).id, ...((d as { attributes?: Row }).attributes ?? {}) }));
  if (data && typeof data === "object") return [{ id: (data as Row).id, ...((data as { attributes?: Row }).attributes ?? {}) }];
  return null;
}

export async function read(query: ReadQuery, creds: PlatformCredential, opts: ReaderOptions = {}): Promise<ReaderResult> {
  const now = opts.now ?? (() => new Date());
  if (creds.kind === "fixture") {
    const rows = FIXTURE_ROWS[query.resource];
    if (!rows) return fail(`klaviyo resource "${query.resource}" has no reader`);
    return ok(PLATFORM, rows, klaviyoMetrics(query.resource, rows), now().toISOString(), "fixture", "fixture rows; no request made");
  }
  if (creds.kind !== "klaviyo") return fail(`klaviyo reader was given ${creds.kind} credentials`);
  const shaped = klaviyoRequest(query, creds.apiKey, now());
  if ("error" in shaped) return fail(shaped.error);
  const res = await fetchJson(shaped.url, shaped.init, opts);
  if (!res.ok) return fail(res.reason);
  const rows = flatten(res.json);
  if (!rows) return fail(`klaviyo ${query.resource}: response had no data`);
  return ok(PLATFORM, rows, klaviyoMetrics(query.resource, rows), now().toISOString(), "live", `${shaped.init.method} ${new URL(shaped.url).pathname} (revision ${KLAVIYO_REVISION})`);
}
