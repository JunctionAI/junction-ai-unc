/* Webhook receivers — verify FIRST, parse, answer fast. Pure over (headers, raw body): the
   routes under src/app/api/webhooks/<channel>/ hand these the request and run handleInbound
   on the returned events AFTER the response went back (next/server `after`).

   Every receiver returns { status, body, events }. A failed verification is 401 with no
   events (and no hint beyond "invalid signature"); an unconfigured channel is 503; a valid
   delivery we can't parse is 200 with no events (the platform must not retry it). */

import { slackConfig, verifySlackWebhook, parseSlackBody } from "./adapters/slack";
import { telegramConfig, verifyTelegramWebhook, parseTelegramUpdate } from "./adapters/telegram";
import { formToRecord, parseTwilioInbound, twilioConfig, verifyTwilioWebhook } from "./adapters/twilio";
import { parseWhatsAppWebhook, verifyWhatsAppSubscription, verifyWhatsAppWebhook, whatsappConfig } from "./adapters/whatsapp";
import type { Env, InboundEvent } from "./types";
import { messagingDisabled, messagingOriginAllowed } from "./releaseGate";

export interface ReceiveDeps {
  env: Env;
  now: () => Date;
  /** Public base URL (APP_URL) — Twilio signs the exact URL it was given. */
  appUrl: string;
}

export interface Received {
  status: 200 | 400 | 401 | 403 | 503;
  body: unknown;
  /** text/plain (WhatsApp challenge) or text/xml (Twilio) when not JSON. */
  contentType?: string;
  events: InboundEvent[];
}

const bad = (status: Received["status"], error: string): Received => ({ status, body: { error }, events: [] });

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
};

// ---------- Telegram ----------

export function receiveTelegram(deps: ReceiveDeps, req: { secretToken: string | null; rawBody: string }): Received {
  if (messagingDisabled(deps.env)) return bad(503, "messaging_disabled");
  const config = telegramConfig(deps.env);
  if (!config) return bad(503, "telegram is not configured");
  if (!verifyTelegramWebhook({ secretToken: req.secretToken }, config.webhookSecret)) return bad(401, "invalid signature");
  const update = parseJson(req.rawBody);
  if (update === null) return { status: 200, body: { ok: true, ignored: "invalid JSON" }, events: [] };
  return { status: 200, body: { ok: true }, events: parseTelegramUpdate(update) };
}

// ---------- WhatsApp ----------

export function receiveWhatsAppVerify(deps: ReceiveDeps, query: URLSearchParams): Received {
  if (messagingDisabled(deps.env)) return bad(503, "messaging_disabled");
  const config = whatsappConfig(deps.env);
  if (!config) return bad(503, "whatsapp is not configured");
  const challenge = verifyWhatsAppSubscription(query, config.verifyToken);
  if (!challenge) return bad(403, "verification failed");
  return { status: 200, body: challenge, contentType: "text/plain", events: [] };
}

export function receiveWhatsApp(deps: ReceiveDeps, req: { signature: string | null; rawBody: string }): Received {
  if (messagingDisabled(deps.env)) return bad(503, "messaging_disabled");
  const config = whatsappConfig(deps.env);
  if (!config) return bad(503, "whatsapp is not configured");
  if (!verifyWhatsAppWebhook(req.rawBody, req.signature, config.appSecret)) return bad(401, "invalid signature");
  const body = parseJson(req.rawBody);
  if (body === null) return { status: 200, body: { ok: true, ignored: "invalid JSON" }, events: [] };
  return { status: 200, body: { ok: true }, events: parseWhatsAppWebhook(body) };
}

// ---------- Slack (Events API + Interactivity on one URL) ----------

export function receiveSlack(deps: ReceiveDeps, req: { signature: string | null; timestamp: string | null; contentType: string | null; rawBody: string }): Received {
  const config = slackConfig(deps.env);
  if (!config) return bad(503, "slack is not configured");
  if (!verifySlackWebhook(req.rawBody, { signature: req.signature, timestamp: req.timestamp }, config.signingSecret, deps.now())) return bad(401, "invalid signature");
  const parsed = parseSlackBody(req.rawBody, req.contentType);
  if (parsed.kind === "challenge") return { status: 200, body: { challenge: parsed.challenge }, events: [] };
  if (messagingDisabled(deps.env)) return bad(503, "messaging_disabled");
  return { status: 200, body: { ok: true }, events: parsed.events.filter(e => messagingOriginAllowed(deps.env, e, deps.now().getTime())) };
}

// ---------- Twilio (SMS) ----------

export const TWILIO_WEBHOOK_PATH = "/api/webhooks/twilio";
export const EMPTY_TWIML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>";

export function receiveTwilio(deps: ReceiveDeps, req: { signature: string | null; rawBody: string; url?: string }): Received {
  if (messagingDisabled(deps.env)) return bad(503, "messaging_disabled");
  if (deps.env.SMS_PROVIDER && deps.env.SMS_PROVIDER !== "twilio") return bad(503, "Twilio is not the selected SMS provider");
  const config = twilioConfig(deps.env);
  if (!config) return bad(503, "sms is not configured");
  const params = formToRecord(req.rawBody);
  const url = req.url ?? `${deps.appUrl.replace(/\/+$/, "")}${TWILIO_WEBHOOK_PATH}`;
  if (!verifyTwilioWebhook(url, params, req.signature, config.authToken)) return bad(401, "invalid signature");
  // Empty TwiML: we answer through the REST API after the 200, never with an auto-reply.
  return { status: 200, body: EMPTY_TWIML, contentType: "text/xml", events: parseTwilioInbound(params) };
}

/** Turn a Received into a Response (routes). */
export function toResponse(r: Received): Response {
  if (r.contentType) return new Response(String(r.body), { status: r.status, headers: { "content-type": r.contentType } });
  return Response.json(r.body, { status: r.status });
}
