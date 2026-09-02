/* Platform-side token revoke, called on Disconnect BEFORE the sealed secret is deleted.

   Best-effort by design: a revoke that fails (network, 4xx, platform without an endpoint)
   never blocks the disconnect — the secret is deleted regardless and the failure is
   receipted so the founder knows to revoke from the platform's connected-apps page.

     shopify      DELETE https://<shop>/admin/api/<ver>/api_permissions/current.json   X-Shopify-Access-Token
     klaviyo      POST   https://a.klaviyo.com/oauth/revoke                            Basic client auth, token=<refresh|access>
     meta_ads     DELETE https://graph.facebook.com/<ver>/me/permissions              Bearer (de-authorises the app)
     ga4 / ads    POST   https://oauth2.googleapis.com/revoke                          token=<refresh|access> (revokes the grant)
     hubspot      DELETE https://api.hubapi.com/oauth/v1/refresh-tokens/<refresh>     (HubSpot's own shape: token in the path —
                                                                                       the receipt names the endpoint redacted)

   Tokens never appear in a result, log line or receipt; results carry codes + a redacted
   endpoint label only. */

import type { FetchLike, TokenBundle } from "./oauth";
import type { ConnectorEntry } from "./registry";

export const REVOKE_TIMEOUT_MS = 10_000;
/** Same Admin API version the worker's Shopify reader uses (src/worker/readers/shopify.ts). */
export const SHOPIFY_REVOKE_API_VERSION = "2026-01";
export const META_GRAPH_VERSION = "v23.0";

export type RevokeCode = `http_${number}` | "timeout" | "network" | "no_revoke_endpoint" | "no_token" | "no_shop" | "not_configured";

export type RevokeResult = { ok: true; endpoint: string } | { ok: false; code: RevokeCode; endpoint: string | null };

export interface RevokeInput {
  bundle: TokenBundle;
  /** connectors.external_ref — Shopify needs the shop domain. */
  externalRef: string | null;
  /** App credentials (Klaviyo's revoke is client-authenticated). */
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
}

/** host + path with any token-shaped segment replaced — what a receipt may carry. */
function label(url: string, redactPath = false): string {
  try {
    const u = new URL(url);
    const path = redactPath ? u.pathname.replace(/\/[^/]+$/, "/<redacted>") : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return "<invalid url>";
  }
}

async function send(fetchFn: FetchLike, url: string, init: RequestInit, endpoint: string, timeoutMs: number): Promise<RevokeResult> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { ok: false, code: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network", endpoint };
  }
  // Google answers 400 invalid_token for a grant that is already gone — the outcome is the same.
  if (res.ok || res.status === 404 || (res.status === 400 && endpoint.startsWith("oauth2.googleapis.com"))) return { ok: true, endpoint };
  return { ok: false, code: `http_${res.status}`, endpoint };
}

export async function revokeToken(fetchFn: FetchLike, entry: ConnectorEntry, input: RevokeInput): Promise<RevokeResult> {
  const timeoutMs = input.timeoutMs ?? REVOKE_TIMEOUT_MS;
  const { bundle } = input;
  switch (entry.id) {
    case "shopify": {
      if (!input.externalRef) return { ok: false, code: "no_shop", endpoint: null };
      const url = `https://${input.externalRef}/admin/api/${SHOPIFY_REVOKE_API_VERSION}/api_permissions/current.json`;
      return send(fetchFn, url, { method: "DELETE", headers: { "X-Shopify-Access-Token": bundle.accessToken, accept: "application/json" } }, label(url), timeoutMs);
    }
    case "klaviyo": {
      if (!input.clientId || !input.clientSecret) return { ok: false, code: "not_configured", endpoint: null };
      const url = "https://a.klaviyo.com/oauth/revoke";
      const body = new URLSearchParams();
      body.set("token", bundle.refreshToken ?? bundle.accessToken);
      body.set("token_type_hint", bundle.refreshToken ? "refresh_token" : "access_token");
      const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8").toString("base64");
      return send(fetchFn, url, { method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString() }, label(url), timeoutMs);
    }
    case "meta_ads": {
      const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions`;
      return send(fetchFn, url, { method: "DELETE", headers: { authorization: `Bearer ${bundle.accessToken}`, accept: "application/json" } }, label(url), timeoutMs);
    }
    case "ga4":
    case "google_ads": {
      const url = "https://oauth2.googleapis.com/revoke";
      const body = new URLSearchParams();
      body.set("token", bundle.refreshToken ?? bundle.accessToken);
      return send(fetchFn, url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString() }, label(url), timeoutMs);
    }
    case "hubspot": {
      if (!bundle.refreshToken) return { ok: false, code: "no_token", endpoint: null };
      const url = `https://api.hubapi.com/oauth/v1/refresh-tokens/${encodeURIComponent(bundle.refreshToken)}`;
      return send(fetchFn, url, { method: "DELETE", headers: { accept: "application/json" } }, label(url, true), timeoutMs);
    }
    default:
      return { ok: false, code: "no_revoke_endpoint", endpoint: null };
  }
}
