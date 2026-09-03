/* Composio adapter (PROTOTYPE — written from the public v3 docs with a stubbed fetch; no
   Composio account exists and nothing here has been run against their API).

   Endpoints used (base COMPOSIO_BASE_URL, default https://backend.composio.dev; header x-api-key)
   — from the v3 / v3.1 API reference as read 2026-09-03 (docs/AUTH-PROVIDERS.md has the links):
     POST   /api/v3.1/connected_accounts/link          hosted Connect Link for a user
                 { auth_config_id, user_id, callback_url?, connection_data? }
                 → 201 { link_token, redirect_url, expires_at, connected_account_id }
                 Composio then sends the browser to callback_url?status=success&connected_account_id=ca_…
     GET    /api/v3/connected_accounts/{id}            status + credential state
                 → { id, status: INITIATED|ACTIVE|FAILED|EXPIRED|INACTIVE, state: { authScheme, val: { access_token?, … } } }
                 ⚠ val.* is MASKED ("abcd..." / "REDACTED") for Composio-managed auth configs (always, since
                 2026-04) and for our own auth configs unless the project setting turns masking off —
                 so getAccessToken() only works on our-own-app auth configs; proxyRequest() always works.
     GET    /api/v3/connected_accounts?user_ids[]=…&auth_config_ids[]=…   → { items[], next_cursor }
     POST   /api/v3.1/tools/execute/proxy              the platform call, credential injected server-side
                 { endpoint, method, connected_account_id, body?, parameters?: [{ name, value, type }] } → { data, status, headers }
                 (endpoint must share eTLD+1 with the toolkit's base URL)
     DELETE /api/v3/connected_accounts/{id}            permanent

   UNCERTAIN (⚠ inline): the connection_data key for the Shopify store subdomain; whether
   `status=success` on the callback is the only success marker. Nothing here has been run
   against a live account.

   Env:
     COMPOSIO_API_KEY                       required
     COMPOSIO_BASE_URL                      optional (default above)
     COMPOSIO_AUTH_CONFIG_<PLATFORM>        per platform: the auth config id created in the Composio
                                            dashboard for that toolkit (ac_…). Absent → the platform is
                                            not supported through Composio (honest fallback). */

import { asRecord, AuthProviderError, providerJson, str, type AuthProvider, type ConnectLink, type ConnectRequest, type ProviderConnection, type ProviderDeps, type ProviderToken, type ProxyRequest, type ProxyResponse } from "./providers/interface";
import type { Platform } from "../runtime/types";

export const COMPOSIO_DEFAULT_BASE_URL = "https://backend.composio.dev";

export const COMPOSIO_ENV = { apiKey: "COMPOSIO_API_KEY", baseUrl: "COMPOSIO_BASE_URL", authConfigPrefix: "COMPOSIO_AUTH_CONFIG_" } as const;

export function composioAuthConfigId(platform: string, env: Record<string, string | undefined>): string | null {
  return (env[`${COMPOSIO_ENV.authConfigPrefix}${platform.toUpperCase()}`] || "").trim() || null;
}

type ComposioStatus = ProviderConnection["status"];

function mapStatus(raw: string | null): ComposioStatus {
  switch ((raw || "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "INITIATED":
    case "INITIALIZING":
    case "PENDING":
      return "pending";
    case "EXPIRED":
    case "INACTIVE":
      return "expired";
    default:
      return "failed";
  }
}

export class ComposioProvider implements AuthProvider {
  readonly id = "composio" as const;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly apiKey: string,
    readonly baseUrl: string = COMPOSIO_DEFAULT_BASE_URL,
  ) {}

  static fromEnv(deps: ProviderDeps): ComposioProvider | null {
    const key = (deps.env[COMPOSIO_ENV.apiKey] || "").trim();
    if (!key) return null;
    const base = (deps.env[COMPOSIO_ENV.baseUrl] || "").trim().replace(/\/+$/, "") || COMPOSIO_DEFAULT_BASE_URL;
    return new ComposioProvider(deps, key, base);
  }

  supports(platform: Platform): boolean {
    return composioAuthConfigId(platform, this.deps.env) !== null;
  }

  private headers(): Record<string, string> {
    return { "x-api-key": this.apiKey };
  }

  private integration(platform: Platform): string {
    const id = composioAuthConfigId(platform, this.deps.env);
    if (!id) throw new AuthProviderError("no_integration", platform);
    return id;
  }

  async connectUrl(req: ConnectRequest): Promise<ConnectLink> {
    const authConfigId = this.integration(req.platform);
    const callback = new URL(req.returnUrl);
    callback.searchParams.set("state", req.state);
    const body: Record<string, unknown> = {
      auth_config_id: authConfigId,
      // Composio's "user" = our account (the founder's company), so every platform they connect
      // hangs off the same id and a disconnect can list by it.
      user_id: req.accountId,
      callback_url: callback.toString(),
      // ⚠ Shopify needs the shop domain to build its authorize URL; the docs call these
      // "connection parameters" — the key name (`subdomain` vs `shop`) is unverified.
      ...(req.shop ? { connection_data: { subdomain: req.shop.replace(/\.myshopify\.com$/, ""), shop: req.shop } } : {}),
    };
    const { json } = await providerJson(this.deps, `${this.baseUrl}/api/v3.1/connected_accounts/link`, { method: "POST", headers: this.headers(), body });
    const j = asRecord(json) ?? {};
    // v3.1 reference: redirect_url + connected_account_id (older SDK shapes tolerated).
    const url = str(j.redirect_url) ?? str(j.redirectUrl);
    const connectionId = str(j.connected_account_id) ?? str(j.connectedAccountId) ?? str(j.id);
    if (!url) throw new AuthProviderError("malformed", "no redirect url");
    return { url, connectionId, integration: authConfigId };
  }

  private async getAccount(id: string): Promise<Record<string, unknown>> {
    const { json } = await providerJson(this.deps, `${this.baseUrl}/api/v3/connected_accounts/${encodeURIComponent(id)}`, { method: "GET", headers: this.headers() });
    const j = asRecord(json);
    if (!j) throw new AuthProviderError("malformed");
    return j;
  }

  private async findAccount(accountId: string, authConfigId: string): Promise<Record<string, unknown> | null> {
    const q = new URLSearchParams({ "user_ids[]": accountId, "auth_config_ids[]": authConfigId });
    const { json } = await providerJson(this.deps, `${this.baseUrl}/api/v3/connected_accounts?${q.toString()}`, { method: "GET", headers: this.headers() });
    const items = asRecord(json)?.items;
    if (!Array.isArray(items)) return null;
    const accounts = items.map(asRecord).filter((x): x is Record<string, unknown> => !!x);
    return accounts.find((a) => mapStatus(str(a.status)) === "active") ?? accounts[0] ?? null;
  }

  async handleCallback(req: { accountId: string; platform: Platform; connectionId: string | null; integration: string }): Promise<ProviderConnection> {
    const acct = req.connectionId ? await this.getAccount(req.connectionId) : await this.findAccount(req.accountId, req.integration);
    if (!acct) throw new AuthProviderError("not_connected");
    const connectionId = str(acct.id);
    if (!connectionId) throw new AuthProviderError("malformed", "no id");
    return { connectionId, status: mapStatus(str(acct.status)), externalRef: externalRefFrom(req.platform, acct) };
  }

  async getAccessToken(req: { accountId: string; platform: Platform; connectionId: string }): Promise<ProviderToken> {
    const acct = await this.getAccount(req.connectionId);
    if (mapStatus(str(acct.status)) !== "active") throw new AuthProviderError("not_connected", str(acct.status) ?? undefined);
    const val = asRecord(asRecord(acct.state)?.val) ?? asRecord(acct.connectionParams) ?? {};
    const accessToken = str(val.access_token) ?? str(val.accessToken) ?? str(val.api_key) ?? str(val.apiKey);
    // Masked values ("shpa...", "REDACTED") are not tokens: a Composio-managed auth config never
    // hands the token out — use proxyRequest() for those.
    if (!accessToken || isMasked(accessToken)) throw new AuthProviderError("no_token", accessToken ? "masked" : undefined);
    const expiresAt = str(val.expires_at) ?? str(val.expiresAt);
    const refreshToken = str(val.refresh_token) ?? str(val.refreshToken);
    return { accessToken, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, ...(refreshToken ? { refreshToken } : {}) };
  }

  async proxyRequest(req: { accountId: string; platform: Platform; connectionId: string } & ProxyRequest): Promise<ProxyResponse> {
    const body: Record<string, unknown> = { connected_account_id: req.connectionId, endpoint: req.path, method: req.method };
    if (req.body !== undefined) body.body = req.body;
    const parameters = [
      ...Object.entries(req.query ?? {}).map(([name, value]) => ({ name, value, type: "query" })),
      ...Object.entries(req.headers ?? {}).map(([name, value]) => ({ name, value, type: "header" })),
    ];
    if (parameters.length) body.parameters = parameters;
    const { json } = await providerJson(this.deps, `${this.baseUrl}/api/v3.1/tools/execute/proxy`, { method: "POST", headers: this.headers(), body });
    const j = asRecord(json) ?? {};
    const status = typeof j.status === "number" ? j.status : 200;
    return { status, body: "data" in j ? j.data : json };
  }

  async deleteConnection(req: { accountId: string; platform: Platform; connectionId: string; integration: string }): Promise<void> {
    await providerJson(this.deps, `${this.baseUrl}/api/v3/connected_accounts/${encodeURIComponent(req.connectionId)}`, { method: "DELETE", headers: this.headers() });
  }
}

/** Composio masks secrets as the first 4 chars + "..." or the literal REDACTED. */
export function isMasked(value: string): boolean {
  return value === "REDACTED" || /^.{0,8}\.\.\.$/.test(value);
}

/** Non-secret platform identifiers Composio may echo back (Shopify shop; nothing reliable for the others). */
function externalRefFrom(platform: Platform, acct: Record<string, unknown>): string | null {
  if (platform !== "shopify") return null;
  const val = asRecord(asRecord(acct.state)?.val) ?? asRecord(acct.connectionParams) ?? {};
  const shop = str(val.shop) ?? str(val.subdomain);
  if (!shop) return null;
  return shop.includes(".") ? shop : `${shop}.myshopify.com`;
}
