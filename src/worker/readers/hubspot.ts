/* HubSpot CRM reader (read-only). API: https://api.hubapi.com, OAuth bearer token in
   `Authorization: Bearer …` (never in the URL), CRM v3 search endpoints.

   Resources:
     contacts   POST /crm/v3/objects/contacts/search
     deals      POST /crm/v3/objects/deals/search
                + POST /crm/v3/objects/emails/search — the engagements the KPI needs
                  (D04-W04 lead_response_hours: median hours from a thread's first
                  INCOMING_EMAIL to the first outgoing EMAIL after it, over the window)

   Catalog field / filter names are Unc's; they map onto HubSpot properties below. Filters
   HubSpot has no property for (scored, contacted, fitScore, winLossCaptured — Unc-side
   state) are dropped and named in the provenance note, never silently invented. Rows come
   back flattened (id + the catalog's names + the raw properties). */

import type { ReadQuery } from "../../lib/runtime/types";
import type { PlatformCredential } from "../credentials";
import { clampLimit, fetchJson, num, round2, windowStartIso } from "./http";
import { fail, ok, type Metrics, type ReaderOptions, type ReaderResult, type Row } from "./types";

export const HUBSPOT_API_BASE = "https://api.hubapi.com";
const PLATFORM = "hubspot" as const;
/** CRM search pages are capped at 200 by HubSpot. */
const SEARCH_MAX = 200;
const STALE_DAYS = 30;
const DAY_MS = 86_400_000;

// ---------- fixtures ----------

const FIXTURE_CONTACTS: Row[] = [
  { id: "c-101", email: "maia@northbeach.co.nz", firstname: "Maia", company: "North Beach Surf", website: "northbeach.co.nz", title: "Founder", lifecycleStage: "lead", fit_reason: "DTC apparel, NZ, 8 staff" },
  { id: "c-102", email: "sam@kohaskincare.com", firstname: "Sam", company: "Koha Skincare", website: "kohaskincare.com", title: "Owner", lifecycleStage: "lead", fit_reason: "Shopify, subscription, no marketer" },
  { id: "c-103", email: "ops@bigboxretail.com", firstname: "Priya", company: "Big Box Retail", website: "bigboxretail.com", title: "Ops manager", lifecycleStage: "customer", fit_reason: "" },
];

const FIXTURE_DEALS: Row[] = [
  { id: "d-1", name: "North Beach — pilot", amount: 4800, stage: "qualifiedtobuy", is_closed: false, close_date: "2026-09-30", last_activity: "2026-08-30T02:00:00.000Z", contact_email: "maia@northbeach.co.nz" },
  { id: "d-2", name: "Koha — annual", amount: 12000, stage: "presentationscheduled", is_closed: false, close_date: "2026-10-15", last_activity: "2026-07-20T02:00:00.000Z", contact_email: "sam@kohaskincare.com" },
  { id: "d-3", name: "Big Box — trial", amount: 2500, stage: "appointmentscheduled", is_closed: false, close_date: null, last_activity: "2026-07-01T02:00:00.000Z", contact_email: "ops@bigboxretail.com" },
  { id: "d-4", name: "Harbour Cafe — starter", amount: 900, stage: "closedwon", is_closed: true, close_date: "2026-09-01", last_activity: "2026-09-01T02:00:00.000Z", contact_email: "hello@harbourcafe.nz" },
];

/** Fixture engagements: two threads answered (2 h, 30 h), one still waiting. */
const FIXTURE_EMAILS: EmailRow[] = [
  { thread: "t-1", direction: "INCOMING_EMAIL", at: "2026-08-31T20:00:00.000Z" },
  { thread: "t-1", direction: "EMAIL", at: "2026-08-31T22:00:00.000Z" },
  { thread: "t-2", direction: "INCOMING_EMAIL", at: "2026-08-30T01:00:00.000Z" },
  { thread: "t-2", direction: "EMAIL", at: "2026-08-31T07:00:00.000Z" },
  { thread: "t-3", direction: "INCOMING_EMAIL", at: "2026-09-01T09:00:00.000Z" },
];

// ---------- property mapping ----------

const CONTACT_PROPS: Record<string, string> = { id: "hs_object_id", email: "email", firstname: "firstname", company: "company", website: "website", title: "jobtitle", lifecycleStage: "lifecyclestage", fit_reason: "fit_reason" };
const DEAL_PROPS: Record<string, string> = { id: "hs_object_id", name: "dealname", amount: "amount", stage: "dealstage", close_date: "closedate", last_activity: "notes_last_updated", days_stale: "notes_last_updated", is_closed: "hs_is_closed" };
/** Catalog filters with no HubSpot property (Unc-side state) — dropped, noted. */
const UNC_SIDE_FILTERS = new Set(["scored", "contacted", "fitScore", "winLossCaptured", "emails_from_reads"]);

type Filter = { propertyName: string; operator: "EQ" | "NEQ" | "GTE" | "LTE" | "LT" | "GT" | "IN"; value?: string; values?: string[] };

function searchBody(filters: Filter[], properties: string[], limit: number, sort?: { propertyName: string; direction: "ASCENDING" | "DESCENDING" }): Record<string, unknown> {
  return {
    filterGroups: filters.length ? [{ filters }] : [],
    properties: [...new Set(properties)],
    sorts: sort ? [sort] : [],
    limit,
  };
}

function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string") return v.split(/[,\s]+/).filter(Boolean);
  return [];
}

export function contactsRequest(query: ReadQuery, accessToken: string, now: Date): { url: string; init: RequestInit; note: string } {
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  const filters: Filter[] = [];
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(filter)) {
    if (k === "lifecycleStage" && typeof v === "string") filters.push({ propertyName: "lifecyclestage", operator: "EQ", value: v });
    else if (k === "emails") {
      const emails = listOf(v).filter((e) => e.includes("@"));
      if (emails.length) filters.push({ propertyName: "email", operator: "IN", values: emails });
      else dropped.push("emails (unresolved template)");
    } else dropped.push(k);
  }
  const since = windowStartIso(query.window, now);
  if (since) filters.push({ propertyName: "createdate", operator: "GTE", value: String(new Date(since).getTime()) });
  const props = (query.fields?.length ? query.fields : Object.keys(CONTACT_PROPS)).map((f) => CONTACT_PROPS[f] ?? f);
  const body = searchBody(filters, props, clampLimit(query.limit, SEARCH_MAX, 100), { propertyName: "createdate", direction: "DESCENDING" });
  return {
    url: `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`,
    init: { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) },
    note: `POST crm/v3/objects/contacts/search${dropped.length ? `; dropped Unc-side filters: ${dropped.join(", ")}` : ""}`,
  };
}

export function dealsRequest(query: ReadQuery, accessToken: string, now: Date): { url: string; init: RequestInit; note: string } {
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  const filters: Filter[] = [];
  const dropped: string[] = [];
  let closedOnly = false;
  for (const [k, v] of Object.entries(filter)) {
    if (k === "stage") {
      if (v === "open") filters.push({ propertyName: "hs_is_closed", operator: "EQ", value: "false" });
      else if (Array.isArray(v) || typeof v === "string") {
        const stages = listOf(v);
        if (stages.length && stages.every((s) => s === "closedwon" || s === "closedlost")) {
          filters.push({ propertyName: "hs_is_closed", operator: "EQ", value: "true" });
          closedOnly = true;
        } else if (stages.length) filters.push({ propertyName: "dealstage", operator: "IN", values: stages });
      }
    } else if (k === "lastActivityOlderThanDays" && typeof v === "number") filters.push({ propertyName: "notes_last_updated", operator: "LT", value: String(now.getTime() - v * DAY_MS) });
    else if (UNC_SIDE_FILTERS.has(k)) dropped.push(k);
    else dropped.push(k);
  }
  const since = windowStartIso(query.window, now);
  if (since) filters.push({ propertyName: closedOnly ? "closedate" : "createdate", operator: "GTE", value: String(new Date(since).getTime()) });
  const wanted = query.fields?.length ? query.fields : Object.keys(DEAL_PROPS);
  const unmapped = wanted.filter((f) => !DEAL_PROPS[f]);
  const props = [...wanted.map((f) => DEAL_PROPS[f] ?? f), "dealname", "amount", "dealstage", "hs_is_closed", "notes_last_updated", "closedate", "createdate"];
  const body = searchBody(filters, props, clampLimit(query.limit, SEARCH_MAX, 100), { propertyName: "notes_last_updated", direction: "ASCENDING" });
  const notes = [dropped.length ? `dropped Unc-side filters: ${dropped.join(", ")}` : "", unmapped.length ? `association-only fields left empty: ${unmapped.join(", ")}` : ""].filter(Boolean);
  return {
    url: `${HUBSPOT_API_BASE}/crm/v3/objects/deals/search`,
    init: { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) },
    note: `POST crm/v3/objects/deals/search${notes.length ? `; ${notes.join("; ")}` : ""}`,
  };
}

export function emailsRequest(query: ReadQuery, accessToken: string, now: Date): { url: string; init: RequestInit } {
  const since = windowStartIso(query.window ?? "7d", now) ?? new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const body = searchBody([{ propertyName: "hs_timestamp", operator: "GTE", value: String(new Date(since).getTime()) }], ["hs_timestamp", "hs_email_direction", "hs_email_thread_id"], SEARCH_MAX, { propertyName: "hs_timestamp", direction: "ASCENDING" });
  return {
    url: `${HUBSPOT_API_BASE}/crm/v3/objects/emails/search`,
    init: { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) },
  };
}

// ---------- response shaping ----------

type HsObject = { id?: string; properties?: Record<string, unknown> };

function results(json: unknown): HsObject[] | null {
  const r = (json as { results?: unknown })?.results;
  return Array.isArray(r) ? (r as HsObject[]) : null;
}

export function flattenContact(o: HsObject): Row {
  const p = o.properties ?? {};
  const email = typeof p.email === "string" ? p.email : "";
  // raw properties first; the catalog's names (normalised) win
  return {
    ...p,
    id: String(o.id ?? p.hs_object_id ?? ""),
    email,
    firstname: p.firstname ?? null,
    company: p.company ?? null,
    website: p.website ?? null,
    title: p.jobtitle ?? null,
    lifecycleStage: p.lifecyclestage ?? null,
    fit_reason: p.fit_reason ?? null,
  };
}

export function flattenDeal(o: HsObject, now: Date): Row {
  const p = o.properties ?? {};
  const last = typeof p.notes_last_updated === "string" && p.notes_last_updated ? p.notes_last_updated : typeof p.createdate === "string" ? p.createdate : null;
  const isClosed = p.hs_is_closed === true || p.hs_is_closed === "true";
  return {
    ...p,
    id: String(o.id ?? p.hs_object_id ?? ""),
    name: p.dealname ?? null,
    amount: num(p.amount),
    stage: p.dealstage ?? null,
    is_closed: isClosed,
    close_date: p.closedate ?? null,
    last_activity: last,
    contact_email: null,
    days_stale: daysStale(last, now),
  };
}

function daysStale(lastActivity: unknown, now: Date): number {
  if (typeof lastActivity !== "string") return 0;
  const t = new Date(lastActivity).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

export interface EmailRow {
  thread: string;
  direction: string;
  at: string;
}

export function flattenEmails(json: unknown): EmailRow[] | null {
  const rs = results(json);
  if (!rs) return null;
  return rs
    .map((o) => {
      const p = o.properties ?? {};
      return { thread: String(p.hs_email_thread_id ?? o.id ?? ""), direction: String(p.hs_email_direction ?? ""), at: typeof p.hs_timestamp === "string" ? p.hs_timestamp : "" };
    })
    .filter((e) => e.thread && e.at);
}

/** Median hours from a thread's first inbound email to the first outbound after it.
    Threads still waiting count as `unanswered`; a window with no answered thread has
    median null (the KPI then reads "couldn't measure", never 0). */
export function responseStats(emails: EmailRow[]): { median_response_hours: number | null; replied_threads: number; unanswered_threads: number } {
  const byThread = new Map<string, EmailRow[]>();
  for (const e of emails) byThread.set(e.thread, [...(byThread.get(e.thread) ?? []), e]);
  const hours: number[] = [];
  let unanswered = 0;
  for (const list of byThread.values()) {
    const sorted = [...list].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const inbound = sorted.find((e) => e.direction === "INCOMING_EMAIL");
    if (!inbound) continue;
    const t0 = new Date(inbound.at).getTime();
    const reply = sorted.find((e) => e.direction === "EMAIL" && new Date(e.at).getTime() >= t0);
    if (!reply) {
      unanswered++;
      continue;
    }
    hours.push((new Date(reply.at).getTime() - t0) / 3_600_000);
  }
  hours.sort((a, b) => a - b);
  const median = hours.length ? (hours.length % 2 ? hours[(hours.length - 1) / 2] : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2) : null;
  return { median_response_hours: median === null ? null : round2(median), replied_threads: hours.length, unanswered_threads: unanswered };
}

const join = (xs: unknown[]) => xs.filter((x) => x !== null && x !== undefined && x !== "").map(String).join(",");

export function contactMetrics(rows: Row[]): Metrics {
  const domains = rows.map((r) => {
    const site = typeof r.website === "string" ? r.website : "";
    const email = typeof r.email === "string" ? r.email : "";
    return site.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || email.split("@")[1] || "";
  });
  return { count: rows.length, ids: join(rows.map((r) => r.id)), emails: join(rows.map((r) => r.email)), domains: join([...new Set(domains)]) };
}

export function dealMetrics(rows: Row[], emails: EmailRow[] | null): Metrics {
  const open = rows.filter((r) => !r.is_closed);
  const stale = open.filter((r) => num(r.days_stale) > STALE_DAYS);
  const stats = emails ? responseStats(emails) : { median_response_hours: null, replied_threads: 0, unanswered_threads: 0 };
  return {
    count: rows.length,
    ids: join(rows.map((r) => r.id)),
    contact_emails: join(rows.map((r) => r.contact_email)),
    open_count: open.length,
    open_amount: round2(open.reduce((a, r) => a + num(r.amount), 0)),
    stale_over_30d_count: stale.length,
    stale_over_30d_ids: join(stale.map((r) => r.id)),
    stale_over_30d_amount: round2(stale.reduce((a, r) => a + num(r.amount), 0)),
    inferred_reasons: "",
    ...stats,
  };
}

// ---------- fixture filtering ----------

function fixtureContacts(query: ReadQuery): Row[] {
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  return FIXTURE_CONTACTS.filter((r) => {
    if (typeof filter.lifecycleStage === "string" && r.lifecycleStage !== filter.lifecycleStage) return false;
    if (filter.emails !== undefined) {
      const emails = listOf(filter.emails).filter((e) => e.includes("@"));
      if (emails.length && !emails.includes(String(r.email))) return false;
    }
    return true;
  });
}

function fixtureDeals(query: ReadQuery, now: Date): Row[] {
  const filter = (query.filter ?? {}) as Record<string, unknown>;
  return FIXTURE_DEALS.map((r): Row => ({ ...r, days_stale: daysStale(r.last_activity, now) })).filter((r) => {
    if (filter.stage === "open" && r.is_closed) return false;
    if (Array.isArray(filter.stage) && !filter.stage.includes(r.stage)) return false;
    if (typeof filter.lastActivityOlderThanDays === "number" && num(r.days_stale) < filter.lastActivityOlderThanDays) return false;
    return true;
  });
}

// ---------- read ----------

export async function read(query: ReadQuery, creds: PlatformCredential, opts: ReaderOptions = {}): Promise<ReaderResult> {
  const now = opts.now ?? (() => new Date());
  const t = now();
  if (query.resource !== "contacts" && query.resource !== "deals") return fail(`hubspot resource "${query.resource}" has no reader (contacts, deals)`);

  if (creds.kind === "fixture") {
    if (query.resource === "contacts") {
      const rows = fixtureContacts(query);
      return ok(PLATFORM, rows, contactMetrics(rows), t.toISOString(), "fixture", "fixture rows; no request made");
    }
    const rows = fixtureDeals(query, t);
    return ok(PLATFORM, rows, dealMetrics(rows, FIXTURE_EMAILS), t.toISOString(), "fixture", "fixture rows; no request made");
  }
  if (creds.kind !== "hubspot") return fail(`hubspot reader was given ${creds.kind} credentials`);

  if (query.resource === "contacts") {
    const shaped = contactsRequest(query, creds.accessToken, t);
    const res = await fetchJson(shaped.url, shaped.init, opts);
    if (!res.ok) return fail(res.reason);
    const rs = results(res.json);
    if (!rs) return fail("hubspot contacts: response had no results array");
    const rows = rs.map(flattenContact);
    return ok(PLATFORM, rows, contactMetrics(rows), t.toISOString(), "live", shaped.note);
  }

  const shaped = dealsRequest(query, creds.accessToken, t);
  const res = await fetchJson(shaped.url, shaped.init, opts);
  if (!res.ok) return fail(res.reason);
  const rs = results(res.json);
  if (!rs) return fail("hubspot deals: response had no results array");
  const rows = rs.map((o) => flattenDeal(o, t));
  // Engagements for the response-time KPI: a failure here is "couldn't ask", like any other.
  const em = emailsRequest(query, creds.accessToken, t);
  const emRes = await fetchJson(em.url, em.init, opts);
  if (!emRes.ok) return fail(`emails search: ${emRes.reason}`);
  const emails = flattenEmails(emRes.json);
  if (!emails) return fail("hubspot emails: response had no results array");
  return ok(PLATFORM, rows, dealMetrics(rows, emails), t.toISOString(), "live", `${shaped.note}; POST crm/v3/objects/emails/search (${emails.length} emails, response time by thread)`);
}
