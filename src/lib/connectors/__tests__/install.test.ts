/* The App Store install entry (install.ts) against the schema-checked fake with fixed
   HMACs — no network, no Next. shopify/REVIEW-CHECKLIST.md §2d is the spec. */

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { handleShopifyInstall, handleShopifyInstallResume, INSTALL_COOKIE_TTL_MS, INSTALL_ERROR_REDIRECT, LOGIN_FOR_INSTALL, readInstallCookie, signInstallCookie } from "../install";
import { INSTALL_PATH, RESUME_PATH, shopifyInstallForward } from "../installForward";
import { APP_URL, config, deps as makeDeps, FAKE_ENV, NOW, seededDb } from "./helpers";

let db: FakeSupabase;
let accountId: string;
let userId: string;
beforeEach(() => {
  ({ db, accountId, userId } = seededDb());
});

const live = (over: Parameters<typeof makeDeps>[0] = {}) => makeDeps({ db, userId, ...over });
const SECRET = FAKE_ENV.SHOPIFY_CLIENT_SECRET;
const TS = String(Math.floor(NOW.getTime() / 1000));

/** Shopify's signing rule: every param but hmac, sorted, k=v&…, HMAC-SHA256 hex under the app secret. */
function signed(params: Record<string, string>, secret = SECRET): string {
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const hmac = createHmac("sha256", secret).update(message).digest("hex");
  return `${APP_URL}${INSTALL_PATH}?${new URLSearchParams({ ...params, hmac }).toString()}`;
}

const installUrl = (over: Record<string, string> = {}, secret?: string) => signed({ shop: "acme.myshopify.com", timestamp: TS, host: "YWNtZS5teXNob3BpZnkuY29tL2FkbWlu", ...over }, secret);

describe("GET …/shopify/install — gates", () => {
  it("rejects anything that isn't a myshopify.com domain with 400, before touching the HMAC", async () => {
    expect(await handleShopifyInstall(live(), installUrl({ shop: "evil.com" }))).toEqual({ status: 400, error: expect.stringMatching(/myshopify\.com/) });
    expect(await handleShopifyInstall(live(), `${APP_URL}${INSTALL_PATH}`)).toMatchObject({ status: 400 });
    expect(db.rows("oauth_states")).toHaveLength(0);
  });

  it("no app credentials → /app?connect_error=shopify (the HMAC can't be checked without the secret)", async () => {
    const d = live({ config: config({ env: {} }) });
    expect(await handleShopifyInstall(d, installUrl())).toEqual({ status: 302, location: INSTALL_ERROR_REDIRECT });
    expect(db.rows("oauth_states")).toHaveLength(0);
  });

  it("bad HMAC → 401: wrong secret, a tampered param, a missing hmac, a malformed hmac", async () => {
    expect(await handleShopifyInstall(live(), installUrl({}, "not-the-secret"))).toEqual({ status: 401, error: "bad hmac" });
    const tampered = installUrl().replace("acme.myshopify.com", "other.myshopify.com");
    expect(await handleShopifyInstall(live(), tampered)).toEqual({ status: 401, error: "bad hmac" });
    expect(await handleShopifyInstall(live(), `${APP_URL}${INSTALL_PATH}?shop=acme.myshopify.com&timestamp=${TS}`)).toEqual({ status: 401, error: "bad hmac" });
    expect(await handleShopifyInstall(live(), `${APP_URL}${INSTALL_PATH}?shop=acme.myshopify.com&timestamp=${TS}&hmac=zz`)).toEqual({ status: 401, error: "bad hmac" });
    expect(db.rows("oauth_states")).toHaveLength(0);
    expect(db.rows("connectors")).toHaveLength(0);
  });

  it("a correctly signed but stale timestamp (> 5 min either side) → 401 replay; a missing one too", async () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 6 * 60);
    expect(await handleShopifyInstall(live(), installUrl({ timestamp: old }))).toEqual({ status: 401, error: "stale timestamp" });
    const future = String(Math.floor(NOW.getTime() / 1000) + 6 * 60);
    expect(await handleShopifyInstall(live(), installUrl({ timestamp: future }))).toEqual({ status: 401, error: "stale timestamp" });
    const url = signed({ shop: "acme.myshopify.com", host: "aG9zdA" });
    expect(await handleShopifyInstall(live(), url)).toEqual({ status: 401, error: "stale timestamp" });
    // 4 minutes 59 seconds old is fine
    const fresh = String(Math.floor(NOW.getTime() / 1000) - 299);
    expect((await handleShopifyInstall(live(), installUrl({ timestamp: fresh }))).status).toBe(302);
  });

  it("valid request but no secret store / no accounts DB → /app?connect_error=shopify, nothing written", async () => {
    expect(await handleShopifyInstall(live({ config: config({ keyring: null }) }), installUrl())).toEqual({ status: 302, location: INSTALL_ERROR_REDIRECT });
    expect(await handleShopifyInstall(makeDeps({ config: config({ dbConfigured: false }) }), installUrl())).toEqual({ status: 302, location: INSTALL_ERROR_REDIRECT });
    expect(db.rows("oauth_states")).toHaveLength(0);
  });
});

describe("GET …/shopify/install — the two happy paths", () => {
  it("no session: parks the shop in a signed 10-minute cookie and sends the merchant to /login?next=…/resume", async () => {
    const d = live({ userId: null });
    const res = await handleShopifyInstall(d, installUrl({ shop: "Acme.myshopify.com" }));
    expect(res.status).toBe(302);
    if (res.status !== 302) return;
    expect(res.location).toBe(LOGIN_FOR_INSTALL);
    expect(res.location).toBe(`/login?next=${encodeURIComponent(RESUME_PATH)}`);
    expect(res.setCookie).toBeDefined();
    // the cookie names the normalised shop, expires in 10 minutes, and verifies under the app secret
    expect(readInstallCookie(res.setCookie, SECRET, NOW)).toBe("acme.myshopify.com");
    expect(res.setCookie!.split(".").slice(-2)[0]).toBe(String(NOW.getTime() + INSTALL_COOKIE_TTL_MS));
    // nothing is started until they are back with a session
    expect(db.rows("oauth_states")).toHaveLength(0);
    expect(db.rows("connectors")).toHaveLength(0);
    expect(d.logs.join("\n")).not.toContain(SECRET);
  });

  it("session: the same start path as the Connectors card → 302 to Shopify's authorize URL, state row bound to the shop", async () => {
    const d = live();
    const res = await handleShopifyInstall(d, installUrl());
    expect(res.status).toBe(302);
    if (res.status !== 302) return;
    const url = new URL(res.location);
    expect(url.origin + url.pathname).toBe("https://acme.myshopify.com/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(FAKE_ENV.SHOPIFY_CLIENT_ID);
    expect(url.searchParams.get("scope")).toBe("read_orders,read_products,read_customers");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/api/connectors/shopify/callback`);
    const state = url.searchParams.get("state")!;
    expect(db.rows("oauth_states")).toEqual([expect.objectContaining({ state, account_id: accountId, platform: "shopify", shop: "acme.myshopify.com", code_verifier: null })]);
    expect(db.rows("connectors")).toEqual([expect.objectContaining({ account_id: accountId, platform: "shopify", status: "connecting" })]);
    expect(res.clearCookie).toBe(true);
    expect(res.location).not.toContain(SECRET);
  });

  it("session without an account → /app?connect_error=shopify (the route creates the account first in practice)", async () => {
    expect(await handleShopifyInstall(live({ userId: "stranger" }), installUrl())).toEqual({ status: 302, location: INSTALL_ERROR_REDIRECT, clearCookie: true });
  });
});

describe("GET …/shopify/install/resume", () => {
  const cookie = (shop = "acme.myshopify.com", expiresMs = NOW.getTime() + INSTALL_COOKIE_TTL_MS, secret = SECRET) => signInstallCookie(shop, expiresMs, secret);

  it("with the cookie and a session → authorize URL for the parked shop, cookie cleared", async () => {
    const res = await handleShopifyInstallResume(live(), cookie());
    expect(res.status).toBe(302);
    if (res.status !== 302) return;
    expect(res.location).toMatch(/^https:\/\/acme\.myshopify\.com\/admin\/oauth\/authorize\?/);
    expect(res.clearCookie).toBe(true);
    expect(db.rows("oauth_states")[0]).toMatchObject({ shop: "acme.myshopify.com", account_id: accountId });
  });

  it("still no session → back to /login?next=…/resume, cookie kept", async () => {
    expect(await handleShopifyInstallResume(live({ userId: null }), cookie())).toEqual({ status: 302, location: LOGIN_FOR_INSTALL });
  });

  it("missing, tampered, expired or wrongly-signed cookie → /app?connect_error=shopify and the cookie is cleared", async () => {
    const want = { status: 302, location: INSTALL_ERROR_REDIRECT, clearCookie: true };
    expect(await handleShopifyInstallResume(live(), null)).toEqual(want);
    expect(await handleShopifyInstallResume(live(), cookie().replace("acme", "evil"))).toEqual(want);
    expect(await handleShopifyInstallResume(live(), cookie("acme.myshopify.com", NOW.getTime() - 1))).toEqual(want);
    expect(await handleShopifyInstallResume(live(), cookie("acme.myshopify.com", NOW.getTime() + 1000, "other-secret"))).toEqual(want);
    expect(await handleShopifyInstallResume(live(), "garbage")).toEqual(want);
    // a cookie naming a non-Shopify host can't be forged into a redirect target
    expect(await handleShopifyInstallResume(live(), cookie("evil.com"))).toEqual(want);
    expect(db.rows("oauth_states")).toHaveLength(0);
  });

  it("no app credentials → /app?connect_error=shopify", async () => {
    expect(await handleShopifyInstallResume(live({ config: config({ env: {} }) }), cookie())).toEqual({ status: 302, location: INSTALL_ERROR_REDIRECT, clearCookie: true });
  });
});

describe("landing forward (installForward.ts)", () => {
  it("forwards ?shop=&hmac= to the install route with every param intact (Shopify signs them all)", () => {
    expect(shopifyInstallForward({ shop: "acme.myshopify.com", hmac: "ab", timestamp: "1", host: "aG9zdA", locale: "en" })).toBe(`${INSTALL_PATH}?shop=acme.myshopify.com&hmac=ab&timestamp=1&host=aG9zdA&locale=en`);
    expect(shopifyInstallForward({ shop: "acme.myshopify.com", hmac: "ab", ids: ["1", "2"] })).toBe(`${INSTALL_PATH}?shop=acme.myshopify.com&hmac=ab&ids=1&ids=2`);
  });

  it("leaves every other landing request alone", () => {
    expect(shopifyInstallForward({})).toBeNull();
    expect(shopifyInstallForward({ country: "nz" })).toBeNull();
    expect(shopifyInstallForward({ shop: "acme.myshopify.com" })).toBeNull();
    expect(shopifyInstallForward({ hmac: "ab" })).toBeNull();
    expect(shopifyInstallForward({ shop: "", hmac: "" })).toBeNull();
  });
});
