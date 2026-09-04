/* The provider-backed Connect flow end to end against the schema-checked fake DB + a stubbed
   fetch: /start hands back the provider's hosted link, the provider callback flips the row,
   tokens.ts fetches the live token from the provider (nothing sealed here), disconnect asks
   the provider to forget the connection, and /state marks the card. With the flag unset
   every one of these paths is byte-identical to the own-app flow (asserted first). */

import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { handleCallback, handleDisconnect, handleStart } from "../../handlers";
import { handleConnectorsState } from "../../state";
import { upsertConnector } from "../../store";
import { ConnectorCredentialProvider, getAccessTokenFor } from "../../tokens";
import { callbackViaProvider, providerCallbackUri } from "../connect";
import { providerRefPatch } from "../interface";
import { APP_URL, assertNoLeak, config, deps as makeDeps, FAKE_ENV, json, KEYRING, NOW, seededDb } from "../../__tests__/helpers";

let db: FakeSupabase;
let accountId: string;
let userId: string;
beforeEach(() => {
  ({ db, accountId, userId } = seededDb());
});

const COMPOSIO_ENV = { CONNECTOR_AUTH_PROVIDER: "composio", COMPOSIO_API_KEY: "ck_FIXTURE", COMPOSIO_AUTH_CONFIG_META_ADS: "ac_meta", COMPOSIO_AUTH_CONFIG_SHOPIFY: "ac_shop" };
const NANGO_ENV = { CONNECTOR_AUTH_PROVIDER: "nango", NANGO_SECRET_KEY: "nk_FIXTURE", NANGO_INTEGRATION_HUBSPOT: "hubspot-prod" };

const live = (env: Record<string, string>, over: Parameters<typeof makeDeps>[0] = {}) => makeDeps({ db, userId, config: config({ env }), ...over });

const COMPOSIO_LINK = "https://connect.composio.dev/link/abc";
function composioRoutes(d: ReturnType<typeof makeDeps>, account: Record<string, unknown> = { id: "ca_1", status: "ACTIVE", state: { val: { access_token: "meta-tok-FIXTURE", expires_at: "2026-10-01T00:00:00Z" } } }) {
  d.routes.push((c) => (c.url.endsWith("/api/v3.1/connected_accounts/link") ? json({ link_token: "lt", redirect_url: COMPOSIO_LINK, connected_account_id: "ca_1", expires_at: "x" }) : undefined));
  d.routes.push((c) => (c.url.endsWith("/api/v3/connected_accounts/ca_1") && c.method === "GET" ? json(account) : undefined));
  d.routes.push((c) => (c.url.endsWith("/api/v3/connected_accounts/ca_1") && c.method === "DELETE" ? json({ success: true }) : undefined));
}

describe("flag unset → the own-app flow is untouched", () => {
  it("/start without our app and without a flag is the honest fallback; nothing is written; no network", async () => {
    const d = live({});
    expect(await handleStart(d, "meta_ads", {})).toEqual({ status: 200, body: { fallback: true, reason: "platform_not_configured" } });
    expect(db.rows("connectors")).toHaveLength(0);
    expect(d.calls).toHaveLength(0);
  });

  it("with our app configured the flag is ignored: /start returns Meta's own authorize URL", async () => {
    const d = live({ ...FAKE_ENV, ...COMPOSIO_ENV });
    const res = await handleStart(d, "meta_ads", {});
    expect(res.status).toBe(200);
    expect("url" in res.body && res.body.url.startsWith("https://www.facebook.com/")).toBe(true);
    expect(d.calls).toHaveLength(0);
  });
});

describe("POST …/start via a provider", () => {
  it("flagged but the provider key is absent → fallback; key present but no auth config for the platform → fallback", async () => {
    expect(await handleStart(live({ CONNECTOR_AUTH_PROVIDER: "composio" }), "meta_ads", {})).toEqual({ status: 200, body: { fallback: true, reason: "platform_not_configured" } });
    expect(await handleStart(live({ CONNECTOR_AUTH_PROVIDER: "composio", COMPOSIO_API_KEY: "ck" }), "klaviyo", {})).toEqual({ status: 200, body: { fallback: true, reason: "platform_not_configured" } });
  });

  it("the same gates as the own flow: secret store, accounts DB, session, membership, Shopify shop", async () => {
    expect(await handleStart(live(COMPOSIO_ENV, { config: config({ env: COMPOSIO_ENV, keyring: null }) }), "meta_ads", {})).toEqual({ status: 200, body: { fallback: true, reason: "secret_store_not_configured" } });
    expect(await handleStart(makeDeps({ config: config({ env: COMPOSIO_ENV, dbConfigured: false }) }), "meta_ads", {})).toEqual({ status: 200, body: { fallback: true, reason: "accounts_not_configured" } });
    expect((await handleStart(live(COMPOSIO_ENV, { userId: null }), "meta_ads", {})).status).toBe(401);
    expect((await handleStart(live(COMPOSIO_ENV, { userId: "stranger" }), "meta_ads", {})).status).toBe(403);
    expect((await handleStart(live(COMPOSIO_ENV), "shopify", { shop: "evil.com" })).status).toBe(400);
    expect(db.rows("oauth_states")).toHaveLength(0);
  });

  it("members cannot start a provider-hosted connection", async () => {
    db.rows("account_members")[0].role = "member";
    const d = live(COMPOSIO_ENV);
    composioRoutes(d);
    expect((await handleStart(d, "meta_ads", {})).status).toBe(403);
    expect(d.calls).toHaveLength(0);
    expect(db.rows("oauth_states")).toHaveLength(0);
    expect(db.rows("connectors")).toHaveLength(0);
  });

  it("Composio: returns the hosted link, records a state row + a 'connecting' row carrying the provider pointer (ids only)", async () => {
    const d = live(COMPOSIO_ENV);
    composioRoutes(d);
    const res = await handleStart(d, "meta_ads", {});
    expect(res).toEqual({ status: 200, body: { url: COMPOSIO_LINK, provider: "composio" } });
    const state = db.rows("oauth_states")[0];
    expect(state).toMatchObject({ account_id: accountId, platform: "meta_ads", code_verifier: null, shop: null });
    const row = db.rows("connectors")[0];
    expect(row).toMatchObject({ platform: "meta_ads", status: "connecting", sync_ref: { auth_provider: "composio", provider_connection_id: "ca_1", provider_integration: "ac_meta" } });
    // the link request carried our callback with the state, and our api key only in the header
    const body = JSON.parse(d.calls[0].body!);
    expect(body.callback_url).toBe(`${APP_URL}/api/connectors/provider/composio/callback?platform=meta_ads&state=${encodeURIComponent(state.state as string)}`);
    expect(d.calls[0].url).not.toContain("ck_FIXTURE");
    expect(db.rows("connector_secrets")).toHaveLength(0);
    assertNoLeak(d.logs, ["ck_FIXTURE"]);
  });

  it("Nango: connection id is assigned late → pointer without an id; the link is the session's connect_link", async () => {
    const d = live(NANGO_ENV);
    d.routes.push((c) => (c.url.endsWith("/connect/sessions") ? json({ data: { token: "sess", connect_link: "https://connect.nango.dev/link/xyz", expires_at: "x" } }) : undefined));
    const res = await handleStart(d, "hubspot", {});
    expect(res).toEqual({ status: 200, body: { url: "https://connect.nango.dev/link/xyz", provider: "nango" } });
    expect(db.rows("connectors")[0]).toMatchObject({ platform: "hubspot", status: "connecting", sync_ref: { auth_provider: "nango", provider_connection_id: null, provider_integration: "hubspot-prod" } });
  });

  it("a provider that refuses the link request → 502 with a code, nothing written", async () => {
    const d = live(COMPOSIO_ENV);
    d.routes.push(() => json({ error: "bad auth config" }, 401));
    expect(await handleStart(d, "meta_ads", {})).toEqual({ status: 502, body: { error: "couldn't start composio connect (http_401)" } });
    expect(db.rows("oauth_states")).toHaveLength(0);
    expect(db.rows("connectors")).toHaveLength(0);
  });

  it("re-connecting keeps the Airbyte handles on sync_ref and replaces only the provider pointer", async () => {
    await upsertConnector(db, accountId, "meta_ads", { status: "needs_reconnect", sync_ref: { airbyte_source_id: "src_1", ...providerRefPatch({ provider: "composio", connectionId: "ca_old", integration: "ac_meta" }) } });
    const d = live(COMPOSIO_ENV);
    composioRoutes(d);
    await handleStart(d, "meta_ads", {});
    expect(db.rows("connectors")[0].sync_ref).toEqual({ airbyte_source_id: "src_1", auth_provider: "composio", provider_connection_id: "ca_1", provider_integration: "ac_meta" });
  });
});

async function startedWith(env: Record<string, string>, platform: string, setup: (d: ReturnType<typeof makeDeps>) => void, body: unknown = {}) {
  const d = live(env);
  setup(d);
  const res = await handleStart(d, platform, body);
  if (res.status !== 200 || !("url" in res.body)) throw new Error(`start failed: ${JSON.stringify(res.body)}`);
  const state = db.rows("oauth_states")[0].state as string;
  return { d, state };
}

const cb = (provider: string, params: Record<string, string>) => `${providerCallbackUri(APP_URL, provider as "composio", params.platform ?? "meta_ads")}&${new URLSearchParams(params).toString()}`;

describe("GET /api/connectors/provider/<provider>/callback", () => {
  it("Composio success: state consumed, provider asked, row → connected with the connection id + a receipt; onConnected fires; no token stored", async () => {
    const connected: unknown[] = [];
    const { d, state } = await startedWith(COMPOSIO_ENV, "meta_ads", composioRoutes);
    d.onConnected = (i) => connected.push(i);
    const res = await callbackViaProvider(d, "composio", cb("composio", { state, status: "success", connected_account_id: "ca_1" }));
    expect(res).toEqual({ redirect: "/app?connected=meta_ads" });
    expect(db.rows("oauth_states")).toHaveLength(0);
    const row = db.rows("connectors")[0];
    expect(row).toMatchObject({ status: "connected", external_ref: null, last_sync_result: null, sync_ref: { auth_provider: "composio", provider_connection_id: "ca_1" } });
    expect(db.rows("connector_secrets")).toHaveLength(0);
    const receipt = db.rows("receipts")[0];
    expect(receipt.description).toContain("connected through Composio");
    expect(JSON.stringify(receipt.payload)).not.toContain("meta-tok-FIXTURE");
    // Meta has a picker → not readable until an ad account is chosen
    expect(connected).toHaveLength(0);
    assertNoLeak(d.logs, ["meta-tok-FIXTURE", "ck_FIXTURE"]);
  });

  it("Shopify through Composio: the shop from the state row becomes external_ref and the first read fires", async () => {
    const connected: unknown[] = [];
    const { d, state } = await startedWith(COMPOSIO_ENV, "shopify", (dd) => composioRoutes(dd, { id: "ca_1", status: "ACTIVE" }), { shop: "acme.myshopify.com" });
    d.onConnected = (i) => connected.push(i);
    expect(JSON.parse(d.calls[0].body!).connection_data).toMatchObject({ shop: "acme.myshopify.com" });
    await callbackViaProvider(d, "composio", cb("composio", { platform: "shopify", state, status: "success" }));
    expect(db.rows("connectors")[0]).toMatchObject({ platform: "shopify", status: "connected", external_ref: "acme.myshopify.com" });
    expect(connected).toEqual([{ accountId, platform: "shopify", connectorId: db.rows("connectors")[0].id }]);
  });

  it("Nango: the callback (or a 'check now' with the same state) lists by our account tag and adopts the newest connection", async () => {
    const { d, state } = await startedWith(NANGO_ENV, "hubspot", (dd) => {
      dd.routes.push((c) => (c.url.endsWith("/connect/sessions") ? json({ data: { token: "sess", connect_link: "https://connect.nango.dev/link/xyz" } }) : undefined));
      dd.routes.push((c) => (c.url.includes("/connections?") ? json({ connections: [{ connection_id: "nc_9", provider_config_key: "hubspot-prod", created: "2026-09-02T00:00:00Z", errors: [] }] }) : undefined));
    });
    expect(await callbackViaProvider(d, "nango", cb("nango", { platform: "hubspot", state }))).toEqual({ redirect: "/app?connected=hubspot" });
    expect(db.rows("connectors")[0]).toMatchObject({ platform: "hubspot", status: "connected", sync_ref: { auth_provider: "nango", provider_connection_id: "nc_9", provider_integration: "hubspot-prod" } });
  });

  it("failures: bad/expired/replayed state, session mismatch, provider refusal, pending or failed connection, wrong provider → connect_error", async () => {
    const { d, state } = await startedWith(COMPOSIO_ENV, "meta_ads", (dd) => composioRoutes(dd, { id: "ca_1", status: "INITIATED" }));
    expect(await callbackViaProvider(d, "composio", cb("composio", { state: "nope" }))).toEqual({ redirect: "/app?connect_error=meta_ads" });
    expect(await callbackViaProvider(d, "composio", cb("composio", { platform: "hubspot", state }))).toEqual({ redirect: "/app?connect_error=hubspot" }); // platform ≠ state's → bad_state, state consumed
    expect(db.rows("oauth_states")).toHaveLength(0);
    expect(db.rows("connectors")[0].status).toBe("connecting"); // bad_state never touches the row

    const s2 = await startedWith(COMPOSIO_ENV, "meta_ads", (dd) => composioRoutes(dd, { id: "ca_1", status: "INITIATED" }));
    expect(await callbackViaProvider({ ...s2.d, userId: "stranger" }, "composio", cb("composio", { state: s2.state, status: "success" }))).toEqual({ redirect: "/app?connect_error=meta_ads" });
    expect(db.rows("connectors")[0]).toMatchObject({ status: "connecting" });

    const s3 = await startedWith(COMPOSIO_ENV, "meta_ads", (dd) => composioRoutes(dd, { id: "ca_1", status: "INITIATED" }));
    expect(await callbackViaProvider(s3.d, "composio", cb("composio", { state: s3.state, status: "failed" }))).toEqual({ redirect: "/app?connect_error=meta_ads" });

    const s4 = await startedWith(COMPOSIO_ENV, "meta_ads", (dd) => composioRoutes(dd, { id: "ca_1", status: "INITIATED" }));
    expect(await callbackViaProvider(s4.d, "composio", cb("composio", { state: s4.state, status: "success" }))).toEqual({ redirect: "/app?connect_error=meta_ads" });
    expect(s4.d.logs.some((l) => l.includes("reason=provider_pending"))).toBe(true);

    const s5 = await startedWith(COMPOSIO_ENV, "meta_ads", (dd) => composioRoutes(dd));
    expect(await callbackViaProvider(s5.d, "nango", cb("nango", { state: s5.state }))).toEqual({ redirect: "/app?connect_error=meta_ads" });
    expect(s5.d.logs.some((l) => l.includes("reason=no_pending_connection"))).toBe(true);

    const s6 = await startedWith(COMPOSIO_ENV, "meta_ads", (dd) => composioRoutes(dd));
    const expired = { ...s6.d, now: () => new Date(NOW.getTime() + 11 * 60_000) };
    expect(await callbackViaProvider(expired, "composio", cb("composio", { state: s6.state }))).toEqual({ redirect: "/app?connect_error=meta_ads" });
  });

  it("a member cannot complete an owner's provider callback or contact the provider", async () => {
    const { d, state } = await startedWith(COMPOSIO_ENV, "meta_ads", composioRoutes);
    db.rows("account_members")[0].role = "member";
    const callsBefore = d.calls.length;
    expect(await callbackViaProvider(d, "composio", cb("composio", { state, status: "success" }))).toEqual({ redirect: "/app?connect_error=meta_ads" });
    expect(d.calls).toHaveLength(callsBefore);
    expect(db.rows("connectors")[0]).toMatchObject({ status: "connecting" });
    expect(db.rows("receipts")).toHaveLength(0);
  });

  it("the own-app callback route refuses a provider state (platform mismatch on purpose: different route, same table)", async () => {
    const { d, state } = await startedWith(COMPOSIO_ENV, "meta_ads", composioRoutes);
    expect(await handleCallback(d, "meta_ads", `${APP_URL}/api/connectors/meta_ads/callback?state=${state}&code=x`)).toEqual({ redirect: "/app?connect_error=meta_ads" });
  });
});

describe("tokens.ts on a provider-held row", () => {
  async function connectedViaComposio(platform = "meta_ads", externalRef: string | null = "act_123") {
    return upsertConnector(db, accountId, platform, { status: "connected", external_ref: externalRef, sync_ref: providerRefPatch({ provider: "composio", connectionId: "ca_1", integration: "ac_meta" }) });
  }
  const tokenDeps = (d: ReturnType<typeof makeDeps>) => ({ db, keyring: KEYRING, env: d.config.env, fetch: d.fetch, now: d.now, log: d.log });

  it("fetches the live token from the provider per call; nothing sealed, nothing logged; the worker-shaped credential is the same", async () => {
    await connectedViaComposio();
    const d = live(COMPOSIO_ENV);
    composioRoutes(d);
    const tok = await getAccessTokenFor(accountId, "meta_ads", tokenDeps(d));
    expect(tok).toEqual({ accessToken: "meta-tok-FIXTURE", platform: "meta_ads", externalRef: "act_123", expiresAt: "2026-10-01T00:00:00.000Z" });
    expect(db.rows("connector_secrets")).toHaveLength(0);
    expect(d.calls.map((c) => c.url)).toEqual([`https://backend.composio.dev/api/v3/connected_accounts/ca_1`]);
    expect(await new ConnectorCredentialProvider(tokenDeps(d)).get(accountId, "meta_ads")).toEqual({ kind: "meta_ads", adAccountId: "act_123", accessToken: "meta-tok-FIXTURE" });
    assertNoLeak(d.logs, ["meta-tok-FIXTURE"]);
  });

  it("provider not configured any more / no connection id / masked token / provider error / expired → null + needs_reconnect with a code", async () => {
    const id = await connectedViaComposio();
    const d0 = live({});
    expect(await getAccessTokenFor(accountId, "meta_ads", tokenDeps(d0))).toBeNull();
    expect(db.rows("connectors")[0]).toMatchObject({ status: "needs_reconnect", last_sync_result: "error:provider_not_configured" });

    await upsertConnector(db, accountId, "meta_ads", { status: "connected", sync_ref: providerRefPatch({ provider: "composio", connectionId: null, integration: "ac_meta" }) });
    expect(await getAccessTokenFor(accountId, "meta_ads", tokenDeps(live(COMPOSIO_ENV)))).toBeNull();
    expect(db.rows("connectors")[0].last_sync_result).toBe("error:provider_no_connection");

    await upsertConnector(db, accountId, "meta_ads", { status: "connected", sync_ref: providerRefPatch({ provider: "composio", connectionId: "ca_1", integration: "ac_meta" }) });
    const masked = live(COMPOSIO_ENV);
    composioRoutes(masked, { id: "ca_1", status: "ACTIVE", state: { val: { access_token: "REDACTED" } } });
    expect(await getAccessTokenFor(accountId, "meta_ads", tokenDeps(masked))).toBeNull();
    expect(db.rows("connectors")[0].last_sync_result).toBe("error:provider_no_token");

    await upsertConnector(db, accountId, "meta_ads", { status: "connected" });
    const down = live(COMPOSIO_ENV);
    down.routes.push(() => json({ error: "x" }, 503));
    expect(await getAccessTokenFor(accountId, "meta_ads", tokenDeps(down))).toBeNull();
    expect(db.rows("connectors")[0].last_sync_result).toBe("error:provider_http_503");

    await upsertConnector(db, accountId, "meta_ads", { status: "connected" });
    const stale = live(COMPOSIO_ENV);
    composioRoutes(stale, { id: "ca_1", status: "ACTIVE", state: { val: { access_token: "old", expires_at: "2026-09-01T00:00:00Z" } } });
    expect(await getAccessTokenFor(accountId, "meta_ads", tokenDeps(stale))).toBeNull();
    expect(db.rows("connectors")[0].last_sync_result).toBe("error:provider_token_expired");
    expect(id).toBe(db.rows("connectors")[0].id);
  });
});

describe("disconnect + state on a provider-held row", () => {
  it("disconnect deletes the connection at the provider, drops the pointer, keeps Airbyte handles, receipts it", async () => {
    await upsertConnector(db, accountId, "meta_ads", { status: "connected", external_ref: "act_123", sync_ref: { airbyte_source_id: "src_1", ...providerRefPatch({ provider: "composio", connectionId: "ca_1", integration: "ac_meta" }) } });
    const d = live(COMPOSIO_ENV);
    composioRoutes(d);
    const res = await handleDisconnect(d, "meta_ads");
    expect(res).toEqual({ status: 200, body: { ok: true, status: "disconnected", revoked: true, syncPurged: false } });
    expect(d.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["DELETE https://backend.composio.dev/api/v3/connected_accounts/ca_1"]);
    expect(db.rows("connectors")[0]).toMatchObject({ status: "disconnected", sync_ref: { airbyte_source_id: "src_1" } });
    expect(db.rows("receipts")).toHaveLength(1);
    expect(db.rows("receipts")[0].description).toContain("deleted at Composio");
  });

  it("when the provider will not confirm, the pointer still goes and the receipt says to delete it in their dashboard", async () => {
    await upsertConnector(db, accountId, "hubspot", { status: "connected", sync_ref: providerRefPatch({ provider: "nango", connectionId: "nc_9", integration: "hubspot-prod" }) });
    const d = live(NANGO_ENV);
    d.routes.push(() => json({ error: "gone" }, 500));
    const res = await handleDisconnect(d, "hubspot");
    expect(res.body).toMatchObject({ ok: true, revoked: false });
    expect(db.rows("connectors")[0]).toMatchObject({ status: "disconnected", sync_ref: {} });
    expect(db.rows("receipts").map((r) => String(r.description))).toEqual([expect.stringContaining("Nango pointer removed here"), expect.stringContaining("Couldn’t revoke")]);
  });

  it("/state: oauthConfigured is true and authProvider names the provider only for platforms the provider path covers", async () => {
    const d = live(COMPOSIO_ENV);
    const res = await handleConnectorsState(d);
    if (res.status !== 200 || !("connectors" in res.body)) throw new Error("state failed");
    const by = Object.fromEntries(res.body.connectors.map((c) => [c.platform, c]));
    expect(by.meta_ads).toMatchObject({ oauthConfigured: true, authProvider: "composio" });
    expect(by.shopify).toMatchObject({ oauthConfigured: true, authProvider: "composio" });
    expect(by.klaviyo).toMatchObject({ oauthConfigured: false });
    expect(by.klaviyo.authProvider).toBeUndefined();
    expect(res.body.google.configured).toBe(false);
    const own = await handleConnectorsState(live(FAKE_ENV));
    if (own.status !== 200 || !("connectors" in own.body)) throw new Error("state failed");
    expect(own.body.connectors.find((c) => c.platform === "meta_ads")).toMatchObject({ oauthConfigured: true });
    expect(own.body.connectors.find((c) => c.platform === "meta_ads")?.authProvider).toBeUndefined();
  });
});
