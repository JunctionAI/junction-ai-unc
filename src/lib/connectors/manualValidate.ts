/* One cheap read per platform to prove a pasted token before it is sealed.

     validateManualToken(platform, input, deps) → { externalRef, label, bundle }
                                               | throws ManualValidationError (the platform's
                                                 own message, never the token)

   Reads chosen to be the smallest authenticated call each API has:
     shopify      GET  /admin/api/<ver>/shop.json
     klaviyo      GET  /api/accounts/
     meta_ads     GET  /<act_id>?fields=name,account_status,currency
     ga4          refresh grant → GET analyticsadmin/v1beta/properties/<id>
     google_ads   refresh grant → (with a developer token) customers:listAccessibleCustomers
     hubspot      GET  /account-info/v3/details

   10 s hard timeout per call. Tokens travel in headers (or the refresh form body) only;
   every error message is the platform's text with anything token-shaped stripped. */

import type { FetchLike, TokenBundle } from "./oauth";
import { normaliseExternalRef } from "./options";
import { GOOGLE_ADS_API_VERSION } from "./options";
import { META_GRAPH_VERSION, normaliseShopDomain, platformCredentials } from "./registry";
import type { ManualPlatform } from "./manualFields";
import { KLAVIYO_REVISION } from "../../worker/readers/klaviyo";
import { SHOPIFY_API_VERSION } from "../../worker/readers/shopify";

export const MANUAL_VALIDATE_TIMEOUT_MS = 10_000;

export type ManualValidationCode = "invalid_input" | "rejected" | "timeout" | "network" | "not_configured" | "malformed";

export class ManualValidationError extends Error {
  constructor(
    readonly code: ManualValidationCode,
    /** Safe to show the founder: the platform's own words, or ours. */
    readonly detail: string,
  ) {
    super(`manual validation: ${code}`);
    this.name = "ManualValidationError";
  }
}

export interface ManualInput {
  token: string;
  externalRef?: string;
  shop?: string;
  /** Meta only: when the founder knows the token's expiry (long-lived user token). */
  expiresAt?: string;
}

export interface ManualValidation {
  externalRef: string | null;
  /** Human name of what was reached ("Acme Store", "Ad account Acme (act_1)"). */
  label: string;
  bundle: TokenBundle;
}

export interface ValidateDeps {
  fetch: FetchLike;
  env: Record<string, string | undefined>;
  now: () => Date;
  timeoutMs?: number;
}

const MAX_DETAIL = 240;

/** Strip anything token-shaped and cap the length — the platform's message is shown verbatim otherwise. */
export function safeDetail(text: unknown): string {
  const s = (typeof text === "string" ? text : JSON.stringify(text ?? "")).replace(/\s+/g, " ").trim();
  return s
    .replace(/\b(shpat|shpca|shpss|pk|pat|EAA|ya29|1\/\/)[A-Za-z0-9_\-.]{8,}/g, "[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
    .slice(0, MAX_DETAIL);
}

async function call(deps: ValidateDeps, url: string, init: RequestInit): Promise<{ status: number; ok: boolean; json: unknown }> {
  let res: Response;
  try {
    res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(deps.timeoutMs ?? MANUAL_VALIDATE_TIMEOUT_MS) });
  } catch (e) {
    throw new ManualValidationError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network", e instanceof Error && e.name === "TimeoutError" ? "they didn't answer within 10 seconds" : "couldn't reach their API");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json };
}

/** The platform's own error line, from the shapes each API documents. */
export function platformMessage(platform: ManualPlatform, status: number, json: unknown): string {
  const j = (json ?? {}) as Record<string, unknown>;
  const fromStatus = status === 401 || status === 403 ? "that key was refused" : status === 404 ? "not found" : status === 429 ? "rate limited — try again in a minute" : `HTTP ${status}`;
  switch (platform) {
    case "shopify": {
      const e = j.errors;
      if (typeof e === "string") return e;
      if (e && typeof e === "object") return Object.entries(e as Record<string, unknown>).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ");
      return fromStatus;
    }
    case "klaviyo": {
      const errs = j.errors;
      if (Array.isArray(errs) && errs[0] && typeof errs[0] === "object") {
        const first = errs[0] as { detail?: unknown; title?: unknown };
        if (typeof first.detail === "string") return first.detail;
        if (typeof first.title === "string") return first.title;
      }
      return fromStatus;
    }
    case "meta_ads": {
      const e = j.error as { message?: unknown; error_user_msg?: unknown } | undefined;
      if (e && typeof e === "object") {
        if (typeof e.error_user_msg === "string") return e.error_user_msg;
        if (typeof e.message === "string") return e.message;
      }
      return fromStatus;
    }
    case "ga4":
    case "google_ads": {
      const e = j.error as { message?: unknown } | string | undefined;
      if (typeof e === "string") return typeof j.error_description === "string" ? `${e}: ${j.error_description}` : e;
      if (e && typeof e === "object" && typeof e.message === "string") return e.message;
      return fromStatus;
    }
    case "hubspot": {
      if (typeof j.message === "string") return j.message;
      return fromStatus;
    }
  }
}

function reject(platform: ManualPlatform, status: number, json: unknown): never {
  throw new ManualValidationError("rejected", safeDetail(platformMessage(platform, status, json)));
}

// ---------- Google refresh grant (captures error_description; the token stays in the body) ----------

async function googleAccessToken(deps: ValidateDeps, platform: "ga4" | "google_ads", refreshToken: string): Promise<{ accessToken: string; expiresAt: string }> {
  const creds = platformCredentials(platform, deps.env);
  if (!creds) throw new ManualValidationError("not_configured", "Junction's Google app credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) aren't set on the server, so a refresh token can't be exchanged yet.");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret });
  const r = await call(deps, "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString() });
  if (!r.ok) reject(platform, r.status, r.json);
  const j = r.json as { access_token?: unknown; expires_in?: unknown } | null;
  if (!j || typeof j.access_token !== "string" || !j.access_token) throw new ManualValidationError("malformed", "Google answered without an access token");
  const expiresIn = typeof j.expires_in === "number" ? j.expires_in : 3600;
  return { accessToken: j.access_token, expiresAt: new Date(deps.now().getTime() + expiresIn * 1000).toISOString() };
}

// ---------- per platform ----------

export async function validateManualToken(platform: ManualPlatform, input: ManualInput, deps: ValidateDeps): Promise<ManualValidation> {
  const now = deps.now().toISOString();
  const token = input.token.trim();
  if (!token) throw new ManualValidationError("invalid_input", "paste the key first");

  switch (platform) {
    case "shopify": {
      const shop = normaliseShopDomain(input.shop);
      if (!shop) throw new ManualValidationError("invalid_input", "the store must be a your-store.myshopify.com domain");
      const r = await call(deps, `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, { method: "GET", headers: { "X-Shopify-Access-Token": token, accept: "application/json" } });
      if (!r.ok) reject(platform, r.status, r.json);
      const name = (r.json as { shop?: { name?: unknown } } | null)?.shop?.name;
      return { externalRef: shop, label: typeof name === "string" && name ? name : shop, bundle: { accessToken: token, obtainedAt: now, tokenType: "manual" } };
    }
    case "klaviyo": {
      const r = await call(deps, "https://a.klaviyo.com/api/accounts/", { method: "GET", headers: { authorization: `Klaviyo-API-Key ${token}`, accept: "application/json", revision: KLAVIYO_REVISION } });
      if (!r.ok) reject(platform, r.status, r.json);
      const first = (r.json as { data?: { id?: unknown; attributes?: { contact_information?: { organization_name?: unknown } } }[] } | null)?.data?.[0];
      const id = typeof first?.id === "string" ? first.id : null;
      const org = first?.attributes?.contact_information?.organization_name;
      return { externalRef: id, label: typeof org === "string" && org ? org : id ? `Klaviyo account ${id}` : "Klaviyo", bundle: { accessToken: token, obtainedAt: now, tokenType: "manual" } };
    }
    case "meta_ads": {
      const act = normaliseExternalRef("meta_ads", input.externalRef);
      if (!act) throw new ManualValidationError("invalid_input", "the ad account id must look like act_1234567890");
      const r = await call(deps, `https://graph.facebook.com/${META_GRAPH_VERSION}/${act}?fields=name,account_status,currency`, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      if (!r.ok) reject(platform, r.status, r.json);
      const j = (r.json ?? {}) as { name?: unknown; account_status?: unknown };
      const name = typeof j.name === "string" && j.name ? j.name : act;
      const status = typeof j.account_status === "number" && j.account_status !== 1 ? " · inactive" : "";
      const bundle: TokenBundle = { accessToken: token, obtainedAt: now, tokenType: "manual" };
      if (input.expiresAt && Number.isFinite(new Date(input.expiresAt).getTime())) bundle.expiresAt = new Date(input.expiresAt).toISOString();
      return { externalRef: act, label: `Ad account ${name} (${act})${status}`, bundle };
    }
    case "ga4": {
      const property = normaliseExternalRef("ga4", input.externalRef);
      if (!property) throw new ManualValidationError("invalid_input", "the GA4 property id is the number under Admin → Property details");
      const g = await googleAccessToken(deps, "ga4", token);
      const r = await call(deps, `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(property)}`, { method: "GET", headers: { authorization: `Bearer ${g.accessToken}`, accept: "application/json" } });
      if (!r.ok) reject(platform, r.status, r.json);
      const name = (r.json as { displayName?: unknown } | null)?.displayName;
      return { externalRef: property, label: typeof name === "string" && name ? `${name} (${property})` : `Property ${property}`, bundle: { accessToken: g.accessToken, refreshToken: token, expiresAt: g.expiresAt, obtainedAt: now, tokenType: "manual" } };
    }
    case "google_ads": {
      const customer = normaliseExternalRef("google_ads", input.externalRef);
      if (!customer) throw new ManualValidationError("invalid_input", "the customer id looks like 123-456-7890");
      const g = await googleAccessToken(deps, "google_ads", token);
      const developerToken = (deps.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
      let label = `Customer ${customer.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3")}`;
      if (developerToken) {
        const r = await call(deps, `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`, { method: "GET", headers: { authorization: `Bearer ${g.accessToken}`, "developer-token": developerToken, accept: "application/json" } });
        if (!r.ok) reject(platform, r.status, r.json);
        const names = (r.json as { resourceNames?: unknown } | null)?.resourceNames;
        if (Array.isArray(names) && !names.includes(`customers/${customer}`)) throw new ManualValidationError("rejected", `that login can't see customer ${customer} (it sees ${names.length} other${names.length === 1 ? "" : "s"})`);
      } else label += " · refresh token accepted; reads wait for GOOGLE_ADS_DEVELOPER_TOKEN";
      return { externalRef: customer, label, bundle: { accessToken: g.accessToken, refreshToken: token, expiresAt: g.expiresAt, obtainedAt: now, tokenType: "manual" } };
    }
    case "hubspot": {
      const r = await call(deps, "https://api.hubapi.com/account-info/v3/details", { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      if (!r.ok) reject(platform, r.status, r.json);
      const j = (r.json ?? {}) as { portalId?: unknown; uiDomain?: unknown };
      const portal = typeof j.portalId === "number" || (typeof j.portalId === "string" && j.portalId) ? String(j.portalId) : null;
      return { externalRef: portal, label: portal ? `HubSpot portal ${portal}` : "HubSpot", bundle: { accessToken: token, obtainedAt: now, tokenType: "manual" } };
    }
  }
}
