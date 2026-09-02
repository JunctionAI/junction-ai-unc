import { afterEach, describe, expect, it, vi } from "vitest";
import type { Platform, ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import * as ga4 from "../readers/ga4";
import * as googleAds from "../readers/googleAds";
import { safeUrl, windowDays, windowStartIso } from "../readers/http";
import * as klaviyo from "../readers/klaviyo";
import * as meta from "../readers/meta";
import * as shopify from "../readers/shopify";

const NOW = new Date("2026-09-02T07:00:00.000Z");
const now = () => NOW;

const FAKE_TOKEN = "shpat_FAKE_TOKEN_FOR_TESTS_ONLY";
const FAKE_KEY = "pk_FAKE_KLAVIYO_KEY";
const FAKE_BEARER = "ya29.FAKE_GOOGLE_TOKEN";
const FAKE_META = "EAAFAKEMETATOKEN0000000000000000000000";

const fixture = (platform: Platform): PlatformCredential => ({ kind: "fixture", platform, marker: `fixture:${platform}` });

type Call = { url: string; init: RequestInit };
function stubFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

afterEach(() => vi.unstubAllGlobals());

// ---------- http helpers ----------

describe("http helpers", () => {
  it("parses windows and never exposes query strings in safeUrl", () => {
    expect(windowStartIso("7d", NOW)).toBe("2026-08-26T07:00:00.000Z");
    expect(windowStartIso("24h", NOW)).toBe("2026-09-01T07:00:00.000Z");
    expect(windowStartIso(undefined, NOW)).toBeNull();
    expect(windowStartIso("soon", NOW)).toBeNull();
    expect(windowDays("28d")).toBe(28);
    expect(windowDays("6h")).toBe(1);
    expect(safeUrl("https://x.myshopify.com/admin/api/2026-01/orders.json?access_token=SECRET")).toBe("x.myshopify.com/admin/api/2026-01/orders.json");
  });
});

// ---------- shopify ----------

describe("shopify reader", () => {
  const creds: PlatformCredential = { kind: "shopify", shopDomain: "example.myshopify.com", accessToken: FAKE_TOKEN };

  it("shapes an orders request: versioned path, window, limit, fields, token in header only", async () => {
    const { calls } = stubFetch({ orders: [{ id: 1, total_price: "10.00" }, { id: 2, total_price: "15.50" }] });
    const query: ReadQuery = { resource: "orders", window: "7d", fields: ["total_price", "landing_site"], limit: 500 };
    const res = await shopify.read(query, creds, { now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.count).toBe(2);
    expect(res.metrics).toMatchObject({ revenue: 25.5, aov: 12.75, order_count: 2, excluded_count: 0 });
    expect(res.provenance).toMatchObject({ platform: "shopify", source: "live", fetchedAt: NOW.toISOString() });

    const [{ url, init }] = calls;
    const u = new URL(url);
    expect(u.host).toBe("example.myshopify.com");
    expect(u.pathname).toBe(`/admin/api/${shopify.SHOPIFY_API_VERSION}/orders.json`);
    expect(u.searchParams.get("status")).toBe("any");
    expect(u.searchParams.get("limit")).toBe("250"); // clamped
    expect(u.searchParams.get("created_at_min")).toBe("2026-08-26T07:00:00.000Z");
    // orders always carry the fields the revenue exclusions need
    expect(u.searchParams.get("fields")).toBe("id,created_at,total_price,current_total_price,financial_status,cancelled_at,landing_site");
    expect(u.searchParams.has("financial_status")).toBe(false);
    expect((init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe(FAKE_TOKEN);
    expect(url).not.toContain(FAKE_TOKEN);
  });

  it("reports HTTP failures as could-not-ask without leaking the token", async () => {
    stubFetch({ errors: "unauthorized" }, 401);
    const res = await shopify.read({ resource: "products" }, creds, { now });
    expect(res).toEqual({ ok: false, reason: `HTTP 401 from example.myshopify.com/admin/api/${shopify.SHOPIFY_API_VERSION}/products.json` });
    expect(JSON.stringify(res)).not.toContain(FAKE_TOKEN);
  });

  it("reports a timeout as could-not-ask", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    );
    const res = await shopify.read({ resource: "orders" }, creds, { now, timeoutMs: 5 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/timeout after 5ms/);
  });

  it("answers fixture credentials without touching the network", async () => {
    const { fn } = stubFetch({});
    const res = await shopify.read({ resource: "checkouts", window: "7d" }, fixture("shopify"), { now });
    expect(fn).not.toHaveBeenCalled();
    expect(res.ok && res.provenance.source).toBe("fixture");
    expect(res.ok && res.count).toBe(5);
    expect(res.ok && res.metrics.total_value).toBe(510);
  });

  it("rejects unknown resources and wrong-platform credentials", async () => {
    expect(await shopify.read({ resource: "inventory" }, creds, { now })).toEqual({ ok: false, reason: 'shopify resource "inventory" has no reader' });
    expect(await shopify.read({ resource: "orders" }, { kind: "klaviyo", apiKey: FAKE_KEY }, { now })).toEqual({ ok: false, reason: "shopify reader was given klaviyo credentials" });
  });

  it("pages metrics flag missing meta", () => {
    expect(shopify.shopifyMetrics("pages", [{ id: 1, handle: "a", metafields_global_title_tag: "A", metafields_global_description_tag: "d" }, { id: 2, handle: "b", metafields_global_title_tag: "" }])).toMatchObject({ missing_meta_count: 1, worst_page_handle: "b" });
  });
});

// ---------- klaviyo ----------

describe("klaviyo reader", () => {
  const creds: PlatformCredential = { kind: "klaviyo", apiKey: FAKE_KEY };

  it("shapes a flows lookup with the name filter and pinned revision", async () => {
    const { calls } = stubFetch({ data: [{ id: "f1", attributes: { name: "Welcome Series", status: "live" } }] });
    const res = await klaviyo.read({ resource: "flows", filter: { name: "Welcome Series" } }, creds, { now });
    expect(res.ok && res.rows).toEqual([{ id: "f1", name: "Welcome Series", status: "live" }]);
    expect(res.ok && res.metrics).toMatchObject({ id: "f1", status: "live" });
    const [{ url, init }] = calls;
    expect(url).toBe("https://a.klaviyo.com/api/flows?filter=equals%28name%2C%22Welcome+Series%22%29&fields%5Bflow%5D=name%2Cstatus%2Ctrigger_type%2Ccreated%2Cupdated");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Klaviyo-API-Key ${FAKE_KEY}`);
    expect(headers.revision).toBe(klaviyo.KLAVIYO_REVISION);
  });

  it("shapes a metric-aggregates POST when a metric id is given, and refuses honestly when not", async () => {
    const { calls } = stubFetch({ data: { id: "agg", attributes: { dates: [], data: [] } } });
    const res = await klaviyo.read({ resource: "metrics", window: "28d", filter: { metricId: "M1" }, groupBy: ["$flow"] }, creds, { now });
    expect(res.ok).toBe(true);
    const [{ url, init }] = calls;
    expect(url).toBe("https://a.klaviyo.com/api/metric-aggregates");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.data.attributes.metric_id).toBe("M1");
    expect(body.data.attributes.filter).toEqual(["greater-or-equal(datetime,2026-08-05T07:00:00.000Z)", "less-than(datetime,2026-09-02T07:00:00.000Z)"]);
    expect(body.data.attributes.by).toEqual(["$flow"]);
    expect(body.data.attributes.measurements).toEqual(["count", "sum_value"]);

    // no metric id and no "Placed Order" on the account's metric list → honest "couldn't ask"
    const noId = await klaviyo.read({ resource: "metrics", filter: { flowName: "Welcome Series" } }, creds, { now });
    expect(noId.ok).toBe(false);
    expect(!noId.ok && noId.reason).toMatch(/no metric named "Placed Order"/);
  });

  it("computes the weakest message by CTOR from fixture metrics", async () => {
    const res = await klaviyo.read({ resource: "metrics", window: "28d" }, fixture("klaviyo"), { now });
    expect(res.ok && res.metrics).toMatchObject({ sends: 1140, weakest_message_id: "msg_2", weakest_message_position: 2, weakest_ctor_pct: 7.06 });
  });

  it("maps HTTP failures without leaking the key", async () => {
    stubFetch({}, 429);
    const res = await klaviyo.read({ resource: "segments" }, creds, { now });
    expect(res).toEqual({ ok: false, reason: "HTTP 429 from a.klaviyo.com/api/segments" });
  });
});

// ---------- ga4 ----------

describe("ga4 reader", () => {
  const creds: PlatformCredential = { kind: "ga4", propertyId: "123456", accessToken: FAKE_BEARER };

  it("shapes runReport: bearer header, dateRanges from window, metrics/dimensions/filter from the query", async () => {
    const { calls } = stubFetch({
      dimensionHeaders: [{ name: "sessionCampaignName" }],
      metricHeaders: [{ name: "sessions" }, { name: "conversions" }],
      rows: [
        { dimensionValues: [{ value: "Prospecting" }], metricValues: [{ value: "120" }, { value: "4" }] },
        { dimensionValues: [{ value: "Retargeting" }], metricValues: [{ value: "80" }, { value: "6" }] },
      ],
    });
    const res = await ga4.read({ resource: "report", window: "7d", fields: ["sessions", "conversions"], groupBy: ["sessionCampaignName"], filter: { sessionSource: "facebook" } }, creds, { now });
    expect(res.ok && res.rows).toEqual([
      { sessionCampaignName: "Prospecting", sessions: 120, conversions: 4 },
      { sessionCampaignName: "Retargeting", sessions: 80, conversions: 6 },
    ]);
    expect(res.ok && res.metrics).toEqual({ sessions: 200, conversions: 10 });
    const [{ url, init }] = calls;
    expect(url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_BEARER}`);
    const body = JSON.parse(init.body as string);
    expect(body.dateRanges).toEqual([{ startDate: "7daysAgo", endDate: "today" }]);
    expect(body.metrics).toEqual([{ name: "sessions" }, { name: "conversions" }]);
    expect(body.dimensions).toEqual([{ name: "sessionCampaignName" }]);
    expect(body.dimensionFilter).toEqual({ filter: { fieldName: "sessionSource", stringFilter: { matchType: "EXACT", value: "facebook" } } });
  });

  it("only knows the report resource; fixture honours string filters", async () => {
    expect(await ga4.read({ resource: "events" }, creds, { now })).toMatchObject({ ok: false });
    const res = await ga4.read({ resource: "report", fields: ["sessions", "conversions"], filter: { sessionSource: "instagram" } }, fixture("ga4"), { now });
    expect(res.ok && res.count).toBe(1);
    expect(res.ok && res.metrics).toEqual({ sessions: 1840, conversions: 21 });
  });
});

// ---------- meta ----------

describe("meta reader", () => {
  const creds: PlatformCredential = { kind: "meta_ads", adAccountId: "123", accessToken: FAKE_META };

  it("shapes an adset insights request with aliases mapped, budget dropped, and the token in the Authorization header", async () => {
    const { calls } = stubFetch({
      data: [
        { adset_id: "a1", adset_name: "Prospecting", spend: "100.5", actions: [{ action_type: "purchase", value: "5" }], action_values: [{ action_type: "omni_purchase", value: "300" }], purchase_roas: [{ value: "2.99" }], frequency: "1.5" },
        { adset_id: "a2", adset_name: "Retargeting", spend: "50", actions: [], action_values: [], purchase_roas: [{ value: "1.2" }], frequency: "4.1" },
      ],
    });
    const res = await meta.read({ resource: "insights", window: "7d", filter: { level: "adset" }, fields: ["spend", "purchases", "purchase_value", "roas", "daily_budget"], limit: 100 }, creds, { now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]).toMatchObject({ spend: 100.5, purchases: 5, purchase_value: 300, roas: 2.99 });
    expect(res.metrics).toMatchObject({ spend: 150.5, purchases: 5, purchase_value: 300, top_adset_id: "a1", top_adset_name: "Prospecting", top_adset_roas: 2.99, worst_ad_name: "Retargeting", worst_frequency: 4.1 });
    expect(res.provenance.note).toContain("dropped non-insights fields: daily_budget");

    const [{ url, init }] = calls;
    const u = new URL(url);
    expect(u.pathname).toBe(`/${meta.META_GRAPH_VERSION}/act_123/insights`);
    expect(u.searchParams.get("level")).toBe("adset");
    // an exact window, not a preset: 7 days ending today (UTC)
    expect(JSON.parse(u.searchParams.get("time_range")!)).toEqual({ since: "2026-08-27", until: "2026-09-02" });
    expect(u.searchParams.has("date_preset")).toBe(false);
    expect(u.searchParams.get("fields")!.split(",")).toEqual(expect.arrayContaining(["spend", "actions", "action_values", "purchase_roas", "adset_id", "adset_name"]));
    expect(u.searchParams.has("access_token")).toBe(false);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_META}`);
  });

  it("shapes an ads listing with a status filter", async () => {
    const { calls } = stubFetch({ data: [{ id: "ad1", name: "Hook", status: "PAUSED" }] });
    const res = await meta.read({ resource: "ads", filter: { status: "PAUSED" } }, creds, { now });
    expect(res.ok && res.rows).toEqual([{ ad_id: "ad1", id: "ad1", name: "Hook", status: "PAUSED" }]);
    expect(res.ok && res.metrics).toEqual({ count: 1 });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe(`/${meta.META_GRAPH_VERSION}/act_123/ads`);
    expect(JSON.parse(u.searchParams.get("filtering")!)).toEqual([{ field: "effective_status", operator: "IN", value: ["PAUSED"] }]);
  });

  it("fails closed on an error status", async () => {
    stubFetch({ error: { message: "bad" } }, 400);
    expect(await meta.read({ resource: "insights" }, creds, { now })).toEqual({ ok: false, reason: `HTTP 400 from graph.facebook.com/${meta.META_GRAPH_VERSION}/act_123/insights` });
  });
});

// ---------- google ads ----------

describe("google ads reader", () => {
  it("serves fixtures and refuses live reads with the developer-token reason", async () => {
    const { fn } = stubFetch({});
    const fx = await googleAds.read({ resource: "campaigns", window: "1d" }, fixture("google_ads"), { now });
    expect(fx.ok && fx.provenance.source).toBe("fixture");
    expect(fx.ok && fx.metrics).toMatchObject({ projected_daily_spend: 115 });
    const live = await googleAds.read({ resource: "campaigns" }, { kind: "google_ads", customerId: "1", developerToken: "dev", accessToken: "tok" }, { now });
    expect(live).toEqual({ ok: false, reason: googleAds.GOOGLE_ADS_LIVE_REASON });
    expect(fn).not.toHaveBeenCalled();
  });
});
