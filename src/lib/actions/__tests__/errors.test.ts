import { describe, expect, it } from "vitest";
import { adsetPause, adRotate, creativeUploadImageFromUrl, readPerformance } from "../meta/actions";
import { mapMetaError, parseRateLimit, send, shapePost } from "../meta/graph";
import { ctx, fakeFetch } from "./helpers";

describe("mapMetaError — Meta codes → honest reasons", () => {
  const meta = (code: number, extra: Record<string, unknown> = {}) => ({ error: { message: "x", type: "OAuthException", code, fbtrace_id: "Tr4c3", ...extra } });
  it("token, permission, rate limit, transient, policy, invalid param", () => {
    expect(mapMetaError(400, meta(190))).toMatchObject({ code: "token_expired", retryable: false, reason: expect.stringContaining("reconnect Meta"), platform: { code: 190, traceId: "Tr4c3" } });
    expect(mapMetaError(400, meta(190, { error_subcode: 463 }))).toMatchObject({ code: "token_expired", reason: "the Meta token has expired — reconnect Meta" });
    expect(mapMetaError(403, meta(10))).toMatchObject({ code: "permission", retryable: false });
    expect(mapMetaError(403, meta(200))).toMatchObject({ code: "permission" });
    expect(mapMetaError(400, meta(4))).toMatchObject({ code: "rate_limited", retryable: true, backoffMs: 60_000 });
    expect(mapMetaError(400, meta(17))).toMatchObject({ code: "rate_limited" });
    expect(mapMetaError(400, meta(80000))).toMatchObject({ code: "rate_limited", reason: expect.stringContaining("ads-management") });
    expect(mapMetaError(400, meta(80004))).toMatchObject({ code: "rate_limited", reason: expect.stringContaining("ads-insights") });
    expect(mapMetaError(500, meta(2))).toMatchObject({ code: "transient", retryable: true });
    expect(mapMetaError(400, meta(368))).toMatchObject({ code: "policy", retryable: false });
    expect(mapMetaError(400, meta(100, { message: "(#100) Invalid parameter daily_budget" }))).toMatchObject({ code: "invalid_param", reason: "Meta rejected a parameter: (#100) Invalid parameter daily_budget" });
    expect(mapMetaError(400, meta(100, { error_subcode: 1487126 }))).toMatchObject({ code: "invalid_param", reason: "the daily budget is below Meta's minimum for this ad set" });
    expect(mapMetaError(400, meta(100, { error_subcode: 1885154 }))).toMatchObject({ reason: "the ad account has reached its spending limit" });
  });
  it("unknown codes keep Meta's message; transient flag is honoured; no body is honest", () => {
    expect(mapMetaError(400, meta(99999, { error_user_msg: "Something specific" }))).toMatchObject({ code: "unknown", reason: "Meta error 99999: Something specific", retryable: false });
    expect(mapMetaError(500, meta(99999, { is_transient: true }))).toMatchObject({ code: "transient", retryable: true });
    expect(mapMetaError(429, null)).toMatchObject({ code: "rate_limited", retryable: true });
    expect(mapMetaError(502, null)).toMatchObject({ code: "http", retryable: true });
    expect(mapMetaError(404, {})).toMatchObject({ code: "http", retryable: false });
  });
});

describe("parseRateLimit — usage headers", () => {
  it("reads X-Business-Use-Case-Usage and backs off when Meta says to", () => {
    const h = { "x-business-use-case-usage": JSON.stringify({ "123": [{ type: "ads_management", call_count: 28, total_cputime: 12, total_time: 30, estimated_time_to_regain_access: 0 }] }) };
    expect(parseRateLimit(h)).toEqual({ utilisationPct: 30, regainAccessMinutes: 0, throttled: false, backoffMs: 0, source: "business_use_case" });
    const hot = { "x-business-use-case-usage": JSON.stringify({ "123": [{ type: "ads_management", call_count: 96, total_cputime: 40, total_time: 50, estimated_time_to_regain_access: 5 }] }) };
    expect(parseRateLimit(hot)).toEqual({ utilisationPct: 96, regainAccessMinutes: 5, throttled: true, backoffMs: 300_000, source: "business_use_case" });
  });
  it("ad-account and app usage; warm zone slows down without throttling", () => {
    expect(parseRateLimit({ "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 92, reset_time_duration: 900 }) })).toMatchObject({ utilisationPct: 92, throttled: true, regainAccessMinutes: 15, backoffMs: 900_000, source: "ad_account" });
    expect(parseRateLimit({ "x-app-usage": JSON.stringify({ call_count: 80, total_cputime: 10, total_time: 10 }) })).toMatchObject({ utilisationPct: 80, throttled: false, backoffMs: 15_000, source: "app" });
    expect(parseRateLimit(new Headers({ "x-app-usage": JSON.stringify({ call_count: 10 }) }))).toMatchObject({ utilisationPct: 10, source: "app" });
  });
  it("missing or malformed headers mean no throttle", () => {
    expect(parseRateLimit(null)).toEqual({ utilisationPct: 0, regainAccessMinutes: 0, throttled: false, backoffMs: 0, source: "none" });
    expect(parseRateLimit({ "x-app-usage": "not json" })).toMatchObject({ throttled: false, source: "none" });
  });
});

describe("send — the only place the token is used", () => {
  it("adds the bearer, form-encodes the body, parses usage, never puts the token in the URL", async () => {
    const { fetch, calls } = fakeFetch([{ json: { success: true }, headers: { "x-app-usage": JSON.stringify({ call_count: 5 }) } }]);
    const res = await send(shapePost("120210000000001", { status: "PAUSED" }, "pause"), "TOKEN-123", { fetch });
    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe("https://graph.facebook.com/v23.0/120210000000001");
    expect(calls[0].url).not.toContain("TOKEN");
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-123");
    expect(calls[0].init!.body).toBe("status=PAUSED");
    expect(res.ok && res.rateLimit.utilisationPct).toBe(5);
  });
  it("maps an error body on a 200 and on a 4xx; a network failure is transient", async () => {
    const err = { error: { code: 190, message: "expired" } };
    const soft = await send(shapePost("1", {}, "x"), "t", { fetch: fakeFetch([{ status: 200, json: err }]).fetch });
    expect(soft.ok).toBe(false);
    expect(!soft.ok && soft.error.code).toBe("token_expired");
    const hard = await send(shapePost("1", {}, "x"), "t", { fetch: fakeFetch([{ status: 400, json: err }]).fetch });
    expect(!hard.ok && hard.error.code).toBe("token_expired");
    const down = await send(shapePost("1", {}, "x"), "t", { fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    expect(!down.ok && down.error).toMatchObject({ code: "transient", retryable: true });
  });
});

describe("execute paths (stubbed fetch)", () => {
  it("read_performance: pages insights, merges budgets in minor units, summarises", async () => {
    const insights = { data: [{ adset_id: "120210000000001", adset_name: "P", spend: "152.10", impressions: "9000", clicks: "220", ctr: "2.44", frequency: "1.4", purchase_roas: [{ action_type: "omni_purchase", value: "0.99" }], actions: [{ action_type: "omni_purchase", value: "1" }], action_values: [{ action_type: "omni_purchase", value: "150.6" }] }] };
    const adsets = { data: [{ id: "120210000000001", name: "P", effective_status: "ACTIVE", daily_budget: "2261" }] };
    const { fetch, calls } = fakeFetch((url) => (url.includes("/insights") ? { json: insights } : { json: adsets }));
    const r = await readPerformance.execute({ level: "adset", datePreset: "last_7d" }, ctx({ fetch }));
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(r.response!.rows[0]).toMatchObject({ id: "120210000000001", spend: 152.1, purchases: 1, purchaseValue: 150.6, cpa: 152.1, roas: 0.99, frequency: 1.4, dailyBudget: 22.61, status: "ACTIVE" });
    expect(r.response!.summary).toEqual({ spend: 152.1, purchases: 1, purchaseValue: 150.6, cpa: 152.1, roas: 0.99, rows: 1 });
    expect(r.receipt).toBe("Read 1 adset over last_7d: NZD 152.10 spend, 1 purchases, CPA NZD 152.10, ROAS 0.99×");
    expect(r.sent!.every((s) => s.headers.Authorization === "Bearer ••••")).toBe(true);
  });
  it("read_performance without a credential says so instead of calling", async () => {
    const { fetch, calls } = fakeFetch([]);
    const r = await readPerformance.execute({}, ctx({ credential: null, fetch }));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("not_connected");
    expect(calls).toHaveLength(0);
  });
  it("pause: success → receipt + rollback-able; Meta error → mapped reason, request kept for the audit", async () => {
    const ok = await adsetPause.execute({ adsetId: "120210000000001" }, ctx({ fetch: fakeFetch([{ json: { success: true } }]).fetch }));
    expect(ok).toMatchObject({ ok: true, externalId: "120210000000001", receipt: "Paused ad set …000001" });
    const bad = await adsetPause.execute({ adsetId: "120210000000001" }, ctx({ fetch: fakeFetch([{ status: 400, json: { error: { code: 10, message: "no perms" } } }]).fetch }));
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatchObject({ code: "permission" });
    expect(bad.receipt).toBe("pause ad set …000001 failed: the Meta token lacks permission for this action (ads_management)");
    expect(bad.sent).toHaveLength(1);
  });
  it("rotate: a failure on the second call is reported honestly (the first went through)", async () => {
    const { fetch } = fakeFetch([{ json: { success: true } }, { status: 400, json: { error: { code: 4 } } }]);
    const r = await adRotate.execute({ pauseAdId: "120210000000009", resumeAdId: "120210000000010" }, ctx({ fetch }));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("rate_limited");
    expect(r.receipt).toContain("the resume went through; the fatigued ad is still active");
    expect(r.sent).toHaveLength(2);
  });
  it("upload: returns the image hash", async () => {
    const { fetch } = fakeFetch([{ json: { images: { "a.jpg": { hash: "abcdef0123456789", url: "https://scontent/x" } } } }]);
    const r = await creativeUploadImageFromUrl.execute({ imageUrl: "https://cdn.example.com/a.jpg" }, ctx({ fetch }));
    expect(r).toMatchObject({ ok: true, externalId: "abcdef0123456789", response: { hash: "abcdef0123456789" } });
  });
});
