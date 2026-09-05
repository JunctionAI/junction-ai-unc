import { KLAVIYO_CAMPAIGN_CONTRACT, campaignHistoryQueryProblem } from "../../lib/data/klaviyoCampaigns";
import type { ReadQuery } from "../../lib/runtime/types";
import { fetchJson, windowStartIso } from "./http";
import { fail, ok, type ReaderOptions, type ReaderResult, type Row } from "./types";

const ENDPOINT = "https://a.klaviyo.com/api/campaigns";
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Complete bounded listing before local windowing/limit. No recipient data, metric
 * reports or sends. Never certify a partial listing as complete campaign history. */
export async function readCampaignHistory(query: ReadQuery, headers: Record<string, string>, opts: ReaderOptions): Promise<ReaderResult> {
  const problem = campaignHistoryQueryProblem(query);
  if (problem) return fail(problem);
  const started = (opts.now ?? (() => new Date()))();
  const since = windowStartIso(query.window, started);
  let next: string | null = `${ENDPOINT}?${new URLSearchParams({ filter: "and(equals(messages.channel,'email'),equals(status,'Sent'))", "fields[campaign]": "name,status,send_time,archived" })}`;
  const visited = new Set<string>(), ids = new Set<string>();
  const rows: Row[] = [];
  while (next) {
    if (visited.size >= 5) return fail("campaign history pagination incomplete (five-page bound)");
    if (visited.has(next)) return fail("campaign history repeated pagination link");
    visited.add(next);
    const res = await fetchJson(next, { method: "GET", headers }, opts);
    if (!res.ok) return fail(res.reason);
    const body = object(res.json);
    if (!body || !Array.isArray(body.data)) return fail("campaign history response requires a data array");
    for (const entry of body.data) {
      const item = object(entry), attrs = object(item?.attributes);
      if (!item || typeof item.id !== "string" || !item.id.trim() || !attrs || typeof attrs.status !== "string") return fail("campaign history contains malformed records");
      if (ids.has(item.id)) return fail("campaign history contains duplicate IDs; reconcile before reuse");
      ids.add(item.id);
      // A defensive check as well as the provider filter; draft/scheduled dates
      // are never evidence of an actual send.
      if (attrs.status !== "Sent") continue;
      const sent = typeof attrs.send_time === "string" ? Date.parse(attrs.send_time) : NaN;
      if (!Number.isFinite(sent) || sent > started.getTime() || typeof attrs.name !== "string" || !attrs.name.trim()) return fail("sent campaign lacks valid send time or name");
      if (since && sent < Date.parse(since)) continue;
      rows.push({ id: item.id, name: attrs.name, status: "Sent", send_time: attrs.send_time,
        archived: typeof attrs.archived === "boolean" ? attrs.archived : null,
        // Campaign names are not email subject lines. Listing metadata contains
        // no performance observations, even if an unexpected extra field arrives.
        subject: null, revenue: null, sends: null, opens: null, clicks: null, unsubscribes: null });
    }
    const links = object(body.links);
    if (!links || !Object.hasOwn(links, "next")) return fail("campaign history pagination completion is missing");
    if (links.next === null) { next = null; continue; }
    if (typeof links.next !== "string" || !links.next) return fail("campaign history pagination link is invalid");
    try {
      const url = new URL(links.next);
      if (url.origin !== "https://a.klaviyo.com" || !["/api/campaigns", "/api/campaigns/"].includes(url.pathname) || url.username || url.password || url.hash)
        return fail("campaign history pagination target refused");
      next = url.toString();
    } catch { return fail("campaign history pagination link is invalid"); }
  }
  rows.sort((a, b) => Date.parse(String(b.send_time)) - Date.parse(String(a.send_time)) || String(a.id).localeCompare(String(b.id)));
  const selected = rows.slice(0, query.limit ?? rows.length);
  return ok("klaviyo", selected, { campaign_history_contract: KLAVIYO_CAMPAIGN_CONTRACT,
    count: selected.length, matching_count: rows.length, limited: selected.length < rows.length,
    revenue: null, sends: null, opens: null, clicks: null, unsubscribes: null }, started.toISOString(), "live",
  `GET /api/campaigns; sent email metadata, ${visited.size} complete pages; window anchored at ${started.toISOString()}; subject/copy and performance unavailable; no scheduled sends or recipient data`);
}
