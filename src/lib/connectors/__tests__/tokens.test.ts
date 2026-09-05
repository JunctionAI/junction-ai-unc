import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { keyringFromKeys, open, seal } from "../crypto";
import type { TokenBundle } from "../oauth";
import { putSecret, upsertConnector } from "../store";
import { ConnectorCredentialProvider, getAccessToken, type TokenDeps } from "../tokens";
import { assertNoLeak, FAKE_ENV, json, KEYRING, NOW, seededDb, stubFetch, TEST_KEY } from "./helpers";

let db: FakeSupabase;
let accountId: string;
beforeEach(() => {
  ({ db, accountId } = seededDb());
});

function tokenDeps(over: Partial<TokenDeps> = {}): TokenDeps & { logs: string[]; calls: ReturnType<typeof stubFetch>["calls"]; routes: ReturnType<typeof stubFetch>["routes"] } {
  const f = stubFetch();
  const logs: string[] = [];
  return { db, keyring: KEYRING, env: FAKE_ENV, fetch: f.fetch, now: () => NOW, log: (l) => logs.push(l), ...over, logs, calls: f.calls, routes: f.routes };
}

async function connected(platform: string, bundle: TokenBundle, externalRef: string | null = null, keyring = KEYRING) {
  const id = await upsertConnector(db, accountId, platform, { status: "connected", external_ref: externalRef });
  await putSecret(db, id, seal(JSON.stringify(bundle), keyring, id), NOW.toISOString());
  return id;
}

const inAnHour = new Date(NOW.getTime() + 3600_000).toISOString();
const inTwoMinutes = new Date(NOW.getTime() + 120_000).toISOString();

describe("getAccessToken", () => {
  it("returns the live token when it is not near expiry, without touching the network", async () => {
    const id = await connected("shopify", { accessToken: "shpat_FIXTURE", obtainedAt: NOW.toISOString() }, "acme.myshopify.com");
    const d = tokenDeps();
    expect(await getAccessToken(id, d)).toEqual({ accessToken: "shpat_FIXTURE", platform: "shopify", externalRef: "acme.myshopify.com", expiresAt: null });
    expect(d.calls).toHaveLength(0);
    expect(await getAccessToken("00000000-0000-4000-8000-ffffffffffff", d)).toBeNull();
  });

  it("refreshes a Google token inside the skew window, re-seals it and keeps the refresh token", async () => {
    const id = await connected("ga4", { accessToken: "old-FIXTURE", refreshToken: "rt-FIXTURE", expiresAt: inTwoMinutes, obtainedAt: NOW.toISOString() }, "properties/123");
    const d = tokenDeps();
    d.routes.push((c) => (c.url === "https://oauth2.googleapis.com/token" ? json({ access_token: "new-FIXTURE", expires_in: 3600 }) : undefined));
    const tok = await getAccessToken(id, d);
    expect(tok).toMatchObject({ accessToken: "new-FIXTURE", platform: "ga4", externalRef: "properties/123", expiresAt: inAnHour, refreshToken: "rt-FIXTURE" });
    const form = new URLSearchParams(d.calls[0].body!);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt-FIXTURE");
    expect(form.get("client_id")).toBe(FAKE_ENV.GOOGLE_CLIENT_ID);
    const secret = db.rows("connector_secrets")[0];
    expect(JSON.parse(open({ ciphertext: secret.ciphertext as string, iv: secret.iv as string, tag: secret.tag as string, keyVersion: 1 }, KEYRING, id))).toMatchObject({ accessToken: "new-FIXTURE", refreshToken: "rt-FIXTURE" });
    expect(db.rows("connectors")[0].status).toBe("connected");
    assertNoLeak(d.logs, ["old-FIXTURE", "new-FIXTURE", "rt-FIXTURE"]);
  });

  it("Klaviyo refresh uses Basic auth", async () => {
    const id = await connected("klaviyo", { accessToken: "a", refreshToken: "r", expiresAt: inTwoMinutes, obtainedAt: NOW.toISOString() });
    const d = tokenDeps();
    d.routes.push((c) => (c.url === "https://a.klaviyo.com/oauth/token" ? json({ access_token: "b", refresh_token: "r2", expires_in: 100 }) : undefined));
    expect((await getAccessToken(id, d))!.accessToken).toBe("b");
    expect(d.calls[0].headers.authorization).toBe(`Basic ${Buffer.from("klaviyo-client-id:klaviyo-client-secret").toString("base64")}`);
    expect(new URLSearchParams(d.calls[0].body!).get("client_secret")).toBeNull();
  });

  it("a failed refresh flips the row to needs_reconnect with a provenance code and returns null", async () => {
    const id = await connected("ga4", { accessToken: "a", refreshToken: "r", expiresAt: inTwoMinutes, obtainedAt: NOW.toISOString() });
    const d = tokenDeps();
    d.routes.push(() => json({ error: "invalid_grant" }, 400));
    expect(await getAccessToken(id, d)).toBeNull();
    expect(db.rows("connectors")[0]).toMatchObject({ status: "needs_reconnect", last_sync_result: "error:token_refresh_http_400" });
  });

  it("an expired non-renewable Meta token requires reconnection", async () => {
    const id = await connected("meta_ads", { accessToken: "a", expiresAt: NOW.toISOString(), obtainedAt: NOW.toISOString() }, "act_1");
    const d = tokenDeps();
    expect(await getAccessToken(id, d)).toBeNull();
    expect(d.calls).toHaveLength(0);
    expect(db.rows("connectors")[0]).toMatchObject({ status: "needs_reconnect", last_sync_result: "error:token_expired" });
  });

  it("a bundle sealed under a key the ring no longer holds fails closed and marks the row", async () => {
    const other = keyringFromKeys({ version: 1, key: Buffer.alloc(32, 1) });
    const id = await connected("shopify", { accessToken: "x", obtainedAt: NOW.toISOString() }, "s.myshopify.com", other);
    await expect(getAccessToken(id, tokenDeps())).rejects.toMatchObject({ code: "configuration_error" });
    expect(db.rows("connectors")[0]).toMatchObject({ status: "connected", last_sync_result: "error:auth_configuration_error" });
  });

  it("re-seals under the current key after a rotation (old version opened, new version written)", async () => {
    const id = await connected("shopify", { accessToken: "x", obtainedAt: NOW.toISOString() }, "s.myshopify.com");
    const rotated = keyringFromKeys({ version: 2, key: Buffer.alloc(32, 99) }, { version: 1, key: TEST_KEY });
    expect((await getAccessToken(id, tokenDeps({ keyring: rotated })))!.accessToken).toBe("x");
    expect(db.rows("connector_secrets")[0].key_version).toBe(2);
    expect(await getAccessToken(id, tokenDeps({ keyring: keyringFromKeys({ version: 2, key: Buffer.alloc(32, 99) }) }))).toMatchObject({ accessToken: "x" });
  });

  it("rows that are not connected, or have no secret, yield null", async () => {
    const id = await upsertConnector(db, accountId, "shopify", { status: "needs_reconnect" });
    expect(await getAccessToken(id, tokenDeps())).toBeNull();
    const id2 = await upsertConnector(db, accountId, "klaviyo", { status: "connected" });
    expect(await getAccessToken(id2, tokenDeps())).toBeNull();
    expect(db.rows("connectors").find((r) => r.id === id2)).toMatchObject({ status: "needs_reconnect", last_sync_result: "error:no_secret" });
  });
});

describe("connection recovery", () => {
  it("does not refresh when another process owns the database lease", async () => {
    const id = await connected("ga4", { accessToken: "old", refreshToken: "r", expiresAt: inTwoMinutes, obtainedAt: NOW.toISOString() });
    db.rpcs.claim_backend_lease = () => false;
    const d = tokenDeps({ env: { ...FAKE_ENV, CONNECTOR_REFRESH_LEASES_ENABLED: "true" } });
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(d.calls).toHaveLength(0);
    expect(db.rows("connectors")[0].status).toBe("connected");
  });

  it("rejects a refreshed token if its lease or previous ciphertext no longer matches", async () => {
    const id = await connected("ga4", { accessToken: "old", refreshToken: "r", expiresAt: inTwoMinutes, obtainedAt: NOW.toISOString() });
    const ciphertext = db.rows("connector_secrets")[0].ciphertext;
    db.rpcs.settle_connector_token = () => null;
    const d = tokenDeps({ env: { ...FAKE_ENV, CONNECTOR_REFRESH_LEASES_ENABLED: "true" } });
    d.routes.push(() => json({ access_token: "new", expires_in: 3600 }));
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "context_changed" });
    expect(db.rows("connector_secrets")[0].ciphertext).toBe(ciphertext);
    expect(db.callsFor("backend_leases", "delete")).toHaveLength(0);
  });

  it("uses a non-renewable token until its actual expiry", async () => {
    const id = await connected("meta_ads", { accessToken: "valid", expiresAt: inTwoMinutes, obtainedAt: NOW.toISOString() }, "act_1");
    expect(await getAccessToken(id, tokenDeps())).toMatchObject({ accessToken: "valid" });
    expect(db.rows("connectors")[0].status).toBe("connected");
  });

  it.each([429, 500, 503])("recovers after HTTP %s without a second customer login", async (status) => {
    const id = await connected("ga4", { accessToken: "old", refreshToken: "refresh", expiresAt: inTwoMinutes, obtainedAt: NOW.toISOString() });
    const d = tokenDeps();
    d.routes.push(() => json({ error: "server_error", error_description: "must-not-leak" }, status));
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(db.rows("connectors")[0]).toMatchObject({ status: "connected", last_sync_result: "error:auth_temporarily_unavailable" });
    d.routes.splice(0, d.routes.length, () => json({ access_token: "new", expires_in: 3600 }));
    const retryNow = new Date(NOW.getTime() + 31_000);
    db.now = () => retryNow.toISOString(); d.now = () => retryNow;
    expect(await getAccessToken(id, d)).toMatchObject({ accessToken: "new" });
    expect(db.rows("connectors")[0].last_sync_result).toBeNull();
    expect(d.logs.join(" ")).not.toContain("must-not-leak");
  });

  it("does not treat application credentials or an unknown 400 as revoked customer consent", async () => {
    const id = await connected("ga4", { accessToken: "old", refreshToken: "refresh", expiresAt: inTwoMinutes, obtainedAt: NOW.toISOString() });
    const d = tokenDeps();
    d.routes.push(() => json({ error: "invalid_client" }, 401));
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "configuration_error" });
    const retryNow = new Date(NOW.getTime() + 31_000);
    db.now = () => retryNow.toISOString(); d.now = () => retryNow;
    d.routes.splice(0, d.routes.length, () => json({ error: "provider-specific-error" }, 400));
    await expect(getAccessToken(id, d)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(db.rows("connectors")[0].status).toBe("connected");
  });

  it("coalesces concurrent refreshes sharing a database client", async () => {
    const id = await connected("ga4", { accessToken: "old", refreshToken: "refresh", expiresAt: inTwoMinutes, obtainedAt: NOW.toISOString() });
    const d = tokenDeps();
    d.routes.push(() => json({ access_token: "new", refresh_token: "rotated", expires_in: 3600 }));
    const results = await Promise.all(Array.from({ length: 8 }, () => getAccessToken(id, d)));
    expect(results.every(r => r?.accessToken === "new")).toBe(true);
    expect(d.calls).toHaveLength(1);
  });
});

describe("ConnectorCredentialProvider (worker CredentialProvider shape)", () => {
  it("maps each launch platform to the worker's PlatformCredential union", async () => {
    await connected("shopify", { accessToken: "sh", obtainedAt: NOW.toISOString() }, "acme.myshopify.com");
    await connected("klaviyo", { accessToken: "kl", expiresAt: inAnHour, obtainedAt: NOW.toISOString() }, "ACC");
    await connected("ga4", { accessToken: "ga", refreshToken: "r", expiresAt: inAnHour, obtainedAt: NOW.toISOString() }, "properties/9");
    await connected("meta_ads", { accessToken: "me", expiresAt: inAnHour, obtainedAt: NOW.toISOString() }, "act_7");
    await connected("google_ads", { accessToken: "ad", refreshToken: "r", expiresAt: inAnHour, obtainedAt: NOW.toISOString() }, "1234567890");
    const p = new ConnectorCredentialProvider(tokenDeps({ env: { ...FAKE_ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "111" } }));
    expect(await p.get(accountId, "shopify")).toEqual({ kind: "shopify", shopDomain: "acme.myshopify.com", accessToken: "sh" });
    expect(await p.get(accountId, "klaviyo")).toEqual({ kind: "klaviyo", apiKey: "kl" });
    expect(await p.get(accountId, "ga4")).toEqual({ kind: "ga4", propertyId: "properties/9", accessToken: "ga" });
    expect(await p.get(accountId, "meta_ads")).toEqual({ kind: "meta_ads", adAccountId: "act_7", accessToken: "me" });
    expect(await p.get(accountId, "google_ads")).toEqual({ kind: "google_ads", customerId: "1234567890", developerToken: "dev-token-fixture", accessToken: "ad", loginCustomerId: "111" });
    expect(await p.get(accountId, "slack")).toBeNull();
    expect(await p.get("other-account", "shopify")).toBeNull();
  });

  it("a token without its external_ref (GA4 property not chosen yet) is not a usable credential", async () => {
    await connected("ga4", { accessToken: "ga", refreshToken: "r", expiresAt: inAnHour, obtainedAt: NOW.toISOString() }, null);
    await connected("google_ads", { accessToken: "ad", expiresAt: inAnHour, obtainedAt: NOW.toISOString() }, "123");
    const p = new ConnectorCredentialProvider(tokenDeps({ env: { ...FAKE_ENV, GOOGLE_ADS_DEVELOPER_TOKEN: "" } }));
    expect(await p.get(accountId, "ga4")).toBeNull();
    expect(await p.get(accountId, "google_ads")).toBeNull(); // no developer token
  });
});
