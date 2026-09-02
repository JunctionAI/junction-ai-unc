/* SMS — Twilio. Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (the E.164 number
   founders text). Inbound: Twilio POSTs form fields (From, Body, MessageSid) signed as
   X-Twilio-Signature = base64(HMAC-SHA1(auth token, <full URL> + <sorted key+value pairs>)).
   The URL must be the exact public URL Twilio hit (APP_URL + /api/webhooks/twilio).
   Outbound: POST /2010-04-01/Accounts/{sid}/Messages.json with basic auth. Text has no
   buttons — approvals go as "Reply YES <id>, HOLD <id> or WHY <id>", parsed by
   parseSmsKeyword. */

import { createHmac, timingSafeEqual } from "node:crypto";
import { shortId } from "../types";
import type { ChannelAdapter, Env, FetchLike, InboundEvent, OutboundPayload, SendOptions, SendResult } from "../types";

export const TWILIO_API = "https://api.twilio.com/2010-04-01";
export const SMS_MAX_CHARS = 1500; // Twilio concatenates up to 10 segments; keep briefs under this

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string;
}

export function twilioConfig(env: Env): TwilioConfig | null {
  const accountSid = (env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = (env.TWILIO_AUTH_TOKEN || "").trim();
  const from = (env.TWILIO_FROM || "").trim();
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

export const smsDeepLink = (from: string, code: string) => `sms:${from}?&body=${encodeURIComponent(code)}`;

/** Twilio's request signature: URL + params sorted by key, each key immediately followed by its value. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/** Verify FIRST. `params` = the form fields, `url` = the exact URL Twilio was configured with. */
export function verifyTwilioWebhook(url: string, params: Record<string, string>, header: string | null, authToken: string): boolean {
  if (!header || !authToken) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params), "utf8");
  const provided = Buffer.from(header.trim(), "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function formToRecord(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(rawBody)) out[k] = v;
  return out;
}

export const normaliseE164 = (v: string) => {
  const digits = v.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
};

export function parseTwilioInbound(params: Record<string, string>): InboundEvent[] {
  const from = params.From?.trim();
  const sid = params.MessageSid?.trim() || params.SmsMessageSid?.trim();
  const text = (params.Body ?? "").trim();
  if (!from || !sid || !text) return [];
  return [{ channel: "sms", externalId: normaliseE164(from), externalMsgId: sid, text, handle: from }];
}

/** "YES", "yes 1a2b3c4d", "hold", "why 1a2b" → a decision keyword and an optional short id. */
export function parseSmsKeyword(text: string): { verb: "approve" | "hold" | "why"; short: string | null } | null {
  const m = /^\s*(yes|y|approve|approved|ok|okay|go|hold|no|n|wait|stop|why|\?)\b[\s:,-]*([a-f0-9]{4,12})?\s*$/i.exec(text);
  if (!m) return null;
  const w = m[1].toLowerCase();
  const verb = ["yes", "y", "approve", "approved", "ok", "okay", "go"].includes(w) ? "approve" : ["hold", "no", "n", "wait", "stop"].includes(w) ? "hold" : "why";
  return { verb, short: m[2] ? m[2].toLowerCase() : null };
}

/** Text-only rendering of approval buttons. */
export function smsButtonsLine(approvalId: string): string {
  const s = shortId(approvalId);
  return `Reply YES ${s} to approve, HOLD ${s} to hold, or WHY ${s} for my reasoning.`;
}

export class TwilioAdapter implements ChannelAdapter {
  readonly channel = "sms" as const;
  readonly configured: boolean;
  constructor(
    private readonly config: TwilioConfig | null,
    private readonly fetchFn: FetchLike,
  ) {
    this.configured = !!config;
  }

  async send(to: string, payload: OutboundPayload, _opts: SendOptions): Promise<SendResult> {
    void _opts;
    if (!this.config) return { ok: false, error: "not configured" };
    let body = payload.text;
    const ap = payload.buttons?.find((b) => b.id.startsWith("ap:"));
    if (ap) body += `\n${smsButtonsLine(ap.id.split(":")[1] ?? "")}`;
    body = body.slice(0, SMS_MAX_CHARS);
    try {
      const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`, "utf8").toString("base64");
      const res = await this.fetchFn(`${TWILIO_API}/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${auth}` },
        body: new URLSearchParams({ To: to, From: this.config.from, Body: body }).toString(),
      });
      const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
      if (!res.ok) return { ok: false, error: `twilio ${res.status}${json.code ? ` (${json.code})` : ""}${json.message ? `: ${json.message.slice(0, 120)}` : ""}` };
      return { ok: true, externalMsgId: json.sid ?? null };
    } catch (err) {
      return { ok: false, error: `twilio: ${err instanceof Error ? err.name : "network"}` };
    }
  }
}
