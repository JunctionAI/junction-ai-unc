/* Telegram — a BotFather bot. Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (the
   secret_token you register the webhook with), TELEGRAM_BOT_USERNAME (for the deep link).

   Inbound: Telegram POSTs an Update; the header X-Telegram-Bot-Api-Secret-Token must equal
   TELEGRAM_WEBHOOK_SECRET (timing-safe). `message.text` is a turn ("/start UNC-XXXXXX" is
   the link handshake); `callback_query.data` is a button press ("ap:<id>:approve").
   Outbound: sendMessage with an inline keyboard for approvals; answerCallbackQuery to clear
   the spinner on a press. Telegram message ids are per chat, so external ids are
   "<chat_id>:<message_id>". Nothing here logs a token. */

import { timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, Env, FetchLike, InboundEvent, OutboundPayload, SendOptions, SendResult } from "../types";

export const TELEGRAM_API = "https://api.telegram.org";
export const TELEGRAM_MAX_TEXT = 4096;

export interface TelegramConfig {
  botToken: string;
  webhookSecret: string;
  botUsername: string | null;
}

export function telegramConfig(env: Env): TelegramConfig | null {
  const botToken = (env.TELEGRAM_BOT_TOKEN || "").trim();
  const webhookSecret = (env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (!botToken || !webhookSecret) return null;
  const botUsername = (env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "") || null;
  return { botToken, webhookSecret, botUsername };
}

export const telegramDeepLink = (botUsername: string, code: string) => `https://t.me/${botUsername}?start=${encodeURIComponent(code)}`;

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Verify FIRST: the secret header Telegram echoes back from setWebhook. */
export function verifyTelegramWebhook(headers: { secretToken: string | null }, secret: string): boolean {
  return !!headers.secretToken && safeEqual(headers.secretToken.trim(), secret);
}

type TgUser = { id?: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
type TgMessage = { message_id?: number; chat?: { id?: number; type?: string }; from?: TgUser; text?: string; date?: number };
type TgUpdate = { update_id?: number; message?: TgMessage; edited_message?: TgMessage; callback_query?: { id?: string; from?: TgUser; message?: TgMessage; data?: string } };

const name = (u?: TgUser) => [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || undefined;

/** One Update → zero or one event. Edited messages, channel posts, bots and empty text are ignored. */
export function parseTelegramUpdate(raw: unknown): InboundEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const u = raw as TgUpdate;
  if (u.callback_query) {
    const cq = u.callback_query;
    const chatId = cq.message?.chat?.id ?? cq.from?.id;
    if (chatId === undefined || !cq.data || !cq.id) return [];
    return [{ channel: "telegram", externalId: String(chatId), externalMsgId: `${chatId}:cb:${cq.id}`, action: cq.data.trim(), ackRef: cq.id, handle: cq.from?.username, displayName: name(cq.from) }];
  }
  const m = u.message;
  if (!m || !m.chat || m.chat.id === undefined || m.message_id === undefined) return [];
  if (m.from?.is_bot) return [];
  const text = (m.text ?? "").trim();
  if (!text) return [];
  return [{ channel: "telegram", externalId: String(m.chat.id), externalMsgId: `${m.chat.id}:${m.message_id}`, text, handle: m.from?.username, displayName: name(m.from), at: m.date ? new Date(m.date * 1000).toISOString() : undefined }];
}

export function telegramKeyboard(buttons: OutboundPayload["buttons"]): unknown {
  if (!buttons?.length) return undefined;
  return { inline_keyboard: [buttons.map((b) => ({ text: b.label, callback_data: b.id.slice(0, 64) }))] };
}

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = "telegram" as const;
  readonly configured: boolean;
  constructor(
    private readonly config: TelegramConfig | null,
    private readonly fetchFn: FetchLike,
  ) {
    this.configured = !!config;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; description?: string }> {
    if (!this.config) return { ok: false, description: "not configured" };
    try {
      const res = await this.fetchFn(`${TELEGRAM_API}/bot${this.config.botToken}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
      if (!res.ok || !json.ok) return { ok: false, description: `telegram ${method} ${res.status}${json.description ? `: ${json.description}` : ""}` };
      return { ok: true, result: json.result };
    } catch (err) {
      return { ok: false, description: `telegram ${method}: ${err instanceof Error ? err.name : "network"}` };
    }
  }

  async send(to: string, payload: OutboundPayload, _opts: SendOptions): Promise<SendResult> {
    void _opts;
    const text = payload.text.slice(0, TELEGRAM_MAX_TEXT);
    const r = await this.call("sendMessage", { chat_id: to, text, disable_web_page_preview: true, ...(payload.buttons?.length ? { reply_markup: telegramKeyboard(payload.buttons) } : {}) });
    if (!r.ok) return { ok: false, error: r.description ?? "send failed" };
    const mid = (r.result as { message_id?: number } | undefined)?.message_id;
    return { ok: true, externalMsgId: mid !== undefined ? `${to}:${mid}` : null };
  }

  async ack(event: InboundEvent, text?: string): Promise<void> {
    if (!event.ackRef) return;
    await this.call("answerCallbackQuery", { callback_query_id: event.ackRef, ...(text ? { text: text.slice(0, 200) } : {}) });
  }
}
