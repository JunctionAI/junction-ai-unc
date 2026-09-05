/* Channels — shared shapes. "Wherever you talk to me, it's the same conversation — and every
   decision still lands in the app."

   A Channel is a place Unc can reach the founder outside the app. Every turn said on one is
   written to the same chat_messages thread ('corner') with `channel` set, so the app's corner
   chat and the channel are one conversation (docs/CHANNELS.md).

   Relative imports only — the worker build (src/worker/channels.ts) reaches these. */

export type Channel = "telegram" | "whatsapp" | "slack" | "sms" | "email" | "apple";
export const CHANNELS: readonly Channel[] = ["telegram", "whatsapp", "slack", "sms", "email", "apple"] as const;
export const isChannel = (v: unknown): v is Channel => typeof v === "string" && (CHANNELS as readonly string[]).includes(v);

/** Where a chat turn was said. 'app' = the corner chat in the product. */
export type MessageChannel = Channel | "app";

export const CHANNEL_LABEL: Record<Channel, string> = { telegram: "Telegram", whatsapp: "WhatsApp", slack: "Slack", sms: "Text", email: "Email", apple: "Apple Messages" };

export interface QuietHours {
  /** "HH:MM" local to the account's timezone (account_profiles.cadence.timezone). */
  start: string;
  end: string;
}

export interface ChannelPrefs {
  brief: boolean;
  approvals: boolean;
  drafts: boolean;
  quiet_hours: QuietHours | null;
}

export const DEFAULT_PREFS: ChannelPrefs = { brief: true, approvals: true, drafts: true, quiet_hours: null };

export interface ChannelLink {
  id: string;
  accountId: string;
  /** Database-managed identity revision, independent of the account's context generation. */
  bindingVersion: number;
  /** Pending codes cannot be reused after a business-context reset. */
  linkCodeGeneration: number | null;
  /** The founder who linked it — decided_by for decisions taken on this channel. */
  userId: string | null;
  channel: Channel;
  /** null until verified. */
  externalId: string | null;
  handle: string | null;
  displayName: string | null;
  verifiedAt: string | null;
  linkCode: string | null;
  linkCodeExpiresAt: string | null;
  prefs: ChannelPrefs;
  meta: Record<string, unknown>;
  lastInboundAt: string | null;
  createdAt: string;
}

/** Outbound kinds — the ledger's vocabulary. */
export type OutboundKind = "reply" | "brief" | "approval" | "draft_landed" | "reminder" | "link" | "system";

/** A button on an outbound message. `id` is what comes back as the action (callback data /
    button id / block value): "ap:<approvalId>:approve|hold|why". */
export interface OutboundButton {
  id: string;
  label: string;
}

export interface OutboundPayload {
  text: string;
  buttons?: OutboundButton[];
}

export type SendResult = { ok: true; externalMsgId: string | null } | { ok: false; error: string };

export interface SendOptions {
  link: ChannelLink;
  /** WhatsApp: send as the approved template (outside the 24-hour window). */
  template?: boolean;
}

/** One inbound thing from a channel, normalised. Exactly one of `text` / `action` is set. */
export interface InboundEvent {
  /** Only a verified provider event may set this; not inferred from customer prose. */
  lifecycle?: "conversation_closed";
  channel: Channel;
  /** The sender's id on the platform — the link's external_id. */
  externalId: string;
  /** Platform message id, unique per channel (Telegram: "<chat>:<message_id>"). */
  externalMsgId: string;
  text?: string;
  /** A button press: the OutboundButton id that was pressed. */
  action?: string;
  /** Platform handle for acknowledging the press (Telegram callback_query id, Slack response_url). */
  ackRef?: string;
  handle?: string;
  displayName?: string;
  /** Slack: the workspace the event came from (selects the bot token). */
  scopeId?: string;
  /** Provider conversation, distinct from the sender. Metadata, NOT account authority. */
  conversationId?: string;
  /** Provider thread root; for a new Slack thread this is the inbound message ts. */
  threadId?: string;
  /** Trusted ingress restriction for a single-account pilot. Never parsed from customer text. */
  accountScope?: string;
  at?: string;
}

export interface ChannelAdapter {
  channel: Channel;
  /** All env for this channel is present. */
  configured: boolean;
  send(to: string, payload: OutboundPayload, opts: SendOptions): Promise<SendResult>;
  /** Acknowledge a button press where the platform expects it (Telegram answerCallbackQuery). */
  ack?(event: InboundEvent, text?: string): Promise<void>;
}

/** The approval-button ids. Kept short: Telegram callback_data is capped at 64 bytes. */
export const approvalButtonId = (approvalId: string, verb: "approve" | "hold" | "why") => `ap:${approvalId}:${verb}`;

export function parseApprovalButton(id: string | undefined | null): { approvalId: string; verb: "approve" | "hold" | "why" } | null {
  if (!id) return null;
  const m = /^ap:([A-Za-z0-9-]{4,64}):(approve|hold|why)$/.exec(id.trim());
  return m ? { approvalId: m[1], verb: m[2] as "approve" | "hold" | "why" } : null;
}

export function approvalButtons(approvalId: string): OutboundButton[] {
  return [
    { id: approvalButtonId(approvalId, "approve"), label: "Approve" },
    { id: approvalButtonId(approvalId, "hold"), label: "Hold" },
    { id: approvalButtonId(approvalId, "why"), label: "Why" },
  ];
}

/** First 8 characters of an approval id — what a text-only channel (SMS) types back. */
export const shortId = (id: string) => id.replace(/-/g, "").slice(0, 8).toLowerCase();

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type Env = Record<string, string | undefined>;
