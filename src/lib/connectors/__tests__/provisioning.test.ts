import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { AIRBYTE_API_BASE, airbyteConfigFromEnv, AirbyteProvisioner, getProvisioner, NoopProvisioner, provisionConnector, recordSyncResult, tenantSchema, type AirbyteConfig, type SyncProvisioner } from "../provisioning";
import { getConnectorById, updateConnector, upsertConnector, type ConnectorRow } from "../store";
import type { AccessToken } from "../tokens";
import { assertNoLeak, FAKE_ENV, json, NOW, seededDb, stubFetch } from "./helpers";

let db: FakeSupabase;
let accountId: string;
beforeEach(() => {
  ({ db, accountId } = seededDb());
});

const CFG: AirbyteConfig = {
  apiKey: "airbyte-key-FIXTURE",
  workspaceId: "ws-1",
  warehouse: { host: "db.example.internal", port: 6543, database: "unc", username: "airbyte", password: "pg-password-FIXTURE", sslMode: "require" },
  startDate: "2025-09-01",
  googleAdsDeveloperToken: "dev-token-FIXTURE",
  clientCredentials: { google: { clientId: "google-client-id", clientSecret: "google-client-secret" }, shopify: { clientId: "shopify-client-id", clientSecret: "shopify-client-secret" } },
};

function prov(cfg: AirbyteConfig = CFG) {
  const f = stubFetch();
  const logs: string[] = [];
  const p = new AirbyteProvisioner(cfg, { db, fetch: f.fetch, now: () => NOW, log: (l) => logs.push(l) });
  return { p, calls: f.calls, routes: f.routes, logs, deps: { db, fetch: f.fetch, now: () => NOW, log: (l: string) => logs.push(l) } };
}

async function row(platform: string, externalRef: string | null): Promise<ConnectorRow> {
  const id = await upsertConnector(db, accountId, platform, { status: "connected", external_ref: externalRef });
  return (await getConnectorById(db, id))!;
}

const tok = (accessToken: string, refreshToken?: string): AccessToken => ({ accessToken, platform: "shopify", externalRef: null, expiresAt: null, ...(refreshToken ? { refreshToken } : {}) });

const body = (c: { body: string | null }) => JSON.parse(c.body!) as Record<string, unknown>;

describe("tenant schema", () => {
  it("is t_<accountId> with hyphens as underscores", () => {
    expect(tenantSchema("00000000-0000-4000-8000-000000000001")).toBe("t_00000000_0000_4000_8000_000000000001");
    expect(tenantSchema("Abc-1")).toBe("t_abc_1");
  });
});

describe("AirbyteProvisioner request shaping", () => {
  it("ensureSource POSTs a Shopify source with the OAuth token and remembers the source id on sync_ref", async () => {
    const { p, calls, routes, logs } = prov();
    routes.push((c) => (c.url === `${AIRBYTE_API_BASE}/sources` && c.method === "POST" ? json({ sourceId: "src-1" }) : undefined));
    const r = await row("shopify", "acme.myshopify.com");
    expect(await p.ensureSource(r, tok("shpat_FIXTURE"))).toBe("src-1");
    expect(calls[0].headers.authorization).toBe("Bearer airbyte-key-FIXTURE");
    expect(calls[0].headers["content-type"]).toBe("application/json");
    const b = body(calls[0]);
    expect(b.workspaceId).toBe("ws-1");
    expect(b.name).toBe(`unc-shopify-${accountId}`);
    expect(b.configuration).toEqual({ sourceType: "shopify", shop: "acme", start_date: "2025-09-01", credentials: { auth_method: "oauth2.0", client_id: "shopify-client-id", client_secret: "shopify-client-secret", access_token: "shpat_FIXTURE" } });
    expect((await getConnectorById(db, r.id))!.sync_ref).toEqual({ sourceId: "src-1" });
    // the log records endpoint + names only
    expect(logs).toEqual(["airbyte POST /sources"]);
    assertNoLeak(logs, ["shpat_FIXTURE", "airbyte-key-FIXTURE", "shopify-client-secret"]);
  });

  it("ensureSource on a known source PATCHes the configuration (token rotation) instead of creating", async () => {
    const { p, calls, routes } = prov();
    routes.push((c) => (c.url === `${AIRBYTE_API_BASE}/sources/src-9` && c.method === "PATCH" ? json({ sourceId: "src-9" }) : undefined));
    const id = await upsertConnector(db, accountId, "klaviyo", { status: "connected", sync_ref: { sourceId: "src-9" } });
    const r = (await getConnectorById(db, id))!;
    expect(await p.ensureSource(r, tok("kl-FIXTURE"))).toBe("src-9");
    expect(calls).toHaveLength(1);
    expect(body(calls[0]).configuration).toEqual({ sourceType: "klaviyo", api_key: "kl-FIXTURE", start_date: "2025-09-01T00:00:00Z" });
  });

  it("shapes the Meta, GA4 and Google Ads source definitions from external_ref + tokens", async () => {
    const { p, calls, routes } = prov();
    routes.push((c) => (c.url.endsWith("/sources") ? json({ sourceId: `src-${calls.length}` }) : undefined));
    await p.ensureSource(await row("meta_ads", "act_123"), tok("meta-FIXTURE"));
    await p.ensureSource(await row("ga4", "properties/456"), tok("ga-FIXTURE", "ga-refresh-FIXTURE"));
    await p.ensureSource(await row("google_ads", "123-456-7890"), tok("ads-FIXTURE", "ads-refresh-FIXTURE"));
    expect(body(calls[0]).configuration).toEqual({ sourceType: "facebook-marketing", account_ids: ["123"], access_token: "meta-FIXTURE", start_date: "2025-09-01T00:00:00Z", include_deleted: false });
    expect(body(calls[1]).configuration).toEqual({
      sourceType: "google-analytics-data-api",
      property_ids: ["properties/456"],
      date_ranges_start_date: "2025-09-01",
      credentials: { auth_type: "Client", client_id: "google-client-id", client_secret: "google-client-secret", refresh_token: "ga-refresh-FIXTURE", access_token: "ga-FIXTURE" },
    });
    expect(body(calls[2]).configuration).toEqual({
      sourceType: "google-ads",
      customer_id: "1234567890",
      start_date: "2025-09-01",
      credentials: { developer_token: "dev-token-FIXTURE", client_id: "google-client-id", client_secret: "google-client-secret", refresh_token: "ads-refresh-FIXTURE", access_token: "ads-FIXTURE" },
    });
  });

  it("ensureDestination reuses AIRBYTE_DESTINATION_ID, else finds/creates a postgres destination in the tenant schema", async () => {
    const shared = prov({ ...CFG, destinationId: "dest-shared" });
    expect(await shared.p.ensureDestination(accountId)).toBe("dest-shared");
    expect(shared.calls).toHaveLength(0);

    const { p, calls, routes } = prov();
    routes.push((c) => (c.url.startsWith(`${AIRBYTE_API_BASE}/destinations?`) ? json({ data: [{ destinationId: "dest-other", name: "unc-warehouse-someone-else" }] }) : undefined));
    routes.push((c) => (c.url === `${AIRBYTE_API_BASE}/destinations` && c.method === "POST" ? json({ destinationId: "dest-new" }) : undefined));
    expect(await p.ensureDestination(accountId)).toBe("dest-new");
    expect(calls[0].url).toBe(`${AIRBYTE_API_BASE}/destinations?workspaceIds=ws-1&limit=100`);
    const b = body(calls[1]);
    expect(b.name).toBe(`unc-warehouse-${accountId}`);
    expect(b.configuration).toEqual({ destinationType: "postgres", host: "db.example.internal", port: 6543, database: "unc", schema: tenantSchema(accountId), username: "airbyte", password: "pg-password-FIXTURE", ssl_mode: { mode: "require" } });

    const found = prov();
    found.routes.push((c) => (c.url.startsWith(`${AIRBYTE_API_BASE}/destinations?`) ? json({ data: [{ destinationId: "dest-mine", name: `unc-warehouse-${accountId}` }] }) : undefined));
    expect(await found.p.ensureDestination(accountId)).toBe("dest-mine");
    expect(found.calls).toHaveLength(1);

    await expect(prov({ ...CFG, warehouse: undefined }).p.ensureDestination(accountId)).rejects.toThrow(/not_configured/);
  });

  it("ensureConnection writes into t_<accountId> with a platform prefix and a cron, and is idempotent via sync_ref", async () => {
    const { p, calls, routes } = prov();
    routes.push((c) => (c.url === `${AIRBYTE_API_BASE}/connections` ? json({ connectionId: "conn-1" }) : undefined));
    const r = await row("shopify", "acme.myshopify.com");
    expect(await p.ensureConnection(r, "src-1", "dest-1")).toBe("conn-1");
    const b = body(calls[0]);
    expect(b).toMatchObject({ name: `unc-shopify-${accountId}`, sourceId: "src-1", destinationId: "dest-1", namespaceDefinition: "custom_format", namespaceFormat: tenantSchema(accountId), prefix: "shopify_", status: "active" });
    expect(b.schedule).toEqual({ scheduleType: "cron", cronExpression: "0 0 2 * * ?" });
    expect((await getConnectorById(db, r.id))!.sync_ref).toEqual({ connectionId: "conn-1", destinationId: "dest-1" });
    // second call: no request
    expect(await p.ensureConnection((await getConnectorById(db, r.id))!, "src-1", "dest-1")).toBe("conn-1");
    expect(calls).toHaveLength(1);
  });

  it("triggerSync + getStatus map Airbyte job states to the provenance vocabulary", async () => {
    const { p, calls, routes } = prov();
    routes.push((c) => (c.url === `${AIRBYTE_API_BASE}/jobs` && c.method === "POST" ? json({ jobId: 42, status: "pending" }) : undefined));
    let status = "succeeded";
    let rows = 120;
    routes.push((c) => (c.url.startsWith(`${AIRBYTE_API_BASE}/jobs?`) ? json({ data: status === "none" ? [] : [{ jobId: 42, status, rowsSynced: rows, lastUpdatedAt: "2026-09-02T02:10:00Z" }] }) : undefined));
    expect(await p.triggerSync("conn-1")).toEqual({ jobId: "42" });
    expect(body(calls[0])).toEqual({ connectionId: "conn-1", jobType: "sync" });

    expect(await p.getStatus("conn-1")).toEqual({ state: "ok", result: "ok", jobId: "42", at: "2026-09-02T02:10:00Z" });
    expect(calls[1].url).toBe(`${AIRBYTE_API_BASE}/jobs?connectionId=conn-1&jobType=sync&limit=1&orderBy=createdAt%7CDESC`);
    rows = 0;
    expect((await p.getStatus("conn-1")).result).toBe("empty");
    status = "running";
    expect(await p.getStatus("conn-1")).toMatchObject({ state: "running", result: null });
    status = "failed";
    expect((await p.getStatus("conn-1")).result).toBe("error:sync_failed");
    status = "cancelled";
    expect((await p.getStatus("conn-1")).result).toBe("error:sync_cancelled");
    status = "none";
    expect(await p.getStatus("conn-1")).toEqual({ state: "error", result: "error:no_sync_yet" });
  });

  it("non-2xx / network failures surface as AirbyteApiError codes, never bodies", async () => {
    const { p, routes } = prov();
    routes.push(() => json({ message: "boom", token: "should-not-appear" }, 500));
    await expect(p.triggerSync("c")).rejects.toThrow(/http_500/);
    routes.length = 0;
    routes.push(() => {
      throw new TypeError("fetch failed");
    });
    await expect(p.triggerSync("c")).rejects.toThrow(/network/);
  });
});

describe("provisionConnector end-to-end + ledger", () => {
  it("source → destination → connection → sync, on the fake API", async () => {
    const { p, calls, routes, deps } = prov({ ...CFG, destinationId: "dest-shared" });
    routes.push((c) => (c.url.endsWith("/sources") ? json({ sourceId: "s" }) : c.url.endsWith("/connections") ? json({ connectionId: "c" }) : c.url.endsWith("/jobs") ? json({ jobId: 7 }) : undefined));
    const r = await row("shopify", "acme.myshopify.com");
    expect(await provisionConnector(r.id, tok("t"), p, deps)).toEqual({ connectionId: "c", jobId: "7" });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v1/sources", "POST /v1/connections", "POST /v1/jobs"]);
    expect((await getConnectorById(db, r.id))!.sync_ref).toEqual({ sourceId: "s", connectionId: "c", destinationId: "dest-shared" });
  });

  it("a provisioning failure is ledgered as error:airbyte_<code> (couldn't ask), not as empty", async () => {
    const { p, routes, deps } = prov({ ...CFG, destinationId: "dest-shared" });
    routes.push(() => json({}, 401));
    const r = await row("shopify", "acme.myshopify.com");
    expect(await provisionConnector(r.id, tok("t"), p, deps)).toBeNull();
    expect((await getConnectorById(db, r.id))!).toMatchObject({ status: "connected", last_sync_result: "error:airbyte_http_401", last_sync_at: NOW.toISOString() });
  });

  it("recordSyncResult writes the vocabulary; error:auth* also flips the card to Reconnect", async () => {
    const r = await row("klaviyo", null);
    await recordSyncResult(db, r.id, "ok", NOW);
    expect((await getConnectorById(db, r.id))!).toMatchObject({ status: "connected", last_sync_result: "ok", last_sync_at: NOW.toISOString() });
    await recordSyncResult(db, r.id, "empty", NOW);
    expect((await getConnectorById(db, r.id))!.last_sync_result).toBe("empty");
    await recordSyncResult(db, r.id, "error:network", NOW);
    expect((await getConnectorById(db, r.id))!).toMatchObject({ status: "connected", last_sync_result: "error:network" });
    await recordSyncResult(db, r.id, "error:auth_401", NOW);
    expect((await getConnectorById(db, r.id))!).toMatchObject({ status: "needs_reconnect", last_sync_result: "error:auth_401" });
  });
});

describe("env gate", () => {
  it("Noop when AIRBYTE_* is missing; Airbyte when both are present", async () => {
    const f = stubFetch();
    const d = { db, fetch: f.fetch, now: () => NOW };
    expect(getProvisioner(d, {}).kind).toBe("noop");
    expect(getProvisioner(d, { AIRBYTE_API_KEY: "k" }).kind).toBe("noop");
    expect(getProvisioner(d, { AIRBYTE_API_KEY: "k", AIRBYTE_WORKSPACE_ID: "w" }).kind).toBe("airbyte");
    expect(await new NoopProvisioner().getStatus()).toEqual({ state: "error", result: "error:sync_not_configured" });
    expect(f.calls).toHaveLength(0);
  });

  it("reads the warehouse + app credentials from env", () => {
    const cfg = airbyteConfigFromEnv({ ...FAKE_ENV, AIRBYTE_API_KEY: "k", AIRBYTE_WORKSPACE_ID: "w", AIRBYTE_DESTINATION_ID: "d", WAREHOUSE_PG_HOST: "h", WAREHOUSE_PG_PORT: "6543", WAREHOUSE_PG_USER: "u", WAREHOUSE_PG_PASSWORD: "p", AIRBYTE_SYNC_CRON: "0 0 3 * * ?" })!;
    expect(cfg).toMatchObject({ apiKey: "k", workspaceId: "w", destinationId: "d", cron: "0 0 3 * * ?", googleAdsDeveloperToken: "dev-token-fixture" });
    expect(cfg.warehouse).toEqual({ host: "h", port: 6543, database: "postgres", username: "u", password: "p", sslMode: "require" });
    expect(cfg.clientCredentials?.google).toEqual({ clientId: "google-client-id", clientSecret: "google-client-secret" });
    expect(airbyteConfigFromEnv({ AIRBYTE_API_KEY: "k", AIRBYTE_WORKSPACE_ID: "w" })!.warehouse).toBeUndefined();
  });
});

describe("purgeTenant", () => {
  it("Airbyte: DELETEs the connection then the source, forgets the handles on sync_ref; 404s count as gone", async () => {
    const { p, calls, routes, logs } = prov();
    const r = await row("klaviyo", "acct-1");
    await updateConnector(db, r.id, { sync_ref: { sourceId: "src-9", connectionId: "conn-9", destinationId: "dst-1" } });
    routes.push((c) => (c.method === "DELETE" && c.url === `${AIRBYTE_API_BASE}/connections/conn-9` ? new Response(null, { status: 204 }) : undefined));
    routes.push((c) => (c.method === "DELETE" && c.url === `${AIRBYTE_API_BASE}/sources/src-9` ? new Response("gone already", { status: 404 }) : undefined));
    expect(await p.purgeTenant(accountId, "klaviyo")).toEqual({ purged: true, deleted: ["connection", "source"] });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["DELETE", `${AIRBYTE_API_BASE}/connections/conn-9`],
      ["DELETE", `${AIRBYTE_API_BASE}/sources/src-9`],
    ]);
    expect(calls[0].headers.authorization).toBe("Bearer airbyte-key-FIXTURE");
    expect((await getConnectorById(db, r.id))!.sync_ref).toEqual({ sourceId: null, connectionId: null, destinationId: "dst-1" });
    expect(logs).toEqual(["airbyte DELETE /connections/conn-9", "airbyte DELETE /sources/src-9"]);
    // idempotent: nothing left to delete
    expect(await p.purgeTenant(accountId, "klaviyo")).toEqual({ purged: true, deleted: [], reason: "nothing_provisioned" });
    expect(calls).toHaveLength(2);
  });

  it("a failing delete stops there, keeps the remaining handle, and reports the code; unknown connector reads as no_connector", async () => {
    const { p, routes } = prov();
    const r = await row("shopify", "acme.myshopify.com");
    await updateConnector(db, r.id, { sync_ref: { sourceId: "src-1", connectionId: "conn-1" } });
    routes.push((c) => (c.url.endsWith("/connections/conn-1") ? new Response(null, { status: 204 }) : undefined));
    routes.push((c) => (c.url.endsWith("/sources/src-1") ? new Response("boom", { status: 503 }) : undefined));
    expect(await p.purgeTenant(accountId, "shopify")).toEqual({ purged: false, deleted: ["connection"], reason: "airbyte_http_503" });
    expect((await getConnectorById(db, r.id))!.sync_ref).toEqual({ sourceId: "src-1", connectionId: null });
    expect(await p.purgeTenant(accountId, "ga4")).toEqual({ purged: false, deleted: [], reason: "no_connector" });
  });

  it("Noop: never purges, says why", async () => {
    expect(await (new NoopProvisioner() as SyncProvisioner).purgeTenant(accountId, "shopify")).toEqual({ purged: false, deleted: [], reason: "sync_not_configured" });
    expect(getProvisioner({ db, fetch: stubFetch().fetch, now: () => NOW }, {}).kind).toBe("noop");
  });
});
