/* POST …/disconnect: gates mirror start; the effect is secret gone + row disconnected + receipt. */

import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { seal } from "../crypto";
import { handleDisconnect } from "../handlers";
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

  it("deletes the secret, marks the row disconnected, writes a receipt with no token in it", async () => {
    const d = live();
    const res = await handleDisconnect(d, "klaviyo");
    expect(res).toEqual({ status: 200, body: { ok: true, status: "disconnected" } });
    expect(await getSecret(db, connectorId)).toBeNull();
    expect(db.rows("connectors")[0]).toMatchObject({ id: connectorId, status: "disconnected", last_sync_result: null, external_ref: "klv-acct-1" });
    const receipts = db.rows("receipts");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ account_id: accountId, run_id: null, kind: "notification", platform: "klaviyo", created_at: NOW.toISOString() });
    expect(receipts[0].description).toMatch(/^Klaviyo disconnected — token deleted/);
    expect(receipts[0].payload).toEqual({ connector_id: connectorId, platform: "klaviyo", previous_status: "connected", external_ref: "klv-acct-1" });
    for (const h of [JSON.stringify(receipts), ...d.logs]) {
      expect(h).not.toContain("klaviyo-token");
      expect(h).not.toContain("klaviyo-refresh");
    }
    expect(d.logs).toEqual([`connectors.disconnect platform=klaviyo account=${accountId}`]);
    // idempotent enough: a second call finds the row (disconnected) and re-receipts without error
    expect((await handleDisconnect(d, "klaviyo")).status).toBe(200);
    expect(db.rows("receipts")).toHaveLength(2);
  });
});
