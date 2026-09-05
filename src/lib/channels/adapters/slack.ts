/* Slack — one Slack app, installed per workspace (OAuth v2; the bot token is sealed in
   channel_secrets per team). Env: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET.

   Inbound (one URL for both the Events API and Interactivity): every request is verified
   FIRST with X-Slack-Signature = "v0=" + HMAC-SHA256(signing secret, "v0:<ts>:<raw body>")
   and a 5-minute timestamp window. `url_verification` answers the challenge; `message` in a
   DM (channel_type "im", no bot_id / subtype) and `app_mention` are turns; `block_actions`
   (form field `payload`) are presses, value = our OutboundButton id.
   Outbound: chat.postMessage into the founder's DM (conversations.open once, cached on the
   link's meta.dm_channel), Block Kit buttons for approvals. Token per workspace, never in env. */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, Env, FetchLike, InboundEvent, OutboundPayload, SendOptions, SendResult } from "../types";

export const SLACK_API = "https://slack.com/api";
export const SLACK_SIGNATURE_WINDOW_S = 5 * 60;
export const SLACK_SCOPES = ["chat:write", "im:history", "im:write", "im:read", "app_mentions:read", "users:read"];

export interface SlackConfig {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
}

export function slackConfig(env: Env): SlackConfig | null {
  const clientId = (env.SLACK_CLIENT_ID || "").trim();
  const clientSecret = (env.SLACK_CLIENT_SECRET || "").trim();
  const signingSecret = (env.SLACK_SIGNING_SECRET || "").trim();
  if (!clientId || !clientSecret || !signingSecret) return null;
  return { clientId, clientSecret, signingSecret };
}

export const slackSignature = (signingSecret: string, timestamp: string, rawBody: string | Buffer) => `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:`).update(rawBody).digest("hex")}`;

/** Verify FIRST: signature over "v0:<ts>:<raw body>", and the timestamp within 5 minutes of now (replay guard). */
export function verifySlackWebhook(rawBody: string | Buffer, headers: { signature: string | null; timestamp: string | null }, signingSecret: string, now: Date): boolean {
  if (!headers.signature || !headers.timestamp || !signingSecret) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > SLACK_SIGNATURE_WINDOW_S) return false;
  const expected = Buffer.from(slackSignature(signingSecret, headers.timestamp, rawBody), "utf8");
  const provided = Buffer.from(headers.signature.trim(), "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export type SlackInbound = { kind: "challenge"; challenge: string } | { kind: "events"; events: InboundEvent[] };

type SlackEvent = { type?: string; channel_type?: string; user?: string; bot_id?: string; subtype?: string; text?: string; channel?: string; ts?: string; thread_ts?: string; event_ts?: string };
type SlackEventBody = { type?: string; challenge?: string; team_id?: string; event?: SlackEvent; event_id?: string };
type SlackAction = { action_id?: string; value?: string; block_id?: string };
type SlackInteraction = { type?: string; user?: { id?: string; username?: string; name?: string }; team?: { id?: string }; actions?: SlackAction[]; response_url?: string; trigger_id?: string; container?: { channel_id?: string; message_ts?: string }; message?: { ts?: string; thread_ts?: string } };

// Keep timestamps as exact strings for threading; Number loses provider precision.
const isSlackTimestamp = (v: unknown): v is string => typeof v === "string"
  && /^\d{1,12}(?:\.\d{1,6})?$/.test(v) && Number(v) > 0;
const isSlackId = (v: unknown): v is string => typeof v === "string" && /^[A-Z][A-Z0-9]{1,63}$/.test(v);

const stripMentions = (t: string) => t.replace(/<@[A-Z0-9]+>/g, " ").replace(/\s+/g, " ").trim();

/** JSON body (Events API). */
export function parseSlackEvent(raw: unknown): SlackInbound {
  if (!raw || typeof raw !== "object") return { kind: "events", events: [] };
  const body = raw as SlackEventBody;
  if (body.type === "url_verification" && typeof body.challenge === "string") return { kind: "challenge", challenge: body.challenge };
  if (body.type !== "event_callback" || !body.event || !isSlackId(body.team_id)) return { kind: "events", events: [] };
  const e = body.event;
  if (e.bot_id || e.subtype || !isSlackId(e.user) || !isSlackId(e.channel) || !isSlackTimestamp(e.ts)
    || (e.thread_ts !== undefined && !isSlackTimestamp(e.thread_ts))) return { kind: "events", events: [] };
  const isDm = e.type === "message" && e.channel_type === "im";
  const isMention = e.type === "app_mention";
  if (!isDm && !isMention) return { kind: "events", events: [] };
  const text = stripMentions(typeof e.text === "string" ? e.text : "");
  if (!text) return { kind: "events", events: [] };
  return { kind: "events", events: [{ channel: "slack", externalId: e.user, externalMsgId: `${e.channel}:${e.ts}`, text, scopeId: body.team_id,
    conversationId: e.channel, threadId: e.thread_ts ?? e.ts, at: new Date(Number(e.ts) * 1000).toISOString() }] };
}

/** Form body (Interactivity): payload=<json>. */
export function parseSlackInteraction(payloadJson: string): InboundEvent[] {
  let p: SlackInteraction;
  try {
    p = JSON.parse(payloadJson) as SlackInteraction;
  } catch {
    return [];
  }
  if (!p || p.type !== "block_actions" || !isSlackId(p.user?.id) || !isSlackId(p.team?.id)
    || !isSlackId(p.container?.channel_id) || !isSlackTimestamp(p.container?.message_ts)
    || (p.message?.ts !== undefined && p.message.ts !== p.container.message_ts)
    || (p.message?.thread_ts !== undefined && !isSlackTimestamp(p.message.thread_ts))) return [];
  const action = Array.isArray(p.actions) ? p.actions.find((a) => a && typeof a.value === "string" && a.value) : undefined;
  if (!action?.value) return [];
  const key = `${p.container.channel_id}:${p.container.message_ts}`;
  return [{ channel: "slack", externalId: p.user.id, externalMsgId: `act:${key}:${action.value}`, action: action.value, ackRef: p.response_url,
    scopeId: p.team.id, conversationId: p.container.channel_id, threadId: p.message?.thread_ts ?? p.container.message_ts, handle: p.user.username ?? p.user.name }];
}

/** Body of a request that is either JSON (events) or form-encoded (interactivity). */
export function parseSlackBody(rawBody: string, contentType: string | null): SlackInbound {
  if ((contentType ?? "").includes("application/x-www-form-urlencoded")) {
    const payload = new URLSearchParams(rawBody).get("payload");
    return { kind: "events", events: payload ? parseSlackInteraction(payload) : [] };
  }
  try {
    return parseSlackEvent(JSON.parse(rawBody));
  } catch {
    return { kind: "events", events: [] };
  }
}

export function slackBlocks(payload: OutboundPayload): unknown[] {
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: payload.text.slice(0, 3000) } }];
  if (payload.buttons?.length) blocks.push({ type: "actions", elements: payload.buttons.map((b) => ({ type: "button", text: { type: "plain_text", text: b.label }, value: b.id, action_id: b.id })) });
  return blocks;
}

export function slackAuthorizeUrl(config: SlackConfig, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: config.clientId, scope: SLACK_SCOPES.join(","), redirect_uri: redirectUri, state });
  return `https://slack.com/oauth/v2/authorize?${q.toString()}`;
}

export interface SlackInstall {
  botToken: string;
  teamId: string;
  teamName: string | null;
  botUserId: string | null;
  userId: string;
}

/** oauth.v2.access — never throws past here; returns null on any failure (no token in the error). */
export async function slackExchangeCode(fetchFn: FetchLike, config: SlackConfig, code: string, redirectUri: string): Promise<SlackInstall | null> {
  try {
    const res = await fetchFn(`${SLACK_API}/oauth.v2.access`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }).toString(),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; access_token?: string; team?: { id?: string; name?: string }; authed_user?: { id?: string }; bot_user_id?: string };
    if (!res.ok || !j.ok || !j.access_token || !j.team?.id || !j.authed_user?.id) return null;
    return { botToken: j.access_token, teamId: j.team.id, teamName: j.team.name ?? null, botUserId: j.bot_user_id ?? null, userId: j.authed_user.id };
  } catch {
    return null;
  }
}

/** Bot token per workspace: resolved by the caller (channel_secrets), never read from env. */
export type SlackTokenResolver = (teamId: string) => Promise<string | null>;

export class SlackAdapter implements ChannelAdapter {
  readonly channel = "slack" as const;
  readonly configured: boolean;
  constructor(
    private readonly config: SlackConfig | null,
    private readonly fetchFn: FetchLike,
    private readonly tokenFor: SlackTokenResolver,
    private readonly rememberDm?: (linkId: string, dmChannel: string) => Promise<void>,
  ) {
    this.configured = !!config;
  }

  private async api(token: string, method: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
    try {
      const res = await this.fetchFn(`${SLACK_API}/${method}`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.ok !== true) return { ok: false, data, error: `slack ${method} ${res.status}${typeof data.error === "string" ? `: ${data.error}` : ""}` };
      return { ok: true, data };
    } catch (err) {
      return { ok: false, data: {}, error: `slack ${method}: ${err instanceof Error ? err.name : "network"}` };
    }
  }

  async send(to: string, payload: OutboundPayload, opts: SendOptions): Promise<SendResult> {
    if (!this.config) return { ok: false, error: "not configured" };
    const teamId = typeof opts.link.meta.team_id === "string" ? opts.link.meta.team_id : null;
    if (!teamId) return { ok: false, error: "slack link has no workspace" };
    const token = await this.tokenFor(teamId);
    if (!token) return { ok: false, error: "slack workspace token missing — reinstall" };
    let dm = typeof opts.link.meta.dm_channel === "string" ? opts.link.meta.dm_channel : null;
    if (!dm) {
      const opened = await this.api(token, "conversations.open", { users: to });
      if (!opened.ok) return { ok: false, error: opened.error ?? "conversations.open failed" };
      dm = String((opened.data.channel as { id?: string } | undefined)?.id ?? "");
      if (!dm) return { ok: false, error: "conversations.open returned no channel" };
      await this.rememberDm?.(opts.link.id, dm);
    }
    const posted = await this.api(token, "chat.postMessage", { channel: dm, text: payload.text.slice(0, 4000), blocks: slackBlocks(payload) });
    if (!posted.ok) return { ok: false, error: posted.error ?? "chat.postMessage failed" };
    const ts = typeof posted.data.ts === "string" ? posted.data.ts : null;
    return { ok: true, externalMsgId: ts ? `${dm}:${ts}` : null };
  }

  /** Replace the buttons on the pressed message with the receipt line. */
  async ack(event: InboundEvent, text?: string): Promise<void> {
    if (!event.ackRef || !/^https:\/\/hooks\.slack\.com\//.test(event.ackRef)) return;
    try {
      await this.fetchFn(event.ackRef, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ replace_original: true, text: text ?? "Got it." }) });
    } catch {
      /* the response_url is best-effort; the real reply goes through send() */
    }
  }
}
