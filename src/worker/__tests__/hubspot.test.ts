/* HubSpot reader: CRM v3 search request shaping (bearer in the header only, catalog
   filters → HubSpot properties, Unc-side filters dropped + noted), the engagements
   search behind lead_response_hours, fixtures, failure mapping, dispatch + credentials. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../lib/db/__tests__/fakeSupabase";
import { keyringFromKeys } from "../../lib/connectors/crypto";
import { seal } from "../../lib/connectors/crypto";
import { ConnectorCredentialProvider } from "../../lib/connectors/tokens";
import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { FixtureCredentialProvider } from "../credentials";
import { WorkerConnectorReader, READERS } from "../providers/connectorReader";
import * as hubspot from "../readers/hubspot";

const NOW = new Date("2026-09-02T07:00:00.000Z");
const now = () => NOW;
const FAKE_TOKEN = "CJ-FAKE-HUBSPOT-TOKEN-FOR-TESTS";
const live: PlatformCredential = { kind: "hubspot", accessToken: FAKE_TOKEN, portalId: "12345" };
const fixture: PlatformCredential = { kind: "fixture", platform: "hubspot", marker: "fixture:hubspot" };

type Call = { url: string; init: RequestInit };
function stubFetch(bodies: unknown[] | ((url: string) => unknown), status = 200) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = typeof bodies === "function" ? bodies(url) : bodies[calls.length - 1];
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}
const sent = (c: Call) => JSON.parse(c.init.body as string) as { filterGroups: { filters: { propertyName: string; operator: string; value?: string; values?: string[] }[] }[]; properties: string[]; sorts: unknown[]; limit: number };
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

afterEach(() => vi.unstubAllGlobals());

describe("contacts search", () => {
  it("maps lifecycleStage + window + fields onto a CRM search; Unc-side filters are dropped and noted; the token rides in the header only", async () => {
    const { calls } = stubFetch([{ results: [{ id: "501", properties: { email: "kim@acme.co", firstname: "Kim", company: "Acme", website: "https://acme.co/", jobtitle: "CEO", lifecyclestage: "lead" } }] }]);
    const query: ReadQuery = { resource: "contacts", window: "1d", filter: { lifecycleStage: "lead", scored: false }, fields: ["id", "email", "company", "website", "title"], limit: 100 };
    const res = await hubspot.read(query, live, { now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/search");
    expect(calls[0].init.method).toBe("POST");
    expect(header(calls[0], "Authorization")).toBe(`Bearer ${FAKE_TOKEN}`);
    const b = sent(calls[0]);
    expect(b.filterGroups[0].filters).toEqual([
      { propertyName: "lifecyclestage", operator: "EQ", value: "lead" },
      { propertyName: "createdate", operator: "GTE", value: String(new Date("2026-09-01T07:00:00.000Z").getTime()) },
    ]);
    expect(b.properties).toEqual(["hs_object_id", "email", "company", "website", "jobtitle"]);
    expect(b.limit).toBe(100);
    expect(res.rows[0]).toMatchObject({ id: "501", email: "kim@acme.co", company: "Acme", title: "CEO", lifecycleStage: "lead" });
    expect(res.metrics).toEqual({ count: 1, ids: "501", emails: "kim@acme.co", domains: "acme.co" });
    expect(res.provenance).toEqual({ platform: "hubspot", fetchedAt: NOW.toISOString(), source: "live", note: "POST crm/v3/objects/contacts/search; dropped Unc-side filters: scored" });
    expect(JSON.stringify({ url: calls[0].url, res })).not.toContain(FAKE_TOKEN);
  });

  it("an emails filter becomes email IN […]; an unresolved template is dropped, not sent", async () => {
    const { calls } = stubFetch([{ results: [] }, { results: [] }]);
    await hubspot.read({ resource: "contacts", filter: { emails: "a@x.co, b@y.co" } }, live, { now });
    expect(sent(calls[0]).filterGroups[0].filters).toEqual([{ propertyName: "email", operator: "IN", values: ["a@x.co", "b@y.co"] }]);
    const r2 = await hubspot.read({ resource: "contacts", filter: { emails: "{{reads.meetings.attendee_emails}}" } }, live, { now });
    expect(sent(calls[1]).filterGroups).toEqual([]);
    expect(r2.ok && r2.provenance.note).toContain("emails (unresolved template)");
  });
});

describe("deals search + engagements", () => {
  const dealsJson = {
    results: [
      { id: "1", properties: { dealname: "Acme pilot", amount: "4800", dealstage: "qualifiedtobuy", hs_is_closed: "false", notes_last_updated: "2026-08-30T00:00:00.000Z", closedate: null, createdate: "2026-08-01T00:00:00.000Z" } },
      { id: "2", properties: { dealname: "Zed annual", amount: "12000", dealstage: "presentationscheduled", hs_is_closed: "false", notes_last_updated: "2026-07-20T00:00:00.000Z", createdate: "2026-06-01T00:00:00.000Z" } },
      { id: "3", properties: { dealname: "Old trial", amount: "2500", dealstage: "appointmentscheduled", hs_is_closed: "false", notes_last_updated: null, createdate: "2026-05-01T00:00:00.000Z" } },
    ],
  };
  const emailsJson = {
    results: [
      { id: "e1", properties: { hs_timestamp: "2026-08-31T20:00:00.000Z", hs_email_direction: "INCOMING_EMAIL", hs_email_thread_id: "t1" } },
      { id: "e2", properties: { hs_timestamp: "2026-08-31T23:00:00.000Z", hs_email_direction: "EMAIL", hs_email_thread_id: "t1" } },
      { id: "e3", properties: { hs_timestamp: "2026-08-30T01:00:00.000Z", hs_email_direction: "INCOMING_EMAIL", hs_email_thread_id: "t2" } },
      { id: "e4", properties: { hs_timestamp: "2026-08-30T02:00:00.000Z", hs_email_direction: "EMAIL", hs_email_thread_id: "t2" } },
      { id: "e5", properties: { hs_timestamp: "2026-08-29T01:00:00.000Z", hs_email_direction: "EMAIL", hs_email_thread_id: "t2" } }, // outbound before the inbound: not a reply
      { id: "e6", properties: { hs_timestamp: "2026-09-01T09:00:00.000Z", hs_email_direction: "INCOMING_EMAIL", hs_email_thread_id: "t3" } },
      { id: "e7", properties: { hs_timestamp: "2026-09-01T10:00:00.000Z", hs_email_direction: "EMAIL", hs_email_thread_id: "t4" } }, // outbound-only thread: ignored
    ],
  };

  it("open + stale filters, then the emails search for the response-time KPI; metrics carry stale ids/amounts and the median", async () => {
    const { calls } = stubFetch((url) => (url.includes("/deals/") ? dealsJson : emailsJson));
    const query: ReadQuery = { resource: "deals", filter: { stage: "open", lastActivityOlderThanDays: 5 }, fields: ["id", "name", "contact_email", "stage", "last_activity"], limit: 50 };
    const res = await hubspot.read(query, live, { now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls.map((c) => c.url)).toEqual(["https://api.hubapi.com/crm/v3/objects/deals/search", "https://api.hubapi.com/crm/v3/objects/emails/search"]);
    const deals = sent(calls[0]);
    expect(deals.filterGroups[0].filters).toEqual([
      { propertyName: "hs_is_closed", operator: "EQ", value: "false" },
      { propertyName: "notes_last_updated", operator: "LT", value: String(NOW.getTime() - 5 * 86_400_000) },
    ]);
    expect(deals.properties.slice(0, 5)).toEqual(["hs_object_id", "dealname", "contact_email", "dealstage", "notes_last_updated"]);
    expect(deals.limit).toBe(50);
    const emails = sent(calls[1]);
    expect(emails.filterGroups[0].filters).toEqual([{ propertyName: "hs_timestamp", operator: "GTE", value: String(new Date("2026-08-26T07:00:00.000Z").getTime()) }]);
    expect(emails.properties).toEqual(["hs_timestamp", "hs_email_direction", "hs_email_thread_id"]);
    expect(emails.limit).toBe(200);
    expect(header(calls[1], "Authorization")).toBe(`Bearer ${FAKE_TOKEN}`);

    expect(res.rows.map((r) => [r.id, r.name, r.amount, r.days_stale])).toEqual([
      ["1", "Acme pilot", 4800, 3],
      ["2", "Zed annual", 12000, 44],
      ["3", "Old trial", 2500, 124], // no activity ever → since creation
    ]);
    expect(res.metrics).toMatchObject({
      count: 3,
      ids: "1,2,3",
      open_count: 3,
      open_amount: 19300,
      stale_over_30d_count: 2,
      stale_over_30d_ids: "2,3",
      stale_over_30d_amount: 14500,
      median_response_hours: 2, // t1 = 3 h, t2 = 1 h → median 2
      replied_threads: 2,
      unanswered_threads: 1,
    });
    expect(res.provenance.note).toBe("POST crm/v3/objects/deals/search; association-only fields left empty: contact_email; POST crm/v3/objects/emails/search (7 emails, response time by thread)");
  });

  it("closed-stage filters use hs_is_closed + closedate window; the KPI query (no filter, 7d) works as-is", async () => {
    const { calls } = stubFetch((url) => (url.includes("/deals/") ? { results: [] } : { results: [] }));
    await hubspot.read({ resource: "deals", window: "1d", filter: { stage: ["closedwon", "closedlost"], winLossCaptured: false }, fields: ["id", "name", "amount", "stage", "contact_email"], limit: 20 }, live, { now });
    expect(sent(calls[0]).filterGroups[0].filters).toEqual([
      { propertyName: "hs_is_closed", operator: "EQ", value: "true" },
      { propertyName: "closedate", operator: "GTE", value: String(new Date("2026-09-01T07:00:00.000Z").getTime()) },
    ]);
    const kpi = await hubspot.read({ resource: "deals", window: "7d" }, live, { now });
    expect(kpi.ok && kpi.metrics.median_response_hours).toBeNull(); // no answered thread → null, never 0
    expect(kpi.ok && kpi.count).toBe(0);
  });

  it("responseStats: median over answered threads, unanswered counted, empty → null", () => {
    expect(hubspot.responseStats([])).toEqual({ median_response_hours: null, replied_threads: 0, unanswered_threads: 0 });
    const rows: hubspot.EmailRow[] = [
      { thread: "a", direction: "INCOMING_EMAIL", at: "2026-09-01T00:00:00.000Z" },
      { thread: "a", direction: "EMAIL", at: "2026-09-01T04:00:00.000Z" },
      { thread: "b", direction: "INCOMING_EMAIL", at: "2026-09-01T00:00:00.000Z" },
      { thread: "b", direction: "EMAIL", at: "2026-09-01T01:00:00.000Z" },
      { thread: "c", direction: "INCOMING_EMAIL", at: "2026-09-01T00:00:00.000Z" },
      { thread: "c", direction: "EMAIL", at: "2026-09-02T00:00:00.000Z" },
      { thread: "d", direction: "INCOMING_EMAIL", at: "2026-09-01T00:00:00.000Z" },
    ];
    expect(hubspot.responseStats(rows)).toEqual({ median_response_hours: 4, replied_threads: 3, unanswered_threads: 1 });
  });
});

describe("failures + fixtures", () => {
  it("HTTP failures on either call are could-not-ask with host + path only; timeouts too", async () => {
    stubFetch([{}], 403);
    expect(await hubspot.read({ resource: "deals" }, live, { now })).toEqual({ ok: false, reason: "HTTP 403 from api.hubapi.com/crm/v3/objects/deals/search" });
    const { calls } = stubFetch((url) => (url.includes("/deals/") ? { results: [] } : { nope: true }));
    expect(await hubspot.read({ resource: "deals" }, live, { now })).toEqual({ ok: false, reason: "hubspot emails: response had no results array" });
    expect(calls).toHaveLength(2);
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    );
    const t = await hubspot.read({ resource: "contacts" }, live, { now, timeoutMs: 5 });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toMatch(/timeout after 5ms calling api.hubapi.com\/crm\/v3\/objects\/contacts\/search/);
    expect(await hubspot.read({ resource: "tickets" }, live, { now })).toEqual({ ok: false, reason: 'hubspot resource "tickets" has no reader (contacts, deals)' });
    expect(await hubspot.read({ resource: "deals" }, { kind: "klaviyo", apiKey: "k" }, { now })).toEqual({ ok: false, reason: "hubspot reader was given klaviyo credentials" });
  });

  it("fixture credentials answer canned rows, filtered like the catalog asks, without a request", async () => {
    const { fn } = stubFetch([]);
    const leads = await hubspot.read({ resource: "contacts", filter: { lifecycleStage: "lead", scored: false } }, fixture, { now });
    expect(leads.ok && leads.count).toBe(2);
    expect(leads.ok && leads.metrics.domains).toBe("northbeach.co.nz,kohaskincare.com");
    const stale = await hubspot.read({ resource: "deals", filter: { stage: "open", lastActivityOlderThanDays: 5 } }, fixture, { now });
    expect(stale.ok && stale.rows.map((r) => r.id)).toEqual(["d-2", "d-3"]);
    const all = await hubspot.read({ resource: "deals", filter: { stage: "open" } }, fixture, { now });
    expect(all.ok && all.metrics).toMatchObject({ count: 3, stale_over_30d_count: 2, stale_over_30d_ids: "d-2,d-3", stale_over_30d_amount: 14500, median_response_hours: 16, replied_threads: 2, unanswered_threads: 1 });
    const closed = await hubspot.read({ resource: "deals", window: "1d", filter: { stage: ["closedwon", "closedlost"] } }, fixture, { now });
    expect(closed.ok && closed.rows.map((r) => r.id)).toEqual(["d-4"]);
    expect(all.ok && all.provenance.source).toBe("fixture");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("dispatch + credentials", () => {
  it("the ConnectorReader routes hubspot to the reader (fixture provenance under fixtures; live under a hubspot credential)", async () => {
    expect(READERS.hubspot).toBe(hubspot.read);
    const ctx = { account: { accountId: "a", currency: "NZD", budgetMonthly: 0 } } as never;
    const fx = await new WorkerConnectorReader({ credentials: new FixtureCredentialProvider(), now }).read("hubspot", { resource: "deals", filter: { stage: "open" } }, ctx);
    expect(fx.provenance).toBe("fixture");
    expect(fx.metrics.stale_over_30d_count).toBe(2);
    stubFetch((url) => (url.includes("/deals/") ? { results: [] } : { results: [] }));
    const lv = await new WorkerConnectorReader({ credentials: { get: async () => live }, now }).read("hubspot", { resource: "deals" }, ctx);
    expect(lv.provenance).toBe("empty");
  });

  it("ConnectorCredentialProvider hands out a hubspot credential from the sealed bundle, portal id optional", async () => {
    const db = new FakeSupabase();
    db.userId = "user-1";
    const accountId = db.rpcs.create_account({ p_name: "X", p_currency: "NZD" }) as string;
    const keyring = keyringFromKeys({ version: 1, key: Buffer.alloc(32, 9) });
    const id = db.insertRow("connectors", { account_id: accountId, platform: "hubspot", status: "connected", external_ref: "777", sync_ref: {} }).id as string;
    const sealed = seal(JSON.stringify({ accessToken: FAKE_TOKEN, refreshToken: "rt", expiresAt: "2026-09-02T09:00:00.000Z", obtainedAt: NOW.toISOString() }), keyring, id);
    db.insertRow("connector_secrets", { connector_id: id, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, key_version: 1 });
    const provider = new ConnectorCredentialProvider({ db, keyring, env: {}, fetch: async () => new Response("", { status: 500 }), now });
    expect(await provider.get(accountId, "hubspot")).toEqual({ kind: "hubspot", accessToken: FAKE_TOKEN, portalId: "777" });
  });
});
