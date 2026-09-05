import { describe, expect, it } from "vitest";
import { listMemberships } from "@/lib/db/accountState";
import { accountForUser } from "../store";
import { seededDb, deps, json, APP_URL } from "./helpers";
import { handleCallback, handleDisconnect, handleOptions, handleSelect, handleStart } from "../handlers";
import { handleManualConnect } from "../manual";

describe("canonical multi-account selection", () => {
  it("display ordering does not silently select a client; an explicit member selection retains member role", async () => {
    const { db, accountId: ownerAccount, userId } = seededDb();
    const memberAccount = db.insertRow("accounts", { name: "Older client", currency: "NZD" }).id as string;
    db.tables.set("account_members", [
      { account_id: memberAccount, user_id: userId, role: "member", created_at: "2026-01-01T00:00:00.000Z" },
      { account_id: ownerAccount, user_id: userId, role: "owner", created_at: "2026-02-01T00:00:00.000Z" },
    ]);

    expect((await listMemberships(db, userId))[0]).toEqual({ accountId: ownerAccount, role: "owner" });
    expect(await accountForUser(db, userId)).toBeNull();
    expect(await accountForUser(db, userId, ownerAccount)).toBe(ownerAccount);
    expect(await accountForUser(db, userId, memberAccount)).toBe(memberAccount);
    expect(await accountForUser(db, userId, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await accountForUser(db, userId, "")).toBeNull();
  });
  it("refuses an ambiguous or foreign client before OAuth/manual token reads, selection or disconnect", async () => {
    const { db, userId } = seededDb();
    const second = db.insertRow("accounts", { name: "Second", currency: "NZD" }).id as string;
    db.insertRow("account_members", { account_id: second, user_id: userId, role: "owner" });
    for (const requestedAccountId of [undefined, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ""]) {
      const d = deps({ db, userId, requestedAccountId });
      expect((await handleStart(d, "klaviyo", {})).status).toBe(403);
      expect((await handleManualConnect(d, "klaviyo", { token: "fixture-never-read" })).status).toBe(403);
      expect((await handleOptions(d, "meta_ads")).status).toBe(403);
      expect((await handleSelect(d, "meta_ads", { externalRef: "act_other" })).status).toBe(403);
      expect((await handleDisconnect(d, "klaviyo")).status).toBe(403);
      expect(d.calls).toHaveLength(0);
      expect(db.rows("oauth_states")).toHaveLength(0);
      expect(db.rows("connector_secrets")).toHaveLength(0);
      expect(db.rows("connectors")).toHaveLength(0);
    }
  });
  it("explicit member selection cannot borrow owner permission from a different client", async () => {
    const { db, userId } = seededDb();
    const second = db.insertRow("accounts", { name: "Read only", currency: "NZD" }).id as string;
    db.insertRow("account_members", { account_id: second, user_id: userId, role: "member" });
    const d = deps({ db, userId, requestedAccountId: second });
    expect((await handleStart(d, "klaviyo", {})).status).toBe(403);
    expect((await handleManualConnect(d, "klaviyo", { token: "fixture-never-read" })).status).toBe(403);
    expect((await handleDisconnect(d, "klaviyo")).status).toBe(403);
    expect(d.calls).toHaveLength(0); expect(db.rows("connector_secrets")).toHaveLength(0);
  });
  it("OAuth callback writes only its persisted original client even if another tab selects a different one", async () => {
    const { db, userId, accountId: first } = seededDb();
    const second = db.insertRow("accounts", { name: "Second", currency: "NZD" }).id as string;
    db.insertRow("account_members", { account_id: second, user_id: userId, role: "owner" });
    const d = deps({ db, userId, requestedAccountId: second });
    const started = await handleStart(d, "klaviyo", {});
    if (!("url" in started.body)) throw new Error("Expected an OAuth URL");
    const state = new URL(started.body.url).searchParams.get("state")!;
    expect(db.rows("oauth_states")[0].account_id).toBe(second);
    d.requestedAccountId = first;
    d.routes.push(c => c.url === "https://a.klaviyo.com/oauth/token" ? json({ access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600, token_type: "bearer" }) : undefined);
    await handleCallback(d, "klaviyo", `${APP_URL}/api/connectors/klaviyo/callback?${new URLSearchParams({ state, code: "fixture-code" })}`);
    expect(db.rows("connectors")).toHaveLength(1);
    expect(db.rows("connectors")[0]).toMatchObject({ account_id: second, status: "connected" });
    expect(db.rows("connector_secrets")).toHaveLength(1);
    expect(db.rows("connector_secrets")[0].connector_id).toBe(db.rows("connectors")[0].id);
  });
});
