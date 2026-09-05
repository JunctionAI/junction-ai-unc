import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { authorizeCalendarReceiver, buildCalendarEnvelope, calendarNextPage, collectCalendarCampaigns,
  validateCalendarIncoming, CALENDAR_CAMPAIGN_QUERY, CALENDAR_CAMPAIGN_QUERY_HASH, CALENDAR_CAMPAIGN_URL } from "../calendarReceiver";
import { calendarShadowArtifact, validateCalendarShadowReceipt } from "../calendarShadowContract";
import { readCampaignHistory } from "../../../worker/readers/klaviyoCampaigns";
import { contract, start, end, ctx } from "./calendarFixture";

const pins = { accountId: contract.accountId, providerAccountId: contract.client.klaviyoAccountId,
  primaryDomain: contract.client.primaryDomain, workflowId: contract.workflowId };
const now = "2026-09-06T12:00:01.000Z";
function incoming() { return { accountId: contract.accountId, runId: ctx.runId, routineId: "D05-W07", kind: "calendar", mode: "dry_run",
  startedAt: start, account: { currency: "NZD" }, dataToken: "synthetic-never-call-token-".repeat(3),
  shadow: { ...structuredClone(contract), data: { mode: "provider" as const, queryHash: CALENDAR_CAMPAIGN_QUERY_HASH } } }; }
function response() { const b = incoming(); return { statusCode: 200, body: { ok: true, shadow: b.shadow,
  run: { id: b.runId, accountId: b.accountId, routineId: b.routineId, mode: b.mode, status: "running", startedAt: start },
  authorizedAt: now, expiresAt: "2026-09-06T12:05:00Z", revisionEvidence: "expected_only", executedAction: "none" } }; }
function context() { return authorizeCalendarReceiver(response(), incoming(), pins, now); }
function page(next: string | null = null) { return { statusCode: 200,
  headers: { cid: pins.providerAccountId, "x-klaviyo-api-revision": "2026-07-15" },
  body: { data: [{ id: "campaign-1", type: "campaign", attributes: { name: "Example | 2026-09-04 | Product overview", status: "Sent",
    send_time: "2026-09-04T12:00:00Z", archived: false, subject: "not-source-copy", revenue: 123456 } }], links: { next } } }; }
const nextUrl = () => CALENDAR_CAMPAIGN_URL + "&page%5Bcursor%5D=next-page";

describe("calendar receiver authority and metadata boundary", () => {
  it("keeps the exact query fingerprint reproducible without secrets or day-specific cache identity", () => {
    const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v !== null && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : v;
    expect(createHash("sha256").update(JSON.stringify(stable(CALENDAR_CAMPAIGN_QUERY))).digest("hex")).toBe(CALENDAR_CAMPAIGN_QUERY_HASH);
  });
  it("accepts only canonical authority and strips bearer, extra body data and private fields", () => {
    const c = context();
    expect(c.shadow.client.currency).toBe("NZD");
    expect(JSON.stringify(c)).not.toContain("synthetic-never-call-token");
    expect(Object.keys(c)).toEqual(["shadow", "run", "authorizedAt", "expiresAt"]);
  });
  it.each(["account", "asset", "domain", "currency", "workflow", "routine", "live", "stale", "token", "query", "stored"])("refuses incoming %s mismatch without reflecting values", fault => {
    const b = incoming();
    if (fault === "account") b.accountId = "other";
    if (fault === "asset") b.shadow.client.klaviyoAccountId = "other";
    if (fault === "domain") b.shadow.client.primaryDomain = "other.test";
    if (fault === "currency") b.account.currency = "USD";
    if (fault === "workflow") b.shadow.workflowId = "other";
    if (fault === "routine") b.routineId = "D03-W01";
    if (fault === "live") b.mode = "live";
    if (fault === "stale") b.startedAt = "2020-01-01T00:00:00Z";
    if (fault === "token") b.dataToken = "private-secret\r\n";
    if (fault === "query") b.shadow.data.queryHash = "a".repeat(64);
    if (fault === "stored") Object.assign(b.shadow.data, { mode: "stored" });
    const result = validateCalendarIncoming(b, pins, now);
    expect(result.valid).toBe(false); expect(JSON.stringify(result)).not.toContain("private-secret");
    expect(() => authorizeCalendarReceiver(response(), b, pins, now)).toThrow();
  });
  it.each(["denied", "wrong-run", "changed-contract", "expired", "not-authorized", "version-claim", "wrong-status"])("rejects authority %s before provider processing", fault => {
    const r = response();
    if (fault === "denied") r.statusCode = 409;
    if (fault === "wrong-run") r.body.run.id = "other";
    if (fault === "changed-contract") r.body.shadow.client.timezone = "America/New_York";
    if (fault === "expired") r.body.expiresAt = start;
    if (fault === "not-authorized") r.body.ok = false;
    if (fault === "version-claim") r.body.revisionEvidence = "verified";
    if (fault === "wrong-status") r.body.run.status = "done";
    expect(() => authorizeCalendarReceiver(r, incoming(), pins, now)).toThrow();
  });
  it("generates useful six-week proposals accepted by the actual Unc contract", () => {
    const c = context(), result = buildCalendarEnvelope(c, [page()], { workflowId: pins.workflowId, executionId: "12345" }, end);
    const identity = { ...ctx, accountId: pins.accountId };
    expect(calendarShadowArtifact(result.artifact, c.shadow, identity).items).toHaveLength(6);
    expect(validateCalendarShadowReceipt(result.executionReceipt, c.shadow, identity, new Date(end))).toMatchObject({ workflowVersion: null, executedAction: "none" });
    expect(result.artifact.items!.map(i => i.meta!.week_start)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(new Set(result.artifact.items!.map(i => i.meta!.phase)).size).toBe(6);
    for (const item of result.artifact.items!) {
      expect(item.meta).toMatchObject({ timing_basis: "hypothesis", channel: "email" });
      expect(item.body).toContain("needs approval"); expect(item.body).toContain("Working subject:");
    }
    expect(result.artifact.evidence).toEqual([{ source: "klaviyo_campaign", ref: `klaviyo:${pins.providerAccountId}:campaign:campaign-1` }]);
    expect(JSON.stringify(result)).not.toContain("123456"); expect(JSON.stringify(result)).not.toContain("not-source-copy");
  });
  it("handles empty history honestly, without inventing approved products or performance", () => {
    const p = page(); p.body.data = [];
    const result = buildCalendarEnvelope(context(), [p], { workflowId: pins.workflowId, executionId: "12345" }, end);
    expect(result.artifact.body).toContain("No sent campaigns"); expect(result.artifact.evidence).toEqual([]);
    expect(result.executionReceipt.provider.itemsCount).toBe(0);
    expect(result.artifact.items!.every(i => i.body.includes("input is still needed"))).toBe(true);
  });
  it("matches the existing worker reader's real-input-shaped row selection", async () => {
    const p = page(); p.body.data.push({ ...structuredClone(p.body.data[0]), id: "old", attributes: { ...p.body.data[0].attributes, send_time: "2025-09-04T12:00:00Z" } });
    const fresh = collectCalendarCampaigns([p], context(), end);
    const worker = await readCampaignHistory({ resource: "campaigns", window: "90d", limit: 1000 }, {}, {
      now: () => new Date(start), fetch: async () => Response.json(p.body),
    });
    expect(worker.ok).toBe(true);
    if (worker.ok) expect(worker.rows.map(r => ({ id: r.id, name: r.name, sendTime: r.send_time, archived: r.archived }))).toEqual(fresh.rows);
  });
  it("accepts complete multiple pages and rejects a capped or duplicated listing", () => {
    const first = page(nextUrl()), second = page(); second.body.data[0].id = "campaign-2";
    expect(collectCalendarCampaigns([first, second], context(), end).rows).toHaveLength(2);
    expect(() => collectCalendarCampaigns([first], context(), end)).toThrow("incomplete_pages");
    second.body.data[0].id = "campaign-1";
    expect(() => collectCalendarCampaigns([first, second], context(), end)).toThrow("campaign_identity");
    expect(() => collectCalendarCampaigns(Array.from({ length: 6 }, () => page()), context(), end)).toThrow("page_count");
  });
  it.each(["account", "status", "revision", "future", "missing-next", "expired", "different-execution"])("fails closed on provider/execution %s", fault => {
    const p = page(), execution = { workflowId: pins.workflowId, executionId: "12345" };
    if (fault === "account") p.headers.cid = "other";
    if (fault === "status") p.statusCode = 401;
    if (fault === "revision") p.headers["x-klaviyo-api-revision"] = "old";
    if (fault === "future") p.body.data[0].attributes.send_time = "2099-01-01T00:00:00Z";
    if (fault === "missing-next") p.body.links = {} as typeof p.body.links;
    if (fault === "different-execution") execution.workflowId = "other";
    expect(() => buildCalendarEnvelope(context(), [p], execution, fault === "expired" ? "2026-09-06T12:06:00Z" : end)).toThrow();
  });
  it("checks next URLs before credentials can follow an expanded target", () => {
    expect(calendarNextPage(null)).toBeNull(); expect(calendarNextPage(nextUrl())).toBe(nextUrl());
    for (const bad of [undefined, "", "https://evil.test/api/campaigns", "https://a.klaviyo.com/api/profiles",
      nextUrl() + "&include=campaign-messages", nextUrl() + "&filter=other", nextUrl() + "#fragment",
      nextUrl().replace("https://", "http://"), nextUrl().replace("https://", "https://user:pass@"), CALENDAR_CAMPAIGN_URL])
      expect(() => calendarNextPage(bad)).toThrow();
  });
  it("reconstructs only the approved query across equivalent encodings and rejects parser ambiguity", () => {
    const link = new URL(nextUrl());
    link.pathname += "/"; link.searchParams.sort();
    expect(calendarNextPage(link.toString())).toBe(nextUrl());
    for (const cursor of ["abc+def==", "cursor&filter=evil", "next?page=2", "semi;colon"])
      expect(new URL(calendarNextPage(CALENDAR_CAMPAIGN_URL + "&page%5Bcursor%5D=" + encodeURIComponent(cursor))!).searchParams.get("page[cursor]")).toBe(cursor);
    for (const bad of [nextUrl() + "&page%5Bcursor%5D=other", nextUrl() + "&page%255Bcursor%255D=other",
      nextUrl().replace("next-page", "%0d%0a"), nextUrl().replace("next-page", "%ZZ"), nextUrl().replace("next-page", "has+space"),
      nextUrl().replace("/api/", "/api/../api/"), nextUrl().replace("/api/", "\\api/"), nextUrl() + "\n",
      nextUrl().replace("a.klaviyo.com", "a.klaviyo.com.evil.test"), nextUrl().replace("a.klaviyo.com", "a.klaviyo.com@evil.test")])
      expect(() => calendarNextPage(bad)).toThrow();
  });
});
