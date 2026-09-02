/* "Connect Google" — one consent for GA4 + Google Ads + Search Console: the scope union on
   the authorize URL, no umbrella row, the callback fanning one sealed token out to the three
   child rows (keeping a property / customer chosen earlier), the read-now hook only for the
   readable children, the state flag, the /app?connected=google return, and the grid. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { derive } from "@/lib/platform/derive";
import { initialState, type PlatformState } from "@/lib/platform/state";
import ConnectorsView from "@/components/platform/ConnectorsView";
import { open } from "../crypto";
import { handleCallback, handleStart } from "../handlers";
import { CONNECTOR_BY_ID, CONNECTOR_REGISTRY, connectorEntry, GOOGLE_CHILDREN, GOOGLE_UMBRELLA, isPlatformConfigured } from "../registry";
import { readConnectReturn } from "../returnParams";
import { handleConnectorsState, type ConnectorsStateListing } from "../state";
import { APP_URL, config, deps as makeDeps, FAKE_ENV, json, KEYRING, seededDb } from "./helpers";

let db: FakeSupabase;
let accountId: string;
let userId: string;
beforeEach(() => {
  ({ db, accountId, userId } = seededDb());
});
const live = (over: Parameters<typeof makeDeps>[0] = {}) => makeDeps({ db, userId, ...over });

describe("the umbrella entry", () => {
  it("unions the three children's read-only scopes, is offline + incremental, and is not a card", () => {
    expect(GOOGLE_CHILDREN).toEqual(["ga4", "google_ads", "search_console"]);
    expect(GOOGLE_UMBRELLA.scopes).toEqual(["https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/adwords", "https://www.googleapis.com/auth/webmasters.readonly"]);
    expect(connectorEntry("google")).toBe(GOOGLE_UMBRELLA);
    expect(CONNECTOR_REGISTRY.some((e) => e.id === "google")).toBe(false);
    expect(CONNECTOR_REGISTRY).toHaveLength(16);
    expect(isPlatformConfigured("google", FAKE_ENV)).toBe(true);
    expect(isPlatformConfigured("google", { ...FAKE_ENV, GOOGLE_CLIENT_ID: "" })).toBe(false);
    // Search Console is now a real per-platform Google entry (webmasters.readonly); the other two are unchanged
    expect(CONNECTOR_BY_ID.search_console).toMatchObject({ flow: "oauth", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"], pkce: true, refresh: "refresh_token" });
    expect(CONNECTOR_BY_ID.ga4.scopes).toEqual(["https://www.googleapis.com/auth/analytics.readonly"]);
    const url = new URL(GOOGLE_UMBRELLA.authorizeUrl({ clientId: "cid", redirectUri: `${APP_URL}/api/connectors/google/callback`, state: "s", scopes: GOOGLE_UMBRELLA.scopes, codeChallenge: "c" }));
    expect(url.searchParams.get("scope")).toBe(GOOGLE_UMBRELLA.scopes.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(GOOGLE_UMBRELLA.unlocks.length).toBeGreaterThan(0);
  });
});

describe("start + callback", () => {
  async function startGoogle() {
    const d = live();
    const res = await handleStart(d, "google", {});
    if (res.status !== 200 || !("url" in res.body)) throw new Error(JSON.stringify(res.body));
    const url = new URL(res.body.url);
    const state = url.searchParams.get("state")!;
    return { d, url, state };
  }

  it("start: a PKCE state for platform google, the umbrella redirect URI, and NO connector row", async () => {
    const { url, state } = await startGoogle();
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP_URL}/api/connectors/google/callback`);
    expect(url.searchParams.get("scope")!.split(" ")).toHaveLength(3);
    expect(db.rows("oauth_states")[0]).toMatchObject({ state, platform: "google", account_id: accountId });
    expect(db.rows("connectors")).toHaveLength(0);
  });

  it("callback: one token exchange, three child rows connected, each with its own sealed copy; a chosen property is kept; the readable children fire read-now", async () => {
    // GA4 was connected on its own earlier and has a property chosen; Ads has a customer
    db.insertRow("connectors", { account_id: accountId, platform: "ga4", status: "needs_reconnect", external_ref: "123456", sync_ref: {} });
    db.insertRow("connectors", { account_id: accountId, platform: "google_ads", status: "disconnected", external_ref: null, sync_ref: {} });
    const { d, state } = await startGoogle();
    const fired: string[] = [];
    d.onConnected = (i) => fired.push(i.platform);
    d.routes.push((c) => (c.url === "https://oauth2.googleapis.com/token" ? json({ access_token: "ya29.FIXTURE", refresh_token: "1//rt-FIXTURE", expires_in: 3600, scope: GOOGLE_UMBRELLA.scopes.join(" "), token_type: "Bearer" }) : undefined));

    const res = await handleCallback(d, "google", `${APP_URL}/api/connectors/google/callback?code=auth-code&state=${state}`);
    expect(res).toEqual({ redirect: "/app?connected=google" });
    expect(d.calls.filter((c) => c.url === "https://oauth2.googleapis.com/token")).toHaveLength(1);

    const rows = db.rows("connectors");
    expect(rows.map((r) => r.platform).sort()).toEqual(["ga4", "google_ads", "search_console"]);
    expect(rows.every((r) => r.status === "connected" && r.last_sync_result === null)).toBe(true);
    expect(rows.find((r) => r.platform === "ga4")!.external_ref).toBe("123456"); // kept
    expect(rows.find((r) => r.platform === "google_ads")!.external_ref).toBeNull();
    expect(db.rows("connectors").some((r) => r.platform === "google")).toBe(false);

    const secrets = db.rows("connector_secrets");
    expect(secrets).toHaveLength(3);
    for (const row of rows) {
      const s = secrets.find((x) => x.connector_id === row.id)!;
      const bundle = JSON.parse(open({ ciphertext: s.ciphertext as string, iv: s.iv as string, tag: s.tag as string, keyVersion: s.key_version as number }, KEYRING, row.id as string));
      expect(bundle).toMatchObject({ accessToken: "ya29.FIXTURE", refreshToken: "1//rt-FIXTURE" });
    }
    // GA4 has its property → readable now; Ads waits for its customer picker; Search Console has no picker → readable (its reader answers honestly)
    expect(fired.sort()).toEqual(["ga4", "search_console"]);
    expect(db.rows("oauth_states")).toHaveLength(0);
  });

  it("callback failure writes no umbrella row and leaves the children as they were", async () => {
    db.insertRow("connectors", { account_id: accountId, platform: "ga4", status: "connected", external_ref: "1", sync_ref: {} });
    const { d, state } = await startGoogle();
    d.routes.push(() => json({ error: "invalid_grant" }, 400));
    expect(await handleCallback(d, "google", `${APP_URL}/api/connectors/google/callback?code=x&state=${state}`)).toEqual({ redirect: "/app?connect_error=google" });
    expect(db.rows("connectors").map((r) => [r.platform, r.status])).toEqual([["ga4", "connected"]]);
  });

  it("the per-platform Google entries still work on their own (GA4 start unchanged)", async () => {
    const res = await handleStart(live(), "ga4", {});
    expect(res.status === 200 && "url" in res.body && new URL(res.body.url).searchParams.get("scope")).toBe("https://www.googleapis.com/auth/analytics.readonly");
    const sc = await handleStart(live(), "search_console", {});
    expect(sc.status === 200 && "url" in sc.body && new URL(sc.body.url).searchParams.get("scope")).toBe("https://www.googleapis.com/auth/webmasters.readonly");
  });
});

describe("state + return + grid", () => {
  it("the state listing says whether Connect Google is on", async () => {
    const on = await handleConnectorsState(live());
    expect((on.body as ConnectorsStateListing).google).toEqual({ configured: true, children: ["ga4", "google_ads", "search_console"] });
    const off = await handleConnectorsState(live({ config: config({ env: { ...FAKE_ENV, GOOGLE_CLIENT_SECRET: "" } }) }));
    expect((off.body as ConnectorsStateListing).google.configured).toBe(false);
  });

  it("/app?connected=google touches the three cards", () => {
    expect(readConnectReturn("?connected=google")).toEqual({ kind: "connected", platform: "google", name: "Google", names: ["Google Analytics 4", "Google Ads", "Google Search Console"] });
    expect(readConnectReturn("?connect_error=google")!.kind).toBe("error");
    expect(readConnectReturn("?connected=shopify")).toEqual({ kind: "connected", platform: "shopify", name: "Shopify", names: ["Shopify"] });
  });

  it("the grid: one Connect Google card first, the three cards say 'via Connect Google' instead of Connect, status still per child", () => {
    const S: PlatformState = { ...initialState, onboarded: true, view: "connectors", connState: { "Google Analytics 4": "ok", "Google Ads": "off", "Google Search Console": "off" } };
    const listing: ConnectorsStateListing = {
      role: "owner",
      google: { configured: true, children: ["ga4", "google_ads", "search_console"] },
      connectors: CONNECTOR_REGISTRY.map((e) => ({ platform: e.id, name: e.name, status: e.id === "ga4" ? "connected" : "disconnected", externalRef: e.id === "ga4" ? "123" : null, lastSyncAt: e.id === "ga4" ? "2026-09-02T09:00:00.000Z" : null, lastSyncResult: e.id === "ga4" ? "ok" : null, lastReadMetrics: e.id === "ga4" ? 1 : null, oauthConfigured: e.env?.clientId === "GOOGLE_CLIENT_ID", tokenPath: e.id === "ga4" || e.id === "google_ads" })),
    };
    const html = renderToStaticMarkup(createElement(ConnectorsView, { V: derive(S, () => {}), initialLive: listing }));
    const umbrella = html.indexOf('data-testid="connector-google"');
    expect(umbrella).toBeGreaterThan(-1);
    expect(umbrella).toBeLessThan(html.indexOf('data-testid="connector-shopify"'));
    expect(html).toContain('data-testid="google-connect"');
    expect(html).toContain("Google Analytics 4 · Google Ads · Google Search Console");
    const ads = html.slice(html.indexOf('data-testid="connector-google_ads"'), html.indexOf('data-testid="connector-klaviyo"'));
    expect(ads).toContain("via Connect Google");
    expect(ads).not.toContain(">Connect<");
    const ga4 = html.slice(html.indexOf('data-testid="connector-ga4"'), html.indexOf('data-testid="connector-meta_ads"'));
    expect(ga4).toContain("Read ✓ · 1 metric");
    // with the Google app off, the three cards keep their own Connect buttons
    const noGoogle = renderToStaticMarkup(createElement(ConnectorsView, { V: derive(S, () => {}), initialLive: { ...listing, google: { configured: false, children: listing.google.children } } }));
    expect(noGoogle).not.toContain('data-testid="connector-google"');
    expect(noGoogle.slice(noGoogle.indexOf('data-testid="connector-google_ads"'), noGoogle.indexOf('data-testid="connector-klaviyo"'))).toContain(">Connect<");
  });
});
