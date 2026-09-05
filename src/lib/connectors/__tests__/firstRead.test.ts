/* "Reading your last 90 days now": the first certified read after a connect — through the
   real credential provider + readers against a stubbed fetch, into kpi_snapshots, with the
   connector row and receipts saying exactly what happened. Plus the OAuth callback and the
   picker firing the same hook. */

import { beforeEach, describe, expect, it, vi } from "vitest";
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
    db.rows("accounts")[0].context_generation = 1;
    const id = connected("shopify", SHOP);
    const d = firstReadDeps();
    d.routes.push((c) => (c.url.includes("/orders.json") && c.headers["x-shopify-access-token"] === TOKEN ? json(P.SHOPIFY_ORDERS_PAGE_1) : undefined));
    d.routes.push((c) => (c.url.includes("/customers.json") ? json(P.SHOPIFY_CUSTOMERS) : undefined));

    const out = await readNowAfterConnect(d, accountId, "shopify", { connectorId: id, contextGeneration: 1, initiatedBy: userId });
    expect(out).toEqual({ platform: "shopify", ok: true, metrics: 5, keys: ["revenue_28d", "revenue_7d", "orders_7d", "aov_28d", "repeat_rate_90d"], rows: null, reason: null });
    // one read per (resource, window): orders 28d, orders 7d, customers 90d
    expect(d.calls.map((c) => new URL(c.url).pathname)).toEqual(["/admin/api/2026-07/orders.json", "/admin/api/2026-07/orders.json", "/admin/api/2026-07/customers.json"]);

    const snaps = db.rows("kpi_snapshots");
    expect(snaps.map((r) => r.metric_key)).toEqual(["revenue_28d", "revenue_7d", "orders_7d", "aov_28d", "repeat_rate_90d"]);
    expect(snaps.find((r) => r.metric_key === "revenue_28d")).toMatchObject({ account_id: accountId, value: 149, currency: "NZD", platform: "shopify", provenance: "live", window_end: "2026-09-02" });
    expect(snaps.find((r) => r.metric_key === "orders_7d")!.value).toBe(3);
    expect(snaps.every(r => r.context_generation === 1)).toBe(true);
    expect(db.rows("receipts").every(r => r.context_generation === 1)).toBe(true);
    expect(snaps.find((r) => r.metric_key === "repeat_rate_90d")!.value).toBe(66.67);

    const row = db.rows("connectors").find((r) => r.id === id)!;
    expect(row).toMatchObject({ status: "connected", last_sync_result: "ok", last_sync_at: NOW.toISOString(), last_read_metrics: 5 });

    const receipts = db.rows("receipts").map((r) => r.description as string);
    expect(receipts[0]).toBe("Reading your recent data from Shopify now…");
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
    expect(last).toContain("Check the connection diagnostics before reconnecting");
    expect(last).not.toContain("HTTP 401");
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

describe("first-read context and atomic persistence", () => {
  it.each(["paused", "old_generation", "missing_account", "different_connector", "different_asset"])("%s before work produces no provider calls or reconnect receipt", async mode => {
    const id = connected("hubspot", "777");
    const capture = { connectorId: id, contextGeneration: 0, externalRef: "777", initiatedBy: userId };
    if (mode === "paused") db.rows("accounts")[0].automation_paused = true;
    if (mode === "old_generation") db.rows("accounts")[0].context_generation = 1;
    if (mode === "missing_account") db.deleteRows("accounts", db.rows("accounts"));
    if (mode === "different_connector") capture.connectorId = "not-original";
    if (mode === "different_asset") capture.externalRef = "not-original";
    const read = vi.fn(async () => ({ rows: [], metrics: {}, fetchedAt: NOW.toISOString() }));
    const out = await readNowAfterConnect(firstReadDeps({ reader: { read } }), accountId, "hubspot", capture);
    expect(out.ok).toBe(false); expect(read).not.toHaveBeenCalled(); expect(db.rows("receipts")).toHaveLength(0);
    expect(db.rows("connectors")[0].last_sync_result).toBeNull();
  });
  it.each(["reset", "pause", "disconnect", "asset", "owner"])("%s during the provider call cannot certify the result", async mode => {
    const id = connected("hubspot", "777");
    const reader: ConnectorReader = { read: async (_source, _query, context) => {
      expect(context.account.contextGeneration).toBe(0);
      if (mode === "reset") db.rows("accounts")[0].context_generation = 1;
      if (mode === "pause") db.rows("accounts")[0].automation_paused = true;
      if (mode === "disconnect") db.rows("connectors")[0].status = "disconnected";
      if (mode === "asset") db.rows("connectors")[0].external_ref = "replacement";
      if (mode === "owner") db.rows("account_members")[0].role = "member";
      return { rows: [{ id: "synthetic" }], metrics: {}, fetchedAt: NOW.toISOString() };
    } };
    const out = await readNowAfterConnect(firstReadDeps({ reader }), accountId, "hubspot", { connectorId: id, contextGeneration: 0, initiatedBy: userId });
    expect(out).toMatchObject({ ok: false, reason: mode === "pause" ? "automation_paused" : "context_changed" });
    expect(db.rows("kpi_snapshots")).toHaveLength(0);
    expect(db.rows("connectors")[0].last_sync_result).toBeNull();
    expect(db.rows("receipts")).toHaveLength(1);
    expect(db.rows("receipts")[0].description).not.toContain("reconnect");
  });
  it("the database commit still refuses a selection change after the final JS guard", async () => {
    const id = connected("hubspot", "777");
    const original = db.rpcs.record_connector_first_read;
    db.rpcs.record_connector_first_read = args => {
      if ((args.input as { result: string | null }).result !== null) db.rows("connectors")[0].external_ref = "replacement";
      return original(args);
    };
    const reader: ConnectorReader = { read: async () => ({ rows: [], metrics: {}, fetchedAt: NOW.toISOString() }) };
    const out = await readNowAfterConnect(firstReadDeps({ reader }), accountId, "hubspot", { connectorId: id });
    expect(out).toMatchObject({ ok: false, reason: "context_changed" });
    expect(db.rows("connectors")[0].last_sync_result).toBeNull(); expect(db.rows("receipts")).toHaveLength(1);
  });
  it("receipt insertion failure rolls back staged KPIs and the dashboard success flag", async () => {
    connected("shopify", SHOP);
    const d = firstReadDeps();
    d.routes.push(c => c.url.includes("/orders.json") ? json(P.SHOPIFY_ORDERS_PAGE_1) : json(P.SHOPIFY_CUSTOMERS));
    const insert = db.insertRow.bind(db);
    vi.spyOn(db, "insertRow").mockImplementation((table, row) => {
      if (table === "receipts" && String(row.description).startsWith("Read ✓")) throw new Error("synthetic receipt failure");
      return insert(table, row);
    });
    const out = await readNowAfterConnect(d, accountId, "shopify");
    expect(out.ok).toBe(false); expect(db.rows("kpi_snapshots")).toHaveLength(0);
    expect(db.rows("connectors")[0].last_sync_result).toBeNull(); expect(db.rows("receipts")).toHaveLength(1);
  });
  it("an uncertain commit response is not retried or overwritten as a known failure", async () => {
    connected("hubspot", "777");
    const original = db.rpcs.record_connector_first_read;
    let completions = 0;
    db.rpcs.record_connector_first_read = args => {
      const result = original(args);
      if ((args.input as { result: string | null }).result !== null) { completions++; throw new Error("response lost after commit"); }
      return result;
    };
    const reader: ConnectorReader = { read: async () => ({ rows: [], metrics: {}, fetchedAt: NOW.toISOString() }) };
    const out = await readNowAfterConnect(firstReadDeps({ reader }), accountId, "hubspot");
    expect(out.ok).toBe(false); expect(completions).toBe(1);
    expect(db.rows("connectors")[0].last_sync_result).toBe("empty"); expect(db.rows("receipts")).toHaveLength(2);
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
