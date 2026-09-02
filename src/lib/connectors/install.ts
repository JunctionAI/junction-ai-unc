/* Shopify App Store install entry — shopify/REVIEW-CHECKLIST.md §2d.

     GET /api/connectors/shopify/install?shop=&hmac=&timestamp=&host=   (handleShopifyInstall)
     GET /api/connectors/shopify/install/resume                          (handleShopifyInstallResume)

   The Connectors card is one way in (the founder types their store, POST …/start). The App
   Store's Install button is the other: Shopify lands the merchant on application_url with a
   signed query, and the reviewer's "OAuth must begin immediately after install" check needs
   that query to turn into the authorize redirect without a detour. Gates, in order:

     shop is a *.myshopify.com domain            → else 400
     app credentials present                     → else 302 /app?connect_error=shopify
     HMAC over the query verifies (oauth.ts)     → else 401
     timestamp within ±5 minutes of now          → else 401 (replay)
     secret store + accounts DB configured       → else 302 /app?connect_error=shopify
     no session                                  → 302 /login?next=…/resume, shop parked in a
                                                   signed, 10-minute cookie (never the query)
     session                                     → handleStart(shopify) → 302 to the authorize URL

   Resume (after the magic link): read + verify the cookie, then the same start. Cookie value
   is `<shop>.<expiresMs>.<hmac-sha256 hex under the app secret>` — the shop is re-validated on
   the way back in, so a tampered cookie can only fail. Pure: everything from Next arrives
   through HandlerDeps, so the tests run this against the fake with fixed HMACs. */

import { createHmac, timingSafeEqual } from "node:crypto";
import { handleStart, type HandlerDeps } from "./handlers";
import { INSTALL_PATH, RESUME_PATH } from "./installForward";
import { verifyShopifyHmac } from "./oauth";
import { normaliseShopDomain, platformCredentials } from "./registry";

export { INSTALL_PATH, RESUME_PATH };

export const INSTALL_COOKIE = "unc_shopify_install";
export const INSTALL_COOKIE_TTL_MS = 10 * 60 * 1000;
/** How far a Shopify `timestamp` may sit from our clock, either side, before it reads as a replay. */
export const INSTALL_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
export const LOGIN_FOR_INSTALL = `/login?next=${encodeURIComponent(RESUME_PATH)}`;
export const INSTALL_ERROR_REDIRECT = "/app?connect_error=shopify";

export type InstallResult =
  | { status: 302; location: string; setCookie?: string; clearCookie?: boolean }
  | { status: 400 | 401; error: string };

// ---------- the parked-shop cookie ----------

function cookieSig(shop: string, expiresMs: number, secret: string): string {
  return createHmac("sha256", secret).update(`${shop}.${expiresMs}`).digest("hex");
}

export function signInstallCookie(shop: string, expiresMs: number, secret: string): string {
  return `${shop}.${expiresMs}.${cookieSig(shop, expiresMs, secret)}`;
}

/** The shop a valid, unexpired cookie names; null for anything else (missing, tampered, expired, odd shape). */
export function readInstallCookie(value: string | null | undefined, secret: string, now: Date): string | null {
  if (!value) return null;
  const last = value.lastIndexOf(".");
  const mid = value.lastIndexOf(".", last - 1);
  if (last <= 0 || mid <= 0) return null;
  const shop = normaliseShopDomain(value.slice(0, mid));
  const expiresMs = Number(value.slice(mid + 1, last));
  const sig = value.slice(last + 1);
  if (!shop || !Number.isFinite(expiresMs) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const a = Buffer.from(cookieSig(shop, expiresMs, secret), "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (expiresMs < now.getTime()) return null;
  return shop;
}

// ---------- handlers ----------

const errorRedirect = (clearCookie = false): InstallResult => ({ status: 302, location: INSTALL_ERROR_REDIRECT, ...(clearCookie ? { clearCookie: true } : {}) });

function freshTimestamp(raw: string | null, now: Date): boolean {
  if (!raw || !/^\d{1,12}$/.test(raw)) return false;
  return Math.abs(now.getTime() - Number(raw) * 1000) <= INSTALL_TIMESTAMP_SKEW_MS;
}

export async function handleShopifyInstall(deps: HandlerDeps, requestUrl: string): Promise<InstallResult> {
  const params = new URL(requestUrl).searchParams;
  const shop = normaliseShopDomain(params.get("shop"));
  if (!shop) return { status: 400, error: "shop must be a your-store.myshopify.com domain" };
  const creds = platformCredentials("shopify", deps.config.env);
  if (!creds) {
    deps.log?.("connectors.install platform=shopify reason=platform_not_configured");
    return errorRedirect();
  }
  if (!verifyShopifyHmac(params, creds.clientSecret)) {
    deps.log?.("connectors.install platform=shopify reason=bad_hmac");
    return { status: 401, error: "bad hmac" };
  }
  if (!freshTimestamp(params.get("timestamp"), deps.now())) {
    deps.log?.("connectors.install platform=shopify reason=stale_timestamp");
    return { status: 401, error: "stale timestamp" };
  }
  if (!deps.config.keyring || !deps.config.dbConfigured || !deps.db) {
    deps.log?.("connectors.install platform=shopify reason=not_configured");
    return errorRedirect();
  }
  if (!deps.userId) {
    deps.log?.(`connectors.install platform=shopify shop=${shop} result=login`);
    return { status: 302, location: LOGIN_FOR_INSTALL, setCookie: signInstallCookie(shop, deps.now().getTime() + INSTALL_COOKIE_TTL_MS, creds.clientSecret) };
  }
  return startFor(deps, shop);
}

export async function handleShopifyInstallResume(deps: HandlerDeps, cookieValue: string | null | undefined): Promise<InstallResult> {
  const creds = platformCredentials("shopify", deps.config.env);
  if (!creds) {
    deps.log?.("connectors.install.resume platform=shopify reason=platform_not_configured");
    return errorRedirect(true);
  }
  const shop = readInstallCookie(cookieValue, creds.clientSecret, deps.now());
  if (!shop) {
    deps.log?.("connectors.install.resume platform=shopify reason=no_cookie");
    return errorRedirect(true);
  }
  if (!deps.userId) return { status: 302, location: LOGIN_FOR_INSTALL };
  if (!deps.config.keyring || !deps.config.dbConfigured || !deps.db) {
    deps.log?.("connectors.install.resume platform=shopify reason=not_configured");
    return errorRedirect(true);
  }
  return startFor(deps, shop);
}

/** The same path the Connectors card takes: state row + connecting row + authorize URL. */
async function startFor(deps: HandlerDeps, shop: string): Promise<InstallResult> {
  const res = await handleStart(deps, "shopify", { shop });
  if (res.status === 200 && "url" in res.body) return { status: 302, location: res.body.url, clearCookie: true };
  const reason = res.status === 200 ? ("reason" in res.body ? res.body.reason : "no_url") : `${res.status}:${res.body.error}`;
  deps.log?.(`connectors.install platform=shopify shop=${shop} reason=start_${reason}`);
  return errorRedirect(true);
}
