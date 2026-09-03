import { describe, expect, it } from "vitest";
import { ComposioProvider, COMPOSIO_DEFAULT_BASE_URL } from "../../composio";
import { AuthProviderError } from "../interface";
import { assertNoLeak, json, stubFetch } from "../../__tests__/helpers";

const ENV = { COMPOSIO_API_KEY: "ck_FIXTURE", COMPOSIO_AUTH_CONFIG_META_ADS: "ac_meta", COMPOSIO_AUTH_CONFIG_SHOPIFY: "ac_shopify" };

function provider(env: Record<string, string> = ENV) {
  const f = stubFetch();
  const p = ComposioProvider.fromEnv({ env, fetch: f.fetch })!;
  return { p, ...f };
}

describe("ComposioProvider (mocked fetch — documented v3 shapes, unverified live)", () => {
  it("fromEnv: null without COMPOSIO_API_KEY; base URL override is honoured; supports() follows COMPOSIO_AUTH_CONFIG_<PLATFORM>", () => {
    const f = stubFetch();
    expect(ComposioProvider.fromEnv({ env: {}, fetch: f.fetch })).toBeNull();
    const p = ComposioProvider.fromEnv({ env: { ...ENV, COMPOSIO_BASE_URL: "https://composio.internal/" }, fetch: f.fetch })!;
    expect(p.baseUrl).toBe("https://composio.internal");
    expect(provider().p.baseUrl).toBe(COMPOSIO_DEFAULT_BASE_URL);
    expect(p.supports("meta_ads")).toBe(true);
    expect(p.supports("klaviyo")).toBe(false);
  });

  it("connectUrl: POST /api/v3.1/connected_accounts/link with the auth config, our account as user_id and a callback carrying our state", async () => {
    const { p, calls, routes } = provider();
    routes.push((c) => (c.url.endsWith("/api/v3.1/connected_accounts/link") ? json({ redirect_url: "https://connect.composio.dev/link/abc", connected_account_id: "ca_123", status: "INITIATED" }) : undefined));
    const link = await p.connectUrl({ accountId: "acct-1", platform: "meta_ads", state: "st8", returnUrl: "https://unc.test/api/connectors/provider/composio/callback?platform=meta_ads" });
    expect(link).toEqual({ url: "https://connect.composio.dev/link/abc", connectionId: "ca_123", integration: "ac_meta" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${COMPOSIO_DEFAULT_BASE_URL}/api/v3.1/connected_accounts/link`);
    expect(calls[0].headers["x-api-key"]).toBe("ck_FIXTURE");
    const body = JSON.parse(calls[0].body!);
    expect(body).toMatchObject({ auth_config_id: "ac_meta", user_id: "acct-1" });
    expect(new URL(body.callback_url).searchParams.get("state")).toBe("st8");
    expect(new URL(body.callback_url).searchParams.get("platform")).toBe("meta_ads");
  });

  it("connectUrl: Shopify passes the shop as connection data; a platform without an auth config → no_integration before any call", async () => {
    const { p, calls, routes } = provider();
    routes.push(() => json({ redirectUrl: "https://c/x", id: "ca_s" }));
    const link = await p.connectUrl({ accountId: "a", platform: "shopify", state: "s", returnUrl: "https://unc.test/cb", shop: "acme.myshopify.com" });
    expect(link.connectionId).toBe("ca_s");
    expect(JSON.parse(calls[0].body!).connection_data).toEqual({ subdomain: "acme", shop: "acme.myshopify.com" });
    await expect(p.connectUrl({ accountId: "a", platform: "klaviyo", state: "s", returnUrl: "https://unc.test/cb" })).rejects.toMatchObject({ code: "no_integration" });
    expect(calls).toHaveLength(1);
  });

  it("handleCallback: by id → status mapped; without an id → list by user + auth config and prefer the ACTIVE one", async () => {
    const { p, calls, routes } = provider();
    routes.push((c) => (c.url.endsWith("/api/v3/connected_accounts/ca_123") ? json({ id: "ca_123", status: "ACTIVE" }) : undefined));
    routes.push((c) => (c.url.includes("/api/v3/connected_accounts?") ? json({ items: [{ id: "ca_old", status: "EXPIRED" }, { id: "ca_new", status: "ACTIVE" }] }) : undefined));
    expect(await p.handleCallback({ accountId: "acct-1", platform: "meta_ads", connectionId: "ca_123", integration: "ac_meta" })).toEqual({ connectionId: "ca_123", status: "active", externalRef: null });
    expect(await p.handleCallback({ accountId: "acct-1", platform: "meta_ads", connectionId: null, integration: "ac_meta" })).toEqual({ connectionId: "ca_new", status: "active", externalRef: null });
    const q = new URL(calls[1].url).searchParams;
    expect(q.get("user_ids[]")).toBe("acct-1");
    expect(q.get("auth_config_ids[]")).toBe("ac_meta");
  });

  it("handleCallback: INITIATED → pending, FAILED → failed, Shopify echoes the shop as external_ref", async () => {
    const { p, routes } = provider();
    routes.push((c) => (c.url.endsWith("/ca_p") ? json({ id: "ca_p", status: "INITIATED" }) : undefined));
    routes.push((c) => (c.url.endsWith("/ca_f") ? json({ id: "ca_f", status: "FAILED" }) : undefined));
    routes.push((c) => (c.url.endsWith("/ca_s") ? json({ id: "ca_s", status: "ACTIVE", state: { authScheme: "OAUTH2", val: { access_token: "t", shop: "acme.myshopify.com" } } }) : undefined));
    expect((await p.handleCallback({ accountId: "a", platform: "meta_ads", connectionId: "ca_p", integration: "ac_meta" })).status).toBe("pending");
    expect((await p.handleCallback({ accountId: "a", platform: "meta_ads", connectionId: "ca_f", integration: "ac_meta" })).status).toBe("failed");
    expect((await p.handleCallback({ accountId: "a", platform: "shopify", connectionId: "ca_s", integration: "ac_shopify" })).externalRef).toBe("acme.myshopify.com");
  });

  it("getAccessToken: reads state.val.access_token (+ expiry) from the connected account; inactive → not_connected; no token or a MASKED token → no_token", async () => {
    const { p, routes, calls } = provider();
    routes.push((c) => (c.url.endsWith("/ca_masked") ? json({ id: "ca_masked", status: "ACTIVE", state: { val: { access_token: "EAAB..." } } }) : undefined));
    routes.push((c) => (c.url.endsWith("/ca_red") ? json({ id: "ca_red", status: "ACTIVE", state: { val: { access_token: "REDACTED" } } }) : undefined));
    routes.push((c) => (c.url.endsWith("/ca_ok") ? json({ id: "ca_ok", status: "ACTIVE", state: { authScheme: "OAUTH2", val: { access_token: "meta-tok-FIXTURE", expires_at: "2026-10-01T00:00:00Z", refresh_token: "rt" } } }) : undefined));
    routes.push((c) => (c.url.endsWith("/ca_exp") ? json({ id: "ca_exp", status: "EXPIRED", state: { val: { access_token: "x" } } }) : undefined));
    routes.push((c) => (c.url.endsWith("/ca_none") ? json({ id: "ca_none", status: "ACTIVE", state: { val: {} } }) : undefined));
    expect(await p.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "ca_ok" })).toEqual({ accessToken: "meta-tok-FIXTURE", expiresAt: "2026-10-01T00:00:00.000Z", refreshToken: "rt" });
    await expect(p.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "ca_exp" })).rejects.toMatchObject({ code: "not_connected" });
    await expect(p.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "ca_none" })).rejects.toMatchObject({ code: "no_token" });
    await expect(p.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "ca_masked" })).rejects.toMatchObject({ code: "no_token" });
    await expect(p.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "ca_red" })).rejects.toMatchObject({ code: "no_token" });
    assertNoLeak(calls.map((c) => c.url), ["meta-tok-FIXTURE"]);
  });

  it("proxyRequest: POST /api/v3.1/tools/execute/proxy with endpoint/method/body/parameters; unwraps data", async () => {
    const { p, routes, calls } = provider();
    routes.push((c) => (c.url.endsWith("/api/v3.1/tools/execute/proxy") ? json({ status: 200, data: { success: true } }) : undefined));
    const res = await p.proxyRequest({ accountId: "a", platform: "meta_ads", connectionId: "ca_1", method: "POST", path: "https://graph.facebook.com/v23.0/act_1/adsets/2", body: { status: "PAUSED" }, query: { fields: "id" } });
    expect(res).toEqual({ status: 200, body: { success: true } });
    const body = JSON.parse(calls[0].body!);
    expect(body).toMatchObject({ connected_account_id: "ca_1", endpoint: "https://graph.facebook.com/v23.0/act_1/adsets/2", method: "POST", body: { status: "PAUSED" } });
    expect(body.parameters).toEqual([{ name: "fields", value: "id", type: "query" }]);
  });

  it("deleteConnection: DELETE /api/v3/connected_accounts/{id}; HTTP errors, timeouts and bad JSON surface as codes only", async () => {
    const { p, routes, calls } = provider();
    routes.push((c) => (c.method === "DELETE" ? json({ success: true }) : undefined));
    await p.deleteConnection({ accountId: "a", platform: "meta_ads", connectionId: "ca_1", integration: "ac_meta" });
    expect(calls[0].url).toBe(`${COMPOSIO_DEFAULT_BASE_URL}/api/v3/connected_accounts/ca_1`);

    const bad = provider();
    bad.routes.push((c) => (c.url.endsWith("/ca_500") ? json({ error: "boom" }, 500) : undefined));
    bad.routes.push((c) => (c.url.endsWith("/ca_html") ? new Response("<html>", { status: 200 }) : undefined));
    await expect(bad.p.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "ca_500" })).rejects.toMatchObject({ code: "http_500" });
    await expect(bad.p.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "ca_html" })).rejects.toMatchObject({ code: "malformed" });
    const dead = ComposioProvider.fromEnv({ env: ENV, fetch: async () => { throw new TypeError("fetch failed"); } })!;
    await expect(dead.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "x" })).rejects.toBeInstanceOf(AuthProviderError);
    await expect(dead.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "x" })).rejects.toMatchObject({ code: "network" });
  });
});
