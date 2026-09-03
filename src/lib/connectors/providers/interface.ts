/* Hosted auth providers — the adapter seam (PROTOTYPE, env-gated, nothing live).

   An AuthProvider is a third party that runs the OAuth dance and holds the tokens for us
   (Composio, Nango, …). We hand it the founder (account id + platform), it hands back a hosted
   connect link; when the founder returns we ask it whether the connection is usable, and at
   read/act time we fetch the live access token from it (or ask it to proxy the call).

   What stays exactly as in the own-app path:
     · the founder authenticates once, from the Connectors grid;
     · a token is only ever in server memory for the duration of one read/act — it is never
       stored client-side, never handed to n8n, never logged (codes only);
     · every read/write is receipted by the caller (readers/executor), not here;
     · approvals gate mutations upstream of any proxyRequest.
   What changes: the token at rest lives in the provider's vault, not connector_secrets.
   The connector row carries the pointer (sync_ref.auth_provider + provider_connection_id),
   never the token.

   Everything network-shaped takes FetchLike so the tests shape requests against a stub. */

import type { FetchLike } from "../oauth";
import type { ConnectorRow } from "../store";
import type { Platform } from "../../runtime/types";

export type AuthProviderId = "composio" | "nango";
export type AuthProviderMode = "own" | AuthProviderId;
export const AUTH_PROVIDER_IDS: AuthProviderId[] = ["composio", "nango"];

export function isAuthProviderId(x: unknown): x is AuthProviderId {
  return typeof x === "string" && (AUTH_PROVIDER_IDS as string[]).includes(x);
}

export class AuthProviderError extends Error {
  constructor(
    readonly code: "not_configured" | "no_integration" | "timeout" | "network" | `http_${number}` | "malformed" | "not_connected" | "no_token",
    detail?: string,
  ) {
    super(`auth provider: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "AuthProviderError";
  }
}

/** What the connector row remembers about a provider-held connection (connectors.sync_ref keys).
    Ids only — never a token, never a session secret. */
export interface ProviderRef {
  provider: AuthProviderId;
  /** The provider's id for this connection (Composio connected_account id / Nango connection_id). */
  connectionId: string | null;
  /** The provider's integration handle we connected through (Composio auth_config_id / Nango provider_config_key). */
  integration: string;
}

export const PROVIDER_REF_KEYS = { provider: "auth_provider", connectionId: "provider_connection_id", integration: "provider_integration" } as const;

export function providerRefOf(row: Pick<ConnectorRow, "sync_ref">): ProviderRef | null {
  const ref = row.sync_ref && typeof row.sync_ref === "object" ? row.sync_ref : null;
  if (!ref) return null;
  const provider = ref[PROVIDER_REF_KEYS.provider];
  if (!isAuthProviderId(provider)) return null;
  const connectionId = ref[PROVIDER_REF_KEYS.connectionId];
  const integration = ref[PROVIDER_REF_KEYS.integration];
  return { provider, connectionId: typeof connectionId === "string" && connectionId ? connectionId : null, integration: typeof integration === "string" ? integration : "" };
}

export function providerRefPatch(ref: ProviderRef): Record<string, unknown> {
  return { [PROVIDER_REF_KEYS.provider]: ref.provider, [PROVIDER_REF_KEYS.connectionId]: ref.connectionId, [PROVIDER_REF_KEYS.integration]: ref.integration };
}

/** sync_ref with the provider pointer removed (disconnect). */
export function withoutProviderRef(syncRef: Record<string, unknown> | null): Record<string, unknown> {
  const next = { ...(syncRef ?? {}) };
  for (const k of Object.values(PROVIDER_REF_KEYS)) delete next[k];
  return next;
}

export interface ConnectLink {
  /** Hosted link the browser is sent to (the provider's connect UI). */
  url: string;
  /** The provider's connection id when it is known before the founder consents (Composio); null when it is assigned after (Nango). */
  connectionId: string | null;
  integration: string;
}

export interface ConnectRequest {
  accountId: string;
  platform: Platform;
  /** Our CSRF state — the provider must carry it back on the callback (as a query param) or we poll by end-user id. */
  state: string;
  /** Where the provider should send the browser afterwards (our /api/connectors/provider/<id>/callback). */
  returnUrl: string;
  /** Shopify only: validated myshopify.com domain (the provider needs it to build the authorize URL). */
  shop?: string;
}

export interface ProviderConnection {
  connectionId: string;
  status: "active" | "pending" | "failed" | "expired";
  /** A platform-side identifier when the provider surfaces one (Shopify shop, Klaviyo account…). */
  externalRef: string | null;
}

export interface ProviderToken {
  accessToken: string;
  expiresAt: string | null;
  refreshToken?: string;
}

export interface ProxyRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path (or absolute URL, provider permitting) on the underlying platform API. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ProxyResponse {
  status: number;
  body: unknown;
}

export interface AuthProvider {
  readonly id: AuthProviderId;
  /** True iff the platform has an integration handle at this provider (env) — the per-platform gate. */
  supports(platform: Platform): boolean;
  /** Create a hosted connect session for (account, platform) and return the link to send the browser to. */
  connectUrl(req: ConnectRequest): Promise<ConnectLink>;
  /** After the founder returns: is the connection usable? Resolves the connection id when the provider assigns it late. */
  handleCallback(req: { accountId: string; platform: Platform; connectionId: string | null; integration: string }): Promise<ProviderConnection>;
  /** Live access token for a connection (the provider refreshes on its side). */
  getAccessToken(req: { accountId: string; platform: Platform; connectionId: string }): Promise<ProviderToken>;
  /** Optional: make the platform call through the provider so the raw token never enters our process. */
  proxyRequest?(req: { accountId: string; platform: Platform; connectionId: string } & ProxyRequest): Promise<ProxyResponse>;
  /** Forget the connection at the provider (disconnect). Best-effort. */
  deleteConnection(req: { accountId: string; platform: Platform; connectionId: string; integration: string }): Promise<void>;
}

export interface ProviderDeps {
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
}

export const PROVIDER_CALL_TIMEOUT_MS = 10_000;

/** JSON call helper shared by the adapters: hard timeout, codes-only errors, no body echo. */
export async function providerJson(deps: ProviderDeps, url: string, init: { method: string; headers: Record<string, string>; body?: unknown }): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: init.method,
      headers: { accept: "application/json", ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(deps.timeoutMs ?? PROVIDER_CALL_TIMEOUT_MS),
    });
  } catch (e) {
    throw new AuthProviderError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network");
  }
  let json: unknown = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (res.ok) throw new AuthProviderError("malformed");
    }
  }
  if (!res.ok) throw new AuthProviderError(`http_${res.status}`);
  return { status: res.status, json };
}

export const asRecord = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
export const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
