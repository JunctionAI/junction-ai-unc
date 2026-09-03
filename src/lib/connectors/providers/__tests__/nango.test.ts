import { describe, expect, it } from "vitest";
import { NANGO_DEFAULT_CONNECT_URL, NANGO_DEFAULT_HOST, NangoProvider, nangoIntegrationKey } from "../../nango";
import { assertNoLeak, json, stubFetch } from "../../__tests__/helpers";

const ENV = { NANGO_SECRET_KEY: "nk_FIXTURE", NANGO_INTEGRATION_META_ADS: "meta-prod", NANGO_INTEGRATION_DEFAULTS: "1" };

function provider(env: Record<string, string> = ENV) {
  const f = stubFetch();
  const p = NangoProvider.fromEnv({ env, fetch: f.fetch })!;
  return { p, ...f };
}

describe("NangoProvider (mocked fetch — documented shapes, unverified live)", () => {
  it("fromEnv: null without NANGO_SECRET_KEY; self-hosted host + connect URL overrides; integration keys", () => {
    const f = stubFetch();
    expect(NangoProvider.fromEnv({ env: {}, fetch: f.fetch })).toBeNull();
    const p = NangoProvider.fromEnv({ env: { ...ENV, NANGO_HOST: "https://nango.internal/", NANGO_CONNECT_URL: "https://connect.internal" }, fetch: f.fetch })!;
    expect(p.host).toBe("https://nango.internal");
    expect(p.connectBase).toBe("https://connect.internal");
    expect(provider().p.host).toBe(NANGO_DEFAULT_HOST);
    expect(nangoIntegrationKey("meta_ads", ENV)).toBe("meta-prod");
    expect(nangoIntegrationKey("meta_ads", { NANGO_SECRET_KEY: "k" })).toBe("meta-marketing-api");
    expect(nangoIntegrationKey("hubspot", ENV)).toBe("hubspot");
    expect(nangoIntegrationKey("gorgias", ENV)).toBeNull();
    expect(provider({ NANGO_SECRET_KEY: "k" }).p.supports("hubspot")).toBe(false); // defaults need the opt-in
    expect(provider().p.supports("hubspot")).toBe(true);
  });

  it("connectUrl: POST /connect/sessions tagged with our account as end_user_id and the integration allow-list; falls back to composing the hosted Connect link from the session token", async () => {
    const { p, calls, routes } = provider();
    routes.push((c) => (c.url === `${NANGO_DEFAULT_HOST}/connect/sessions` ? json({ data: { token: "sess_FIXTURE", expires_at: "2026-09-03T10:00:00Z" } }) : undefined));
    const link = await p.connectUrl({ accountId: "acct-1", platform: "meta_ads", state: "st8", returnUrl: "https://unc.test/api/connectors/provider/nango/callback?platform=meta_ads" });
    expect(link).toEqual({ url: `${NANGO_DEFAULT_CONNECT_URL}/?session_token=sess_FIXTURE`, connectionId: null, integration: "meta-prod" });
    expect(calls[0].headers.authorization).toBe("Bearer nk_FIXTURE");
    expect(JSON.parse(calls[0].body!)).toEqual({ tags: { end_user_id: "acct-1", unc_platform: "meta_ads", unc_state: "st8" }, allowed_integrations: ["meta-prod"] });
  });

  it("connectUrl: prefers a connect_link the API returns; Shopify seeds connection_config.subdomain", async () => {
    const { p, calls, routes } = provider();
    routes.push(() => json({ data: { token: "t", connect_link: "https://connect.nango.dev/link/xyz" } }));
    const link = await p.connectUrl({ accountId: "a", platform: "shopify", state: "s", returnUrl: "https://unc.test/cb", shop: "acme.myshopify.com" });
    expect(link.url).toBe("https://connect.nango.dev/link/xyz");
    expect(JSON.parse(calls[0].body!).integrations_config_defaults).toEqual({ shopify: { connection_config: { subdomain: "acme" } } });
  });

  it("handleCallback: Nango assigns the connection id late → list by end_user_id tag, newest for our integration key; errors on the connection → failed", async () => {
    const { p, calls, routes } = provider();
    routes.push((c) =>
      c.url.startsWith(`${NANGO_DEFAULT_HOST}/connections?`)
        ? json({ connections: [{ connection_id: "old", provider_config_key: "meta-prod", created: "2026-08-01T00:00:00Z" }, { connection_id: "other", provider_config_key: "hubspot", created: "2026-09-01T00:00:00Z" }, { connection_id: "new", provider_config_key: "meta-prod", created: "2026-09-02T00:00:00Z", errors: [] }] })
        : undefined,
    );
    routes.push((c) => (c.url.startsWith(`${NANGO_DEFAULT_HOST}/connections/bad?`) ? json({ connection_id: "bad", provider_config_key: "meta-prod", errors: [{ type: "auth" }] }) : undefined));
    expect(await p.handleCallback({ accountId: "acct-1", platform: "meta_ads", connectionId: null, integration: "meta-prod" })).toEqual({ connectionId: "new", status: "active", externalRef: null });
    expect(new URL(calls[0].url).searchParams.get("tags[end_user_id]")).toBe("acct-1");
    expect((await p.handleCallback({ accountId: "acct-1", platform: "meta_ads", connectionId: "bad", integration: "meta-prod" })).status).toBe("failed");
    const none = provider();
    none.routes.push(() => json({ connections: [] }));
    await expect(none.p.handleCallback({ accountId: "a", platform: "meta_ads", connectionId: null, integration: "meta-prod" })).rejects.toMatchObject({ code: "not_connected" });
  });

  it("getAccessToken: GET /connections/{id}?provider_config_key=… → credentials.access_token (+ expiry); Shopify external_ref from connection_config", async () => {
    const { p, calls, routes } = provider();
    routes.push((c) => (c.url.startsWith(`${NANGO_DEFAULT_HOST}/connections/c1?`) ? json({ connection_id: "c1", provider_config_key: "meta-prod", credentials: { type: "OAUTH2", access_token: "fb-tok-FIXTURE", expires_at: "2026-11-01T00:00:00Z" } }) : undefined));
    routes.push((c) => (c.url.startsWith(`${NANGO_DEFAULT_HOST}/connections/s1?`) ? json({ connection_id: "s1", provider_config_key: "shopify", connection_config: { subdomain: "acme" }, credentials: { type: "OAUTH2", access_token: "shpat" } }) : undefined));
    expect(await p.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "c1" })).toEqual({ accessToken: "fb-tok-FIXTURE", expiresAt: "2026-11-01T00:00:00.000Z" });
    expect(new URL(calls[0].url).searchParams.get("provider_config_key")).toBe("meta-prod");
    expect((await p.handleCallback({ accountId: "a", platform: "shopify", connectionId: "s1", integration: "shopify" })).externalRef).toBe("acme.myshopify.com");
    assertNoLeak(calls.map((c) => c.url), ["fb-tok-FIXTURE"]);
  });

  it("proxyRequest: ANY /proxy/<path> with Connection-Id + Provider-Config-Key headers; the platform token never enters our process", async () => {
    const { p, calls, routes } = provider();
    routes.push((c) => (c.url.startsWith(`${NANGO_DEFAULT_HOST}/proxy/`) ? json({ data: [{ id: "1" }] }) : undefined));
    const res = await p.proxyRequest({ accountId: "a", platform: "meta_ads", connectionId: "c1", method: "GET", path: "/v23.0/act_1/insights", query: { fields: "spend" } });
    expect(res).toEqual({ status: 200, body: { data: [{ id: "1" }] } });
    expect(calls[0].url).toBe(`${NANGO_DEFAULT_HOST}/proxy/v23.0/act_1/insights?fields=spend`);
    expect(calls[0].headers["connection-id"]).toBe("c1");
    expect(calls[0].headers["provider-config-key"]).toBe("meta-prod");
    expect(calls[0].headers.authorization).toBe("Bearer nk_FIXTURE");
  });

  it("deleteConnection: DELETE /connections/{id}?provider_config_key=…; HTTP errors are codes", async () => {
    const { p, calls, routes } = provider();
    routes.push((c) => (c.method === "DELETE" ? new Response(null, { status: 204 }) : undefined));
    await p.deleteConnection({ accountId: "a", platform: "meta_ads", connectionId: "c1", integration: "meta-prod" });
    expect(calls[0].url).toBe(`${NANGO_DEFAULT_HOST}/connections/c1?provider_config_key=meta-prod`);
    const bad = provider();
    bad.routes.push(() => json({ error: "nope" }, 404));
    await expect(bad.p.getAccessToken({ accountId: "a", platform: "meta_ads", connectionId: "gone" })).rejects.toMatchObject({ code: "http_404" });
  });
});
