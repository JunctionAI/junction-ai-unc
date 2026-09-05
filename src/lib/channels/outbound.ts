/* Outbound — sending on a channel, the send ledger (outbound_messages), prefs and quiet
   hours, and the WhatsApp 24-hour rule.

     sendOnLink(deps, link, kind, payload, opts)   one send, always ledgered (sent | failed |
                                                   queued); the thread row is the caller's job
     pushToAccount(deps, {accountId, kind, ref…})  a proactive push: every verified link whose
                                                   prefs allow the kind, skipping quiet hours,
                                                   deduped on `ref` per link — the worker's call
     flushQueued(deps, link)                       WhatsApp: what waited for the founder to open
                                                   the window (their next message opens it)
     inQuietHours(quiet, now, timezone)            pure

   Nothing here decides what to say; copy lives in worker/channels.ts (pushes) and
   inbound.ts (replies). Relative imports only (worker-buildable). */

import { unwrap, type DbClient, type Row } from "../db/types";
import { appendOutbound } from "./thread";
import type { Channel, ChannelAdapter, ChannelLink, OutboundKind, OutboundPayload, QuietHours } from "./types";

export type AdapterRegistry = Partial<Record<Channel, ChannelAdapter>>;

export interface OutboundDeps {
  db: DbClient;
  adapters: AdapterRegistry;
  now: () => Date;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Original message identity; never resolve a replacement after a model/provider wait. */
  guard?: () => Promise<void>;
}

export const WHATSAPP_WINDOW_MS = 24 * 3_600_000;

// ---------- quiet hours (pure) ----------

function localMinutes(now: Date, timezone: string | null): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone ?? "UTC", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    return (get("hour") % 24) * 60 + get("minute");
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

const hhmm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

/** True inside [start, end) local time; a window that crosses midnight ("22:00"–"07:00") wraps. */
export function inQuietHours(quiet: QuietHours | null | undefined, now: Date, timezone: string | null): boolean {
  if (!quiet) return false;
  const t = localMinutes(now, timezone);
  const a = hhmm(quiet.start);
  const b = hhmm(quiet.end);
  if (a === b) return false;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** Which pref governs a kind. Replies and link handshakes always go. */
export function prefAllows(link: ChannelLink, kind: OutboundKind): boolean {
  if (link.channel === "apple" && kind !== "reply" && kind !== "link" && kind !== "system") return false;
  switch (kind) {
    case "brief":
      return link.prefs.brief;
    case "approval":
    case "reminder":
      return link.prefs.approvals;
    case "draft_landed":
      return link.prefs.drafts;
    default:
      return true;
  }
}

/** WhatsApp only: free-form messages need an inbound message from the founder in the last 24 h. */
export function whatsappWindowOpen(link: ChannelLink, now: Date): boolean {
  if (link.channel !== "whatsapp") return true;
  if (!link.lastInboundAt) return false;
  return now.getTime() - new Date(link.lastInboundAt).getTime() < WHATSAPP_WINDOW_MS;
}

// ---------- ledger ----------

export interface LedgerRow {
  id: string;
  accountId: string;
  linkId: string | null;
  channel: Channel;
  kind: OutboundKind;
  ref: string | null;
  body: string;
  externalMsgId: string | null;
  status: "sent" | "failed" | "queued";
  error: string | null;
  createdAt: string;
}

const LEDGER_COLS = "id, account_id, link_id, channel, kind, ref, body, external_msg_id, status, error, created_at";

const rowToLedger = (r: Row): LedgerRow => ({
  id: String(r.id),
  accountId: String(r.account_id),
  linkId: r.link_id ? String(r.link_id) : null,
  channel: r.channel as Channel,
  kind: r.kind as OutboundKind,
  ref: r.ref ? String(r.ref) : null,
  body: String(r.body ?? ""),
  externalMsgId: r.external_msg_id ? String(r.external_msg_id) : null,
  status: r.status as LedgerRow["status"],
  error: r.error ? String(r.error) : null,
  createdAt: String(r.created_at ?? ""),
});

export async function recordOutbound(db: DbClient, r: Omit<LedgerRow, "id" | "createdAt"> & { now: Date }): Promise<string> {
  const row = await unwrap<{ id: string }>(
    "outbound_messages.insert",
    db
      .from("outbound_messages")
      .insert({ account_id: r.accountId, link_id: r.linkId, channel: r.channel, kind: r.kind, ref: r.ref, body: r.body, external_msg_id: r.externalMsgId, status: r.status, error: r.error, created_at: r.now.toISOString() })
      .select("id")
      .single(),
  );
  return row.id;
}

/** Has this ref already been sent (or queued) to this link? The durable dedup for pushes. */
export async function alreadyPushed(db: DbClient, accountId: string, linkId: string, ref: string): Promise<boolean> {
  const rows = await unwrap<{ id: string; status: string }[]>("outbound_messages.select", db.from("outbound_messages").select("id, status").eq("account_id", accountId).eq("link_id", linkId).eq("ref", ref));
  return rows.some((r) => r.status === "sent" || r.status === "queued");
}

export async function listOutbound(db: DbClient, accountId: string, opts: { since?: string; limit?: number } = {}): Promise<LedgerRow[]> {
  let q = db.from("outbound_messages").select(LEDGER_COLS).eq("account_id", accountId);
  if (opts.since) q = q.gte("created_at", opts.since);
  q = q.order("created_at", { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);
  return (await unwrap<Row[]>("outbound_messages.select", q)).map(rowToLedger);
}

// ---------- send ----------

export type SendOutcome = { status: "sent"; ledgerId: string; externalMsgId: string | null } | { status: "failed"; ledgerId: string; error: string } | { status: "queued"; ledgerId: string } | { status: "skipped"; reason: "no_adapter" | "not_configured" | "pref_off" | "quiet_hours" | "unverified" };

export interface SendOnLinkOptions {
  contextGeneration?: number;
  ref?: string | null;
  /** Set on briefs: outside the WhatsApp window this goes as the approved template instead of queuing. */
  allowTemplate?: boolean;
  /** Also write Unc's turn to the one thread (the caller passes false when it already did). */
  appendToThread?: boolean;
}

export async function sendOnLink(deps: OutboundDeps, link: ChannelLink, kind: OutboundKind, payload: OutboundPayload, opts: SendOnLinkOptions = {}): Promise<SendOutcome> {
  await deps.guard?.();
  // No proactive Apple messages or automation during human handoff in the initial pilot.
  if (link.channel === "apple" && ((!prefAllows(link, kind)) || (link.meta.human_support_requested && kind !== "system"))) return { status: "skipped", reason: "pref_off" };
  if (!link.verifiedAt || !link.externalId) return { status: "skipped", reason: "unverified" };
  const adapter = deps.adapters[link.channel];
  if (!adapter) return { status: "skipped", reason: "no_adapter" };
  if (!adapter.configured) return { status: "skipped", reason: "not_configured" };
  const now = deps.now();
  const base = { accountId: link.accountId, linkId: link.id, channel: link.channel, kind, ref: opts.ref ?? null, body: payload.text, now };

  let template = false;
  if (!whatsappWindowOpen(link, now)) {
    if (opts.allowTemplate) template = true;
    else {
      await deps.guard?.();
      const ledgerId = await recordOutbound(deps.db, { ...base, externalMsgId: null, status: "queued", error: null });
      await deps.guard?.();
      deps.log?.("channels.queued", { accountId: link.accountId, channel: link.channel, kind, ref: opts.ref ?? null });
      return { status: "queued", ledgerId };
    }
  }

  await deps.guard?.();
  const result = await adapter.send(link.externalId, payload, { link, template });
  await deps.guard?.();
  if (result.ok) {
    const ledgerId = await recordOutbound(deps.db, { ...base, externalMsgId: result.externalMsgId, status: "sent", error: null });
    await deps.guard?.();
    if (opts.appendToThread ?? true) {
      try {
        await appendOutbound(deps.db, { accountId: link.accountId, contextGeneration: opts.contextGeneration, externalScope: link.id, channel: link.channel, text: payload.text, externalMsgId: result.externalMsgId ? `out:${result.externalMsgId}` : null, delivery: { status: "sent", kind, ref: opts.ref ?? null, link_id: link.id }, now });
      } catch (err) {
        deps.log?.("channels.thread_write_failed", { accountId: link.accountId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    deps.log?.("channels.sent", { accountId: link.accountId, channel: link.channel, kind, ref: opts.ref ?? null, template });
    return { status: "sent", ledgerId, externalMsgId: result.externalMsgId };
  }
  const ledgerId = await recordOutbound(deps.db, { ...base, externalMsgId: null, status: "failed", error: result.error.slice(0, 300) });
  deps.log?.("channels.send_failed", { accountId: link.accountId, channel: link.channel, kind, error: result.error });
  return { status: "failed", ledgerId, error: result.error };
}

// ---------- proactive push ----------

export interface PushInput {
  accountId: string;
  contextGeneration?: number;
  kind: Exclude<OutboundKind, "reply">;
  /** Durable dedup key — one send per link per ref, ever. */
  ref: string;
  payload: OutboundPayload;
  links: ChannelLink[];
  timezone: string | null;
  /** Briefs may use the WhatsApp template outside the window. */
  allowTemplate?: boolean;
}

export interface PushReport {
  sent: number;
  failed: number;
  queued: number;
  quiet: number;
  skipped: number;
  /** True when at least one send went (or queued) — the thread row is written once, on the first. */
  delivered: boolean;
}

export async function pushToAccount(deps: OutboundDeps, input: PushInput): Promise<PushReport> {
  const report: PushReport = { sent: 0, failed: 0, queued: 0, quiet: 0, skipped: 0, delivered: false };
  const now = deps.now();
  let threadWritten = false;
  for (const link of input.links) {
    if (link.accountId !== input.accountId) continue;
    if (!prefAllows(link, input.kind)) {
      report.skipped++;
      continue;
    }
    if (inQuietHours(link.prefs.quiet_hours, now, input.timezone)) {
      report.quiet++;
      continue; // not ledgered: the next tick outside the window sends it
    }
    if (await alreadyPushed(deps.db, input.accountId, link.id, input.ref)) continue;
    const out = await sendOnLink(deps, link, input.kind, input.payload, { contextGeneration: input.contextGeneration, ref: input.ref, allowTemplate: input.allowTemplate, appendToThread: !threadWritten });
    if (out.status === "sent") {
      report.sent++;
      threadWritten = true;
    } else if (out.status === "queued") report.queued++;
    else if (out.status === "failed") report.failed++;
    else report.skipped++;
  }
  report.delivered = report.sent + report.queued > 0;
  return report;
}

// ---------- WhatsApp queue ----------

/** Send what waited for the window. Called on every inbound message (the window just opened). */
export async function flushQueued(deps: OutboundDeps, link: ChannelLink): Promise<number> {
  if (link.channel !== "whatsapp" || !link.externalId) return 0;
  const adapter = deps.adapters.whatsapp;
  if (!adapter?.configured) return 0;
  const rows = await unwrap<Row[]>("outbound_messages.select", deps.db.from("outbound_messages").select(LEDGER_COLS).eq("link_id", link.id).eq("status", "queued").order("created_at", { ascending: true }));
  let flushed = 0;
  for (const raw of rows) {
    const r = rowToLedger(raw);
    const result = await adapter.send(link.externalId, { text: r.body }, { link });
    if (result.ok) {
      await unwrap("outbound_messages.update", deps.db.from("outbound_messages").update({ status: "sent", external_msg_id: result.externalMsgId, error: null }).eq("id", r.id));
      flushed++;
    } else {
      await unwrap("outbound_messages.update", deps.db.from("outbound_messages").update({ status: "failed", error: result.error.slice(0, 300) }).eq("id", r.id));
    }
  }
  return flushed;
}
