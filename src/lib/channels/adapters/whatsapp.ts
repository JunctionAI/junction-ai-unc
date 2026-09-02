/* WhatsApp — Meta Cloud API (reuse Junction's existing app + number; docs/CHANNELS.md).
   Env: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN (system-user token), WHATSAPP_VERIFY_TOKEN
   (webhook verification), WHATSAPP_APP_SECRET (X-Hub-Signature-256), WHATSAPP_DISPLAY_NUMBER
   (the number founders message, for the wa.me link), WHATSAPP_BRIEF_TEMPLATE (default
   unc_brief), WHATSAPP_TEMPLATE_LANG (default en).

   Inbound: GET with hub.mode/hub.verify_token/hub.challenge verifies the webhook; POST carries
   entry[].changes[].value.messages[] signed as sha256=HMAC-SHA256(app secret, raw body).
   Text messages are turns; interactive button replies are presses (button id = our
   OutboundButton id). Status updates are ignored.
   Outbound: POST /v21.0/{phone_number_id}/messages — text, interactive reply buttons (max 3)
   or, outside the 24-hour customer-service window, the approved `unc_brief` template with
   one body parameter (whitespace squashed: template params reject newlines / 4+ spaces). */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, Env, FetchLike, InboundEvent, OutboundPayload, SendOptions, SendResult } from "../types";

export const WHATSAPP_GRAPH = "https://graph.facebook.com/v21.0";
export const WHATSAPP_MAX_BUTTONS = 3;
export const WHATSAPP_BUTTON_TITLE_MAX = 20;
export const WHATSAPP_TEMPLATE_PARAM_MAX = 1024;

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  displayNumber: string | null;
  briefTemplate: string;
  templateLang: string;
}

export function whatsappConfig(env: Env): WhatsAppConfig | null {
  const phoneNumberId = (env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const accessToken = (env.WHATSAPP_ACCESS_TOKEN || "").trim();
  const verifyToken = (env.WHATSAPP_VERIFY_TOKEN || "").trim();
  const appSecret = (env.WHATSAPP_APP_SECRET || "").trim();
  if (!phoneNumberId || !accessToken || !verifyToken || !appSecret) return null;
  return {
    phoneNumberId,
    accessToken,
    verifyToken,
    appSecret,
    displayNumber: (env.WHATSAPP_DISPLAY_NUMBER || "").replace(/[^\d]/g, "") || null,
    briefTemplate: (env.WHATSAPP_BRIEF_TEMPLATE || "unc_brief").trim(),
    templateLang: (env.WHATSAPP_TEMPLATE_LANG || "en").trim(),
  };
}

export const whatsappDeepLink = (displayNumber: string, code: string) => `https://wa.me/${displayNumber}?text=${encodeURIComponent(code)}`;

/** GET verification handshake → the challenge to echo, or null. */
export function verifyWhatsAppSubscription(query: URLSearchParams, verifyToken: string): string | null {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token") ?? "";
  const challenge = query.get("hub.challenge");
  if (mode !== "subscribe" || !challenge) return null;
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(verifyToken, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b) ? challenge : null;
}

export const whatsappSignature = (rawBody: string | Buffer, appSecret: string) => `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

/** Verify FIRST, over the RAW body. */
export function verifyWhatsAppWebhook(rawBody: string | Buffer, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const expected = Buffer.from(whatsappSignature(rawBody, appSecret), "utf8");
  const provided = Buffer.from(header.trim(), "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

type WaMessage = { from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string }; interactive?: { type?: string; button_reply?: { id?: string; title?: string } }; button?: { payload?: string; text?: string } };
type WaValue = { messaging_product?: string; contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: WaMessage[] };
type WaBody = { object?: string; entry?: { changes?: { field?: string; value?: WaValue }[] }[] };

export function parseWhatsAppWebhook(raw: unknown): InboundEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const body = raw as WaBody;
  if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return [];
  const out: InboundEvent[] = [];
  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v || !Array.isArray(v.messages)) continue;
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name ?? ""]));
      for (const m of v.messages) {
        if (!m.from || !m.id) continue;
        const base = { channel: "whatsapp" as const, externalId: m.from.replace(/[^\d]/g, ""), externalMsgId: m.id, displayName: names.get(m.from) || undefined, at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : undefined };
        if (m.type === "text" && m.text?.body?.trim()) out.push({ ...base, text: m.text.body.trim() });
        else if (m.type === "interactive" && m.interactive?.type === "button_reply" && m.interactive.button_reply?.id) out.push({ ...base, action: m.interactive.button_reply.id });
        else if (m.type === "button" && m.button?.payload) out.push({ ...base, action: m.button.payload });
      }
    }
  }
  return out;
}

/** Template parameters may not contain newlines, tabs or 4+ consecutive spaces. */
export const templateParam = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, WHATSAPP_TEMPLATE_PARAM_MAX);

export function whatsappMessageBody(to: string, payload: OutboundPayload, config: WhatsAppConfig, template: boolean): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (template) {
    return { ...base, type: "template", template: { name: config.briefTemplate, language: { code: config.templateLang }, components: [{ type: "body", parameters: [{ type: "text", text: templateParam(payload.text) }] }] } };
  }
  const buttons = (payload.buttons ?? []).slice(0, WHATSAPP_MAX_BUTTONS);
  if (buttons.length) {
    return { ...base, type: "interactive", interactive: { type: "button", body: { text: payload.text.slice(0, 1024) }, action: { buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: b.label.slice(0, WHATSAPP_BUTTON_TITLE_MAX) } })) } } };
  }
  return { ...base, type: "text", text: { preview_url: false, body: payload.text.slice(0, 4096) } };
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  readonly configured: boolean;
  constructor(
    private readonly config: WhatsAppConfig | null,
    private readonly fetchFn: FetchLike,
  ) {
    this.configured = !!config;
  }

  async send(to: string, payload: OutboundPayload, opts: SendOptions): Promise<SendResult> {
    if (!this.config) return { ok: false, error: "not configured" };
    try {
      const res = await this.fetchFn(`${WHATSAPP_GRAPH}/${this.config.phoneNumberId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.accessToken}` },
        body: JSON.stringify(whatsappMessageBody(to, payload, this.config, !!opts.template)),
      });
      const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
      if (!res.ok) return { ok: false, error: `whatsapp ${res.status}${json.error?.code ? ` (${json.error.code})` : ""}${json.error?.message ? `: ${json.error.message.slice(0, 120)}` : ""}` };
      return { ok: true, externalMsgId: json.messages?.[0]?.id ?? null };
    } catch (err) {
      return { ok: false, error: `whatsapp: ${err instanceof Error ? err.name : "network"}` };
    }
  }
}
