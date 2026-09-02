/* Per-adapter: signature verification (valid / invalid / replayed), inbound parsing, and the
   exact request each send shapes — against a recording fetch stub, never the network. */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { stubFetch, json } from "@/lib/connectors/__tests__/helpers";
import { parseSlackBody, parseSlackEvent, parseSlackInteraction, SlackAdapter, slackAuthorizeUrl, slackConfig, slackSignature, verifySlackWebhook } from "../adapters/slack";
import { parseTelegramUpdate, TelegramAdapter, telegramConfig, telegramDeepLink, telegramKeyboard, verifyTelegramWebhook } from "../adapters/telegram";
import { formToRecord, parseSmsKeyword, parseTwilioInbound, smsButtonsLine, TwilioAdapter, twilioConfig, twilioSignature, verifyTwilioWebhook } from "../adapters/twilio";
import { parseWhatsAppWebhook, templateParam, verifyWhatsAppSubscription, verifyWhatsAppWebhook, WhatsAppAdapter, whatsappConfig, whatsappMessageBody, whatsappSignature } from "../adapters/whatsapp";
import { availability, buildAdapters } from "../adapters/index";
import { approvalButtons, parseApprovalButton, shortId } from "../types";
import { seedLink, channelDb, T0 } from "./helpers";

const AP = "00000000-0000-4000-8000-0000000000a1";

const ENV = {
  TELEGRAM_BOT_TOKEN: "123456:telegram-bot-token-fixture",
  TELEGRAM_WEBHOOK_SECRET: "tg-webhook-secret",
  TELEGRAM_BOT_USERNAME: "@UncJunctionBot",
  WHATSAPP_PHONE_NUMBER_ID: "1234567890",
  WHATSAPP_ACCESS_TOKEN: "EAAwhatsapp-token-fixture-000000000000",
  WHATSAPP_VERIFY_TOKEN: "wa-verify",
  WHATSAPP_APP_SECRET: "wa-app-secret",
  WHATSAPP_DISPLAY_NUMBER: "+64 21 000 0000",
  SLACK_CLIENT_ID: "slack-client",
  SLACK_CLIENT_SECRET: "slack-secret",
  SLACK_SIGNING_SECRET: "slack-signing",
  TWILIO_ACCOUNT_SID: "ACfixture",
  TWILIO_AUTH_TOKEN: "twilio-auth",
  TWILIO_FROM: "+15550001111",
};

describe("config + availability", () => {
  it("each channel is configured only with its full env; email is never configured", () => {
    expect(telegramConfig({})).toBeNull();
    expect(telegramConfig(ENV)).toMatchObject({ botUsername: "UncJunctionBot" });
    expect(whatsappConfig({ ...ENV, WHATSAPP_APP_SECRET: "" })).toBeNull();
    expect(whatsappConfig(ENV)).toMatchObject({ displayNumber: "64210000000", briefTemplate: "unc_brief", templateLang: "en" });
    expect(slackConfig({ ...ENV, SLACK_SIGNING_SECRET: undefined })).toBeNull();
    expect(twilioConfig(ENV)).toMatchObject({ from: "+15550001111" });
    expect(availability(ENV).map((a) => [a.channel, a.configured])).toEqual([
      ["telegram", true],
      ["whatsapp", true],
      ["slack", true],
      ["sms", true],
      ["email", false],
    ]);
    expect(availability({}).every((a) => !a.configured)).toBe(true);
    const a = availability(ENV);
    expect(a.find((x) => x.channel === "telegram")?.botUsername).toBe("UncJunctionBot");
    expect(JSON.stringify(a)).not.toContain("token");
    const reg = buildAdapters({ env: ENV, fetch: async () => new Response("{}") });
    expect(Object.values(reg).every((ad) => ad?.configured)).toBe(true);
  });

  it("button ids round-trip and stay under Telegram's 64-byte cap", () => {
    const btns = approvalButtons(AP);
    expect(btns.map((b) => b.label)).toEqual(["Approve", "Hold", "Why"]);
    for (const b of btns) {
      expect(Buffer.byteLength(b.id)).toBeLessThanOrEqual(64);
      expect(parseApprovalButton(b.id)).toEqual({ approvalId: AP, verb: b.label.toLowerCase() });
    }
    expect(parseApprovalButton("ap:x:nuke")).toBeNull();
    expect(parseApprovalButton(undefined)).toBeNull();
    expect(shortId(AP)).toBe("00000000");
  });
});

describe("Telegram", () => {
  it("verifies the secret header timing-safe; wrong / missing header fails", () => {
    expect(verifyTelegramWebhook({ secretToken: "tg-webhook-secret" }, "tg-webhook-secret")).toBe(true);
    expect(verifyTelegramWebhook({ secretToken: "tg-webhook-secre" }, "tg-webhook-secret")).toBe(false);
    expect(verifyTelegramWebhook({ secretToken: null }, "tg-webhook-secret")).toBe(false);
    expect(verifyTelegramWebhook({ secretToken: "" }, "")).toBe(false);
  });

  it("parses a text message, a /start code and a callback press; ignores bots, edits and empties", () => {
    const msg = parseTelegramUpdate({ update_id: 1, message: { message_id: 7, chat: { id: 555, type: "private" }, from: { id: 555, first_name: "Tom", last_name: "H", username: "tomh" }, text: "  what ran overnight?  ", date: 1756800000 } });
    expect(msg).toEqual([{ channel: "telegram", externalId: "555", externalMsgId: "555:7", text: "what ran overnight?", handle: "tomh", displayName: "Tom H", at: new Date(1756800000 * 1000).toISOString() }]);
    expect(parseTelegramUpdate({ message: { message_id: 8, chat: { id: 555 }, from: { id: 9, is_bot: true }, text: "hi" } })).toEqual([]);
    expect(parseTelegramUpdate({ edited_message: { message_id: 8, chat: { id: 555 }, text: "hi" } })).toEqual([]);
    expect(parseTelegramUpdate({ message: { message_id: 9, chat: { id: 555 }, text: "   " } })).toEqual([]);
    expect(parseTelegramUpdate("nope")).toEqual([]);
    const cb = parseTelegramUpdate({ callback_query: { id: "cbq1", from: { id: 555, first_name: "Tom" }, message: { message_id: 10, chat: { id: 555 } }, data: `ap:${AP}:approve` } });
    expect(cb).toEqual([{ channel: "telegram", externalId: "555", externalMsgId: "555:cb:cbq1", action: `ap:${AP}:approve`, ackRef: "cbq1", handle: undefined, displayName: "Tom" }]);
  });

  it("sendMessage carries the inline keyboard; answerCallbackQuery acks; failures are codes not tokens", async () => {
    const f = stubFetch([(c) => (c.url.endsWith("/sendMessage") ? json({ ok: true, result: { message_id: 42 } }) : c.url.endsWith("/answerCallbackQuery") ? json({ ok: true }) : undefined)]);
    const tg = new TelegramAdapter(telegramConfig(ENV), f.fetch);
    const link = seedLink(channelDb());
    const r = await tg.send("555", { text: "One decision needs you.", buttons: approvalButtons(AP) }, { link });
    expect(r).toEqual({ ok: true, externalMsgId: "555:42" });
    expect(f.calls[0].url).toBe(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/sendMessage`);
    const body = JSON.parse(f.calls[0].body!);
    expect(body.chat_id).toBe("555");
    expect(body.reply_markup).toEqual(telegramKeyboard(approvalButtons(AP)));
    expect(body.reply_markup.inline_keyboard[0]).toHaveLength(3);
    await tg.ack({ channel: "telegram", externalId: "555", externalMsgId: "x", ackRef: "cbq1" }, "Approved");
    expect(JSON.parse(f.calls[1].body!)).toEqual({ callback_query_id: "cbq1", text: "Approved" });

    const down = stubFetch([() => json({ ok: false, description: "Bad Request: chat not found" }, 400)]);
    const r2 = await new TelegramAdapter(telegramConfig(ENV), down.fetch).send("1", { text: "x" }, { link });
    expect(r2).toEqual({ ok: false, error: "telegram sendMessage 400: Bad Request: chat not found" });
    expect(JSON.stringify(r2)).not.toContain(ENV.TELEGRAM_BOT_TOKEN);
    expect(telegramDeepLink("UncJunctionBot", "UNC-ABC234")).toBe("https://t.me/UncJunctionBot?start=UNC-ABC234");
  });
});

describe("WhatsApp", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { contacts: [{ wa_id: "64210001111", profile: { name: "Tom" } }], messages: [{ from: "64210001111", id: "wamid.1", timestamp: "1756800000", type: "text", text: { body: "UNC-ABC234" } }] } }] }] });

  it("X-Hub-Signature-256 over the RAW body: valid, tampered body, wrong secret, missing", () => {
    const sig = `sha256=${createHmac("sha256", "wa-app-secret").update(body).digest("hex")}`;
    expect(whatsappSignature(body, "wa-app-secret")).toBe(sig);
    expect(verifyWhatsAppWebhook(body, sig, "wa-app-secret")).toBe(true);
    expect(verifyWhatsAppWebhook(body + " ", sig, "wa-app-secret")).toBe(false);
    expect(verifyWhatsAppWebhook(body, sig, "other")).toBe(false);
    expect(verifyWhatsAppWebhook(body, null, "wa-app-secret")).toBe(false);
    expect(verifyWhatsAppWebhook(body, "sha256=00", "wa-app-secret")).toBe(false);
  });

  it("the GET handshake echoes hub.challenge only for the right verify token", () => {
    expect(verifyWhatsAppSubscription(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "wa-verify", "hub.challenge": "12345" }), "wa-verify")).toBe("12345");
    expect(verifyWhatsAppSubscription(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "12345" }), "wa-verify")).toBeNull();
    expect(verifyWhatsAppSubscription(new URLSearchParams({ "hub.mode": "unsubscribe", "hub.verify_token": "wa-verify", "hub.challenge": "1" }), "wa-verify")).toBeNull();
  });

  it("parses text and button replies with the contact name; statuses and other objects are ignored", () => {
    expect(parseWhatsAppWebhook(JSON.parse(body))).toEqual([{ channel: "whatsapp", externalId: "64210001111", externalMsgId: "wamid.1", displayName: "Tom", at: new Date(1756800000 * 1000).toISOString(), text: "UNC-ABC234" }]);
    const press = parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "64210001111", id: "wamid.2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: `ap:${AP}:hold`, title: "Hold" } } }] } }] }] });
    expect(press[0]).toMatchObject({ action: `ap:${AP}:hold`, externalMsgId: "wamid.2" });
    expect(parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "delivered" }] } }] }] })).toEqual([]);
    expect(parseWhatsAppWebhook({ object: "page" })).toEqual([]);
  });

  it("shapes text, interactive (max 3 buttons, 20-char titles) and template sends; template params are squashed", async () => {
    const cfg = whatsappConfig(ENV)!;
    expect(whatsappMessageBody("6421", { text: "hi" }, cfg, false)).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "6421", type: "text", text: { preview_url: false, body: "hi" } });
    const inter = whatsappMessageBody("6421", { text: "One decision needs you.", buttons: [...approvalButtons(AP), { id: "extra", label: "A very long label that will be cut" }] }, cfg, false) as { interactive: { action: { buttons: { reply: { title: string } }[] } } };
    expect(inter.interactive.action.buttons).toHaveLength(3);
    expect(inter.interactive.action.buttons.every((b) => b.reply.title.length <= 20)).toBe(true);
    const tpl = whatsappMessageBody("6421", { text: "Morning.\n\nHere's   today:\tquiet night" }, cfg, true) as { template: { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] } };
    expect(tpl.template.name).toBe("unc_brief");
    expect(tpl.template.language.code).toBe("en");
    expect(tpl.template.components[0].parameters[0].text).toBe("Morning. Here's today: quiet night");
    expect(templateParam("a\n\n\n b")).toBe("a b");

    const f = stubFetch([(c) => (c.url === "https://graph.facebook.com/v21.0/1234567890/messages" ? json({ messages: [{ id: "wamid.out1" }] }) : undefined)]);
    const wa = new WhatsAppAdapter(cfg, f.fetch);
    const link = seedLink(channelDb(), { channel: "whatsapp", external_id: "64210001111" });
    expect(await wa.send("64210001111", { text: "hi" }, { link })).toEqual({ ok: true, externalMsgId: "wamid.out1" });
    expect(f.calls[0].headers.authorization).toBe(`Bearer ${ENV.WHATSAPP_ACCESS_TOKEN}`);
    expect(JSON.parse(f.calls[0].body!).type).toBe("text");
    expect(await wa.send("64210001111", { text: "brief" }, { link, template: true })).toEqual({ ok: true, externalMsgId: "wamid.out1" });
    expect(JSON.parse(f.calls[1].body!).type).toBe("template");
    const err = stubFetch([() => json({ error: { message: "(#131047) Re-engagement message", code: 131047 } }, 400)]);
    expect(await new WhatsAppAdapter(cfg, err.fetch).send("1", { text: "x" }, { link })).toEqual({ ok: false, error: "whatsapp 400 (131047): (#131047) Re-engagement message" });
  });
});

describe("Slack", () => {
  const now = new Date(T0);
  const ts = String(Math.floor(now.getTime() / 1000) - 10);
  const eventBody = JSON.stringify({ type: "event_callback", team_id: "T1", event: { type: "message", channel_type: "im", user: "U1", channel: "D1", ts: "1756800000.000100", text: "hey <@UBOT> what's waiting?" } });

  it("v0 signature over v0:<ts>:<body>; a stale timestamp is a replay and fails even with a valid signature", () => {
    const sig = slackSignature("slack-signing", ts, eventBody);
    expect(sig).toBe(`v0=${createHmac("sha256", "slack-signing").update(`v0:${ts}:${eventBody}`).digest("hex")}`);
    expect(verifySlackWebhook(eventBody, { signature: sig, timestamp: ts }, "slack-signing", now)).toBe(true);
    expect(verifySlackWebhook(eventBody + "x", { signature: sig, timestamp: ts }, "slack-signing", now)).toBe(false);
    expect(verifySlackWebhook(eventBody, { signature: sig, timestamp: ts }, "other", now)).toBe(false);
    const old = String(Math.floor(now.getTime() / 1000) - 6 * 60);
    expect(verifySlackWebhook(eventBody, { signature: slackSignature("slack-signing", old, eventBody), timestamp: old }, "slack-signing", now)).toBe(false);
    expect(verifySlackWebhook(eventBody, { signature: null, timestamp: ts }, "slack-signing", now)).toBe(false);
  });

  it("url_verification → challenge; DM + app_mention → turns (mentions stripped); bot / subtype / channel messages ignored", () => {
    expect(parseSlackEvent({ type: "url_verification", challenge: "abc" })).toEqual({ kind: "challenge", challenge: "abc" });
    const dm = parseSlackEvent(JSON.parse(eventBody));
    expect(dm).toEqual({ kind: "events", events: [{ channel: "slack", externalId: "U1", externalMsgId: "D1:1756800000.000100", text: "hey what's waiting?", scopeId: "T1", at: new Date(1756800000000.1).toISOString() }] });
    expect(parseSlackEvent({ type: "event_callback", team_id: "T1", event: { type: "app_mention", user: "U1", channel: "C1", ts: "1.2", text: "<@UBOT> brief me" } })).toMatchObject({ events: [{ text: "brief me", externalMsgId: "C1:1.2" }] });
    expect(parseSlackEvent({ type: "event_callback", team_id: "T1", event: { type: "message", channel_type: "im", bot_id: "B1", user: "U1", channel: "D1", ts: "1", text: "x" } })).toEqual({ kind: "events", events: [] });
    expect(parseSlackEvent({ type: "event_callback", team_id: "T1", event: { type: "message", channel_type: "channel", user: "U1", channel: "C1", ts: "1", text: "x" } })).toEqual({ kind: "events", events: [] });
    expect(parseSlackEvent({ type: "event_callback", team_id: "T1", event: { type: "message", channel_type: "im", subtype: "message_changed", user: "U1", channel: "D1", ts: "1", text: "x" } })).toEqual({ kind: "events", events: [] });
  });

  it("block_actions (form payload=) → a press with the response_url as ack handle", () => {
    const payload = JSON.stringify({ type: "block_actions", user: { id: "U1", username: "tom" }, team: { id: "T1" }, response_url: "https://hooks.slack.com/actions/T1/1/abc", container: { channel_id: "D1", message_ts: "1756800001.5" }, actions: [{ action_id: `ap:${AP}:why`, value: `ap:${AP}:why`, block_id: "b" }] });
    expect(parseSlackInteraction(payload)).toEqual([{ channel: "slack", externalId: "U1", externalMsgId: `act:D1:1756800001.5:ap:${AP}:why`, action: `ap:${AP}:why`, ackRef: "https://hooks.slack.com/actions/T1/1/abc", scopeId: "T1", handle: "tom" }]);
    expect(parseSlackBody(`payload=${encodeURIComponent(payload)}`, "application/x-www-form-urlencoded")).toMatchObject({ events: [{ action: `ap:${AP}:why` }] });
    expect(parseSlackBody("not json", "application/json")).toEqual({ kind: "events", events: [] });
    expect(parseSlackInteraction("{bad")).toEqual([]);
  });

  it("send opens the DM once (remembered on the link), posts blocks with the workspace token; no token → fails closed", async () => {
    const f = stubFetch([
      (c) => (c.url.endsWith("/conversations.open") ? json({ ok: true, channel: { id: "D9" } }) : undefined),
      (c) => (c.url.endsWith("/chat.postMessage") ? json({ ok: true, ts: "1756800002.1" }) : undefined),
    ]);
    const remembered: string[] = [];
    const slack = new SlackAdapter(slackConfig(ENV), f.fetch, async (team) => (team === "T1" ? "xoxb-team-token" : null), async (_id, dm) => void remembered.push(dm));
    const link = seedLink(channelDb(), { channel: "slack", external_id: "U1", meta: { team_id: "T1" } });
    const r = await slack.send("U1", { text: "One decision needs you.", buttons: approvalButtons(AP) }, { link });
    expect(r).toEqual({ ok: true, externalMsgId: "D9:1756800002.1" });
    expect(f.calls.map((c) => c.url.split("/").pop())).toEqual(["conversations.open", "chat.postMessage"]);
    expect(f.calls[1].headers.authorization).toBe("Bearer xoxb-team-token");
    const posted = JSON.parse(f.calls[1].body!);
    expect(posted.channel).toBe("D9");
    expect(posted.blocks[1].elements.map((e: { value: string }) => e.value)).toEqual(approvalButtons(AP).map((b) => b.id));
    expect(remembered).toEqual(["D9"]);
    // second send with the DM on the link skips conversations.open
    await slack.send("U1", { text: "again" }, { link: { ...link, meta: { team_id: "T1", dm_channel: "D9" } } });
    expect(f.calls).toHaveLength(3);
    const other = seedLink(channelDb(), { channel: "slack", external_id: "U2", meta: { team_id: "T2" } });
    expect(await slack.send("U2", { text: "x" }, { link: other })).toEqual({ ok: false, error: "slack workspace token missing — reinstall" });
    expect(slackAuthorizeUrl(slackConfig(ENV)!, "https://unc.test/api/channels/slack/callback", "st")).toContain("scope=chat%3Awrite%2Cim%3Ahistory");
  });
});

describe("Twilio (SMS)", () => {
  const url = "https://unc.test/api/webhooks/twilio";
  const params = { From: "+64210001111", To: "+15550001111", Body: "YES 1a2b3c4d", MessageSid: "SM123" };

  it("signature = base64(HMAC-SHA1(token, url + sorted key/value pairs)); valid / wrong url / tampered / missing", () => {
    const expected = createHmac("sha1", "twilio-auth").update(url + "Body" + "YES 1a2b3c4d" + "From" + "+64210001111" + "MessageSid" + "SM123" + "To" + "+15550001111").digest("base64");
    expect(twilioSignature("twilio-auth", url, params)).toBe(expected);
    expect(verifyTwilioWebhook(url, params, expected, "twilio-auth")).toBe(true);
    expect(verifyTwilioWebhook("https://unc.test/api/webhooks/twilio?x=1", params, expected, "twilio-auth")).toBe(false);
    expect(verifyTwilioWebhook(url, { ...params, Body: "HOLD" }, expected, "twilio-auth")).toBe(false);
    expect(verifyTwilioWebhook(url, params, null, "twilio-auth")).toBe(false);
    expect(verifyTwilioWebhook(url, params, expected, "")).toBe(false);
  });

  it("parses the form into one event keyed on MessageSid; keywords map to approve / hold / why with an optional short id", () => {
    const raw = new URLSearchParams(params).toString();
    expect(parseTwilioInbound(formToRecord(raw))).toEqual([{ channel: "sms", externalId: "+64210001111", externalMsgId: "SM123", text: "YES 1a2b3c4d", handle: "+64210001111" }]);
    expect(parseTwilioInbound({ From: "+1", Body: "", MessageSid: "S" })).toEqual([]);
    expect(parseSmsKeyword("YES 1a2b3c4d")).toEqual({ verb: "approve", short: "1a2b3c4d" });
    expect(parseSmsKeyword("hold")).toEqual({ verb: "hold", short: null });
    expect(parseSmsKeyword("Why 00000000?")).toBeNull(); // trailing "?" after the id is not a keyword
    expect(parseSmsKeyword("why")).toEqual({ verb: "why", short: null });
    expect(parseSmsKeyword("yes please run the winback flow")).toBeNull();
    expect(smsButtonsLine(AP)).toBe("Reply YES 00000000 to approve, HOLD 00000000 to hold, or WHY 00000000 for my reasoning.");
  });

  it("send posts basic-auth form to Messages.json; buttons become the reply line", async () => {
    const f = stubFetch([(c) => (c.url === "https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json" ? json({ sid: "SMout1" }, 201) : undefined)]);
    const tw = new TwilioAdapter(twilioConfig(ENV), f.fetch);
    const link = seedLink(channelDb(), { channel: "sms", external_id: "+64210001111" });
    expect(await tw.send("+64210001111", { text: "One decision needs you.", buttons: approvalButtons(AP) }, { link })).toEqual({ ok: true, externalMsgId: "SMout1" });
    expect(f.calls[0].headers.authorization).toBe(`Basic ${Buffer.from("ACfixture:twilio-auth").toString("base64")}`);
    const sent = new URLSearchParams(f.calls[0].body!);
    expect(sent.get("From")).toBe("+15550001111");
    expect(sent.get("To")).toBe("+64210001111");
    expect(sent.get("Body")).toBe(`One decision needs you.\n${smsButtonsLine(AP)}`);
    const err = stubFetch([() => json({ message: "The 'To' number is not valid", code: 21211 }, 400)]);
    expect(await new TwilioAdapter(twilioConfig(ENV), err.fetch).send("x", { text: "x" }, { link })).toEqual({ ok: false, error: "twilio 400 (21211): The 'To' number is not valid" });
  });
});
