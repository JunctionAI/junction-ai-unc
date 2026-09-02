/* Post-connect pickers: GET …/options lists the founder's GA4 properties / Google Ads
   customers / Meta ad accounts from the sealed token (request shaping against a stubbed
   fetch), POST …/select stores the choice. Gates mirror disconnect. */

import { beforeEach, describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { seal } from "../crypto";
import { handleOptions, handleSelect } from "../handlers";
import { formatCustomerId, GOOGLE_ADS_API_VERSION, listAccountOptions, normaliseExternalRef, OptionsError, PICKER_PLATFORMS } from "../options";
import { assertNoLeak, config, deps as makeDeps, FAKE_ENV, json, KEYRING, NOW, seededDb, stubFetch } from "./helpers";

let db: FakeSupabase;
let accountId: string;
let userId: string;

beforeEach(() => {
  ({ db, accountId, userId } = seededDb());
});

const TOKEN = "ya29.FAKE_GOOGLE_TOKEN_FOR_TESTS";

function connected(platform: string, externalRef: string | null = null, token = TOKEN): string {
  const id = db.insertRow("connectors", { account_id: accountId, platform, status: "connected", external_ref: externalRef, sync_ref: {} }).id as string;
  // a long-lived token so no refresh is attempted
  const sealed = seal(JSON.stringify({ accessToken: token, refreshToken: "rt-FAKE", expiresAt: "2026-09-02T23:00:00.000Z", obtainedAt: NOW.toISOString() }), KEYRING, id);
  db.insertRow("connector_secrets", { connector_id: id, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, key_version: sealed.keyVersion });
  return id;
}

const live = (over: Parameters<typeof makeDeps>[0] = {}) => makeDeps({ db, userId, ...over });

describe("normaliseExternalRef", () => {
  it("accepts resource-name and human forms per platform, rejects the rest", () => {
    expect(normaliseExternalRef("ga4", "properties/123456")).toBe("123456");
    expect(normaliseExternalRef("ga4", " 123456 ")).toBe("123456");
    expect(normaliseExternalRef("ga4", "accounts/1")).toBeNull();
    expect(normaliseExternalRef("google_ads", "customers/1234567890")).toBe("1234567890");
    expect(normaliseExternalRef("google_ads", "123-456-7890")).toBe("1234567890");
    expect(normaliseExternalRef("google_ads", "12345")).toBeNull();
    expect(normaliseExternalRef("meta_ads", "act_42")).toBe("act_42");
    expect(normaliseExternalRef("meta_ads", "42")).toBe("act_42");
    expect(normaliseExternalRef("meta_ads", "act_")).toBeNull();
    expect(normaliseExternalRef("shopify", "acme.myshopify.com")).toBeNull();
    expect(normaliseExternalRef("ga4", 42)).toBeNull();
    expect(normaliseExternalRef("ga4", "")).toBeNull();
    expect(formatCustomerId("1234567890")).toBe("123-456-7890");
    expect(PICKER_PLATFORMS).toEqual(["ga4", "google_ads", "meta_ads"]);
  });
});

describe("listAccountOptions — request shaping", () => {
  it("GA4: Admin API accountSummaries with a bearer, follows nextPageToken, labels property — account (id)", async () => {
    const f = stubFetch([
      (c) =>
        c.url === "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200"
          ? json({ accountSummaries: [{ account: "accounts/1", displayName: "Acme", propertySummaries: [{ property: "properties/111", displayName: "acme.com" }, { property: "properties/222", displayName: "App" }] }], nextPageToken: "p2" })
          : undefined,
      (c) => (c.url === "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200&pageToken=p2" ? json({ accountSummaries: [{ account: "accounts/2", propertySummaries: [{ property: "properties/333" }] }] }) : undefined),
    ]);
    const out = await listAccountOptions("ga4", TOKEN, { fetch: f.fetch, env: FAKE_ENV });
    expect(out).toEqual([
      { id: "111", label: "acme.com — Acme (111)" },
      { id: "222", label: "App — Acme (222)" },
      { id: "333", label: "Property 333 (333)" },
    ]);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    assertNoLeak(
      f.calls.map((c) => c.url),
      [TOKEN],
    );
  });

  it("Google Ads: listAccessibleCustomers with bearer + developer-token headers; missing developer token is a coded failure", async () => {
    const f = stubFetch([(c) => (c.url === `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers` ? json({ resourceNames: ["customers/1234567890", "customers/9876543210"] }) : undefined)]);
    const out = await listAccountOptions("google_ads", TOKEN, { fetch: f.fetch, env: FAKE_ENV });
    expect(out).toEqual([
      { id: "1234567890", label: "Customer 123-456-7890" },
      { id: "9876543210", label: "Customer 987-654-3210" },
    ]);
    expect(f.calls[0].headers["developer-token"]).toBe(FAKE_ENV.GOOGLE_ADS_DEVELOPER_TOKEN);
    expect(f.calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    await expect(listAccountOptions("google_ads", TOKEN, { fetch: f.fetch, env: {} })).rejects.toMatchObject({ code: "developer_token_missing" });
  });

  it("Meta: /me/adaccounts with a bearer, re-requests our own paging shape, marks inactive accounts", async () => {
    const f = stubFetch([
      (c) =>
        c.url === "https://graph.facebook.com/v21.0/me/adaccounts?fields=account_id,name,account_status&limit=100"
          ? json({ data: [{ id: "act_1", account_id: "1", name: "Acme main", account_status: 1 }], paging: { next: `https://graph.facebook.com/v21.0/me/adaccounts?access_token=${TOKEN}&after=CURSOR` } })
          : undefined,
      (c) => (c.url === "https://graph.facebook.com/v21.0/me/adaccounts?fields=account_id,name,account_status&limit=100&after=CURSOR" ? json({ data: [{ id: "act_2", account_id: "2", name: "Old", account_status: 2 }] }) : undefined),
    ]);
    const out = await listAccountOptions("meta_ads", TOKEN, { fetch: f.fetch, env: FAKE_ENV });
    expect(out).toEqual([
      { id: "act_1", label: "Acme main (act_1)" },
      { id: "act_2", label: "Old (act_2) · inactive" },
    ]);
    // the token from Meta's own paging URL never rides in ours
    expect(f.calls[1].url).not.toContain(TOKEN);
  });

  it("HTTP / malformed / timeout answers are coded, never bodies", async () => {
    const f = stubFetch([() => new Response("nope", { status: 403 })]);
    await expect(listAccountOptions("ga4", TOKEN, { fetch: f.fetch, env: FAKE_ENV })).rejects.toMatchObject({ code: "http_403" });
    const g = stubFetch([() => new Response("<html>", { status: 200 })]);
    await expect(listAccountOptions("meta_ads", TOKEN, { fetch: g.fetch, env: FAKE_ENV })).rejects.toMatchObject({ code: "malformed" });
    // a fetch that only ever answers the abort (AbortSignal.timeout → TimeoutError), like the real one
    const slow: Parameters<typeof listAccountOptions>[2]["fetch"] = (_url, init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))));
    await expect(listAccountOptions("ga4", TOKEN, { fetch: slow, env: FAKE_ENV, timeoutMs: 5 })).rejects.toMatchObject({ code: "timeout" });
    await expect(listAccountOptions("shopify", TOKEN, { fetch: f.fetch, env: FAKE_ENV })).rejects.toBeInstanceOf(OptionsError);
  });
});

describe("GET …/options", () => {
  it("gates: unknown → 404; no picker → 404; no DB → fallback; no session 401; stranger 403; nothing connected 404", async () => {
    expect((await handleOptions(live(), "nope")).status).toBe(404);
    expect(await handleOptions(live(), "shopify")).toEqual({ status: 404, body: { error: "this platform has no account picker" } });
    expect(await handleOptions(makeDeps({ config: config({ dbConfigured: false }) }), "ga4")).toEqual({ status: 200, body: { fallback: true, reason: "accounts_not_configured" } });
    expect((await handleOptions(live({ userId: null }), "ga4")).status).toBe(401);
    expect((await handleOptions(live({ userId: "stranger" }), "ga4")).status).toBe(403);
    expect((await handleOptions(live(), "ga4")).status).toBe(404);
    db.insertRow("connectors", { account_id: accountId, platform: "meta_ads", status: "needs_reconnect", sync_ref: {} });
    expect(await handleOptions(live(), "meta_ads")).toEqual({ status: 404, body: { error: "nothing connected" } });
  });

  it("lists the choices from the sealed token while external_ref is null, and skips the platform once chosen", async () => {
    connected("ga4");
    const d = live();
    d.routes.push((c) => (c.url.startsWith("https://analyticsadmin.googleapis.com/") ? json({ accountSummaries: [{ displayName: "Acme", propertySummaries: [{ property: "properties/111", displayName: "acme.com" }] }] }) : undefined));
    expect(await handleOptions(d, "ga4")).toEqual({ status: 200, body: { platform: "ga4", externalRef: null, options: [{ id: "111", label: "acme.com — Acme (111)" }], listed: true } });
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    assertNoLeak([...d.logs, ...d.calls.map((c) => c.url)], [TOKEN, "rt-FAKE"]);
    expect(d.logs).toEqual([`connectors.options platform=ga4 account=${accountId} options=1`]);

    // chosen → no platform call unless refresh is asked for
    db.rows("connectors")[0].external_ref = "111";
    expect(await handleOptions(d, "ga4")).toEqual({ status: 200, body: { platform: "ga4", externalRef: "111", options: [], listed: false } });
    expect(d.calls).toHaveLength(1);
    expect((await handleOptions(d, "ga4", { refresh: true })).body).toMatchObject({ externalRef: "111", listed: true });
    expect(d.calls).toHaveLength(2);
  });

  it("no secret store → fallback; Google Ads without a developer token → fallback; a dead token → 409 + needs_reconnect; list failure → 502 with a code", async () => {
    connected("google_ads");
    expect(await handleOptions(live({ config: config({ keyring: null }) }), "google_ads")).toEqual({ status: 200, body: { fallback: true, reason: "secret_store_not_configured" } });
    expect(await handleOptions(live({ config: config({ env: { ...FAKE_ENV, GOOGLE_ADS_DEVELOPER_TOKEN: "" } }) }), "google_ads")).toEqual({ status: 200, body: { fallback: true, reason: "developer_token_not_configured" } });

    const d = live();
    d.routes.push((c) => (c.url.includes("listAccessibleCustomers") ? new Response("denied", { status: 401 }) : undefined));
    expect(await handleOptions(d, "google_ads")).toEqual({ status: 502, body: { error: "couldn't list accounts (http_401)" } });
    expect(d.logs.at(-1)).toBe(`connectors.options platform=google_ads account=${accountId} result=list_http_401`);

    // secret row gone → tokens.ts flips the row; the picker answers 409
    db.tables.set("connector_secrets", []);
    expect(await handleOptions(d, "google_ads")).toEqual({ status: 409, body: { error: "needs reconnect" } });
    expect(db.rows("connectors")[0]).toMatchObject({ status: "needs_reconnect", last_sync_result: "error:no_secret" });
  });
});

describe("POST …/select", () => {
  it("validates the shape, stores the normalised ref, keeps status connected, writes a receipt", async () => {
    const id = connected("meta_ads");
    const d = live();
    expect((await handleSelect(d, "meta_ads", {})).status).toBe(400);
    expect((await handleSelect(d, "meta_ads", { externalRef: "acme" })).status).toBe(400);
    expect(db.rows("receipts")).toHaveLength(0);

    expect(await handleSelect(d, "meta_ads", { externalRef: "12345" })).toEqual({ status: 200, body: { ok: true, externalRef: "act_12345" } });
    expect(db.rows("connectors")[0]).toMatchObject({ id, status: "connected", external_ref: "act_12345" });
    const [receipt] = db.rows("receipts");
    expect(receipt).toMatchObject({ account_id: accountId, run_id: null, kind: "notification", platform: "meta_ads", created_at: NOW.toISOString() });
    expect(receipt.description).toBe("Meta Ads: reading ad account act_12345 from now on.");
    expect(receipt.payload).toEqual({ connector_id: id, platform: "meta_ads", external_ref: "act_12345", previous_external_ref: null });
    expect(d.logs).toEqual([`connectors.select platform=meta_ads account=${accountId}`]);
    expect(d.calls).toHaveLength(0); // no platform call

    // re-choosing notes the previous one
    expect((await handleSelect(d, "meta_ads", { externalRef: "act_777" })).status).toBe(200);
    expect(db.rows("receipts")[1].description).toBe("Meta Ads: reading ad account act_777 from now on. (was act_12345)");
    assertNoLeak([JSON.stringify(db.rows("receipts")), ...d.logs], [TOKEN, "rt-FAKE"]);
  });

  it("Google Ads customer ids are stored as digits and described with dashes; gates match options", async () => {
    connected("google_ads");
    expect(await handleSelect(live(), "google_ads", { externalRef: "123-456-7890" })).toEqual({ status: 200, body: { ok: true, externalRef: "1234567890" } });
    expect(db.rows("receipts")[0].description).toBe("Google Ads: reading customer 123-456-7890 from now on.");
    expect((await handleSelect(live(), "shopify", { externalRef: "x" })).status).toBe(404);
    expect((await handleSelect(live({ userId: null }), "google_ads", { externalRef: "1234567890" })).status).toBe(401);
    expect(await handleSelect(makeDeps({ config: config({ dbConfigured: false }) }), "ga4", { externalRef: "1" })).toEqual({ status: 200, body: { fallback: true, reason: "accounts_not_configured" } });
  });
});
