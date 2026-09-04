/* channel_links — issue a one-time link code, verify it from the device, list / unlink /
   prefs. Every writer here runs under the SERVICE ROLE (members only read the table); the
   API routes check the session first.

   Link-code lifecycle:
     issueLinkCode      one pending row per (account, channel) — re-issuing replaces the code
     consumeLinkCode    the device sends the code → the row gets external_id / handle /
                        display_name / verified_at, the code is cleared. Expired or unknown
                        codes are refused; a previously linked external id moves to the new
                        account (the person holding the device proved it is theirs).
   Codes look like UNC-7K3P9M (no 0/O/1/I), 10-minute TTL.

   Relative imports only (worker-buildable). */

import { randomBytes } from "node:crypto";
import { unwrap, type DbClient, type Row } from "../db/types";
import { CHANNEL_LABEL, DEFAULT_PREFS, isChannel, type Channel, type ChannelLink, type ChannelPrefs, type QuietHours } from "./types";

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const LINK_CODE_PREFIX = "UNC-";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O/1/I
const CODE_LEN = 6;

const LINK_COLS = "id, account_id, user_id, channel, external_id, handle, display_name, verified_at, link_code, link_code_expires_at, prefs, meta, last_inbound_at, created_at";

export function newLinkCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return LINK_CODE_PREFIX + s;
}

/** Normalise whatever the founder typed / the deep link carried into the stored form. */
export function normaliseLinkCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase().replace(/^\/START\s+/i, "").replace(/\s+/g, "");
  const m = /^(?:UNC-?)?([A-Z2-9]{6})$/.exec(t);
  return m ? LINK_CODE_PREFIX + m[1] : null;
}

/** True when a message is (only) a link code — the "link me" handshake. */
export const looksLikeLinkCode = (text: string | undefined | null) => {
  if (!text || normaliseLinkCode(text) === null) return false;
  // Six-letter words such as "thanks" and "cancel" are conversation, not codes.
  // The UI always supplies UNC-; bare mixed codes remain backwards-compatible.
  return /^(?:\/start\s+|unc[-\s]?)/i.test(text.trim()) || /[2-9]/.test(text);
};

export function normalisePrefs(raw: unknown): ChannelPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return { brief: bool(o.brief, DEFAULT_PREFS.brief), approvals: bool(o.approvals, DEFAULT_PREFS.approvals), drafts: bool(o.drafts, DEFAULT_PREFS.drafts), quiet_hours: normaliseQuietHours(o.quiet_hours) };
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normaliseQuietHours(raw: unknown): QuietHours | null {
  if (!raw || typeof raw !== "object") return null;
  const { start, end } = raw as Record<string, unknown>;
  if (typeof start !== "string" || typeof end !== "string" || !HHMM.test(start) || !HHMM.test(end) || start === end) return null;
  return { start, end };
}

export function rowToLink(r: Row): ChannelLink {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    userId: r.user_id ? String(r.user_id) : null,
    channel: r.channel as Channel,
    externalId: r.external_id ? String(r.external_id) : null,
    handle: r.handle ? String(r.handle) : null,
    displayName: r.display_name ? String(r.display_name) : null,
    verifiedAt: r.verified_at ? String(r.verified_at) : null,
    linkCode: r.link_code ? String(r.link_code) : null,
    linkCodeExpiresAt: r.link_code_expires_at ? String(r.link_code_expires_at) : null,
    prefs: normalisePrefs(r.prefs),
    meta: r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : {},
    lastInboundAt: r.last_inbound_at ? String(r.last_inbound_at) : null,
    createdAt: String(r.created_at ?? ""),
  };
}

// ---------- read ----------

export async function listLinks(db: DbClient, accountId: string): Promise<ChannelLink[]> {
  const rows = await unwrap<Row[]>("channel_links.select", db.from("channel_links").select(LINK_COLS).eq("account_id", accountId).order("created_at", { ascending: true }));
  return rows.map(rowToLink);
}

/** The account's verified destinations (what proactive pushes go to). */
export async function verifiedLinks(db: DbClient, accountId: string): Promise<ChannelLink[]> {
  return (await listLinks(db, accountId)).filter((l) => !!l.verifiedAt && !!l.externalId);
}

export async function getLink(db: DbClient, linkId: string): Promise<ChannelLink | null> {
  const row = await unwrap<Row | null>("channel_links.select", db.from("channel_links").select(LINK_COLS).eq("id", linkId).maybeSingle());
  return row ? rowToLink(row) : null;
}

/** Who is this sender? null = not linked (or not yet verified). */
export async function findVerifiedLink(db: DbClient, channel: Channel, externalId: string): Promise<ChannelLink | null> {
  const row = await unwrap<Row | null>("channel_links.select", db.from("channel_links").select(LINK_COLS).eq("channel", channel).eq("external_id", externalId).maybeSingle());
  const link = row ? rowToLink(row) : null;
  return link && link.verifiedAt ? link : null;
}

/** Every account with at least one verified link — the worker's push set. */
export async function accountsWithLinks(db: DbClient): Promise<string[]> {
  const rows = await unwrap<{ account_id: string; verified_at: string | null }[]>("channel_links.select", db.from("channel_links").select("account_id, verified_at"));
  return [...new Set(rows.filter((r) => !!r.verified_at).map((r) => r.account_id))];
}

// ---------- link code ----------

export interface IssuedCode {
  linkId: string;
  code: string;
  expiresAt: string;
}

/** One pending row per (account, channel); a second call re-issues the code on the same row.
    An already-verified link on that channel is left alone — a new pending row is created so
    a second device can be added. */
export async function issueLinkCode(db: DbClient, input: { accountId: string; userId: string | null; channel: Channel; now: Date; ttlMs?: number }): Promise<IssuedCode> {
  const code = newLinkCode();
  const expiresAt = new Date(input.now.getTime() + (input.ttlMs ?? LINK_CODE_TTL_MS)).toISOString();
  const pending = (await listLinks(db, input.accountId)).find((l) => l.channel === input.channel && !l.verifiedAt);
  if (pending) {
    await unwrap("channel_links.update", db.from("channel_links").update({ link_code: code, link_code_expires_at: expiresAt, user_id: input.userId }).eq("id", pending.id));
    return { linkId: pending.id, code, expiresAt };
  }
  const row = await unwrap<{ id: string }>(
    "channel_links.insert",
    db
      .from("channel_links")
      .insert({ account_id: input.accountId, user_id: input.userId, channel: input.channel, link_code: code, link_code_expires_at: expiresAt, prefs: DEFAULT_PREFS, created_at: input.now.toISOString() })
      .select("id")
      .single(),
  );
  return { linkId: row.id, code, expiresAt };
}

export type ConsumeResult = { ok: true; link: ChannelLink; welcome: string } | { ok: false; reason: "unknown" | "expired" | "channel_mismatch" };

export interface ConsumeInput {
  code: string;
  channel: Channel;
  externalId: string;
  handle?: string | null;
  displayName?: string | null;
  now: Date;
  accountScope?: string;
}

export const welcomeLine = (channel: Channel) =>
  channel === "sms"
    ? "hey 👋 we're connected. it's the same conversation here and in the app, with every decision saved there. what do you want to tackle?"
    : `Linked. Wherever you talk to me — here on ${CHANNEL_LABEL[channel]} or in the app — it's the same conversation, and every decision still lands in the app. I'll send the morning brief and anything that needs you here.`;

export async function consumeLinkCode(db: DbClient, input: ConsumeInput): Promise<ConsumeResult> {
  const code = normaliseLinkCode(input.code);
  if (!code) return { ok: false, reason: "unknown" };
  const row = await unwrap<Row | null>("channel_links.select", db.from("channel_links").select(LINK_COLS).eq("link_code", code).maybeSingle());
  if (!row) return { ok: false, reason: "unknown" };
  const pending = rowToLink(row);
  if (input.accountScope && pending.accountId !== input.accountScope) return { ok: false, reason: "unknown" };
  if (pending.channel !== input.channel) return { ok: false, reason: "channel_mismatch" };
  if (!pending.linkCodeExpiresAt || new Date(pending.linkCodeExpiresAt).getTime() < input.now.getTime()) return { ok: false, reason: "expired" };

  // The same device linked before (to this or another account): that row goes, this one wins.
  const previous = await unwrap<{ id: string }[]>("channel_links.select", db.from("channel_links").select("id").eq("channel", input.channel).eq("external_id", input.externalId));
  for (const p of previous) if (p.id !== pending.id) await unwrap("channel_links.delete", db.from("channel_links").delete().eq("id", p.id));

  const nowIso = input.now.toISOString();
  const patch: Row = { external_id: input.externalId, handle: input.handle ?? null, display_name: input.displayName ?? null, verified_at: nowIso, link_code: null, link_code_expires_at: null, last_inbound_at: nowIso };
  await unwrap("channel_links.update", db.from("channel_links").update(patch).eq("id", pending.id));
  const link = { ...pending, externalId: input.externalId, handle: input.handle ?? null, displayName: input.displayName ?? null, verifiedAt: nowIso, linkCode: null, linkCodeExpiresAt: null, lastInboundAt: nowIso };
  return { ok: true, link, welcome: welcomeLine(input.channel) };
}

/** Slack has no code: the OAuth install verifies the installing user directly. */
export async function upsertVerifiedLink(
  db: DbClient,
  input: { accountId: string; userId: string | null; channel: Channel; externalId: string; handle?: string | null; displayName?: string | null; meta?: Record<string, unknown>; now: Date },
): Promise<ChannelLink> {
  const nowIso = input.now.toISOString();
  const existing = await unwrap<Row | null>("channel_links.select", db.from("channel_links").select(LINK_COLS).eq("channel", input.channel).eq("external_id", input.externalId).maybeSingle());
  if (existing) {
    const patch: Row = { account_id: input.accountId, user_id: input.userId, handle: input.handle ?? null, display_name: input.displayName ?? null, verified_at: nowIso, link_code: null, link_code_expires_at: null, meta: { ...((existing.meta as Record<string, unknown>) ?? {}), ...(input.meta ?? {}) } };
    await unwrap("channel_links.update", db.from("channel_links").update(patch).eq("id", existing.id));
    return rowToLink({ ...existing, ...patch });
  }
  // a pending code row for this channel becomes the verified one
  const pending = (await listLinks(db, input.accountId)).find((l) => l.channel === input.channel && !l.verifiedAt);
  if (pending) {
    const patch: Row = { user_id: input.userId, external_id: input.externalId, handle: input.handle ?? null, display_name: input.displayName ?? null, verified_at: nowIso, link_code: null, link_code_expires_at: null, meta: input.meta ?? {} };
    await unwrap("channel_links.update", db.from("channel_links").update(patch).eq("id", pending.id));
    return { ...pending, userId: input.userId, externalId: input.externalId, handle: input.handle ?? null, displayName: input.displayName ?? null, verifiedAt: nowIso, linkCode: null, linkCodeExpiresAt: null, meta: input.meta ?? {} };
  }
  const row = await unwrap<Row>(
    "channel_links.insert",
    db
      .from("channel_links")
      .insert({ account_id: input.accountId, user_id: input.userId, channel: input.channel, external_id: input.externalId, handle: input.handle ?? null, display_name: input.displayName ?? null, verified_at: nowIso, prefs: DEFAULT_PREFS, meta: input.meta ?? {}, created_at: nowIso })
      .select(LINK_COLS)
      .single(),
  );
  return rowToLink(row);
}

// ---------- maintain ----------

export async function updatePrefs(db: DbClient, accountId: string, linkId: string, patch: Partial<ChannelPrefs>): Promise<ChannelLink | null> {
  const link = await getLink(db, linkId);
  if (!link || link.accountId !== accountId) return null;
  const prefs = normalisePrefs({ ...link.prefs, ...patch });
  await unwrap("channel_links.update", db.from("channel_links").update({ prefs }).eq("id", linkId));
  return { ...link, prefs };
}

export async function mergeMeta(db: DbClient, linkId: string, meta: Record<string, unknown>): Promise<void> {
  const link = await getLink(db, linkId);
  if (!link) return;
  await unwrap("channel_links.update", db.from("channel_links").update({ meta: { ...link.meta, ...meta } }).eq("id", linkId));
}

export async function unlink(db: DbClient, accountId: string, linkId: string): Promise<boolean> {
  const link = await getLink(db, linkId);
  if (!link || link.accountId !== accountId) return false;
  await unwrap("channel_links.delete", db.from("channel_links").delete().eq("id", linkId));
  return true;
}

/** Every inbound message refreshes the WhatsApp 24-hour window (and is useful on every channel). */
export async function touchInbound(db: DbClient, linkId: string, now: Date): Promise<void> {
  await unwrap("channel_links.update", db.from("channel_links").update({ last_inbound_at: now.toISOString() }).eq("id", linkId));
}

/** Parse a channel out of untrusted input. */
export function channelFrom(v: unknown): Channel | null {
  return isChannel(v) ? v : null;
}
