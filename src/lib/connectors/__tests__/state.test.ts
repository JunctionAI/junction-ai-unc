/* GET /api/connectors/state — the grid's real rows: role, per-card status + first-read
   result, whether the OAuth app is configured, whether a token path exists. */

import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { handleConnectorsState } from "../state";
import { config, deps as makeDeps, FAKE_ENV, seededDb } from "./helpers";

let db: FakeSupabase;
let accountId: string;
let userId: string;
beforeEach(() => {
  ({ db, accountId, userId } = seededDb());
});

describe("handleConnectorsState", () => {
  it("gates: no DB → fallback; no session → 401; no account → 403", async () => {
    expect(await handleConnectorsState(makeDeps({ config: config({ dbConfigured: false }) }))).toEqual({ status: 200, body: { fallback: true, reason: "accounts_not_configured" } });
    expect((await handleConnectorsState(makeDeps({ db, userId: null }))).status).toBe(401);
    expect((await handleConnectorsState(makeDeps({ db, userId: "stranger" }))).status).toBe(403);
  });

  it("lists all 16 cards with real rows, the owner's role, oauthConfigured from the env and the token path", async () => {
    db.insertRow("connectors", { account_id: accountId, platform: "shopify", status: "connected", external_ref: "acme.myshopify.com", last_sync_at: "2026-09-02T09:00:00.000Z", last_sync_result: "ok", last_read_metrics: 4, sync_ref: {} });
    db.insertRow("connectors", { account_id: accountId, platform: "klaviyo", status: "connected", external_ref: null, sync_ref: {} });
    db.insertRow("connectors", { account_id: accountId, platform: "meta_ads", status: "needs_reconnect", external_ref: "act_1", last_sync_result: "error:token_expired", sync_ref: {} });
    const res = await handleConnectorsState(makeDeps({ db, userId, config: config({ env: { ...FAKE_ENV, HUBSPOT_CLIENT_ID: "", HUBSPOT_CLIENT_SECRET: "" } }) }));
    expect(res.status).toBe(200);
    const body = res.body as { role: string; connectors: { platform: string; name: string; status: string; lastSyncResult: string | null; lastReadMetrics: number | null; oauthConfigured: boolean; tokenPath: boolean }[] };
    expect(body.role).toBe("owner");
    expect(body.connectors).toHaveLength(16);
    expect(body.connectors.find((c) => c.platform === "shopify")).toMatchObject({ name: "Shopify", status: "connected", lastSyncResult: "ok", lastReadMetrics: 4, oauthConfigured: true, tokenPath: true });
    expect(body.connectors.find((c) => c.platform === "klaviyo")).toMatchObject({ status: "connected", lastSyncResult: null, lastReadMetrics: null });
    expect(body.connectors.find((c) => c.platform === "meta_ads")).toMatchObject({ status: "needs_reconnect", lastSyncResult: "error:token_expired" });
    // HubSpot: OAuth app not configured, token path still there for the owner
    expect(body.connectors.find((c) => c.platform === "hubspot")).toMatchObject({ status: "disconnected", oauthConfigured: false, tokenPath: true });
    expect(body.connectors.find((c) => c.platform === "slack")).toMatchObject({ status: "disconnected", oauthConfigured: false, tokenPath: false });
    expect(JSON.stringify(body)).not.toContain("ciphertext");
  });

  it("a member (not owner) is told so", async () => {
    db.insertRow("account_members", { account_id: accountId, user_id: "m2", role: "member" });
    const res = await handleConnectorsState(makeDeps({ db, userId: "m2" }));
    expect((res.body as { role: string }).role).toBe("member");
  });

  it("exposes only redacted recovery for the current account generation and grant", async () => {
    const c = db.insertRow("connectors", { account_id: accountId, platform: "ga4", status: "connected", sync_ref: {} });
    db.insertRow("connector_secrets", { connector_id: c.id, ciphertext: "synthetic-cipher", iv: "iv", tag: "tag", key_version: 1 });
    const binding = db.rpcs.native_oauth_binding({ connector: c.id }) as { secretDigest: string };
    db.insertRow("connector_refresh_attempts", { connector_id: c.id, context_generation: 0, secret_digest: binding.secretDigest, holder: "synthetic-holder", status: "pending", attempts: 1 });
    const result = await handleConnectorsState(makeDeps({ db, userId }));
    expect(JSON.stringify(result.body)).toContain('"status":"uncertain"');
    for (const secret of ["synthetic-cipher", "synthetic-holder", binding.secretDigest, "secret_digest", "ciphertext"]) expect(JSON.stringify(result.body)).not.toContain(secret);
    db.rows("accounts")[0].context_generation = 1;
    expect(JSON.stringify((await handleConnectorsState(makeDeps({ db, userId }))).body)).not.toContain("authRecovery");
    db.rows("accounts")[0].context_generation = 0;
    db.rows("connector_secrets")[0].ciphertext = "new-login";
    expect(JSON.stringify((await handleConnectorsState(makeDeps({ db, userId }))).body)).not.toContain("authRecovery");
  });

  it("fails closed when membership disappears during the health read", async () => {
    db.rpcs.connector_recovery_state = () => null;
    expect((await handleConnectorsState(makeDeps({ db, userId }))).status).toBe(403);
  });
});
