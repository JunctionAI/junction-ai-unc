import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCallback, handleStart } from "../handlers";
import { seal } from "../crypto";
import { finishNativeOauth, type NativeOauthContext } from "../store";
import { APP_URL, deps, json, KEYRING, seededDb } from "./helpers";
import type { Row } from "@/lib/db/types";

let f: ReturnType<typeof seededDb>;
beforeEach(() => { f = seededDb(); });
const cb = (platform: string, state: string, params = "code=synthetic-code") => `${APP_URL}/api/connectors/${platform}/callback?state=${state}&${params}`;
async function start(platform = "klaviyo") {
  const d = deps(f); d.onConnected = vi.fn();
  const r = await handleStart(d, platform, {});
  if (!("url" in r.body)) throw new Error("OAuth start failed");
  const state = new URL(r.body.url).searchParams.get("state")!;
  const context = structuredClone(f.db.rows("oauth_states").find(s => s.state === state)!.auth_context) as NativeOauthContext;
  return { d, state, context };
}
function response(url: string) { return url.endsWith("/token") ? json({ access_token: "synthetic-new-token", expires_in: 3600 }) : json({ data: [{ id: "external-account" }] }); }
function mutate(mode: string) {
  const c = f.db.rows("connectors")[0];
  if (mode === "reset") f.db.rows("accounts")[0].context_generation = 1;
  else if (mode === "remove_owner") f.db.rows("account_members")[0].role = "member";
  else if (mode === "disconnect") c.status = "disconnected";
  else if (mode === "change_asset") c.external_ref = "different-account";
  else if (mode === "change_provider") c.sync_ref = { auth_provider: "nango", provider_connection_id: "replacement" };
  else if (mode === "replace_secret") f.db.upsertRow("connector_secrets", { connector_id: c.id, ciphertext: "newer-ciphertext", iv: "newer-iv", tag: "newer-tag", key_version: 1 }, "connector_id");
}
const saved = () => structuredClone({ connectors: f.db.rows("connectors"), secrets: f.db.rows("connector_secrets") });

describe("native OAuth captured attempt", () => {
  it("captures the exact owner and nonzero generation while allowing onboarding on a paused account", async () => {
    Object.assign(f.db.rows("accounts")[0], { context_generation: 7, automation_paused: true });
    const { d, state, context } = await start();
    expect(context).toMatchObject({ protocol: "native_oauth_v1", initiatedBy: f.userId, contextGeneration: 7, accountId: f.accountId });
    d.routes.push(c => response(c.url));
    expect(await handleCallback(d, "klaviyo", cb("klaviyo", state))).toEqual({ redirect: "/app?connected=klaviyo" });
    expect(d.onConnected).toHaveBeenCalledWith(expect.objectContaining({ contextGeneration: 7, externalRef: "external-account" }));
    expect(f.db.rows("accounts")[0].automation_paused).toBe(true);
  });
  it("another owner cannot finish the initiating owner's attempt", async () => {
    const { d, state } = await start();
    f.db.insertRow("account_members", { account_id: f.accountId, user_id: "second-owner", role: "owner" });
    d.userId = "second-owner";
    const before = saved();
    await handleCallback(d, "klaviyo", cb("klaviyo", state));
    expect(saved()).toEqual(before); expect(d.calls).toHaveLength(0);
  });
  it.each(["reset", "remove_owner", "disconnect", "change_asset", "change_provider", "replace_secret"])("refuses %s before any token exchange", async mode => {
    const { d, state } = await start(); mutate(mode); const before = saved();
    await handleCallback(d, "klaviyo", cb("klaviyo", state));
    expect(d.calls).toHaveLength(0); expect(saved()).toEqual(before); expect(d.onConnected).not.toHaveBeenCalled();
  });
  it.each(["reset", "remove_owner", "disconnect", "change_asset", "change_provider", "replace_secret"])("refuses a %s occurring during exchange, without overwriting the new state", async mode => {
    const { d, state } = await start(); let before: ReturnType<typeof saved>;
    d.routes.push(c => { if (c.url.endsWith("/token")) { mutate(mode); before = saved(); } return response(c.url); });
    expect(await handleCallback(d, "klaviyo", cb("klaviyo", state))).toEqual({ redirect: "/app?connect_error=klaviyo" });
    expect(saved()).toEqual(before!); expect(d.onConnected).not.toHaveBeenCalled();
  });
  it("an older success or denial cannot consume the newer pending marker", async () => {
    const old = await start(); await start(); const before = saved();
    old.d.routes.push(c => response(c.url));
    await handleCallback(old.d, "klaviyo", cb("klaviyo", old.state));
    expect(saved()).toEqual(before); expect(old.d.calls).toHaveLength(0);
    expect(f.db.rows("oauth_states")).toHaveLength(1);
  });
  it("a newer start during exchange invalidates the old success", async () => {
    const old = await start(); let before: ReturnType<typeof saved>;
    old.d.routes.push(async c => { if (c.url.endsWith("/token")) { await start(); before = saved(); } return response(c.url); });
    await handleCallback(old.d, "klaviyo", cb("klaviyo", old.state));
    expect(saved()).toEqual(before!); expect(old.d.onConnected).not.toHaveBeenCalled();
  });
  it("legacy states without originating context fail closed", async () => {
    const { d, state } = await start(); f.db.rows("oauth_states")[0].auth_context = null;
    await handleCallback(d, "klaviyo", cb("klaviyo", state));
    expect(d.calls).toHaveLength(0); expect(f.db.rows("connector_secrets")).toHaveLength(0);
  });
  it("native success removes stale hosted-auth pointers without dropping unrelated sync metadata", async () => {
    f.db.insertRow("connectors", { account_id: f.accountId, platform: "klaviyo", status: "connected", sync_ref: { auth_provider: "nango", provider_connection_id: "old", provider_integration: "old", dataset: "preserved" } });
    const { d, state } = await start(); d.routes.push(c => response(c.url));
    await handleCallback(d, "klaviyo", cb("klaviyo", state));
    expect(f.db.rows("connectors")[0].sync_ref).toEqual({ dataset: "preserved" });
  });
  it("all Google credential replacements roll back when the last sealed bundle is invalid", async () => {
    const { state, context } = await start("google"); const before = saved();
    const replacements = context.targets.map(t => ({ connectorId: t.id, externalRef: t.externalRef, sealed: seal("synthetic", KEYRING, t.id) }));
    replacements.at(-1)!.sealed.tag = "";
    await expect(finishNativeOauth(f.db, state, context, f.userId, replacements)).rejects.toThrow("Sealed credential required");
    expect(saved()).toEqual(before);
  });
  it("a transaction storage failure cannot leave a connected row without its sealed token", async () => {
    const { d, state } = await start("google");
    const insert = f.db.upsertRow.bind(f.db);
    let n = 0;
    vi.spyOn(f.db, "upsertRow").mockImplementation((table, values, conflict, ignore) => {
      if (table === "connector_secrets" && ++n === 3) throw new Error("synthetic storage error");
      return insert(table, values as Row, conflict, ignore ?? false);
    });
    d.routes.push(c => response(c.url));
    await handleCallback(d, "google", cb("google", state));
    expect(f.db.rows("connector_secrets")).toHaveLength(0);
    expect(f.db.rows("connectors").some(c => c.status === "connected")).toBe(false);
    expect(d.onConnected).not.toHaveBeenCalled();
  });
  it("a consumed attempt cannot commit twice", async () => {
    const { state, context } = await start();
    const replacements = context.targets.map(t => ({ connectorId: t.id, externalRef: "external-account", sealed: seal("synthetic", KEYRING, t.id) }));
    expect(await finishNativeOauth(f.db, state, context, f.userId, replacements)).toBe(true);
    expect(await finishNativeOauth(f.db, state, context, f.userId, replacements)).toBe(false);
  });
});
