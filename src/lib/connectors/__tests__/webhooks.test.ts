/* Shopify compliance webhooks: locally-computed HMACs over the raw body, 401 on anything
   that doesn't verify, receipts + effects on the schema-checked fake. */

import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { seal } from "../crypto";
import { getSecret } from "../store";
import { handleShopifyWebhook, normaliseTopic, shopifyWebhookHmac, topicPathSegment, verifyShopifyWebhookHmac, type WebhookDeps, type WebhookRequest } from "../webhooks";
import { KEYRING, NOW, seededDb } from "./helpers";

import { POST as route } from "@/app/api/webhooks/shopify/[topic]/route";

const SECRET = "shopify-client-secret";
const SHOP = "acme.myshopify.com";

let db: FakeSupabase;
let accountId: string;
let logs: string[];
let connectorId: string;

beforeEach(() => {
  ({ db, accountId } = seededDb());
  logs = [];
  connectorId = db.insertRow("connectors", { account_id: accountId, platform: "shopify", status: "connected", external_ref: SHOP, sync_ref: {} }).id as string;
  const sealed = seal(JSON.stringify({ accessToken: "shpat_secret_token", obtainedAt: NOW.toISOString() }), KEYRING, connectorId);
  db.insertRow("connector_secrets", { connector_id: connectorId, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, key_version: sealed.keyVersion });
});

const deps = (over: Partial<WebhookDeps> = {}): WebhookDeps => ({ db, secret: SECRET, now: () => NOW, log: (l) => logs.push(l), ...over });

function delivery(topic: string, body: unknown, over: { hmac?: string | null; secret?: string; shop?: string | null; headerTopic?: string | null; raw?: string } = {}): WebhookRequest {
  const raw = over.raw ?? JSON.stringify(body);
  const hmac = over.hmac === undefined ? shopifyWebhookHmac(raw, over.secret ?? SECRET) : over.hmac;
  return { topicParam: topic, headers: { hmac, topic: over.headerTopic === undefined ? topic.replace("_", "/") : over.headerTopic, shopDomain: over.shop === undefined ? SHOP : over.shop }, rawBody: raw };
}

describe("HMAC", () => {
  it("verifies a locally-computed signature over the raw body and rejects everything else", () => {
    const raw = '{"shop_domain":"acme.myshopify.com","customer":{"id":42}}';
    const good = shopifyWebhookHmac(raw, SECRET);
    expect(verifyShopifyWebhookHmac(raw, good, SECRET)).toBe(true);
    expect(verifyShopifyWebhookHmac(raw, good, "other-secret")).toBe(false);
    expect(verifyShopifyWebhookHmac(raw + " ", good, SECRET)).toBe(false); // raw body, byte for byte
    expect(verifyShopifyWebhookHmac(raw, shopifyWebhookHmac('{"shop_domain":"acme.myshopify.com","customer":{"id":43}}', SECRET), SECRET)).toBe(false);
    expect(verifyShopifyWebhookHmac(raw, null, SECRET)).toBe(false);
    expect(verifyShopifyWebhookHmac(raw, "", SECRET)).toBe(false);
    expect(verifyShopifyWebhookHmac(raw, "not base64 at all!!", SECRET)).toBe(false);
    expect(verifyShopifyWebhookHmac(raw, good.slice(0, 20), SECRET)).toBe(false); // length mismatch never throws
    expect(verifyShopifyWebhookHmac(raw, good, "")).toBe(false);
  });
  it("topics normalise from the path form and the header form", () => {
    expect(normaliseTopic("customers_data_request")).toBe("customers/data_request");
    expect(normaliseTopic("customers/data_request")).toBe("customers/data_request");
    expect(normaliseTopic("customers_redact")).toBe("customers/redact");
    expect(normaliseTopic("SHOP_REDACT")).toBe("shop/redact");
    expect(normaliseTopic("orders/create")).toBeNull();
    expect(normaliseTopic("")).toBeNull();
    expect(["customers/data_request", "customers/redact", "shop/redact"].map((t) => topicPathSegment(t as never))).toEqual(["customers_data_request", "customers_redact", "shop_redact"]);
  });
});

describe("handleShopifyWebhook", () => {
  it("401 on a bad HMAC — before anything is read or written; 404 unknown topic; 503 unconfigured", async () => {
    const bad = await handleShopifyWebhook(deps(), delivery("customers_redact", { shop_domain: SHOP, customer: { id: 42 } }, { hmac: "AAAA" }));
    expect(bad.status).toBe(401);
    expect(db.rows("receipts")).toHaveLength(0);
    expect(logs).toEqual(["webhooks.shopify topic=customers/redact result=bad_hmac"]);
    expect((await handleShopifyWebhook(deps(), delivery("customers_redact", {}, { secret: "wrong" }))).status).toBe(401);
    expect((await handleShopifyWebhook(deps(), delivery("orders_create", {}))).status).toBe(404);
    expect((await handleShopifyWebhook(deps({ secret: null }), delivery("shop_redact", {}))).status).toBe(503);
  });

  it("customers/data_request → 200 + one notification receipt per account that holds the shop (ids only, no PII)", async () => {
    const body = { shop_id: 954889, shop_domain: SHOP, orders_requested: [299938, 280263], customer: { id: 191167, email: "john@example.com", phone: "555-625-1199" }, data_request: { id: 9999 } };
    const res = await handleShopifyWebhook(deps(), delivery("customers_data_request", body));
    expect(res).toEqual({ status: 200, body: { ok: true, topic: "customers/data_request", recorded: true, accounts: 1 } });
    const receipts = db.rows("receipts");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ account_id: accountId, run_id: null, kind: "notification", platform: "shopify", created_at: NOW.toISOString() });
    expect(receipts[0].description).toContain("customer 191167");
    expect(receipts[0].payload).toEqual({ topic: "customers/data_request", shop_domain: SHOP, customer_id: 191167, orders: 2, webhook_id: null });
    expect(JSON.stringify(receipts[0])).not.toContain("john@example.com");
    expect(JSON.stringify(receipts[0])).not.toContain("555-625");
    // the connection is untouched
    expect(db.rows("connectors")[0].status).toBe("connected");
    expect(await getSecret(db, connectorId)).not.toBeNull();
  });

  it("customers/redact → receipted, connection untouched", async () => {
    const res = await handleShopifyWebhook(deps(), delivery("customers_redact", { shop_domain: SHOP, customer: { id: 7 }, orders_to_redact: [1, 2, 3] }));
    expect(res.status).toBe(200);
    expect(db.rows("receipts")[0].description).toMatch(/redaction request for customer 7/);
    expect(db.rows("receipts")[0].payload).toMatchObject({ orders: 3 });
    expect(db.rows("connectors")[0].status).toBe("connected");
  });

  it("shop/redact → connector disconnected, its secret deleted, receipt written", async () => {
    const res = await handleShopifyWebhook(deps(), delivery("shop_redact", { shop_id: 954889, shop_domain: SHOP }));
    expect(res).toEqual({ status: 200, body: { ok: true, topic: "shop/redact", recorded: true, accounts: 1 } });
    expect(db.rows("connectors")[0]).toMatchObject({ status: "disconnected", last_sync_result: "error:shop_redacted", last_sync_at: NOW.toISOString() });
    expect(await getSecret(db, connectorId)).toBeNull();
    expect(db.rows("connector_secrets")).toHaveLength(0);
    expect(db.rows("receipts")[0].description).toBe(`Shopify shop/redact for ${SHOP} — connector disconnected and its token deleted.`);
  });

  it("the header topic wins over the path when both verify (the path is ours, the header is Shopify's)", async () => {
    const res = await handleShopifyWebhook(deps(), delivery("customers_redact", { shop_domain: SHOP }, { headerTopic: "shop/redact" }));
    expect(res.body).toMatchObject({ topic: "shop/redact" });
    expect(db.rows("connectors")[0].status).toBe("disconnected");
  });

  it("a verified delivery for a shop we don't hold, or with no DB, is 200 recorded:false — nothing to retry", async () => {
    expect(await handleShopifyWebhook(deps(), delivery("shop_redact", { shop_domain: "other.myshopify.com" }, { shop: "other.myshopify.com" }))).toEqual({ status: 200, body: { ok: true, topic: "shop/redact", recorded: false, accounts: 0 } });
    expect(db.rows("connectors")[0].status).toBe("connected");
    expect(await handleShopifyWebhook(deps({ db: null }), delivery("shop_redact", { shop_domain: SHOP }))).toEqual({ status: 200, body: { ok: true, topic: "shop/redact", recorded: false, accounts: 0 } });
    // shop domain from the body when the header is missing; junk domains are ignored
    expect((await handleShopifyWebhook(deps(), delivery("customers_redact", { shop_domain: SHOP }, { shop: null }))).body).toMatchObject({ recorded: true });
    expect((await handleShopifyWebhook(deps(), delivery("customers_redact", { shop_domain: "evil.com/x" }, { shop: null }))).body).toMatchObject({ recorded: false });
  });

  it("400 on a verified but malformed body", async () => {
    expect((await handleShopifyWebhook(deps(), delivery("customers_redact", null, { raw: "{not json" }))).status).toBe(400);
  });
});

describe("POST /api/webhooks/shopify/[topic] (route)", () => {
  it("reads the raw body + headers and answers 401 / 503 from the environment", async () => {
    const saved = process.env.SHOPIFY_CLIENT_SECRET;
    try {
      process.env.SHOPIFY_CLIENT_SECRET = SECRET;
      const raw = JSON.stringify({ shop_domain: SHOP });
      const mk = (hmac: string) => new Request("http://unc.test/api/webhooks/shopify/shop_redact", { method: "POST", headers: { "content-type": "application/json", "x-shopify-hmac-sha256": hmac, "x-shopify-topic": "shop/redact", "x-shopify-shop-domain": SHOP }, body: raw });
      expect((await route(mk("bad"), { params: Promise.resolve({ topic: "shop_redact" }) })).status).toBe(401);
      // valid signature, no DB configured in this process → acknowledged, recorded:false
      const ok = await route(mk(shopifyWebhookHmac(raw, SECRET)), { params: Promise.resolve({ topic: "shop_redact" }) });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true, topic: "shop/redact", recorded: false, accounts: 0 });
      delete process.env.SHOPIFY_CLIENT_SECRET;
      expect((await route(mk(shopifyWebhookHmac(raw, SECRET)), { params: Promise.resolve({ topic: "shop_redact" }) })).status).toBe(503);
    } finally {
      if (saved === undefined) delete process.env.SHOPIFY_CLIENT_SECRET;
      else process.env.SHOPIFY_CLIENT_SECRET = saved;
    }
  });
});
