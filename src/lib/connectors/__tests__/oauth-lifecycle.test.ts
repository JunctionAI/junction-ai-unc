import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { DbClient } from "@/lib/db/types";
import { seal } from "../crypto";
import { handleCallback, handleStart } from "../handlers";
import { STATE_TTL_MS } from "../oauth";
import { callbackViaProvider } from "../providers/connect";
import { beginOauthConnection, consumeOauthState, insertOauthState, markOauthFailure, putSecret, upsertConnector } from "../store";
import { getAccessTokenFor } from "../tokens";
import { APP_URL, deps, json, KEYRING, NOW, seededDb } from "./helpers";

let fixture: ReturnType<typeof seededDb>;
beforeEach(() => { fixture = seededDb(); });
const callback = (state: string, params = "code=synthetic-code") => `${APP_URL}/api/connectors/klaviyo/callback?state=${state}&${params}`;

async function start() {
  const d = deps(fixture);
  const response = await handleStart(d, "klaviyo", {});
  if (!("url" in response.body)) throw new Error("expected native OAuth start");
  return { d, state: new URL(response.body.url).searchParams.get("state")! };
}

async function healthy() {
  const { db, accountId } = fixture;
  const id = await upsertConnector(db, accountId, "klaviyo", { status: "connected", external_ref: "account-original", last_sync_at: NOW.toISOString(), last_sync_result: "ok" });
  await putSecret(db, id, seal(JSON.stringify({ accessToken: "synthetic-current-token", refreshToken: "synthetic-refresh", expiresAt: "2026-09-02T11:00:00.000Z", obtainedAt: NOW.toISOString() }), KEYRING, id), NOW.toISOString());
  return structuredClone({ connector: db.rows("connectors")[0], secret: db.rows("connector_secrets")[0] });
}

describe("native reconnect availability and callback failure isolation", () => {
  it("keeps the current grant readable throughout a new consent attempt", async () => {
    const before = await healthy();
    const { d, state } = await start();
    expect(fixture.db.rows("connectors")[0]).toEqual({ ...before.connector, pending_oauth_digest: createHash("sha256").update(state).digest("hex") });
    expect(fixture.db.rows("connector_secrets")[0]).toEqual(before.secret);
    const token = await getAccessTokenFor(fixture.accountId, "klaviyo", { db: fixture.db, keyring: KEYRING, env: d.config.env, fetch: d.fetch, now: d.now });
    expect(token?.accessToken).toBe("synthetic-current-token");
    expect(d.calls).toHaveLength(0);
  });

  it.each(["disconnected", "needs_reconnect", "error", "connecting"])("starts an unavailable %s connector without replacing its identity", async (status) => {
    const row = fixture.db.insertRow("connectors", { account_id: fixture.accountId, platform: "klaviyo", status, external_ref: "saved-account" });
    const id = row.id;
    await start();
    expect(fixture.db.rows("connectors")).toHaveLength(1);
    expect(row).toMatchObject({ id, status: "connecting", external_ref: "saved-account" });
  });

  it.each(["denied", "missing_code", "expired", "invalid_expiry", "exchange_error"])("preserves the complete working connection after %s", async (mode) => {
    const before = await healthy();
    const { d, state } = await start();
    if (mode === "expired") d.now = () => new Date(NOW.getTime() + STATE_TTL_MS);
    if (mode === "invalid_expiry") fixture.db.rows("oauth_states")[0].expires_at = "invalid";
    if (mode === "exchange_error") d.routes.push(() => json({ error: "invalid_grant" }, 400));
    const params = mode === "denied" ? "error=access_denied" : mode === "missing_code" ? "" : "code=synthetic-code";
    expect(await handleCallback(d, "klaviyo", callback(state, params))).toEqual({ redirect: "/app?connect_error=klaviyo" });
    expect(fixture.db.rows("connectors")[0]).toEqual(before.connector);
    expect(fixture.db.rows("connector_secrets")[0]).toEqual(before.secret);
    expect(fixture.db.rows("oauth_states")).toHaveLength(0);
    if (mode !== "exchange_error") expect(d.calls).toHaveLength(0);
  });

  it.each([null, "stranger"])("an expired callback without owner authority (%s) cannot alter a pending connector", async (userId) => {
    const { d, state } = await start();
    const before = structuredClone(fixture.db.rows("connectors"));
    d.userId = userId;
    d.now = () => new Date(NOW.getTime() + STATE_TTL_MS);
    await handleCallback(d, "klaviyo", callback(state));
    expect(fixture.db.rows("connectors")).toEqual(before);
    expect(d.calls).toHaveLength(0);
  });

  it.each(["disconnect", "remove"])("a late denial does not undo %s", async (mode) => {
    const { d, state } = await start();
    if (mode === "disconnect") fixture.db.rows("connectors")[0].status = "disconnected";
    else fixture.db.deleteRows("connectors", fixture.db.rows("connectors"));
    const before = structuredClone(fixture.db.rows("connectors"));
    await handleCallback(d, "klaviyo", callback(state, "error=access_denied"));
    expect(fixture.db.rows("connectors")).toEqual(before);
    expect(d.calls).toHaveLength(0);
  });

  it("an older denied attempt does not downgrade a newer successful attempt", async () => {
    const old = await start();
    const next = await start();
    next.d.routes.push(c => c.url.endsWith("/oauth/token") ? json({ access_token: "synthetic-new", expires_in: 3600 }) : json({ data: [{ id: "new-account" }] }));
    expect(await handleCallback(next.d, "klaviyo", callback(next.state))).toEqual({ redirect: `/app?connected=klaviyo&account=${fixture.accountId}` });
    const before = structuredClone({ connector: fixture.db.rows("connectors")[0], secret: fixture.db.rows("connector_secrets")[0] });
    await handleCallback(old.d, "klaviyo", callback(old.state, "error=access_denied"));
    expect(fixture.db.rows("connectors")[0]).toEqual(before.connector);
    expect(fixture.db.rows("connector_secrets")[0]).toEqual(before.secret);
  });

  it("cannot downgrade a connection completed between the two start statements", async () => {
    await healthy();
    fixture.db.rows("connectors")[0].status = "error";
    const original = fixture.db.upsertRow.bind(fixture.db);
    vi.spyOn(fixture.db, "upsertRow").mockImplementation((table, values, conflict, ignore) => {
      const result = original(table, values, conflict, ignore ?? false);
      if (table === "connectors") fixture.db.rows("connectors")[0].status = "connected";
      return result;
    });
    await beginOauthConnection(fixture.db, fixture.accountId, "klaviyo");
    expect(fixture.db.rows("connectors")[0].status).toBe("connected");
  });

  it("duplicate concurrent callbacks exchange and persist only once", async () => {
    const { d, state } = await start();
    d.onConnected = vi.fn();
    d.routes.push(c => c.url.endsWith("/oauth/token") ? json({ access_token: "synthetic-new", expires_in: 3600 }) : json({ data: [{ id: "new-account" }] }));
    const results = await Promise.all([handleCallback(d, "klaviyo", callback(state)), handleCallback(d, "klaviyo", callback(state))]);
    expect(results.map(r => r.redirect).sort()).toEqual(["/app?connect_error=klaviyo", `/app?connected=klaviyo&account=${fixture.accountId}`].sort());
    expect(d.calls.filter(c => c.url.endsWith("/oauth/token"))).toHaveLength(1);
    expect(fixture.db.rows("connector_secrets")).toHaveLength(1);
    expect(d.onConnected).toHaveBeenCalledTimes(1);
  });

  it("a failed state-delete never authorizes an exchange or automatically retries", async () => {
    const { d, state } = await start();
    vi.spyOn(fixture.db, "deleteRows").mockImplementation(() => { throw new Error("synthetic database failure"); });
    expect(await handleCallback(d, "klaviyo", callback(state))).toEqual({ redirect: "/app?connect_error=klaviyo" });
    expect(d.calls).toHaveLength(0);
    expect(fixture.db.rows("oauth_states")).toHaveLength(1);
    expect(fixture.db.calls.filter(c => c.table === "oauth_states" && c.op === "delete")).toHaveLength(1);
  });
});

describe("shared OAuth store protocol", () => {
  it("the schema fake models insert-ignore returning no duplicate row", async () => {
    const { db, accountId } = fixture;
    const values = { account_id: accountId, platform: "klaviyo", status: "connected" };
    const options = { onConflict: "account_id,platform", ignoreDuplicates: true };
    expect((await db.from("connectors").upsert(values, options).select("id")).data).toHaveLength(1);
    expect((await db.from("connectors").upsert({ ...values, status: "connecting" }, options).select("id")).data).toEqual([]);
    expect(db.rows("connectors")[0].status).toBe("connected");
  });
  it("uses one DELETE RETURNING, not a SELECT-then-DELETE", async () => {
    const { state } = await start();
    const offset = fixture.db.calls.length;
    const results = await Promise.all([consumeOauthState(fixture.db, state), consumeOauthState(fixture.db, state)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fixture.db.calls.slice(offset)).toEqual([0, 1].map(() => expect.objectContaining({ table: "oauth_states", op: "delete", returning: true, single: "maybeSingle", filters: [{ kind: "eq", column: "state", value: state }] })));
  });

  it("real supabase-js emits DELETE plus representation and insert-ignore plus guarded UPDATE", async () => {
    const calls: { method: string; url: URL; headers: Headers; body: unknown }[] = [];
    const client = createClient("https://synthetic.supabase.co", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      calls.push({ method: init?.method ?? "GET", url: new URL(String(input)), headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
      return json([]);
    } } });
    const db = client as unknown as DbClient;
    expect(await consumeOauthState(db, "synthetic-state")).toBeNull();
    await beginOauthConnection(db, "synthetic-account", "klaviyo");
    await markOauthFailure(db, "synthetic-account", "klaviyo");
    expect(calls.map(c => c.method)).toEqual(["DELETE", "POST", "PATCH", "PATCH"]);
    expect(calls[0].url.searchParams.get("state")).toBe("eq.synthetic-state");
    expect(calls[0].headers.get("prefer")).toContain("return=representation");
    expect(calls[1].headers.get("prefer")).toContain("resolution=ignore-duplicates");
    expect(calls[2].url.searchParams.get("status")).toBe("in.(disconnected,needs_reconnect,error)");
    expect(calls[3].url.searchParams.get("status")).toBe("eq.connecting");
    for (const c of calls.slice(2)) {
      expect(c.url.searchParams.get("account_id")).toBe("eq.synthetic-account");
      expect(c.url.searchParams.get("platform")).toBe("eq.klaviyo");
    }
  });

  it.each(["connected", "disconnected", "needs_reconnect"])("hosted-provider failure preserves a %s row", async (status) => {
    const { db, accountId } = fixture;
    const d = deps(fixture);
    db.insertRow("connectors", { account_id: accountId, platform: "meta_ads", status, external_ref: "act_original" });
    await insertOauthState(db, { state: "hosted-state", account_id: accountId, platform: "meta_ads", code_verifier: null, shop: null, redirect_to: "/app", created_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + STATE_TTL_MS).toISOString() });
    const before = structuredClone(db.rows("connectors"));
    await callbackViaProvider(d, "composio", `${APP_URL}/api/connectors/provider/composio/callback?platform=meta_ads&state=hosted-state&error=denied`);
    expect(db.rows("connectors")).toEqual(before);
    expect(d.calls).toHaveLength(0);
  });

  it("hosted callbacks check owner authority before recording expired-attempt failure", async () => {
    const { db, accountId } = fixture;
    db.insertRow("connectors", { account_id: accountId, platform: "meta_ads", status: "connecting" });
    await insertOauthState(db, { state: "hosted-expired", account_id: accountId, platform: "meta_ads", code_verifier: null, shop: null, redirect_to: "/app", created_at: NOW.toISOString(), expires_at: NOW.toISOString() });
    const d = deps({ ...fixture, userId: null });
    const before = structuredClone(db.rows("connectors"));
    await callbackViaProvider(d, "composio", `${APP_URL}/api/connectors/provider/composio/callback?platform=meta_ads&state=hosted-expired&status=success`);
    expect(db.rows("connectors")).toEqual(before);
    expect(d.calls).toHaveLength(0);
  });
});
