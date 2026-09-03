/* Nango adapter (PROTOTYPE — written from the public docs with a stubbed fetch; no Nango
   account exists and nothing here has been run against their API).

   Endpoints used (base NANGO_HOST, default https://api.nango.dev; header Authorization: Bearer <secret key>)
   — from the API reference as read 2026-09-03 (docs/AUTH-PROVIDERS.md has the links):
     POST   /connect/sessions        Connect session for an end user (30-minute expiry)
                 { tags: { end_user_id }, allowed_integrations: [key], integrations_config_defaults?: { [key]: { connection_config } } }
                 → 201 { data: { token, connect_link, expires_at } }      (end_user/organization are deprecated → tags)
     GET    /connections?tags[end_user_id]=…   → { connections: [{ id, connection_id, provider_config_key, created, tags, errors[] }] }
                 (no credentials in the list; the singular /connection was removed 2026-01-20)
     GET    /connections/{id}?provider_config_key=…&force_refresh=…
                 → { connection_id, provider_config_key, credentials: { type: "OAUTH2", access_token, refresh_token?, expires_at? }, connection_config, errors[] }
                 (424 = refresh exhausted → reconnect; needs the key scope environment:connections:read_credentials)
     ANY    /proxy/<path>            headers Connection-Id, Provider-Config-Key (+ Retries, Base-Url-Override) — token injected by Nango
     DELETE /connections/{id}?provider_config_key=…

   UNCERTAIN (⚠ inline): whether the hosted Connect Link can redirect back to us after success
   (the docs describe frontend events + an auth webhook, not a redirect) — so our callback
   route doubles as a "check now" poll by state and the flow completes either way. Nothing
   here has been run against a live account.

   Env:
     NANGO_SECRET_KEY                 required (the environment's secret key — server only)
     NANGO_HOST                       optional (self-hosted API base; default above)
     NANGO_CONNECT_URL                optional (hosted Connect UI base; default https://connect.nango.dev)
     NANGO_INTEGRATION_<PLATFORM>     optional per platform: the provider_config_key (unique key) of the
                                      integration in the Nango dashboard. Defaults below match Nango's
                                      provider slugs but the key is whatever was typed when creating it. */

import { asRecord, AuthProviderError, providerJson, str, type AuthProvider, type ConnectLink, type ConnectRequest, type ProviderConnection, type ProviderDeps, type ProviderToken, type ProxyRequest, type ProxyResponse } from "./providers/interface";
import type { Platform } from "../runtime/types";

export const NANGO_DEFAULT_HOST = "https://api.nango.dev";
export const NANGO_DEFAULT_CONNECT_URL = "https://connect.nango.dev";

export const NANGO_ENV = { secretKey: "NANGO_SECRET_KEY", host: "NANGO_HOST", connectUrl: "NANGO_CONNECT_URL", integrationPrefix: "NANGO_INTEGRATION_" } as const;

/** Nango provider slugs per platform (⚠ the integration's unique key in a dashboard can differ — set NANGO_INTEGRATION_<PLATFORM>).
    Klaviyo at Nango is an API-key provider (no OAuth) — the founder pastes a private key into Nango's UI instead of ours. */
export const NANGO_DEFAULT_INTEGRATIONS: Partial<Record<Platform, string>> = {
  shopify: "shopify",
  klaviyo: "klaviyo",
  meta_ads: "meta-marketing-api",
  ga4: "google-analytics",
  google_ads: "google-ads",
  hubspot: "hubspot",
  search_console: "google-search-console",
};

export function nangoIntegrationKey(platform: string, env: Record<string, string | undefined>): string | null {
  const explicit = (env[`${NANGO_ENV.integrationPrefix}${platform.toUpperCase()}`] || "").trim();
  if (explicit) return explicit;
  return NANGO_DEFAULT_INTEGRATIONS[platform as Platform] ?? null;
}

export class NangoProvider implements AuthProvider {
  readonly id = "nango" as const;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly secretKey: string,
    readonly host: string = NANGO_DEFAULT_HOST,
    readonly connectBase: string = NANGO_DEFAULT_CONNECT_URL,
  ) {}

  static fromEnv(deps: ProviderDeps): NangoProvider | null {
    const key = (deps.env[NANGO_ENV.secretKey] || "").trim();
    if (!key) return null;
    const host = (deps.env[NANGO_ENV.host] || "").trim().replace(/\/+$/, "") || NANGO_DEFAULT_HOST;
    const connect = (deps.env[NANGO_ENV.connectUrl] || "").trim().replace(/\/+$/, "") || NANGO_DEFAULT_CONNECT_URL;
    return new NangoProvider(deps, key, host, connect);
  }

  supports(platform: Platform): boolean {
    // Only platforms with an explicit key are "supported" unless the default slug exists AND
    // the operator opted in with NANGO_INTEGRATION_DEFAULTS=1 (keeps an unset dashboard honest).
    const explicit = (this.deps.env[`${NANGO_ENV.integrationPrefix}${platform.toUpperCase()}`] || "").trim();
    if (explicit) return true;
    return (this.deps.env.NANGO_INTEGRATION_DEFAULTS || "").trim() === "1" && !!NANGO_DEFAULT_INTEGRATIONS[platform];
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.secretKey}`, ...extra };
  }

  private integration(platform: Platform): string {
    const key = nangoIntegrationKey(platform, this.deps.env);
    if (!key || !this.supports(platform)) throw new AuthProviderError("no_integration", platform);
    return key;
  }

  async connectUrl(req: ConnectRequest): Promise<ConnectLink> {
    const key = this.integration(req.platform);
    const body: Record<string, unknown> = {
      // tags.end_user_id = our account id (the founder's company): one bucket per tenant.
      tags: { end_user_id: req.accountId, unc_platform: req.platform, unc_state: req.state },
      allowed_integrations: [key],
    };
    // Nango's Shopify provider reads the store subdomain from connection_config.subdomain.
    if (req.shop) body.integrations_config_defaults = { [key]: { connection_config: { subdomain: req.shop.replace(/\.myshopify\.com$/, "") } } };
    const { json } = await providerJson(this.deps, `${this.host}/connect/sessions`, { method: "POST", headers: this.headers(), body });
    const data = asRecord(asRecord(json)?.data) ?? asRecord(json) ?? {};
    const token = str(data.token);
    // The session returns the hosted Connect Link; composing one from the token is the fallback.
    const url = str(data.connect_link) ?? str(data.connectLink) ?? (token ? `${this.connectBase}/?session_token=${encodeURIComponent(token)}` : null);
    if (!url) throw new AuthProviderError("malformed", "no session token");
    return { url, connectionId: null, integration: key };
  }

  private async getConnection(connectionId: string, key: string, forceRefresh = false): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ provider_config_key: key, ...(forceRefresh ? { force_refresh: "true" } : {}) });
    const { json } = await providerJson(this.deps, `${this.host}/connections/${encodeURIComponent(connectionId)}?${q.toString()}`, { method: "GET", headers: this.headers() });
    const j = asRecord(json);
    if (!j) throw new AuthProviderError("malformed");
    return j;
  }

  private async findConnection(accountId: string, key: string): Promise<Record<string, unknown> | null> {
    const q = new URLSearchParams({ "tags[end_user_id]": accountId });
    const { json } = await providerJson(this.deps, `${this.host}/connections?${q.toString()}`, { method: "GET", headers: this.headers() });
    const list = asRecord(json)?.connections;
    if (!Array.isArray(list)) return null;
    const mine = list.map(asRecord).filter((c): c is Record<string, unknown> => !!c && str(c.provider_config_key) === key);
    // newest first when the provider timestamps them
    mine.sort((a, b) => (str(b.created) ?? "").localeCompare(str(a.created) ?? ""));
    return mine[0] ?? null;
  }

  async handleCallback(req: { accountId: string; platform: Platform; connectionId: string | null; integration: string }): Promise<ProviderConnection> {
    const key = req.integration || this.integration(req.platform);
    const conn = req.connectionId ? await this.getConnection(req.connectionId, key) : await this.findConnection(req.accountId, key);
    if (!conn) throw new AuthProviderError("not_connected");
    const connectionId = str(conn.connection_id) ?? str(conn.id);
    if (!connectionId) throw new AuthProviderError("malformed", "no connection id");
    const errors = Array.isArray(conn.errors) ? conn.errors : [];
    return { connectionId, status: errors.length ? "failed" : "active", externalRef: externalRefFrom(req.platform, conn) };
  }

  async getAccessToken(req: { accountId: string; platform: Platform; connectionId: string }): Promise<ProviderToken> {
    const key = this.integration(req.platform);
    const conn = await this.getConnection(req.connectionId, key);
    const creds = asRecord(conn.credentials) ?? {};
    const accessToken = str(creds.access_token) ?? str(creds.api_key) ?? str(creds.apiKey);
    if (!accessToken) throw new AuthProviderError("no_token");
    const expiresAt = str(creds.expires_at);
    const refreshToken = str(creds.refresh_token);
    return { accessToken, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, ...(refreshToken ? { refreshToken } : {}) };
  }

  async proxyRequest(req: { accountId: string; platform: Platform; connectionId: string } & ProxyRequest): Promise<ProxyResponse> {
    const key = this.integration(req.platform);
    const path = req.path.replace(/^\/+/, "");
    const qs = req.query && Object.keys(req.query).length ? `?${new URLSearchParams(req.query).toString()}` : "";
    const { status, json } = await providerJson(this.deps, `${this.host}/proxy/${path}${qs}`, {
      method: req.method,
      headers: this.headers({ "connection-id": req.connectionId, "provider-config-key": key, ...(req.headers ?? {}) }),
      ...(req.body !== undefined ? { body: req.body } : {}),
    });
    return { status, body: json };
  }

  async deleteConnection(req: { accountId: string; platform: Platform; connectionId: string; integration: string }): Promise<void> {
    const key = req.integration || this.integration(req.platform);
    await providerJson(this.deps, `${this.host}/connections/${encodeURIComponent(req.connectionId)}?${new URLSearchParams({ provider_config_key: key }).toString()}`, { method: "DELETE", headers: this.headers() });
  }
}

function externalRefFrom(platform: Platform, conn: Record<string, unknown>): string | null {
  if (platform !== "shopify") return null;
  const cfg = asRecord(conn.connection_config) ?? {};
  const sub = str(cfg.subdomain) ?? str(cfg.shop);
  if (!sub) return null;
  return sub.includes(".") ? sub : `${sub}.myshopify.com`;
}
