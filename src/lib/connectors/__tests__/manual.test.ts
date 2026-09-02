/* Connect with a token (POST …/manual): gates, per-platform validation against a stubbed
   fetch with the platforms' real error shapes, sealing, the receipt, the read-now hook — and
   that no token value ever reaches a log, a receipt or a response. */

import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import * as P from "@/worker/__tests__/fixtures/platformPayloads";
import { open } from "../crypto";
import { handleManualConnect, parseManualBody } from "../manual";
import { hasTokenPath, MANUAL_FORMS, MANUAL_PLATFORMS } from "../manualFields";
import { platformMessage, safeDetail } from "../manualValidate";
import { assertNoLeak, config, deps as makeDeps, FAKE_ENV, json, KEYRING, NOW, seededDb } from "./helpers";

let db: FakeSupabase;
let accountId: string;
let userId: string;
beforeEach(() => {
  ({ db, accountId, userId } = seededDb());
});

const TOKENS = { shopify: "shpat_0123456789abcdef0123456789abcdef", klaviyo: "pk_0123456789abcdef0123456789abcdef", meta: "EAAB0123456789abcdefghijklmnopqrstuvwxyz0123456789", google: "1//0gFAKE_REFRESH_TOKEN_abcdefghijklmnopqrstuvwxyz", hubspot: "pat-na1-01234567-89ab-cdef-0123-456789abcdef" };

function live(over: Parameters<typeof makeDeps>[0] = {}) {
  const fired: { accountId: string; platform: string; connectorId: string }[] = [];
  const d = makeDeps({ db, userId, onConnected: (i) => fired.push(i), ...over });
  return Object.assign(d, { fired });
}

function sealedBundle(platform: string) {
  const conn = db.rows("connectors").find((r) => r.platform === platform)!;
  const secret = db.rows("connector_secrets").find((r) => r.connector_id === conn.id)!;
  return { conn, bundle: JSON.parse(open({ ciphertext: secret.ciphertext as string, iv: secret.iv as string, tag: secret.tag as string, keyVersion: secret.key_version as number }, KEYRING, conn.id as string)) };
}

const everything = () => [...db.rows("receipts").map((r) => JSON.stringify(r)), ...db.rows("connectors").map((r) => JSON.stringify(r))];

describe("the token path's shape", () => {
  it("six platforms, each with the fields the founder pastes", () => {
    expect(MANUAL_PLATFORMS).toEqual(["shopify", "klaviyo", "meta_ads", "ga4", "google_ads", "hubspot"]);
    expect(hasTokenPath("slack")).toBe(false);
    for (const p of MANUAL_PLATFORMS) expect(MANUAL_FORMS[p].fields.some((f) => f.key === "token" && f.secret)).toBe(true);
    expect(MANUAL_FORMS.shopify.fields.map((f) => f.key)).toEqual(["shop", "token"]);
    expect(MANUAL_FORMS.meta_ads.fields.map((f) => f.key)).toEqual(["external_ref", "token"]);
  });

  it("parses the body per platform and refuses what is missing", () => {
    expect(parseManualBody("shopify", { token: " t ", extra: { shop: "Acme.myshopify.com" } })).toEqual({ token: "t", externalRef: undefined, shop: "Acme.myshopify.com", expiresAt: undefined });
    expect(parseManualBody("shopify", { token: "t" })).toEqual({ error: "the store domain is needed" });
    expect(parseManualBody("meta_ads", { token: "t" })).toEqual({ error: "ad account id is needed" });
    expect(parseManualBody("klaviyo", {})).toEqual({ error: "paste the key first" });
    expect(parseManualBody("klaviyo", { token: "x".repeat(5000) })).toEqual({ error: "that doesn't look like a key (too long)" });
    expect(parseManualBody("hubspot", "nope")).toEqual({ error: "paste the key first" });
  });

  it("surfaces each platform's own error line and strips anything token-shaped", () => {
    expect(platformMessage("shopify", 401, P.SHOPIFY_ERROR_401)).toBe(P.SHOPIFY_ERROR_401.errors);
    expect(platformMessage("shopify", 422, { errors: { shop: ["is invalid"] } })).toBe("shop: is invalid");
    expect(platformMessage("klaviyo", 401, P.KLAVIYO_ERROR_401)).toBe("Missing or invalid private key.");
    expect(platformMessage("meta_ads", 400, P.META_ERROR_190)).toBe("Invalid OAuth access token - Cannot parse access token");
    expect(platformMessage("ga4", 400, P.GOOGLE_TOKEN_BAD)).toBe("invalid_grant: Token has been expired or revoked.");
    expect(platformMessage("ga4", 403, { error: { message: "The caller does not have permission", status: "PERMISSION_DENIED" } })).toBe("The caller does not have permission");
    expect(platformMessage("hubspot", 401, P.HUBSPOT_ERROR_401)).toBe("The access token is invalid or expired.");
    expect(platformMessage("hubspot", 500, null)).toBe("HTTP 500");
    expect(platformMessage("klaviyo", 429, {})).toBe("rate limited — try again in a minute");
    expect(safeDetail(`bad token ${TOKENS.shopify} here`)).toBe("bad token [redacted] here");
    expect(safeDetail("word ".repeat(100))).toHaveLength(240);
    expect(safeDetail(`key ${"A".repeat(64)}`)).toBe("key [redacted]");
  });
});

describe("POST …/manual — gates", () => {
  it("unknown platform / no token path → 404; no secret store / no DB → 503; no session → 401; no account → 403", async () => {
    expect((await handleManualConnect(live(), "nope", {})).status).toBe(404);
    expect((await handleManualConnect(live(), "slack", {})).status).toBe(404);
    expect(await handleManualConnect(live({ config: config({ keyring: null }) }), "shopify", {})).toMatchObject({ status: 503, body: { code: "secret_store_not_configured" } });
    expect((await handleManualConnect(makeDeps({ config: config({ dbConfigured: false }) }), "shopify", {})).status).toBe(503);
    expect((await handleManualConnect(live({ userId: null }), "shopify", {})).status).toBe(401);
    expect((await handleManualConnect(live({ userId: "stranger" }), "shopify", {})).status).toBe(403);
    expect(db.rows("connectors")).toHaveLength(0);
  });

  it("a member who is not the owner is refused (owner_only), and nothing is called", async () => {
    db.insertRow("account_members", { account_id: accountId, user_id: "member-2", role: "member" });
    const d = live({ userId: "member-2" });
    const res = await handleManualConnect(d, "klaviyo", { token: TOKENS.klaviyo });
    expect(res).toMatchObject({ status: 403, body: { code: "owner_only" } });
    expect(d.calls).toHaveLength(0);
    expect(db.rows("connector_secrets")).toHaveLength(0);
  });

  it("a malformed body is a 400 before any platform call", async () => {
    const d = live();
    expect((await handleManualConnect(d, "shopify", { token: TOKENS.shopify })).body).toEqual({ error: "the store domain is needed" });
    expect((await handleManualConnect(d, "shopify", { token: TOKENS.shopify, extra: { shop: "evil.com" } })).body).toEqual({ error: "Shopify said: the store must be a your-store.myshopify.com domain", code: "invalid_input" });
    expect((await handleManualConnect(d, "meta_ads", { token: TOKENS.meta, external_ref: "abc" })).status).toBe(400);
    expect(d.calls).toHaveLength(0);
  });
});

describe("POST …/manual — per platform", () => {
  it("Shopify: one shop.json read with the token in the header → sealed, connected with the shop, receipt, read-now fired", async () => {
    const d = live();
    d.routes.push((c) => (c.url === "https://acme.myshopify.com/admin/api/2026-07/shop.json" && c.headers["x-shopify-access-token"] === TOKENS.shopify ? json(P.SHOPIFY_SHOP) : undefined));
    const res = await handleManualConnect(d, "shopify", { token: TOKENS.shopify, extra: { shop: "Acme.myshopify.com" } });
    expect(res).toEqual({ status: 200, body: { ok: true, platform: "shopify", externalRef: "acme.myshopify.com", label: "Acme Wellness", reading: true } });
    expect(d.calls).toHaveLength(1);
    const { conn, bundle } = sealedBundle("shopify");
    expect(conn).toMatchObject({ account_id: accountId, status: "connected", external_ref: "acme.myshopify.com", last_sync_at: null, last_sync_result: null });
    expect(bundle).toEqual({ accessToken: TOKENS.shopify, obtainedAt: NOW.toISOString(), tokenType: "manual" });
    expect(d.fired).toEqual([{ accountId, platform: "shopify", connectorId: conn.id }]);
    const receipt = db.rows("receipts")[0];
    expect(receipt).toMatchObject({ account_id: accountId, kind: "notification", platform: "shopify", run_id: null });
    expect(receipt.description).toContain("Acme Wellness");
    expect(receipt.description).toContain("Reading your last 90 days now");
    assertNoLeak([...d.logs, ...everything(), JSON.stringify(res)], [TOKENS.shopify]);
  });

  it("Shopify: a refused key → 400 with Shopify's words, nothing stored, nothing fired", async () => {
    const d = live();
    d.routes.push(() => json(P.SHOPIFY_ERROR_401, 401));
    const res = await handleManualConnect(d, "shopify", { token: TOKENS.shopify, extra: { shop: "acme.myshopify.com" } });
    expect(res).toEqual({ status: 400, body: { error: `Shopify said: ${P.SHOPIFY_ERROR_401.errors}`, code: "rejected" } });
    expect(db.rows("connectors")).toHaveLength(0);
    expect(db.rows("connector_secrets")).toHaveLength(0);
    expect(db.rows("receipts")).toHaveLength(0);
    expect(d.fired).toEqual([]);
    assertNoLeak([...d.logs, JSON.stringify(res)], [TOKENS.shopify]);
  });

  it("Shopify: a timeout is a 400 in plain words", async () => {
    const d = live({ fetch: async () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })) });
    expect(await handleManualConnect(d, "shopify", { token: TOKENS.shopify, extra: { shop: "acme.myshopify.com" } })).toEqual({ status: 400, body: { error: "Shopify said: they didn't answer within 10 seconds", code: "timeout" } });
  });

  it("Klaviyo: /api/accounts/ with the private key as Klaviyo-API-Key → account id + organisation name", async () => {
    const d = live();
    d.routes.push((c) => (c.url === "https://a.klaviyo.com/api/accounts/" && c.headers.authorization === `Klaviyo-API-Key ${TOKENS.klaviyo}` && c.headers.revision ? json(P.KLAVIYO_ACCOUNTS) : undefined));
    const res = await handleManualConnect(d, "klaviyo", { token: TOKENS.klaviyo });
    expect(res.body).toMatchObject({ ok: true, externalRef: "AbC123", label: "Acme Wellness" });
    expect(sealedBundle("klaviyo").bundle.accessToken).toBe(TOKENS.klaviyo);
    d.routes.length = 0;
    d.routes.push(() => json(P.KLAVIYO_ERROR_401, 401));
    expect((await handleManualConnect(d, "klaviyo", { token: "pk_wrong" })).body).toEqual({ error: "Klaviyo said: Missing or invalid private key.", code: "rejected" });
  });

  it("Meta: reads the ad account itself with a Bearer; the id is normalised; an inactive account is labelled", async () => {
    const d = live();
    d.routes.push((c) => (c.url === "https://graph.facebook.com/v23.0/act_1234567890?fields=name,account_status,currency" && c.headers.authorization === `Bearer ${TOKENS.meta}` ? json({ ...P.META_AD_ACCOUNT, account_status: 2 }) : undefined));
    const res = await handleManualConnect(d, "meta_ads", { token: TOKENS.meta, external_ref: "1234567890", extra: { expires_at: "2026-11-01T00:00:00Z" } });
    expect(res.body).toMatchObject({ ok: true, externalRef: "act_1234567890", label: "Ad account Acme Wellness NZ (act_1234567890) · inactive" });
    expect(sealedBundle("meta_ads").bundle).toMatchObject({ accessToken: TOKENS.meta, expiresAt: "2026-11-01T00:00:00.000Z" });
    d.routes.length = 0;
    d.routes.push(() => json(P.META_ERROR_190, 400));
    expect((await handleManualConnect(d, "meta_ads", { token: "EAAbad", external_ref: "act_1" })).body).toEqual({ error: "Meta Ads said: Invalid OAuth access token - Cannot parse access token", code: "rejected" });
    assertNoLeak(d.logs, [TOKENS.meta]);
  });

  it("GA4: exchanges the refresh token with the Google app credentials, reads the property, seals access + refresh + expiry", async () => {
    const d = live();
    d.routes.push((c) => {
      if (c.url !== "https://oauth2.googleapis.com/token") return undefined;
      const form = new URLSearchParams(c.body!);
      return form.get("grant_type") === "refresh_token" && form.get("refresh_token") === TOKENS.google && form.get("client_id") === FAKE_ENV.GOOGLE_CLIENT_ID ? json(P.GOOGLE_TOKEN_OK) : json(P.GOOGLE_TOKEN_BAD, 400);
    });
    d.routes.push((c) => (c.url === "https://analyticsadmin.googleapis.com/v1beta/properties/123456" && c.headers.authorization === `Bearer ${P.GOOGLE_TOKEN_OK.access_token}` ? json(P.GA4_PROPERTY) : undefined));
    const res = await handleManualConnect(d, "ga4", { token: TOKENS.google, external_ref: "properties/123456" });
    expect(res.body).toMatchObject({ ok: true, externalRef: "123456", label: "acme.example.com (123456)" });
    expect(sealedBundle("ga4").bundle).toEqual({ accessToken: P.GOOGLE_TOKEN_OK.access_token, refreshToken: TOKENS.google, expiresAt: new Date(NOW.getTime() + 3599 * 1000).toISOString(), obtainedAt: NOW.toISOString(), tokenType: "manual" });
    assertNoLeak([...d.logs, ...everything(), ...d.calls.map((c) => c.url)], [TOKENS.google, P.GOOGLE_TOKEN_OK.access_token]);

    expect((await handleManualConnect(d, "ga4", { token: "1//wrong", external_ref: "123456" })).body).toEqual({ error: "Google Analytics 4 said: invalid_grant: Token has been expired or revoked.", code: "rejected" });
  });

  it("GA4 without the Google app credentials is an honest not_configured, no call made", async () => {
    const d = live({ config: config({ env: { ...FAKE_ENV, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" } }) });
    const res = await handleManualConnect(d, "ga4", { token: TOKENS.google, external_ref: "123456" });
    expect(res).toMatchObject({ status: 400, body: { code: "not_configured" } });
    expect(d.calls).toHaveLength(0);
  });

  it("Google Ads: with a developer token the customer must be on the accessible list", async () => {
    const d = live();
    d.routes.push((c) => (c.url === "https://oauth2.googleapis.com/token" ? json(P.GOOGLE_TOKEN_OK) : undefined));
    d.routes.push((c) => (c.url.endsWith("customers:listAccessibleCustomers") && c.headers["developer-token"] === FAKE_ENV.GOOGLE_ADS_DEVELOPER_TOKEN ? json(P.GOOGLE_ADS_CUSTOMERS) : undefined));
    expect((await handleManualConnect(d, "google_ads", { token: TOKENS.google, external_ref: "123-456-7890" })).body).toMatchObject({ ok: true, externalRef: "1234567890", label: "Customer 123-456-7890" });
    expect((await handleManualConnect(d, "google_ads", { token: TOKENS.google, external_ref: "555-555-5555" })).body).toEqual({ error: "Google Ads said: that login can't see customer 5555555555 (it sees 2 others)", code: "rejected" });
  });

  it("Google Ads without a developer token accepts the refresh token and says reads wait", async () => {
    const d = live({ config: config({ env: { ...FAKE_ENV, GOOGLE_ADS_DEVELOPER_TOKEN: "" } }) });
    d.routes.push((c) => (c.url === "https://oauth2.googleapis.com/token" ? json(P.GOOGLE_TOKEN_OK) : undefined));
    const res = await handleManualConnect(d, "google_ads", { token: TOKENS.google, external_ref: "1234567890" });
    expect(res.body).toMatchObject({ ok: true, externalRef: "1234567890" });
    expect((res.body as { label: string }).label).toContain("GOOGLE_ADS_DEVELOPER_TOKEN");
    expect(d.calls).toHaveLength(1);
  });

  it("HubSpot: account-info with a Bearer → portal id", async () => {
    const d = live();
    d.routes.push((c) => (c.url === "https://api.hubapi.com/account-info/v3/details" && c.headers.authorization === `Bearer ${TOKENS.hubspot}` ? json(P.HUBSPOT_ACCOUNT) : json(P.HUBSPOT_ERROR_401, 401)));
    expect((await handleManualConnect(d, "hubspot", { token: TOKENS.hubspot })).body).toMatchObject({ ok: true, externalRef: "44556677", label: "HubSpot portal 44556677" });
    expect((await handleManualConnect(d, "hubspot", { token: "pat-wrong" })).body).toEqual({ error: "HubSpot said: The access token is invalid or expired.", code: "rejected" });
  });

  it("re-pasting replaces the sealed key on the same row and notes the previous status", async () => {
    const d = live();
    db.insertRow("connectors", { account_id: accountId, platform: "hubspot", status: "needs_reconnect", external_ref: "1", sync_ref: {} });
    d.routes.push(() => json(P.HUBSPOT_ACCOUNT));
    await handleManualConnect(d, "hubspot", { token: TOKENS.hubspot });
    expect(db.rows("connectors")).toHaveLength(1);
    expect(db.rows("connectors")[0]).toMatchObject({ status: "connected", external_ref: "44556677" });
    expect(db.rows("receipts")[0].payload).toMatchObject({ previous_status: "needs_reconnect", source: "manual" });
  });

  it("without a read-now hook the response says reading:false and the connection still stands", async () => {
    const d = makeDeps({ db, userId });
    d.routes.push(() => json(P.HUBSPOT_ACCOUNT));
    expect((await handleManualConnect(d, "hubspot", { token: TOKENS.hubspot })).body).toMatchObject({ ok: true, reading: false });
    expect(db.rows("connectors")[0].status).toBe("connected");
  });
});
