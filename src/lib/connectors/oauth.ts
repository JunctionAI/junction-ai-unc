/* OAuth primitives shared by the start/callback handlers and tokens.ts.

   Pure functions + one network helper (postToken) that takes fetch as a parameter so the
   tests shape requests against a stub and nothing here ever dials out on its own.
   No token value is ever placed in an Error message or a log line: failures carry codes. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ConnectorEntry } from "./registry";

export const TOKEN_CALL_TIMEOUT_MS = 10_000;
export const STATE_TTL_MS = 10 * 60 * 1000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** What gets sealed into connector_secrets. `expiresAt` absent = offline token (Shopify). */
export interface TokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
  obtainedAt: string;
}

// ---------- randomness / PKCE ----------

export const b64url = (buf: Buffer) => buf.toString("base64url");

export function newState(): string {
  return b64url(randomBytes(32));
}

export function newCodeVerifier(): string {
  return b64url(randomBytes(48)); // 64 chars, within RFC 7636's 43–128
}

export function codeChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

// ---------- Shopify HMAC ----------

/** Shopify signs the callback query: every param except hmac (and the legacy signature),
    sorted, joined as k=v with &, HMAC-SHA256 under the app secret, hex. */
export function verifyShopifyHmac(params: URLSearchParams, clientSecret: string): boolean {
  const provided = params.get("hmac");
  if (!provided || !/^[0-9a-f]{64}$/i.test(provided)) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const expected = createHmac("sha256", clientSecret).update(message).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- token endpoint ----------

export class TokenCallError extends Error {
  constructor(readonly code: "timeout" | "network" | `http_${number}` | "malformed") {
    super(`token call failed: ${code}`);
    this.name = "TokenCallError";
  }
}

/** Raw provider token response, normalised. Provider error bodies are never surfaced. */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

/** POST a form-encoded token request with a hard timeout. `basic` moves the client
    credentials to an Authorization header (Klaviyo); otherwise they ride in the body. */
export async function postToken(
  fetchFn: FetchLike,
  url: string,
  form: Record<string, string | undefined>,
  opts: { basic?: { clientId: string; clientSecret: string }; timeoutMs?: number; method?: "POST" | "GET" } = {},
): Promise<TokenResponse> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (typeof v === "string") body.set(k, v);
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.basic) headers.authorization = `Basic ${Buffer.from(`${opts.basic.clientId}:${opts.basic.clientSecret}`, "utf8").toString("base64")}`;
  const method = opts.method ?? "POST";
  let target = url;
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(opts.timeoutMs ?? TOKEN_CALL_TIMEOUT_MS) };
  if (method === "GET") target = `${url}${url.includes("?") ? "&" : "?"}${body.toString()}`;
  else {
    headers["content-type"] = "application/x-www-form-urlencoded";
    init.body = body.toString();
  }
  let res: Response;
  try {
    res = await fetchFn(target, init);
  } catch (e) {
    throw new TokenCallError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network");
  }
  if (!res.ok) throw new TokenCallError(`http_${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new TokenCallError("malformed");
  }
  const j = json as Record<string, unknown>;
  if (!j || typeof j.access_token !== "string" || !j.access_token) throw new TokenCallError("malformed");
  return {
    access_token: j.access_token,
    refresh_token: typeof j.refresh_token === "string" ? j.refresh_token : undefined,
    expires_in: typeof j.expires_in === "number" ? j.expires_in : typeof j.expires_in === "string" && /^\d+$/.test(j.expires_in) ? Number(j.expires_in) : undefined,
    scope: typeof j.scope === "string" ? j.scope : undefined,
    token_type: typeof j.token_type === "string" ? j.token_type : undefined,
  };
}

export function bundleFromResponse(r: TokenResponse, now: Date, previous?: TokenBundle): TokenBundle {
  const b: TokenBundle = { accessToken: r.access_token, obtainedAt: now.toISOString() };
  const refresh = r.refresh_token ?? previous?.refreshToken;
  if (refresh) b.refreshToken = refresh;
  if (r.expires_in !== undefined) b.expiresAt = new Date(now.getTime() + r.expires_in * 1000).toISOString();
  if (r.scope) b.scope = r.scope;
  if (r.token_type) b.tokenType = r.token_type;
  return b;
}

/** Exchange an authorization code for the platform's tokens. */
export async function exchangeCode(
  fetchFn: FetchLike,
  entry: ConnectorEntry,
  p: { code: string; redirectUri: string; clientId: string; clientSecret: string; codeVerifier?: string; shop?: string },
): Promise<TokenResponse> {
  const url = entry.tokenEndpoint(p.shop);
  switch (entry.id) {
    case "shopify":
      return postToken(fetchFn, url, { client_id: p.clientId, client_secret: p.clientSecret, code: p.code });
    case "meta_ads":
      return postToken(fetchFn, url, { client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: p.redirectUri, code: p.code }, { method: "GET" });
    default: {
      const form = { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.codeVerifier };
      return entry.tokenAuth === "basic"
        ? postToken(fetchFn, url, form, { basic: { clientId: p.clientId, clientSecret: p.clientSecret } })
        : postToken(fetchFn, url, { ...form, client_id: p.clientId, client_secret: p.clientSecret });
    }
  }
}

/** Meta: swap a short-lived user token for a ~60-day one. */
export async function exchangeMetaLongLived(fetchFn: FetchLike, entry: ConnectorEntry, p: { accessToken: string; clientId: string; clientSecret: string }): Promise<TokenResponse> {
  return postToken(fetchFn, entry.tokenEndpoint(), { grant_type: "fb_exchange_token", client_id: p.clientId, client_secret: p.clientSecret, fb_exchange_token: p.accessToken }, { method: "GET" });
}

/** refresh_token grant (Google, Klaviyo). */
export async function refreshTokens(fetchFn: FetchLike, entry: ConnectorEntry, p: { refreshToken: string; clientId: string; clientSecret: string }): Promise<TokenResponse> {
  if (!entry.refreshEndpoint) throw new TokenCallError("malformed");
  const form = { grant_type: "refresh_token", refresh_token: p.refreshToken };
  return entry.tokenAuth === "basic"
    ? postToken(fetchFn, entry.refreshEndpoint, form, { basic: { clientId: p.clientId, clientSecret: p.clientSecret } })
    : postToken(fetchFn, entry.refreshEndpoint, { ...form, client_id: p.clientId, client_secret: p.clientSecret });
}

/** Redirect URI every platform must have registered, exactly. */
export function callbackUri(appUrl: string, platform: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/connectors/${platform}/callback`;
}
