/** Pure functions for the separately owned n8n calendar receiver. No network,
 * credentials, model, database or publication. Provider reads remain HTTP nodes.
 * Bundle these exact functions for n8n; do not maintain a second hand-copied implementation. */
import { calendarWeekStarts } from "./calendarDates";
import type { CalendarShadowContract } from "./calendarShadowContract";
import type { ArtifactDraft } from "../runtime/types";

export const CALENDAR_CAMPAIGN_QUERY = {
  contract: "unc.klaviyo-campaign-history.v1", resource: "campaigns",
  filter: "and(equals(messages.channel,'email'),equals(status,'Sent'))",
  fields: ["archived", "name", "send_time", "status"], window: "90d", limit: 1000, maxPages: 5,
} as const;
// SHA-256 of recursively key-sorted CALENDAR_CAMPAIGN_QUERY JSON. This is a fixed
// receiver query definition, not a daily warehouse snapshot's query hash.
export const CALENDAR_CAMPAIGN_QUERY_HASH = "cb73504f19d1ac1521f8dff33db3eb1611f143e70130396f2b7a88aaded65ad0";
// n8n Cloud's Code sandbox lacks URLSearchParams (real fixture execution 86).
// Encode only fixed query keys; no runtime URL or URLSearchParams dependency.
export const CALENDAR_CAMPAIGN_URL = "https://a.klaviyo.com/api/campaigns?filter=" +
  encodeURIComponent(CALENDAR_CAMPAIGN_QUERY.filter) + "&fields%5Bcampaign%5D=" + encodeURIComponent(CALENDAR_CAMPAIGN_QUERY.fields.join(","));

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const iso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  // Keep adjacent closing braces out of template literals: n8n's expression
  // delimiters can terminate the surrounding {{ ... }} expression early.
  : v !== null && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(row(v)[k])}`).join(",") + "}" : JSON.stringify(v);
function requireFact(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(`calendar_receiver_${code}`); }
export interface CalendarReceiverPins { accountId: string; providerAccountId: string; primaryDomain: string; workflowId: string }
export interface CalendarReceiverContext {
  shadow: CalendarShadowContract;
  run: { id: string; accountId: string; routineId: "D05-W07"; mode: "dry_run"; startedAt: string };
  authorizedAt: string; expiresAt: string;
}

/** For the Set/IIFE validator pattern. Errors never echo token or caller values. */
export function validateCalendarIncoming(value: unknown, pins: CalendarReceiverPins, now: string) {
  const b = row(value), s = row(b.shadow), c = row(s.client), d = row(s.data);
  const details: Record<string, string> = {};
  const check = (pass: unknown, field: string, message: string) => { if (!pass) details[field] = message; };
  check(uuid(pins.accountId) && id(pins.providerAccountId) && id(pins.workflowId), "binding", "Receiver binding must be configured");
  check(b.accountId === pins.accountId && s.accountId === pins.accountId, "accountId", "Account must match this receiver binding");
  check(uuid(b.runId), "runId", "A stored run UUID is required");
  check(b.routineId === "D05-W07" && b.mode === "dry_run" && b.kind === "calendar", "routineId", "Only the calendar draft routine is supported");
  check(s.contract === "unc.campaign-calendar-shadow.v1" && s.routineId === "D05-W07" && s.routineKey === "campaign_calendar",
    "shadow.contract", "The calendar shadow protocol is required");
  check(s.workflowId === pins.workflowId && uuid(s.workflowVersion), "shadow.workflowId", "Expected receiver identity is required");
  check(c.klaviyoAccountId === pins.providerAccountId && c.primaryDomain === pins.primaryDomain && uuid(c.bindingId), "shadow.client", "Verified provider account, domain and binding are required");
  check(typeof c.currency === "string" && /^[A-Z]{3}$/.test(c.currency) && row(b.account).currency === c.currency, "shadow.client.currency", "Unc business currency must match");
  try { calendarWeekStarts(String(b.startedAt), String(c.timezone)); }
  catch { details["shadow.client.timezone"] = "Valid calendar clock and timezone are required"; }
  check(iso(b.startedAt) && iso(now) && Date.parse(now) - Date.parse(b.startedAt) >= -30000 && Date.parse(now) - Date.parse(b.startedAt) <= 900000,
    "startedAt", "The stored run must be current");
  check(d.mode === "provider" && d.queryHash === CALENDAR_CAMPAIGN_QUERY_HASH && Object.keys(d).length === 2,
    "shadow.data", "This receiver requires its exact reviewed provider query; stored mode is not wired");
  check(typeof b.dataToken === "string" && b.dataToken.length >= 32 && b.dataToken.length <= 8192 && !/[\r\n\s]/.test(b.dataToken),
    "dataToken", "A run-scoped authorization token is required");
  const valid = Object.keys(details).length === 0;
  return { valid, validationError: valid ? null : "Calendar request does not match the receiver contract", details,
    requiredSchema: { contract: "unc.campaign-calendar-shadow.v1", routineId: "D05-W07", mode: "dry_run", dataMode: "provider" } };
}

/** Only the independently pinned Junction POST response can supply provider context.
 * Do not call the provider when this throws; route it to the sanitized error responder. */
export function authorizeCalendarReceiver(response: unknown, incoming: unknown, pins: CalendarReceiverPins, now: string): CalendarReceiverContext {
  requireFact(validateCalendarIncoming(incoming, pins, now).valid, "invalid_request");
  const http = row(response), body = row(http.body), run = row(body.run), b = row(incoming);
  requireFact(http.statusCode === 200 && body.ok === true && body.executedAction === "none" && body.revisionEvidence === "expected_only", "authority_denied");
  requireFact(canonical(body.shadow) === canonical(b.shadow), "authority_contract_mismatch");
  requireFact(run.id === b.runId && run.accountId === pins.accountId && run.routineId === "D05-W07" && run.mode === "dry_run" &&
    run.status === "running" && run.startedAt === b.startedAt, "authority_run_mismatch");
  requireFact(iso(body.authorizedAt) && iso(body.expiresAt) && iso(now) && Date.parse(body.expiresAt) > Date.parse(now) &&
    Date.parse(body.authorizedAt) >= Date.parse(String(b.startedAt)) - 30000 && Date.parse(body.authorizedAt) <= Date.parse(now) + 30000 &&
    Date.parse(now) - Date.parse(body.authorizedAt) <= 60000, "authority_timing");
  // Deliberately omit the bearer, callback, reads, vars and any extra authority fields.
  return { shadow: body.shadow as CalendarShadowContract,
    run: { id: String(run.id), accountId: pins.accountId, routineId: "D05-W07", mode: "dry_run", startedAt: String(run.startedAt) },
    authorizedAt: body.authorizedAt, expiresAt: body.expiresAt };
}

/** Used BEFORE n8n follows any next link. Reject same-host path/query expansion too. */
export function calendarNextPage(value: unknown): string | null {
  if (value === null) return null;
  requireFact(typeof value === "string" && value.length > 0 && value.length <= 4000, "pagination_link");
  // Not a general URL parser: accept only this literal HTTPS origin/path, then
  // reconstruct from reviewed values. No caller-controlled host/path is returned.
  const match = /^https:\/\/a\.klaviyo\.com\/api\/campaigns\/?\?([^#]+)$/.exec(value);
  requireFact(match && !/[\u0000-\u0020\u007f\\]/.test(value), "pagination_target");
  const params = new Map<string, string>();
  const allowed = new Set(["filter", "fields[campaign]", "page[cursor]"]);
  for (const part of match[1].split("&")) {
    const equal = part.indexOf("=");
    requireFact(equal > 0, "pagination_query");
    let key: string, val: string;
    try { key = decodeURIComponent(part.slice(0, equal).replace(/\+/g, " ")); val = decodeURIComponent(part.slice(equal + 1).replace(/\+/g, " ")); }
    catch { throw new Error("calendar_receiver_pagination_encoding"); }
    requireFact(allowed.has(key) && !params.has(key), "pagination_query");
    params.set(key, val);
  }
  const cursor = params.get("page[cursor]");
  requireFact(params.get("filter") === CALENDAR_CAMPAIGN_QUERY.filter &&
    params.get("fields[campaign]")?.split(",").sort().join(",") === CALENDAR_CAMPAIGN_QUERY.fields.join(",") &&
    typeof cursor === "string" && cursor.length > 0 && cursor.length <= 2000 && !/[\u0000-\u0020\u007f]/.test(cursor), "pagination_query");
  return CALENDAR_CAMPAIGN_URL + "&page%5Bcursor%5D=" + encodeURIComponent(cursor);
}

export interface CalendarCampaign { id: string; name: string; sendTime: string; archived: boolean | null }
export function collectCalendarCampaigns(pages: unknown[], context: CalendarReceiverContext, fetchedAt: string) {
  requireFact(pages.length > 0 && pages.length <= 5 && iso(fetchedAt), "page_count");
  const since = Date.parse(context.run.startedAt) - 90 * 86400000;
  requireFact(Date.parse(fetchedAt) >= Date.parse(context.authorizedAt) - 30000 && Date.parse(fetchedAt) < Date.parse(context.expiresAt), "read_window");
  const ids = new Set<string>(), links = new Set<string>(), rows: CalendarCampaign[] = [];
  for (const [index, raw] of pages.entries()) {
    const page = row(raw), body = row(page.body), responseLinks = row(body.links);
    requireFact(page.statusCode === 200 && Array.isArray(body.data) && Object.hasOwn(responseLinks, "next"), "provider_response");
    requireFact(row(page.headers).cid === context.shadow.client.klaviyoAccountId, "provider_account");
    requireFact(row(page.headers)["x-klaviyo-api-revision"] === "2026-07-15", "provider_revision");
    const next = calendarNextPage(responseLinks.next);
    requireFact(index === pages.length - 1 ? next === null : next !== null, "incomplete_pages");
    if (next) { requireFact(!links.has(next), "repeated_page"); links.add(next); }
    for (const rawItem of body.data) {
      const item = row(rawItem), a = row(item.attributes);
      requireFact(id(item.id) && !ids.has(item.id) && item.type === "campaign" && typeof a.status === "string", "campaign_identity");
      ids.add(item.id);
      requireFact(ids.size <= 1000, "record_bound");
      if (a.status !== "Sent") continue;
      requireFact(iso(a.send_time) && Date.parse(a.send_time) <= Date.parse(context.run.startedAt) &&
        typeof a.name === "string" && a.name.trim().length > 0 && a.name.length <= 500, "campaign_metadata");
      if (Date.parse(a.send_time) < since) continue;
      rows.push({ id: item.id, name: a.name, sendTime: a.send_time, archived: typeof a.archived === "boolean" ? a.archived : null });
    }
  }
  rows.sort((a, b) => Date.parse(b.sendTime) - Date.parse(a.sendTime) || a.id.localeCompare(b.id));
  return { rows, fetchedAt, complete: true as const, pages: pages.length };
}

/** Multi-source aggregation: canonical authority + complete provider pages + actual
 * runtime execution ID. Titles are data, never instructions; no LLM is involved. */
export function buildCalendarEnvelope(context: CalendarReceiverContext, pages: unknown[], execution: { workflowId: string; executionId: string }, now: string) {
  requireFact(execution.workflowId === context.shadow.workflowId && /^[1-9]\d{0,29}$/.test(execution.executionId), "execution_identity");
  const history = collectCalendarCampaigns(pages, context, now), client = context.shadow.client;
  const weeks = calendarWeekStarts(context.run.startedAt, client.timezone);
  const clean = (v: string) => v.replace(/[<>\[\]{}*_`#\\\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  const themes = history.rows.map(c => ({ ...c, theme: clean(c.name.split("|").at(-1) ?? c.name) })).filter(c => c.theme);
  const unique = themes.filter((c, index) => themes.findIndex(x => x.theme.toLowerCase() === c.theme.toLowerCase()) === index);
  const phases = [
    { name: "Reintroduce a recent theme", job: "Reconnect readers with a topic already used by the business", subject: "a closer look", success: "Readers visit the reviewed product page" },
    { name: "Show it in use", job: "Explain one practical use with an approved photo or demonstration", subject: "see it in action", success: "Readers explore the demonstration or product details" },
    { name: "Help someone choose", job: "Answer one buying question using verified product differences", subject: "find your fit", success: "Readers reach the option that suits their needs" },
    { name: "Answer a common question", job: "Draft a useful answer once the business supplies an approved customer question and answer", subject: "a useful question, answered", success: "Readers find the answer or reply with a follow-up" },
    { name: "Invite feedback", job: "Ask what information readers still need; do not invent customer quotes or reviews", subject: "what would you like to know?", success: "Readers reply with useful questions or feedback" },
    { name: "Review and recap", job: "Select one useful theme after reviewing the preceding drafts and actual results", subject: "worth another look", success: "The business learns which topic deserves a follow-up" },
  ];
  const used = new Map<string, CalendarCampaign>();
  const artifact: ArtifactDraft = {
    kind: "calendar", title: "Your next six weeks: email draft plan",
    body: history.rows.length ? "A six-week draft sequence informed by recent sent-campaign names. Recency is not evidence of strong performance. Every proposed week is a timing hypothesis; no messages are scheduled or sent. Confirm product facts, stock, approved content and contact-frequency policy before preparing any send."
      : "No sent campaigns were found in the reviewed 90-day window. These six weeks are starting hypotheses, not a history-based recommendation. Supply approved products and content, and confirm contact-frequency policy before preparing any send. Nothing is scheduled or sent.",
    items: weeks.map((week, index) => {
      const phase = phases[index], anchor = unique[index % Math.max(unique.length, 1)];
      if (anchor) used.set(anchor.id, anchor);
      const theme = anchor ? `${phase.name}: ${anchor.theme}` : phase.name;
      const ref = anchor ? `klaviyo:${client.klaviyoAccountId}:campaign:${anchor.id}` : null;
      return { title: `Week of ${week}: ${phase.name}`,
        body: `${phase.job}. ${anchor ? `Topic reference only: “${anchor.theme}”, from a sent campaign dated ${anchor.sendTime.slice(0, 10)}. This does not establish current stock, a live offer or product claims. ` : "Approved product/topic input is still needed. "}` +
          `Working subject: “${phase.subject}”. Proposed channel: email. Timing: week of ${week} in ${client.timezone}; exact send day/time needs approval. ` +
          `CTA: choose a verified destination on ${client.primaryDomain}; no unverified product URL. Success to observe: ${phase.success.toLowerCase()}. ` +
          "Before drafting: confirm product/source material, audience consent and frequency rules. No discount, scheduled send or SMS is authorized.",
        meta: { week_start: week, channel: "email", theme, phase: phase.name, timing_basis: "hypothesis", ...(ref ? { anchor_refs: [ref] } : {}) } };
    }),
    evidence: [], meta: { scheduled: false, executed_action: "none" },
  };
  artifact.evidence = [...used.values()].map(c => ({ source: "klaviyo_campaign", ref: `klaviyo:${client.klaviyoAccountId}:campaign:${c.id}` }));
  return { artifact, executionReceipt: {
    contract: context.shadow.contract, accountId: context.run.accountId, runId: context.run.id,
    routineId: "D05-W07", routineKey: "campaign_calendar", workflowId: execution.workflowId,
    workflowVersion: null, revisionEvidence: "pending_unc_verification", executionId: execution.executionId,
    startedAt: context.run.startedAt, finishedAt: now, mode: "dry_run", status: "succeeded", executedAction: "none", client: { ...client },
    provider: { name: "klaviyo", dataset: "campaign_metadata", accountId: client.klaviyoAccountId,
      bindingId: client.bindingId, queryHash: context.shadow.data.queryHash, source: "provider", complete: true,
      itemsCount: history.rows.length, fetchedAt: history.fetchedAt, statusCode: 200 },
  } };
}
