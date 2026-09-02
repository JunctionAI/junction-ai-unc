/* "Reading your last 90 days now": the first certified read after a connect — through the
   real credential provider + readers against a stubbed fetch, into kpi_snapshots, with the
   connector row and receipts saying exactly what happened. Plus the OAuth callback and the
   picker firing the same hook. */

import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import type { ConnectorReader } from "@/lib/runtime/types";
import * as P from "@/worker/__tests__/fixtures/platformPayloads";
import { seal } from "../crypto";
import { readNowAfterConnect, type FirstReadDeps } from "../firstRead";
import { handleSelect, readableOnConnect } from "../handlers";
import { assertNoLeak, FAKE_ENV, json, KEYRING, NOW, seededDb, stubFetch, deps as makeDeps } from "./helpers";

let db: FakeSupabase;
let accountId: string;
let userId: string;
beforeEach(() => {
  ({ db, accountId, userId } = seededDb());
});

const SHOP = "acme.myshopify.com";
const TOKEN = "shpat_FIRSTREAD_FAKE_TOKEN_0000000000";

function connected(platform: string, externalRef: string | null, token = TOKEN, status = "connected") {
  const id = db.insertRow("connectors", { account_id: accountId, platform, status, external_ref: externalRef, sync_ref: {} }).id as string;
  const sealed = seal(JSON.stringify({ accessToken: token, obtainedAt: NOW.toISOString() }), KEYRING, id);
  db.insertRow("connector_secrets", { connector_id: id, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, key_version: sealed.keyVersion });
  return id;
}

function firstReadDeps(over: Partial<FirstReadDeps> = {}) {
  const f = stubFetch();
  const logs: string[] = [];
  const d: FirstReadDeps = { db, keyring: KEYRING, env: FAKE_ENV, fetch: f.fetch, now: () => NOW, log: (l) => logs.push(l), ...over };
  return Object.assign(d, { routes: f.routes, calls: f.calls, logs });
}

describe("readNowAfterConnect — Shopify through the real reader", () => {
  it("writes the KPI rows this platform can answer, flips the row to ok + N metrics, and receipts both ends", async () => {
    const id = connected("shopify", SHOP);
    const d = firstReadDeps();
    d.routes.push((c) => (c.url.includes("/orders.json") && c.headers["x-shopify-access-token"] === TOKEN ? json(P.SHOPIFY_ORDERS_PAGE_1) : undefined));
    d.routes.push((c) => (c.url.includes("/customers.json") ? json(P.SHOPIFY_CUSTOMERS) : undefined));

    const out = await readNowAfterConnect(d, accountId, "shopify");
    expect(out).toEqual({ platform: "shopify", ok: true, metrics: 5, keys: ["revenue_28d", "revenue_7d", "orders_7d", "aov_28d", "repeat_rate_90d"], rows: null, reason: null });
    // one read per (resource, window): orders 28d, orders 7d, customers 90d
    expect(d.calls.map((c) => new URL(c.url).pathname)).toEqual(["/admin/api/2026-07/orders.json", "/admin/api/2026-07/orders.json", "/admin/api/2026-07/customers.json"]);

    const snaps = db.rows("kpi_snapshots");
    expect(snaps.map((r) => r.metric_key)).toEqual(["revenue_28d", "revenue_7d", "orders_7d", "aov_28d", "repeat_rate_90d"]);
    expect(snaps.find((r) => r.metric_key === "revenue_28d")).toMatchObject({ account_id: accountId, value: 149, currency: "NZD", platform: "shopify", provenance: "live", window_end: "2026-09-02" });
    expect(snaps.find((r) => r.metric_key === "orders_7d")!.value).toBe(3);
    expect(snaps.find((r) => r.metric_key === "repeat_rate_90d")!.value).toBe(66.67);

    const row = db.rows("connectors").find((r) => r.id === id)!;
    expect(row).toMatchObject({ status: "connected", last_sync_result: "ok", last_sync_at: NOW.toISOString(), last_read_metrics: 5 });

    const receipts = db.rows("receipts").map((r) => r.description as string);
    expect(receipts[0]).toBe("Reading your last 90 days from Shopify now…");
    expect(receipts[receipts.length - 1]).toBe("Read ✓ · 5 metrics from Shopify: revenue (28d), revenue (7d), orders (7d), average order (28d), repeat rate (90d).");
    expect(db.rows("receipts").every((r) => r.run_id === null && r.kind === "notification" && r.platform === "shopify")).toBe(true);
    assertNoLeak([...d.logs, ...db.rows("receipts").map((r) => JSON.stringify(r))], [TOKEN]);
  });

  it("a refused token: no KPI rows, error:first_read on the row, a couldn't-read receipt — never a zero", async () => {
    const id = connected("shopify", SHOP);
    const d = firstReadDeps();
    d.routes.push(() => json(P.SHOPIFY_ERROR_401, 401));
    const out = await readNowAfterConnect(d, accountId, "shopify");
    expect(out.ok).toBe(false);
    expect(out.metrics).toBe(0);
    expect(out.reason).toContain("HTTP 401 from acme.myshopify.com/admin/api/2026-07/orders.json");
    expect(db.rows("kpi_snapshots")).toHaveLength(0);
    expect(db.rows("connectors").find((r) => r.id === id)).toMatchObject({ last_sync_result: "error:first_read", last_sync_at: NOW.toISOString() });
    const last = db.rows("receipts").at(-1)!.description as string;
    expect(last).toMatch(/^Couldn't read Shopify: couldn't ask shopify orders: HTTP 401/);
    expect(last).toContain("reconnect or paste a fresh key");
    assertNoLeak(db.rows("receipts").map((r) => JSON.stringify(r)), [TOKEN]);
  });

  it("nothing connected → reason, no receipts beyond the failure line", async () => {
    connected("shopify", SHOP, TOKEN, "needs_reconnect");
    const out = await readNowAfterConnect(firstReadDeps(), accountId, "shopify");
    expect(out).toMatchObject({ ok: false, reason: "nothing connected" });
    expect(db.rows("kpi_snapshots")).toHaveLength(0);
  });
});

describe("readNowAfterConnect — platforms outside the KPI set", () => {
  it("HubSpot gets one probe read (deals) so the card can still say Read ✓", async () => {
    const id = connected("hubspot", "777");
    const reader: ConnectorReader = { read: async (source, query) => ({ rows: [{ id: "d1" }, { id: "d2" }], metrics: { count: 2 }, fetchedAt: NOW.toISOString(), provenance: "ok", ...(source === "hubspot" && query.resource === "deals" ? {} : { rows: [] }) }) };
    const out = await readNowAfterConnect(firstReadDeps({ reader }), accountId, "hubspot");
    expect(out).toEqual({ platform: "hubspot", ok: true, metrics: 0, keys: [], rows: 2, reason: null });
    expect(db.rows("connectors").find((r) => r.id === id)).toMatchObject({ last_sync_result: "ok", last_read_metrics: 0 });
    expect(db.rows("kpi_snapshots")).toHaveLength(0);
    expect(db.rows("receipts").at(-1)!.description).toContain("HubSpot answered (2 deals in the last 28d)");
  });

  it("an empty probe answer is 'empty', not an error", async () => {
    const id = connected("hubspot", "777");
    const reader: ConnectorReader = { read: async () => ({ rows: [], metrics: {}, fetchedAt: NOW.toISOString(), provenance: "empty" }) };
    await readNowAfterConnect(firstReadDeps({ reader }), accountId, "hubspot");
    expect(db.rows("connectors").find((r) => r.id === id)!.last_sync_result).toBe("empty");
  });
});

describe("the read-now hook from the OAuth side", () => {
  it("fires only once a row is readable: Shopify/Klaviyo/HubSpot at the callback, picker platforms at the choice", () => {
    expect(readableOnConnect("shopify", "acme.myshopify.com")).toBe(true);
    expect(readableOnConnect("klaviyo", null)).toBe(true);
    expect(readableOnConnect("ga4", null)).toBe(false);
    expect(readableOnConnect("ga4", "123")).toBe(true);
    expect(readableOnConnect("meta_ads", "act_1")).toBe(true);
  });

  it("POST …/select fires the hook with the connector once the GA4 property is chosen", async () => {
    const id = connected("ga4", null, "ya29.FAKE");
    const fired: unknown[] = [];
    const d = makeDeps({ db, userId, onConnected: (i) => fired.push(i) });
    const res = await handleSelect(d, "ga4", { externalRef: "properties/123456" });
    expect(res).toEqual({ status: 200, body: { ok: true, externalRef: "123456" } });
    expect(fired).toEqual([{ accountId, platform: "ga4", connectorId: id }]);
  });
});
