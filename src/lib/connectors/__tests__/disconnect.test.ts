/* POST …/disconnect: gates mirror start; the effect is revoke (best-effort) → sync purge
   (best-effort) → secret gone + row disconnected → receipts. Nothing upstream blocks the
   secret deletion. */

import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { seal } from "../crypto";
import { handleDisconnect } from "../handlers";
import type { PurgeResult, SyncProvisioner } from "../provisioning";
import { getSecret } from "../store";
import { config, deps as makeDeps, KEYRING, NOW, seededDb } from "./helpers";

let db: FakeSupabase;
let accountId: string;
let userId: string;
let connectorId: string;

beforeEach(() => {
  ({ db, accountId, userId } = seededDb());
  connectorId = db.insertRow("connectors", { account_id: accountId, platform: "klaviyo", status: "connected", external_ref: "klv-acct-1", sync_ref: {} }).id as string;
  const sealed = seal(JSON.stringify({ accessToken: "klaviyo-token", refreshToken: "klaviyo-refresh", obtainedAt: NOW.toISOString() }), KEYRING, connectorId);
  db.insertRow("connector_secrets", { connector_id: connectorId, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, key_version: sealed.keyVersion });
});

const live = (over: Parameters<typeof makeDeps>[0] = {}) => makeDeps({ db, userId, ...over });

/** A provisioner that records purge calls and answers what the test says. */
function recordingProvisioner(answer: PurgeResult | Error = { purged: true, deleted: ["connection", "source"] }): SyncProvisioner & { purges: [string, string][] } {
  const purges: [string, string][] = [];
  return {
    kind: "airbyte",
    purges,
    ensureSource: async () => "x",
    ensureDestination: async () => "x",
    ensureConnection: async () => "x",
    triggerSync: async () => ({ jobId: "x" }),
    getStatus: async () => ({ state: "ok", result: "ok" }),
    purgeTenant: async (a, p) => {
      purges.push([a, p]);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

describe("handleDisconnect", () => {
  it("gates: unknown platform 404; no DB → fallback; no session 401; no account 403; nothing connected 404", async () => {
    expect((await handleDisconnect(live(), "nope")).status).toBe(404);
    expect(await handleDisconnect(makeDeps({ config: config({ dbConfigured: false }) }), "klaviyo")).toEqual({ status: 200, body: { fallback: true, reason: "accounts_not_configured" } });
    expect((await handleDisconnect(live({ userId: null }), "klaviyo")).status).toBe(401);
    expect((await handleDisconnect(live({ userId: "stranger" }), "klaviyo")).status).toBe(403);
    expect((await handleDisconnect(live(), "shopify")).status).toBe(404);
    // nothing changed by any of those
    expect(db.rows("connectors")[0].status).toBe("connected");
    expect(await getSecret(db, connectorId)).not.toBeNull();
    expect(db.rows("receipts")).toHaveLength(0);
  });

  it("revokes on Klaviyo's side (Basic auth, refresh token), purges the sync, deletes the secret, marks the row, receipts — no token anywhere", async () => {
    const provisioner = recordingProvisioner();
    const d = live({ provisioner });
    d.routes.push((c) => (c.url === "https://a.klaviyo.com/oauth/revoke" ? new Response("", { status: 200 }) : undefined));
    const res = await handleDisconnect(d, "klaviyo");
    expect(res).toEqual({ status: 200, body: { ok: true, status: "disconnected", revoked: true, syncPurged: true } });

    // the revoke call happened first, with the client credentials in the header and the token in the body only
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]).toMatchObject({ method: "POST", url: "https://a.klaviyo.com/oauth/revoke" });
    expect(d.calls[0].headers.authorization).toBe(`Basic ${Buffer.from("klaviyo-client-id:klaviyo-client-secret").toString("base64")}`);
    expect(new URLSearchParams(d.calls[0].body!).get("token")).toBe("klaviyo-refresh");
    expect(new URLSearchParams(d.calls[0].body!).get("token_type_hint")).toBe("refresh_token");
    expect(provisioner.purges).toEqual([[accountId, "klaviyo"]]);

    expect(await getSecret(db, connectorId)).toBeNull();
    expect(db.rows("connectors")[0]).toMatchObject({ id: connectorId, status: "disconnected", last_sync_result: null, external_ref: "klv-acct-1" });
    const receipts = db.rows("receipts");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ account_id: accountId, run_id: null, kind: "notification", platform: "klaviyo", created_at: NOW.toISOString() });
    expect(receipts[0].description).toBe("Klaviyo disconnected — access revoked on Klaviyo’s side and the token deleted from the secret store; reads on it stop now. Warehouse sync torn down (Airbyte connection + source deleted).");
    expect(receipts[0].payload).toEqual({
      connector_id: connectorId,
      platform: "klaviyo",
      previous_status: "connected",
      external_ref: "klv-acct-1",
      revoke: { ok: true, endpoint: "a.klaviyo.com/oauth/revoke" },
      sync_purge: { purged: true, deleted: ["connection", "source"] },
    });
    for (const h of [JSON.stringify(receipts), ...d.logs]) {
      expect(h).not.toContain("klaviyo-token");
      expect(h).not.toContain("klaviyo-refresh");
    }
    expect(d.logs).toEqual([`connectors.disconnect platform=klaviyo account=${accountId} revoke=ok purge=ok`]);
    // idempotent enough: a second call finds the row (disconnected, no secret) and re-receipts without error
    expect((await handleDisconnect(d, "klaviyo")).body).toMatchObject({ ok: true, revoked: false });
    expect(db.rows("receipts")).toHaveLength(3); // + main + "couldn't revoke (no_token)"
  });

  it("a failed revoke never blocks the disconnect: secret deleted, main receipt + a second receipt naming the code", async () => {
    const d = live({ provisioner: recordingProvisioner({ purged: false, deleted: [], reason: "sync_not_configured" }) });
    d.routes.push((c) => (c.url === "https://a.klaviyo.com/oauth/revoke" ? new Response("nope", { status: 500 }) : undefined));
    const res = await handleDisconnect(d, "klaviyo");
    expect(res.body).toMatchObject({ ok: true, revoked: false, syncPurged: false });
    expect(await getSecret(db, connectorId)).toBeNull();
    expect(db.rows("connectors")[0].status).toBe("disconnected");
    const receipts = db.rows("receipts");
    expect(receipts).toHaveLength(2);
    expect(receipts[0].description).toBe("Klaviyo disconnected — token deleted from the secret store; reads on it stop now. Warehouse sync isn’t switched on — nothing to tear down.");
    expect(receipts[0].payload).toMatchObject({ revoke: { ok: false, code: "http_500", endpoint: "a.klaviyo.com/oauth/revoke" }, sync_purge: { purged: false, reason: "sync_not_configured" } });
    expect(receipts[1].description).toBe("Couldn’t revoke Klaviyo’s access on their side (http_500) — the token is deleted here, but revoke the app from Klaviyo’s connected-apps page too if you want it gone there.");
    expect(d.logs).toEqual([`connectors.disconnect platform=klaviyo account=${accountId} revoke=http_500 purge=sync_not_configured`]);
  });

  it("network failure / timeout on revoke and a throwing provisioner are absorbed the same way; no provisioner reads as not configured", async () => {
    const d = live({ provisioner: recordingProvisioner(Object.assign(new Error("airbyte: http_503"), { code: "http_503" })) });
    d.routes.push(() => {
      throw new TypeError("fetch failed");
    });
    const res = await handleDisconnect(d, "klaviyo");
    expect(res.body).toMatchObject({ ok: true, revoked: false, syncPurged: false });
    expect(db.rows("receipts")[0].payload).toMatchObject({ revoke: { ok: false, code: "network" }, sync_purge: { purged: false, reason: "airbyte_http_503" } });
    expect(db.rows("receipts")[0].description).toContain("Couldn’t tear down the warehouse sync (airbyte_http_503)");
    expect(await getSecret(db, connectorId)).toBeNull();

    // no secret store → no revoke attempt (not_configured), still disconnects
    const { db: db2, accountId: a2, userId: u2 } = seededDb();
    db2.insertRow("connectors", { account_id: a2, platform: "meta_ads", status: "connected", external_ref: "act_1", sync_ref: {} });
    const e = makeDeps({ db: db2, userId: u2, config: config({ keyring: null }) });
    expect((await handleDisconnect(e, "meta_ads")).body).toMatchObject({ ok: true, revoked: false, syncPurged: false });
    expect(e.calls).toHaveLength(0);
    expect(db2.rows("receipts")[0].payload).toMatchObject({ revoke: { ok: false, code: "not_configured" }, sync_purge: { purged: false, reason: "sync_not_configured" } });
  });
});
