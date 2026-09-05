import { describe, expect, it, vi } from "vitest";
import { read } from "../readers/klaviyo";
import { KLAVIYO_CAMPAIGN_CONTRACT } from "../../lib/data/klaviyoCampaigns";

const now = () => new Date("2026-09-06T02:00:00Z");
const creds = { kind: "klaviyo" as const, apiKey: "synthetic-only" };
const campaign = (id = "c1", attributes = {}) => ({ id, attributes: { name: "Product campaign", status: "Sent", send_time: "2026-09-05T01:00:00Z", ...attributes } });
const page = (data: unknown[] = [campaign()], next: unknown = null) => ({ data, links: { next } });
const transport = (body: unknown) => vi.fn<typeof fetch>(async () => Response.json(body));

describe("complete Klaviyo campaign history for calendar inputs", () => {
  it("reads only email campaign metadata and keeps subject/performance unknown", async () => {
    const fetch = transport(page([campaign("c1", { revenue: 999, subject: "unexpected subject", recipients: ["private"] })]));
    const result = await read({ resource: "campaigns", window: "90d", fields: ["id", "subject", "revenue"] }, creds, { now, fetch });
    expect(result).toMatchObject({ ok: true, count: 1, rows: [{ id: "c1", name: "Product campaign", subject: null, revenue: null }], metrics: { count: 1, revenue: null, clicks: null, sends: null, campaign_history_contract: KLAVIYO_CAMPAIGN_CONTRACT } });
    expect(JSON.stringify(result)).not.toContain("private");
    const [url, init] = fetch.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("filter")).toBe("and(equals(messages.channel,'email'),equals(status,'Sent'))");
    expect(init?.method).toBe("GET");
    expect(JSON.stringify(result)).not.toContain(creds.apiKey);
  });
  it("windows by actual send time, excludes scheduled/draft work, then applies a deterministic limit", async () => {
    const fetch = transport(page([campaign("old", { send_time: "2026-05-01T00:00:00Z" }), campaign("draft", { status: "Draft", send_time: null }), campaign("scheduled", { status: "Scheduled", send_time: "2026-10-01T00:00:00Z" }), campaign("b"), campaign("a")]));
    const result = await read({ resource: "campaigns", window: "90d", limit: 1 }, creds, { now, fetch });
    expect(result).toMatchObject({ ok: true, count: 1, rows: [{ id: "a" }], metrics: { matching_count: 2, limited: true } });
  });
  it("returns a verified empty window without manufacturing zero performance", async () => {
    const result = await read({ resource: "campaigns", window: "1h" }, creds, { now, fetch: transport(page()) });
    expect(result).toMatchObject({ ok: true, count: 0, metrics: { revenue: null, sends: null } });
  });
  it("follows all pages even when the requested limit is already filled", async () => {
    const next = "https://a.klaviyo.com/api/campaigns/?page%5Bcursor%5D=next";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json(page([campaign("a")], next))).mockResolvedValueOnce(Response.json(page([campaign("b")])));
    expect(await read({ resource: "campaigns", limit: 1 }, creds, { now, fetch })).toMatchObject({ ok: true, metrics: { matching_count: 2, limited: true } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    { window: "all" }, { window: "0d" }, { window: "366d" }, { window: "9999999999999999999999d" },
    { filter: { tag: "winback" } }, { groupBy: ["week"] }, { limit: 0 }, { limit: 1001 }, { fields: ["recipient_email"] },
  ])("rejects unsupported query %j without a provider request", async query => {
    const fetch = transport(page());
    expect(await read({ resource: "campaigns", ...query }, creds, { now, fetch })).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "https://a.klaviyo.com.evil.test/api/campaigns", "https://a.klaviyo.com/api/profiles", "http://a.klaviyo.com/api/campaigns",
    "https://user:pass@a.klaviyo.com/api/campaigns", "https://a.klaviyo.com/api/campaigns#fragment", "/api/campaigns?page=2", "",
  ])("rejects unsafe pagination %s before forwarding a credential", async next => {
    const fetch = transport(page([campaign()], next));
    expect(await read({ resource: "campaigns" }, creds, { now, fetch })).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { data: {} }, { data: [] }, { data: [null], links: { next: null } }, page([campaign("bad", { send_time: null })]),
    page([campaign("bad", { send_time: "2027-01-01T00:00:00Z" })]), page([campaign("bad", { name: "" })]), page([campaign(), campaign()]),
  ])("refuses malformed/incomplete history %j", async body => {
    expect(await read({ resource: "campaigns" }, creds, { now, fetch: transport(body) })).toMatchObject({ ok: false });
  });
  it("refuses an unfinished five-page result", async () => {
    let n = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(page([campaign(String(++n))], `https://a.klaviyo.com/api/campaigns?page=${n}`)));
    expect(await read({ resource: "campaigns" }, creds, { now, fetch })).toEqual({ ok: false, reason: "campaign history pagination incomplete (five-page bound)" });
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it("refuses pagination loops", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async url => Response.json(page([], String(url))));
    expect(await read({ resource: "campaigns" }, creds, { now, fetch })).toMatchObject({ ok: false, reason: expect.stringContaining("repeated") });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not accept an earlier page after a later HTTP failure", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json(page([campaign()], "https://a.klaviyo.com/api/campaigns?page=2"))).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    expect(await read({ resource: "campaigns" }, creds, { now, fetch })).toMatchObject({ ok: false });
  });
});
