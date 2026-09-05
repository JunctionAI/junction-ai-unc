/* First live contact: the readers against realistic payloads (fixtures/platformPayloads.ts) —
   Shopify Link-header paging + revenue exclusions, Klaviyo metric-id resolution +
   metric-aggregates + flow-values reports, Meta time_range + cursor paging + minor-unit
   budgets, GA4 rowCount — plus the --probe path and its redaction. */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadQuery } from "../../lib/runtime/types";
import { parseArgs } from "../cli";
import { FixtureCredentialProvider, type PlatformCredential } from "../credentials";
import { formatProbe, probeQuery, redactRow, runProbe } from "../probe";
import * as ga4 from "../readers/ga4";
import { nextLink } from "../readers/http";
import * as klaviyo from "../readers/klaviyo";
import * as meta from "../readers/meta";
import * as shopify from "../readers/shopify";
import * as P from "./fixtures/platformPayloads";

const NOW = new Date("2026-09-02T07:00:00.000Z");
const now = () => NOW;
const SHOP = "acme.myshopify.com";
const FAKE_TOKEN = "shpat_FAKE_TOKEN_FOR_TESTS_ONLY";
const FAKE_KEY = "pk_FAKE_KLAVIYO_KEY";
const FAKE_META = "EAAFAKEMETATOKEN0000000000000000000000";
const FAKE_BEARER = "ya29.FAKE_GOOGLE_TOKEN";

type Route = (url: string, init: RequestInit) => { body: unknown; status?: number; headers?: Record<string, string> } | undefined;
function routedFetch(routes: Route[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    for (const r of routes) {
      const hit = r(url, init);
      if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200, headers: { "content-type": "application/json", ...(hit.headers ?? {}) } });
    }
    return new Response("not stubbed", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}
afterEach(() => vi.unstubAllGlobals());

// ---------- shopify ----------

describe("shopify — first live contact", () => {
  const creds: PlatformCredential = { kind: "shopify", shopDomain: SHOP, accessToken: FAKE_TOKEN };

  it("parses a Link header's rel=next and refuses one pointing off the shop", () => {
    expect(nextLink(P.SHOPIFY_LINK_NEXT(SHOP, "abc"))).toBe(`https://${SHOP}/admin/api/2026-07/orders.json?limit=250&page_info=abc`);
    expect(nextLink(P.SHOPIFY_LINK_PREV_NEXT(SHOP, "p", "n"))).toContain("page_info=n");
    expect(nextLink(null)).toBeNull();
    expect(shopify.safeNextUrl(P.SHOPIFY_LINK_NEXT("evil.example.com", "x"), SHOP)).toBeNull();
    expect(shopify.safeNextUrl(P.SHOPIFY_LINK_NEXT(SHOP, "x"), SHOP)).toContain(SHOP);
  });

  it("follows the Link header across pages, excludes cancelled/voided orders and uses current_total_price", async () => {
    const { calls } = routedFetch([
      (url) => (url.includes("page_info=PAGE2") ? { body: P.SHOPIFY_ORDERS_PAGE_2 } : undefined),
      (url) => (url.includes("/orders.json") ? { body: P.SHOPIFY_ORDERS_PAGE_1, headers: { link: P.SHOPIFY_LINK_NEXT(SHOP, "PAGE2") } } : undefined),
    ]);
    const res = await shopify.read({ resource: "orders", window: "28d" }, creds, { now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(`https://${SHOP}/admin/api/2026-07/orders.json?limit=250&page_info=PAGE2`);
    expect((calls[1].init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe(FAKE_TOKEN);
    expect(res.count).toBe(4);
    // 89 (paid) + 60 (partially refunded → current_total_price) + 59 (page 2); the voided/cancelled one is out
    expect(res.metrics).toMatchObject({ revenue: 208, order_count: 3, excluded_count: 1, aov: 69.33 });
    expect(res.provenance.note).toContain("2 pages");
    expect(res.provenance.note).toContain("1 excluded");
    expect(JSON.stringify(res)).not.toContain(FAKE_TOKEN);
  });

  it("passes financial_status through when the query names one, and names missing fields", async () => {
    const { calls } = routedFetch([() => ({ body: { orders: [{ id: 1, created_at: "2026-09-01T00:00:00Z" }] } })]);
    const res = await shopify.read({ resource: "orders", window: "7d", filter: { financial_status: "paid" } }, creds, { now });
    expect(new URL(calls[0].url).searchParams.get("financial_status")).toBe("paid");
    expect(res.ok && res.metrics.revenue).toBe(0);
    expect(res.ok && res.provenance.note).toContain("fields missing on some rows (read as 0/null): total_price");
  });

  it("customers window uses updated_at_min and the repeat count", async () => {
    const { calls } = routedFetch([() => ({ body: P.SHOPIFY_CUSTOMERS })]);
    const res = await shopify.read({ resource: "customers", window: "90d" }, creds, { now });
    expect(new URL(calls[0].url).searchParams.get("updated_at_min")).toBe("2026-06-04T07:00:00.000Z");
    expect(res.ok && res.metrics).toMatchObject({ repeat_count: 2, total_spent: 634.5 });
  });
});

// ---------- klaviyo ----------

describe("klaviyo — first live contact", () => {
  const creds: PlatformCredential = { kind: "klaviyo", apiKey: FAKE_KEY };

  it("a private key rides as Klaviyo-API-Key, an OAuth token as Bearer", () => {
    expect(klaviyo.authHeader("pk_abc")).toBe("Klaviyo-API-Key pk_abc");
    expect(klaviyo.authHeader("oauth-token")).toBe("Bearer oauth-token");
  });

  it("picks the Shopify Placed Order metric over the API one", () => {
    const rows = klaviyo.flatten(P.KLAVIYO_METRICS_LIST)!;
    expect(klaviyo.pickMetricId(rows, "Placed Order")).toBe("M_shop");
    expect(klaviyo.pickMetricId(rows, "placed order")).toBe("M_shop");
    expect(klaviyo.pickMetricId(rows, "Nope")).toBeNull();
  });

  it("resolves the metric id, posts metric-aggregates by $attributed_channel and splits attributed from total revenue", async () => {
    const { calls } = routedFetch([
      (url) => (url.startsWith("https://a.klaviyo.com/api/metrics?") ? { body: P.KLAVIYO_METRICS_LIST } : undefined),
      (url) => (url === "https://a.klaviyo.com/api/metric-aggregates" ? { body: P.KLAVIYO_METRIC_AGGREGATES } : undefined),
    ]);
    const res = await klaviyo.read({ resource: "metrics", window: "28d", filter: { metric: "Placed Order", attributed: true } }, creds, { now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toHaveLength(2);
    const body = JSON.parse(calls[1].init.body as string);
    expect(body.data.attributes).toMatchObject({ metric_id: "M_shop", by: ["$attributed_channel"], measurements: ["count", "sum_value"], interval: "day" });
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe(`Klaviyo-API-Key ${FAKE_KEY}`);
    expect(res.rows).toEqual([
      { attributed_channel: "email", placed_orders: 5, revenue: 600.5 },
      { attributed_channel: "sms", placed_orders: 1, revenue: 89 },
      { attributed_channel: "", placed_orders: 22, revenue: 2700.25 },
    ]);
    expect(res.metrics).toMatchObject({ revenue: 689.5, revenue_total: 3389.75, placed_orders: 28 });
    expect(res.provenance.note).toContain("M_shop");
  });

  it("flowName → flow lookup + flow-values report, per-message rows in the catalog's names", async () => {
    const { calls } = routedFetch([
      (url) => (url.startsWith("https://a.klaviyo.com/api/metrics?") ? { body: P.KLAVIYO_METRICS_LIST } : undefined),
      (url) => (url.startsWith("https://a.klaviyo.com/api/flows?") ? { body: P.KLAVIYO_FLOWS_ABANDONED } : undefined),
      (url) => (url === "https://a.klaviyo.com/api/flow-values-reports" ? { body: P.KLAVIYO_FLOW_VALUES } : undefined),
    ]);
    const res = await klaviyo.read({ resource: "metrics", window: "28d", filter: { flowName: "Abandoned Cart" }, fields: ["sends", "clicks", "placed_orders", "revenue"] }, creds, { now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/metrics", "/api/flows", "/api/flow-values-reports"]);
    const body = JSON.parse(calls[2].init.body as string);
    expect(body.data.attributes).toMatchObject({ conversion_metric_id: "M_shop", filter: 'equals(flow_id,"FLOW_ac")', statistics: ["recipients", "opens", "clicks", "conversions", "conversion_value"] });
    expect(res.rows[0]).toMatchObject({ message_id: "MSG_1", sends: 410, opens: 220, clicks: 41, placed_orders: 12, revenue: 1080 });
    expect(res.metrics).toMatchObject({ sends: 790, placed_orders: 16, revenue: 1440, weakest_message_id: "MSG_2", weakest_message_position: 2, weakest_ctor_pct: 7.06 });
  });

  it("a missing measurement reads 0 and is named, never NaN", () => {
    const flat = klaviyo.flattenAggregates({ data: { attributes: { data: [{ dimensions: [], measurements: { count: [1, 2] } }] } } }, [])!;
    expect(flat.rows).toEqual([{ placed_orders: 3, revenue: 0 }]);
    expect(flat.missing).toEqual(["sum_value"]);
    expect(klaviyo.flattenAggregates({ data: {} }, [])).toBeNull();
    expect(klaviyo.flattenFlowValues({ data: { attributes: { results: [{ groupings: {}, statistics: { recipients: 5 } }] } } })!.missing).toEqual(["opens", "clicks", "conversions", "conversion_value"]);
  });

  it("no matching flow is an honest could-not-ask", async () => {
    routedFetch([
      (url) => (url.startsWith("https://a.klaviyo.com/api/metrics?") ? { body: P.KLAVIYO_METRICS_LIST } : undefined),
      (url) => (url.startsWith("https://a.klaviyo.com/api/flows?") ? { body: { data: [] } } : undefined),
    ]);
    const res = await klaviyo.read({ resource: "metrics", filter: { flowName: "Ghost" } }, creds, { now });
    expect(res).toEqual({ ok: false, reason: 'no flow named "Ghost" on this account' });
  });
});

// ---------- meta ----------

describe("meta — first live contact", () => {
  const creds: PlatformCredential = { kind: "meta_ads", adAccountId: "act_1234567890", accessToken: FAKE_META };

  it("follows paging.cursors.after with our own URL (never Meta's token-bearing next), reads omni_purchase first, derives cpa", async () => {
    const { calls } = routedFetch([
      (url) => (url.includes("after=MQZDZD") ? { body: P.META_INSIGHTS_PAGE_2 } : undefined),
      (url) => (url.includes("/insights") ? { body: P.META_INSIGHTS_PAGE_1 } : undefined),
    ]);
    const res = await meta.read({ resource: "insights", window: "7d", fields: ["spend", "purchases", "purchase_value", "roas"] }, creds, { now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toHaveLength(2);
    expect(calls[1].url).not.toContain("SHOULD_NOT_BE_USED");
    expect(new URL(calls[1].url).searchParams.get("after")).toBe("MQZDZD");
    expect(res.count).toBe(3);
    expect(res.rows[0]).toMatchObject({ campaign_id: "c1", spend: 420.17, purchases: 19, purchase_value: 1302, roas: 3.098, cpa: 22.11, impressions: 51230 });
    expect(res.rows[1]).toMatchObject({ purchases: 9, purchase_value: 546, roas: 2.1 });
    expect(res.rows[2]).toMatchObject({ purchases: null, purchase_value: null, roas: null, cpa: null });
    expect(res.metrics).toMatchObject({ spend: 690.17, purchases: null, purchase_value: null, roas: null, top_adset_name: null, worst_ad_name: null, daily_budget_total: null, projected_daily_spend: null });
    expect(res.provenance.note).toContain("2 pages");
    expect(JSON.stringify(res)).not.toContain(FAKE_META);
  });

  it("campaign budgets arrive in minor units and are converted", async () => {
    routedFetch([() => ({ body: P.META_CAMPAIGNS })]);
    const res = await meta.read({ resource: "campaigns" }, creds, { now });
    expect(res.ok && res.rows[0]).toMatchObject({ id: "c1", daily_budget: 100 });
    expect(res.ok && res.rows[1]).toMatchObject({ id: "c2", lifetime_budget: 2500 });
    expect(res.ok && res.metrics).toEqual({ daily_budget_total: 100, count: 2 });
  });

  it("rejects capped pagination rather than returning partial totals", async () => {
    const { calls } = routedFetch([() => ({ body: { data: [{ spend: "1" }], paging: { next: "https://example.invalid/next", cursors: { after: "cursor" } } } })]);
    const res = await meta.read({ resource: "insights" }, creds, { now });
    expect(res).toEqual({ ok: false, reason: "Meta pagination is incomplete after 5 pages; narrow the query or use a complete ingestion job" });
    expect(calls).toHaveLength(5);
  });

  it.each([undefined, ""])("rejects an unusable next cursor %s", async after => {
    routedFetch([() => ({ body: { data: [{ spend: "1" }], paging: { next: "https://example.invalid/next", cursors: { after } } } })]);
    expect(await meta.read({ resource: "insights" }, creds, { now })).toMatchObject({ ok: false, reason: expect.stringContaining("no usable cursor") });
  });

  it("distinguishes an explicit empty action array from omitted purchase data", async () => {
    routedFetch([() => ({ body: { data: [{ spend: "1", actions: [], action_values: [], purchase_roas: [] }] } })]);
    const res = await meta.read({ resource: "insights" }, creds, { now });
    expect(res.ok && res.metrics).toMatchObject({ purchases: 0, purchase_value: 0, roas: 0, cpa: null });
  });

  it("does not certify missing spend as zero", async () => {
    routedFetch([() => ({ body: { data: [{ actions: [] }] } })]);
    expect(await meta.read({ resource: "insights" }, creds, { now })).toMatchObject({ ok: false, reason: expect.stringContaining("spend") });
  });

  it("rows without the purchase fields are named in provenance, and the platform's error is the reason", async () => {
    routedFetch([() => ({ body: { data: [{ campaign_id: "c9", spend: "1.00" }] } })]);
    const res = await meta.read({ resource: "insights", window: "1d" }, creds, { now });
    expect(res.ok && res.provenance.note).toContain("fields absent from every row: actions, action_values, purchase_roas");
    expect(res.ok && res.metrics).toMatchObject({ purchases: null, purchase_value: null, roas: null, cpa: null });
    routedFetch([() => ({ body: P.META_ERROR_190, status: 400 })]);
    expect(await meta.read({ resource: "insights" }, creds, { now })).toEqual({ ok: false, reason: `HTTP 400 from graph.facebook.com/${meta.META_GRAPH_VERSION}/act_1234567890/insights` });
  });
});

// ---------- ga4 ----------

describe("ga4 — first live contact", () => {
  it("reads a runReport, caps the limit and notes the row count", async () => {
    const { calls } = routedFetch([() => ({ body: P.GA4_RUN_REPORT })]);
    const res = await ga4.read({ resource: "report", window: "7d", fields: ["sessions", "conversions"], groupBy: ["sessionSource"] }, { kind: "ga4", propertyId: "123456", accessToken: FAKE_BEARER }, { now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.limit).toBe(1000);
    expect(body.keepEmptyRows).toBe(false);
    expect(res.rows).toEqual([
      { sessionSource: "google", sessions: 3975, conversions: 48 },
      { sessionSource: "(direct)", sessions: 1200, conversions: 10 },
    ]);
    expect(res.metrics).toEqual({ sessions: 5175, conversions: 58 });
    expect(res.provenance.note).toBe("POST properties/{id}:runReport (2 of 2 rows)");
  });
});

// ---------- --probe ----------

describe("--probe", () => {
  it("parses the flag and its overrides", () => {
    expect(parseArgs(["--probe", "shopify", "--account", "acct-1", "--resource", "customers", "--window", "90d"])).toMatchObject({ probe: "shopify", accountId: "acct-1", accountGiven: true, resource: "customers", window: "90d" });
    expect(parseArgs([]).probe).toBeNull();
    expect(() => parseArgs(["--probe"])).toThrow(/needs a platform/);
  });

  it("runs one read through the credential provider and prints shaped, redacted rows", async () => {
    const report = await runProbe({ credentials: new FixtureCredentialProvider(), now }, { platform: "shopify", accountId: "demo" });
    expect(report).toMatchObject({ ok: true, credential: "fixture:shopify", query: { resource: "orders", window: "7d" }, count: 3 });
    expect(report.columns).toContain("total_price");
    expect(report.sample).toHaveLength(2);
    expect(report.sample![0].line_items).toBe("[1 items]");
    const text = formatProbe(report);
    expect(text).toContain('"platform": "shopify"');
    expect(text).not.toContain("shpat_");
  });

  it("answers honestly when nothing is connected or the platform has no reader", async () => {
    const none = await runProbe({ credentials: new FixtureCredentialProvider([]), now }, { platform: "klaviyo", accountId: "demo" });
    expect(none.ok).toBe(false);
    expect(none.reason).toMatch(/nothing connected/);
    const noReader = await runProbe({ credentials: new FixtureCredentialProvider(), now }, { platform: "instagram", accountId: "demo" });
    expect(noReader.reason).toMatch(/no reader for platform "instagram"/);
  });

  it("redacts emails, token-shaped strings and personal columns; overrides the default query", () => {
    const long = `https://example.com/${"x".repeat(90)}`;
    expect(redactRow({ email: "a@b.co", note: "hello", token: "shpat_abcdefghijklmnop", url: long, items: [1, 2], nested: { a: 1 } })).toEqual({ email: "[redacted]", note: "hello", token: "[redacted]", url: `${long.slice(0, 77)}…`, items: "[2 items]", nested: "{…}" });
    expect(redactRow({ blob: "A".repeat(64) })).toEqual({ blob: "[redacted]" });
    expect(redactRow({ contact: "someone@example.com" })).toEqual({ contact: "[email]" });
    const q: ReadQuery = probeQuery("klaviyo", { resource: "flows", window: null });
    expect(q).toMatchObject({ resource: "flows", window: "28d" });
  });
});
