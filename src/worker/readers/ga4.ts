/* GA4 Data API reader (read-only).
   POST https://analyticsdata.googleapis.com/v1beta/properties/{id}:runReport
   with an OAuth bearer token. `fields` → metrics, `groupBy` → dimensions,
   `filter` → an AND of string-equals dimension filters, `window` → dateRanges. */

import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { fetchJson, num, round2, windowDays } from "./http";
import { fail, ok, type Metrics, type ReaderOptions, type ReaderResult, type Row } from "./types";

const PLATFORM = "ga4" as const;

const FIXTURE_ROWS: Row[] = [
  { sessionSource: "instagram", sessionMedium: "social", sessions: 1840, conversions: 21, purchaseRevenue: 1890.5 },
  { sessionSource: "facebook", sessionMedium: "cpc", sessions: 2210, conversions: 34, purchaseRevenue: 3120.0 },
  { sessionSource: "google", sessionMedium: "organic", sessions: 3975, conversions: 48, purchaseRevenue: 4410.25 },
];

export function ga4Metrics(rows: Row[], metricNames: string[]): Metrics {
  const out: Metrics = {};
  for (const name of metricNames) out[name] = round2(rows.reduce((acc, r) => acc + num(r[name]), 0));
  return out;
}

export function ga4Request(query: ReadQuery, propertyId: string, accessToken: string): { url: string; init: RequestInit; metricNames: string[] } {
  const metricNames = query.fields?.length ? query.fields : ["sessions", "conversions"];
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  const expressions = Object.entries(filter)
    .filter(([, v]) => typeof v === "string")
    .map(([fieldName, value]) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value } } }));
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: `${windowDays(query.window)}daysAgo`, endDate: "today" }],
    metrics: metricNames.map((name) => ({ name })),
    dimensions: (query.groupBy ?? []).map((name) => ({ name })),
    limit: query.limit ?? 100,
  };
  if (expressions.length === 1) body.dimensionFilter = expressions[0];
  else if (expressions.length > 1) body.dimensionFilter = { andGroup: { expressions } };
  return {
    url: `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    init: { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    metricNames,
  };
}

/** runReport response → rows keyed by header names. */
export function flattenReport(json: unknown): Row[] | null {
  const r = json as { dimensionHeaders?: { name: string }[]; metricHeaders?: { name: string }[]; rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] } | null;
  if (!r || typeof r !== "object") return null;
  const dims = (r.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (r.metricHeaders ?? []).map((h) => h.name);
  return (r.rows ?? []).map((row) => {
    const out: Row = {};
    dims.forEach((d, i) => (out[d] = row.dimensionValues?.[i]?.value ?? null));
    mets.forEach((m, i) => (out[m] = num(row.metricValues?.[i]?.value)));
    return out;
  });
}

export async function read(query: ReadQuery, creds: PlatformCredential, opts: ReaderOptions = {}): Promise<ReaderResult> {
  const now = opts.now ?? (() => new Date());
  if (query.resource !== "report") return fail(`ga4 resource "${query.resource}" has no reader (only "report")`);
  const metricNames = query.fields?.length ? query.fields : ["sessions", "conversions"];
  if (creds.kind === "fixture") {
    const filter = (query.filter ?? {}) as Record<string, unknown>;
    const rows = FIXTURE_ROWS.filter((r) => Object.entries(filter).every(([k, v]) => typeof v !== "string" || r[k] === v));
    return ok(PLATFORM, rows, ga4Metrics(rows, metricNames), now().toISOString(), "fixture", "fixture rows; no request made");
  }
  if (creds.kind !== "ga4") return fail(`ga4 reader was given ${creds.kind} credentials`);
  const shaped = ga4Request(query, creds.propertyId, creds.accessToken);
  const res = await fetchJson(shaped.url, shaped.init, opts);
  if (!res.ok) return fail(res.reason);
  const rows = flattenReport(res.json);
  if (!rows) return fail("ga4 report: unexpected response shape");
  return ok(PLATFORM, rows, ga4Metrics(rows, shaped.metricNames), now().toISOString(), "live", "POST properties/{id}:runReport");
}
