/* Outbound — sending on a channel, the send ledger (outbound_messages), prefs and quiet
   hours, and the WhatsApp 24-hour rule.

     sendOnLink(deps, link, kind, payload, opts)   durable intent before a single attempt;
                                                   confirmed sends project into the thread
     pushToAccount(deps, {accountId, kind, ref…})  a proactive push: every verified link whose
                                                   prefs allow the kind, skipping quiet hours,
                                                   deduped on `ref` per link — the worker's call
     flushQueued(deps, link)                       WhatsApp: what waited for the founder to open
                                                   the window (their next message opens it)
     inQuietHours(quiet, now, timezone)            pure

   Nothing here decides what to say; copy lives in worker/channels.ts (pushes) and
   inbound.ts (replies). Relative imports only (worker-buildable). */

import { unwrap, type DbClient, type Row } from "../db/types";
import { boundedSend, claimOutbound, enqueueOutbound, finishOutbound, projectOutbound, type DeliveryStatus, type ReplyContext } from "./outbox";
import { messagingDisabled } from "./releaseGate";
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
  status: DeliveryStatus;
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

/** An existing attempt, including uncertainty, must never be blindly re-sent. */
export async function alreadyPushed(db: DbClient, accountId: string, linkId: string, ref: string, contextGeneration = 0, bindingVersion?: number): Promise<boolean> {
  let q = db.from("outbound_messages").select("id").eq("account_id", accountId).eq("context_generation", contextGeneration).eq("captured_link_id", linkId).eq("ref", ref);
  if (bindingVersion !== undefined) q = q.eq("binding_version", bindingVersion);
  return (await unwrap<Row[]>("outbound_messages.select", q)).length > 0;
}

export async function listOutbound(db: DbClient, accountId: string, opts: { since?: string; limit?: number } = {}): Promise<LedgerRow[]> {
  let q = db.from("outbound_messages").select(LEDGER_COLS).eq("account_id", accountId);
  if (opts.since) q = q.gte("created_at", opts.since);
  q = q.order("created_at", { ascending: false }).order("id", { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);
  return (await unwrap<Row[]>("outbound_messages.select", q)).map(rowToLedger);
}

// ---------- send ----------

export type SendOutcome = { status: "sent"; ledgerId: string; externalMsgId: string | null } | { status: "failed" | "uncertain"; ledgerId: string; error: string } | { status: "queued"; ledgerId: string } | { status: "skipped"; reason: "no_adapter" | "not_configured" | "pref_off" | "quiet_hours" | "unverified" | "messaging_disabled" | "cancelled" };

export interface SendOnLinkOptions {
  contextGeneration?: number;
  /** Only a captured link handshake or human-handoff acknowledgement may use this. */
  allowPaused?: boolean;
  ref?: string | null;
  /** Set on briefs: outside the WhatsApp window this goes as the approved template instead of queuing. */
  allowTemplate?: boolean;
  /** Also write Unc's turn to the one thread (the caller passes false when it already did). */
  appendToThread?: boolean;
  replyContext?: ReplyContext;
}

export async function sendOnLink(deps: OutboundDeps, link: ChannelLink, kind: OutboundKind, payload: OutboundPayload, opts: SendOnLinkOptions = {}): Promise<SendOutcome> {
  if (messagingDisabled(process.env)) return { status: "skipped", reason: "messaging_disabled" };
  await deps.guard?.();
  // No proactive Apple messages or automation during human handoff in the initial pilot.
  if (link.channel === "apple" && ((!prefAllows(link, kind)) || (link.meta.human_support_requested && kind !== "system"))) return { status: "skipped", reason: "pref_off" };
  if (!link.verifiedAt || !link.externalId) return { status: "skipped", reason: "unverified" };
  const adapter = deps.adapters[link.channel];
  if (!adapter) return { status: "skipped", reason: "no_adapter" };
  if (!adapter.configured) return { status: "skipped", reason: "not_configured" };
  const queued = await enqueueOutbound(deps.db, link, kind, payload, opts);
  return deliverOutbound(deps, String(queued.id));
}

/** Resume a durable operation by ID. Never reselect destinations or re-enqueue it. */
export async function deliverOutbound(deps: OutboundDeps, outboundId: string): Promise<SendOutcome> {
  if (messagingDisabled(process.env)) return { status: "skipped", reason: "messaging_disabled" };
  await deps.guard?.();
  const original = await unwrap<Row | null>("channel.original", deps.db.from("outbound_messages").select("*").eq("id", outboundId).maybeSingle());
  if (!original?.binding) throw new Error("Original outbound operation missing");
  const adapter = deps.adapters[original.channel as Channel];
  if (!adapter) return { status: "skipped", reason: "no_adapter" };
  if (!adapter.configured) return { status: "skipped", reason: "not_configured" };
  const claim = await claimOutbound(deps.db, outboundId);
  let row = claim.row;
  if (claim.claimed) {
    try {
      await deps.guard?.();
      if (messagingDisabled(process.env)) throw new Error("Messaging disabled before provider call");
      if (!claim.link?.externalId) throw new Error("Missing claimed destination");
      const pinned = claim.link;
      const result = await boundedSend(() => adapter.send(pinned.externalId!, row.payload as unknown as OutboundPayload, { link: pinned, template: claim.template }));
      row = await finishOutbound(deps.db, String(row.id), claim.attempt, result);
    } catch {
      // Even persistence failure after provider acceptance must not lead to a resend.
      try { row = await finishOutbound(deps.db, String(row.id), claim.attempt, null); } catch { /* durable claim remains non-retryable */ }
      return { status: "uncertain", ledgerId: String(row.id), error: "provider_outcome_unknown" };
    }
  }
  const ledgerId = String(row.id);
  if (row.status === "sent") {
    try { await projectOutbound(deps.db, ledgerId); }
    catch { deps.log?.("channels.thread_projection_pending", { accountId: original.account_id, ledgerId }); }
    return { status: "sent", ledgerId, externalMsgId: row.external_msg_id ? String(row.external_msg_id) : null };
  }
  if (row.status === "queued") return { status: "queued", ledgerId };
  if (row.status === "cancelled") return { status: "skipped", reason: "cancelled" };
  return { status: row.status === "failed" ? "failed" : "uncertain", ledgerId, error: "provider_outcome_unknown" };
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
  /** True only on provider acceptance, never merely because delivery was queued. */
  delivered: boolean;
}

export async function pushToAccount(deps: OutboundDeps, input: PushInput): Promise<PushReport> {
  const report: PushReport = { sent: 0, failed: 0, queued: 0, quiet: 0, skipped: 0, delivered: false };
  const now = deps.now();
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
    if (await alreadyPushed(deps.db, input.accountId, link.id, input.ref, input.contextGeneration ?? 0, link.bindingVersion)) continue;
    const out = await sendOnLink(deps, link, input.kind, input.payload, { contextGeneration: input.contextGeneration, ref: input.ref, allowTemplate: input.allowTemplate, appendToThread: true });
    if (out.status === "sent") {
      report.sent++;
    } else if (out.status === "queued") report.queued++;
    else if (out.status === "failed" || out.status === "uncertain") report.failed++;
    else report.skipped++;
  }
  report.delivered = report.sent > 0;
  return report;
}

// ---------- WhatsApp queue ----------

/** Send what waited for the window. Called on every inbound message (the window just opened). */
export async function flushQueued(deps: OutboundDeps, link: ChannelLink, contextGeneration = 0): Promise<number> {
  if (link.channel !== "whatsapp" || !link.externalId) return 0;
  const adapter = deps.adapters.whatsapp;
  if (!adapter?.configured) return 0;
  const rows = await unwrap<Row[]>("outbound_messages.select", deps.db.from("outbound_messages").select("*")
    .eq("account_id", link.accountId).eq("context_generation", contextGeneration).eq("captured_link_id", link.id)
    .eq("binding_version", link.bindingVersion).eq("status", "queued").order("created_at", { ascending: true }).limit(20));
  let flushed = 0;
  for (const raw of rows) {
    const result = await sendOnLink(deps, link, raw.kind as OutboundKind, raw.payload as unknown as OutboundPayload,
      { contextGeneration, ref: String(raw.ref), appendToThread: raw.append_thread === true, allowTemplate: raw.allow_template === true, allowPaused: raw.allow_paused === true,
        replyContext: raw.reply_context as unknown as ReplyContext | undefined });
    if (result.status === "sent") flushed++;
  }
  return flushed;
}
