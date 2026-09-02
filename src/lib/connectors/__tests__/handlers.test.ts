import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { open } from "../crypto";
import { handleCallback, handleStart } from "../handlers";
import { codeChallenge } from "../oauth";
import { APP_URL, assertNoLeak, config, deps as makeDeps, FAKE_ENV, json, KEYRING, NOW, seededDb } from "./helpers";

let db: FakeSupabase;
let accountId: string;
let userId: string;
beforeEach(() => {
  ({ db, accountId, userId } = seededDb());
});

const live = (over: Parameters<typeof makeDeps>[0] = {}) => makeDeps({ db, userId, ...over });

/** Run start and pull the state + verifier the handler stored. */
async function startFlow(platform: string, body: unknown = {}) {
  const d = live();
  const res = await handleStart(d, platform, body);
  if (res.status !== 200 || !("url" in res.body)) throw new Error(`start failed: ${JSON.stringify(res.body)}`);
  const url = new URL(res.body.url);
  const state = url.searchParams.get("state")!;
  const row = db.rows("oauth_states").find((r) => r.state === state)!;
  return { d, url, state, row };
}

const cb = (platform: string, params: Record<string, string>) => `${APP_URL}/api/connectors/${platform}/callback?${new URLSearchParams(params).toString()}`;

describe("POST …/start — env gates", () => {
  it("unknown platform → 404; catalogued-only platform → honest fallback", async () => {
    expect((await handleStart(live(), "nope", {})).status).toBe(404);
    expect(await handleStart(live(), "slack", {})).toEqual({ status: 200, body: { fallback: true, reason: "platform_not_configured" } });
  });

  it("platform without client id/secret → fallback, and nothing is written", async () => {
    const d = live({ config: config({ env: {} }) });
    expect(await handleStart(d, "shopify", { shop: "acme.myshopify.com" })).toEqual({ status: 200, body: { fallback: true, reason: "platform_not_configured" } });
    expect(db.rows("oauth_states")).toHaveLength(0);
    expect(db.rows("connectors")).toHaveLength(0);
  });

  it("no secret store → fallback; no accounts DB → fallback (demo mode untouched)", async () => {
    expect(await handleStart(live({ config: config({ keyring: null }) }), "klaviyo", {})).toEqual({ status: 200, body: { fallback: true, reason: "secret_store_not_configured" } });
    expect(await handleStart(makeDeps({ config: config({ dbConfigured: false }) }), "klaviyo", {})).toEqual({ status: 200, body: { fallback: true, reason: "accounts_not_configured" } });
  });

  it("DB configured but no session → 401; session without an account → 403", async () => {
    expect((await handleStart(live({ userId: null }), "klaviyo", {})).status).toBe(401);
    expect((await handleStart(live({ userId: "stranger" }), "klaviyo", {})).status).toBe(403);
  });

  it("Shopify needs a valid myshopify.com domain", async () => {
    expect((await handleStart(live(), "shopify", {})).status).toBe(400);
    expect((await handleStart(live(), "shopify", { shop: "evil.com" })).status).toBe(400);
    expect(db.rows("oauth_states")).toHaveLength(0);
  });
});

describe("POST …/start — happy paths", () => {
  it("Klaviyo: stores a PKCE state row and returns the authorize URL with the S256 challenge", async () => {
    const { url, row } = await startFlow("klaviyo");
    expect(url.origin + url.pathname).toBe("https://www.klaviyo.com/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/api/connectors/klaviyo/callback`);
    expect(url.searchParams.get("client_id")).toBe(FAKE_ENV.KLAVIYO_CLIENT_ID);
    expect(row).toMatchObject({ account_id: accountId, platform: "klaviyo", shop: null, redirect_to: "/app" });
    expect(typeof row.code_verifier).toBe("string");
    expect(url.searchParams.get("code_challenge")).toBe(codeChallenge(row.code_verifier as string));
    expect(new Date(row.expires_at as string).getTime() - NOW.getTime()).toBe(10 * 60 * 1000);
    expect(db.rows("connectors")).toEqual([expect.objectContaining({ account_id: accountId, platform: "klaviyo", status: "connecting" })]);
    // the client secret never rides in the URL
    expect(url.toString()).not.toContain(FAKE_ENV.KLAVIYO_CLIENT_SECRET);
  });

  it("Shopify: per-shop authorize URL, nonce state bound to the shop, no PKCE", async () => {
    const { url, row } = await startFlow("shopify", { shop: "Acme.myshopify.com" });
    expect(url.origin + url.pathname).toBe("https://acme.myshopify.com/admin/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("read_orders,read_products,read_customers");
    expect(row).toMatchObject({ platform: "shopify", shop: "acme.myshopify.com", code_verifier: null });
  });

  it("Google (GA4 + Ads) and Meta build their own dialogs from the shared/own env pair", async () => {
    const ga4 = await startFlow("ga4");
    expect(ga4.url.hostname).toBe("accounts.google.com");
    expect(ga4.url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/analytics.readonly");
    const ads = await startFlow("google_ads");
    expect(ads.url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adwords");
    const meta = await startFlow("meta_ads");
    expect(meta.url.hostname).toBe("www.facebook.com");
    expect(meta.row.code_verifier).toBeNull();
    expect(db.rows("oauth_states")).toHaveLength(3);
  });
});

describe("GET …/callback", () => {
  it("Klaviyo happy path: exchanges the code with PKCE + Basic auth, seals the tokens, marks connected, deletes the state", async () => {
    const { d, state, row } = await startFlow("klaviyo");
    d.routes.push((c) => (c.url === "https://a.klaviyo.com/oauth/token" ? json({ access_token: "kl-access-FIXTURE", refresh_token: "kl-refresh-FIXTURE", expires_in: 3600, token_type: "bearer", scope: "metrics:read" }) : undefined));
    d.routes.push((c) => (c.url.startsWith("https://a.klaviyo.com/api/accounts/") ? json({ data: [{ type: "account", id: "ACC0UNT" }] }) : undefined));

    const res = await handleCallback(d, "klaviyo", cb("klaviyo", { code: "auth-code", state }));
    expect(res).toEqual({ redirect: "/app?connected=klaviyo" });

    const token = d.calls.find((c) => c.url === "https://a.klaviyo.com/oauth/token")!;
    expect(token.method).toBe("POST");
    expect(token.headers.authorization).toBe(`Basic ${Buffer.from("klaviyo-client-id:klaviyo-client-secret").toString("base64")}`);
    const form = new URLSearchParams(token.body!);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("auth-code");
    expect(form.get("code_verifier")).toBe(row.code_verifier);
    expect(form.get("redirect_uri")).toBe(`${APP_URL}/api/connectors/klaviyo/callback`);

    const conn = db.rows("connectors").find((r) => r.platform === "klaviyo")!;
    expect(conn).toMatchObject({ status: "connected", external_ref: "ACC0UNT" });
    const secret = db.rows("connector_secrets").find((r) => r.connector_id === conn.id)!;
    expect(secret.key_version).toBe(1);
    const bundle = JSON.parse(open({ ciphertext: secret.ciphertext as string, iv: secret.iv as string, tag: secret.tag as string, keyVersion: secret.key_version as number }, KEYRING, conn.id as string));
    expect(bundle).toMatchObject({ accessToken: "kl-access-FIXTURE", refreshToken: "kl-refresh-FIXTURE", expiresAt: "2026-09-02T10:00:00.000Z", obtainedAt: NOW.toISOString() });
    expect(db.rows("oauth_states")).toHaveLength(0);
    // tokens never in logs, and never in the plain columns
    assertNoLeak([...d.logs, JSON.stringify(db.rows("connectors"))], ["kl-access-FIXTURE", "kl-refresh-FIXTURE"]);
    expect(secret.ciphertext).not.toContain("FIXTURE");
  });

  it("Shopify happy path: verifies the HMAC + shop, exchanges without PKCE, external_ref = shop domain", async () => {
    const { d, state } = await startFlow("shopify", { shop: "acme.myshopify.com" });
    d.routes.push((c) => (c.url === "https://acme.myshopify.com/admin/oauth/access_token" ? json({ access_token: "shpat_FIXTURE", scope: "read_orders,read_products,read_customers" }) : undefined));
    const params: Record<string, string> = { code: "sh-code", shop: "acme.myshopify.com", state, timestamp: "1756800000", host: "aG9zdA" };
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    params.hmac = createHmac("sha256", FAKE_ENV.SHOPIFY_CLIENT_SECRET).update(message).digest("hex");

    expect(await handleCallback(d, "shopify", cb("shopify", params))).toEqual({ redirect: "/app?connected=shopify" });
    const form = new URLSearchParams(d.calls[0].body!);
    expect(form.get("client_id")).toBe(FAKE_ENV.SHOPIFY_CLIENT_ID);
    expect(form.get("client_secret")).toBe(FAKE_ENV.SHOPIFY_CLIENT_SECRET);
    expect(form.get("code")).toBe("sh-code");
    expect(db.rows("connectors").find((r) => r.platform === "shopify")).toMatchObject({ status: "connected", external_ref: "acme.myshopify.com" });
    const secret = db.rows("connector_secrets")[0];
    const conn = db.rows("connectors")[0];
    const bundle = JSON.parse(open({ ciphertext: secret.ciphertext as string, iv: secret.iv as string, tag: secret.tag as string, keyVersion: 1 }, KEYRING, conn.id as string));
    expect(bundle.accessToken).toBe("shpat_FIXTURE");
    expect(bundle.expiresAt).toBeUndefined(); // offline token
  });

  it("Shopify: a bad HMAC or a different shop → error status, error:oauth, error redirect, no secret stored", async () => {
    const { d, state } = await startFlow("shopify", { shop: "acme.myshopify.com" });
    const params = { code: "sh-code", shop: "acme.myshopify.com", state, timestamp: "1", hmac: "0".repeat(64) };
    expect(await handleCallback(d, "shopify", cb("shopify", params))).toEqual({ redirect: "/app?connect_error=shopify" });
    expect(d.calls).toHaveLength(0); // never exchanged
    expect(db.rows("connectors")[0]).toMatchObject({ status: "error", last_sync_result: "error:oauth" });
    expect(db.rows("connector_secrets")).toHaveLength(0);
    expect(db.rows("oauth_states")).toHaveLength(0); // state consumed regardless

    const again = await startFlow("shopify", { shop: "acme.myshopify.com" });
    const p2: Record<string, string> = { code: "x", shop: "other.myshopify.com", state: again.state };
    const msg = Object.keys(p2)
      .sort()
      .map((k) => `${k}=${p2[k]}`)
      .join("&");
    p2.hmac = createHmac("sha256", FAKE_ENV.SHOPIFY_CLIENT_SECRET).update(msg).digest("hex");
    expect(await handleCallback(again.d, "shopify", cb("shopify", p2))).toEqual({ redirect: "/app?connect_error=shopify" });
    expect(again.d.logs.some((l) => l.includes("shop_mismatch"))).toBe(true);
  });

  it("bad / replayed / expired state → error redirect", async () => {
    const d = live();
    expect(await handleCallback(d, "klaviyo", cb("klaviyo", { code: "c", state: "not-a-state" }))).toEqual({ redirect: "/app?connect_error=klaviyo" });
    expect(await handleCallback(d, "klaviyo", cb("klaviyo", { code: "c" }))).toEqual({ redirect: "/app?connect_error=klaviyo" });

    const { d: d2, state } = await startFlow("ga4");
    // wrong platform for this state
    expect(await handleCallback(d2, "klaviyo", cb("klaviyo", { code: "c", state }))).toEqual({ redirect: "/app?connect_error=klaviyo" });
    expect(db.rows("oauth_states")).toHaveLength(0); // consumed on first use …
    // … so the replay against the right platform fails too
    expect(await handleCallback(d2, "ga4", cb("ga4", { code: "c", state }))).toEqual({ redirect: "/app?connect_error=ga4" });

    const late = await startFlow("ga4");
    const lateDeps = live({ now: () => new Date(NOW.getTime() + 11 * 60 * 1000) });
    expect(await handleCallback(lateDeps, "ga4", cb("ga4", { code: "c", state: late.state }))).toEqual({ redirect: "/app?connect_error=ga4" });
    expect(lateDeps.logs.some((l) => l.includes("state_expired"))).toBe(true);
    expect(lateDeps.calls).toHaveLength(0);
  });

  it("the founder who finishes must be the one who started (session bound to the state's account)", async () => {
    const { state } = await startFlow("klaviyo");
    const other = live({ userId: "someone-else" });
    expect(await handleCallback(other, "klaviyo", cb("klaviyo", { code: "c", state }))).toEqual({ redirect: "/app?connect_error=klaviyo" });
    expect(other.logs.some((l) => l.includes("session_mismatch"))).toBe(true);
    const anon = live({ userId: null });
    const again = await startFlow("klaviyo");
    expect(await handleCallback(anon, "klaviyo", cb("klaviyo", { code: "c", state: again.state }))).toEqual({ redirect: "/app?connect_error=klaviyo" });
  });

  it("provider denial (?error=access_denied) → error path without an exchange", async () => {
    const { d, state } = await startFlow("ga4");
    expect(await handleCallback(d, "ga4", cb("ga4", { error: "access_denied", state }))).toEqual({ redirect: "/app?connect_error=ga4" });
    expect(d.calls).toHaveLength(0);
    expect(db.rows("connectors")[0]).toMatchObject({ platform: "ga4", status: "error", last_sync_result: "error:oauth" });
  });

  it("token exchange failure (HTTP 400 / network) → error status, no secret, no stack trace", async () => {
    const { d, state } = await startFlow("ga4");
    d.routes.push((c) => (c.url === "https://oauth2.googleapis.com/token" ? json({ error: "invalid_grant" }, 400) : undefined));
    expect(await handleCallback(d, "ga4", cb("ga4", { code: "c", state }))).toEqual({ redirect: "/app?connect_error=ga4" });
    expect(d.logs.some((l) => l.includes("exchange_http_400"))).toBe(true);
    expect(db.rows("connector_secrets")).toHaveLength(0);
    expect(db.rows("connectors")[0]).toMatchObject({ status: "error", last_sync_result: "error:oauth" });

    const second = await startFlow("ga4");
    second.d.routes.push(() => {
      throw new TypeError("fetch failed");
    });
    expect(await handleCallback(second.d, "ga4", cb("ga4", { code: "c", state: second.state }))).toEqual({ redirect: "/app?connect_error=ga4" });
    expect(second.d.logs.some((l) => l.includes("exchange_network"))).toBe(true);
  });

  it("Google happy path: form-encoded exchange with the verifier; external_ref stays null until a property is chosen", async () => {
    const { d, state, row } = await startFlow("ga4");
    d.routes.push((c) => (c.url === "https://oauth2.googleapis.com/token" ? json({ access_token: "ya29.FIXTURE", refresh_token: "1//FIXTURE", expires_in: 3599, scope: "https://www.googleapis.com/auth/analytics.readonly", token_type: "Bearer" }) : undefined));
    expect(await handleCallback(d, "ga4", cb("ga4", { code: "g-code", state, scope: "https://www.googleapis.com/auth/analytics.readonly" }))).toEqual({ redirect: "/app?connected=ga4" });
    const form = new URLSearchParams(d.calls[0].body!);
    expect(form.get("code_verifier")).toBe(row.code_verifier);
    expect(form.get("client_secret")).toBe(FAKE_ENV.GOOGLE_CLIENT_SECRET);
    expect(d.calls[0].headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(d.calls).toHaveLength(1); // no identify call for Google
    expect(db.rows("connectors")[0]).toMatchObject({ status: "connected", external_ref: null });
    assertNoLeak(d.logs, ["ya29.FIXTURE", "1//FIXTURE"]);
  });

  it("HubSpot happy path: no PKCE, client id + secret in the form body, portal id from account-info becomes external_ref", async () => {
    const { d, state, row } = await startFlow("hubspot");
    expect(row.code_verifier).toBeNull();
    d.routes.push((c) => (c.url === "https://api.hubapi.com/oauth/v1/token" ? json({ access_token: "hs-access-FIXTURE", refresh_token: "hs-refresh-FIXTURE", expires_in: 1800, token_type: "bearer" }) : undefined));
    d.routes.push((c) => (c.url === "https://api.hubapi.com/account-info/v3/details" ? json({ portalId: 24681357, timeZone: "Pacific/Auckland" }) : undefined));
    expect(await handleCallback(d, "hubspot", cb("hubspot", { code: "hs-code", state }))).toEqual({ redirect: "/app?connected=hubspot" });
    const form = new URLSearchParams(d.calls[0].body!);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_id")).toBe(FAKE_ENV.HUBSPOT_CLIENT_ID);
    expect(form.get("client_secret")).toBe(FAKE_ENV.HUBSPOT_CLIENT_SECRET);
    expect(form.get("redirect_uri")).toBe(`${APP_URL}/api/connectors/hubspot/callback`);
    expect(form.has("code_verifier")).toBe(false);
    expect(d.calls[1].headers.authorization).toBe("Bearer hs-access-FIXTURE");
    expect(db.rows("connectors")[0]).toMatchObject({ status: "connected", external_ref: "24681357" });
    expect(db.rows("connector_secrets")).toHaveLength(1);
    assertNoLeak([...d.logs, JSON.stringify(db.rows("connectors"))], ["hs-access-FIXTURE", "hs-refresh-FIXTURE"]);
  });

  it("Meta happy path: GET exchange, long-lived swap, single ad account becomes external_ref", async () => {
    const { d, state } = await startFlow("meta_ads");
    d.routes.push((c) => {
      const u = new URL(c.url);
      if (u.pathname !== "/v23.0/oauth/access_token") return undefined;
      if (u.searchParams.get("grant_type") === "fb_exchange_token") {
        expect(u.searchParams.get("fb_exchange_token")).toBe("short-FIXTURE");
        return json({ access_token: "long-FIXTURE", token_type: "bearer", expires_in: 5183944 });
      }
      expect(u.searchParams.get("code")).toBe("m-code");
      expect(u.searchParams.get("client_secret")).toBe(FAKE_ENV.META_APP_SECRET);
      return json({ access_token: "short-FIXTURE", token_type: "bearer", expires_in: 5000 });
    });
    d.routes.push((c) => (c.url.startsWith("https://graph.facebook.com/v23.0/me/adaccounts") ? json({ data: [{ account_id: "123456" }] }) : undefined));
    expect(await handleCallback(d, "meta_ads", cb("meta_ads", { code: "m-code", state }))).toEqual({ redirect: "/app?connected=meta_ads" });
    expect(d.calls.map((c) => c.method)).toEqual(["GET", "GET", "GET"]);
    const conn = db.rows("connectors")[0];
    expect(conn).toMatchObject({ status: "connected", external_ref: "act_123456" });
    const secret = db.rows("connector_secrets")[0];
    const bundle = JSON.parse(open({ ciphertext: secret.ciphertext as string, iv: secret.iv as string, tag: secret.tag as string, keyVersion: 1 }, KEYRING, conn.id as string));
    expect(bundle.accessToken).toBe("long-FIXTURE");
    expect(bundle.expiresAt).toBe(new Date(NOW.getTime() + 5183944 * 1000).toISOString());
    assertNoLeak(d.logs, ["short-FIXTURE", "long-FIXTURE"]);
  });

  it("without the DB the callback just lands on /app (demo mode)", async () => {
    expect(await handleCallback(makeDeps({ config: config({ dbConfigured: false }) }), "klaviyo", cb("klaviyo", { code: "c", state: "s" }))).toEqual({ redirect: "/app" });
    expect(await handleCallback(live(), "slack", cb("slack", { code: "c", state: "s" }))).toEqual({ redirect: "/app?connect_error=slack" });
  });

  it("reconnect: a second successful flow replaces the sealed bundle in place (one row per connector)", async () => {
    const first = await startFlow("klaviyo");
    first.d.routes.push((c) => (c.url === "https://a.klaviyo.com/oauth/token" ? json({ access_token: "one", expires_in: 10 }) : undefined));
    await handleCallback(first.d, "klaviyo", cb("klaviyo", { code: "c1", state: first.state }));
    const second = await startFlow("klaviyo");
    second.d.routes.push((c) => (c.url === "https://a.klaviyo.com/oauth/token" ? json({ access_token: "two", expires_in: 10 }) : undefined));
    await handleCallback(second.d, "klaviyo", cb("klaviyo", { code: "c2", state: second.state }));
    expect(db.rows("connectors")).toHaveLength(1);
    expect(db.rows("connector_secrets")).toHaveLength(1);
    const conn = db.rows("connectors")[0];
    const secret = db.rows("connector_secrets")[0];
    expect(JSON.parse(open({ ciphertext: secret.ciphertext as string, iv: secret.iv as string, tag: secret.tag as string, keyVersion: 1 }, KEYRING, conn.id as string)).accessToken).toBe("two");
  });
});
