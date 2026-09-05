import { describe, expect, it, vi } from "vitest";
import { TnzAdapter, tnzConfig, verifyTnzWebhook, parseTnzInbound, TNZ_API } from "../adapters/tnz";
import { availability, buildAdapters } from "../adapters";
import { receiveTnz } from "../tnzReceiver";
import { drainInboundEvents, saveInboundEvents } from "../inbox";
import { handleTestInbound as handleInbound } from "./helpers";
import { issueLinkCode, findVerifiedLink } from "../links";
import { MemoryStore } from "../../runtime/store/memory";
import { StaticAccountsSource } from "../../../worker/accounts";
import { ACCT, OTHER, USER, channelDb, fakeAdapters, seedLink } from "./helpers";

const now = new Date("2026-09-04T00:00:00Z");
const env = { SMS_PROVIDER: "tnz", TNZ_SMS_ENABLED: "true", TNZ_AUTH_TOKEN: "fixture-api-token", TNZ_WEBHOOK_AUTHORIZATION: "Basic fixture-webhook-secret-0123456789", TNZ_SENDER: "unc@example.test", TNZ_FROM: "800123", TNZ_PILOT_ACCOUNT_ID: ACCT, TNZ_PILOT_PHONE: "+64210000001" };
const config = tnzConfig(env)!;
const headers = () => new Headers({ authorization: env.TNZ_WEBHOOK_AUTHORIZATION, "x-sender": env.TNZ_SENDER, "x-timestamp": now.toISOString(), "content-type": "application/json" });
const payload = (Message = "hello") => ({ Sender: env.TNZ_SENDER, Type: "SMSInbound", Status: "RECEIVED", Result: "RECEIVED", Destination: env.TNZ_PILOT_PHONE, ReceivedID: "fixture-inbound-1", Message });
const request = (body: unknown = payload(), h = headers()) => new Request("https://unc.test/api/webhooks/tnz", { method: "POST", headers: h, body: JSON.stringify(body) });

describe("TNZ transport contract", () => {
  it("requires explicit provider activation, a dedicated number and pilot scope", () => {
    expect(config).not.toBeNull();
    for (const key of Object.keys(env)) expect(tnzConfig({ ...env, [key]: "" })).toBeNull();
    expect(tnzConfig({ ...env, TNZ_FROM: "+15551234" })).toBeNull();
    expect(tnzConfig({ ...env, TNZ_PILOT_PHONE: "+15551234" })).toBeNull();
  });

  it("selects TNZ without leaking secrets or falling back to Twilio", () => {
    const available = availability(env).find(c => c.channel === "sms");
    expect(available).toMatchObject({ configured: true, number: "800123", pilotAccountId: ACCT });
    expect(JSON.stringify(available)).not.toContain("fixture");
    expect(buildAdapters({ env, fetch }).sms).toBeInstanceOf(TnzAdapter);
    expect(buildAdapters({ env: { ...env, TNZ_SMS_ENABLED: "false", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "token", TWILIO_FROM: "+1555" }, fetch }).sms?.configured).toBe(false);
    expect(availability({ SMS_PROVIDER: "typo", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+1555" }).find(c => c.channel === "sms")?.configured).toBe(false);
  });

  it("verifies the configured header, sender and fresh timestamp", () => {
    expect(verifyTnzWebhook(config, headers(), now)).toBe(true);
    for (const [key, value] of [["authorization", "Basic wrong"], ["x-sender", "other@example.test"], ["x-timestamp", "2026-09-03T00:00:00Z"], ["x-timestamp", "2026-09-05T00:00:00Z"]]) {
      const h = headers(); h.set(key, value);
      expect(verifyTnzWebhook(config, h, now)).toBe(false);
    }
  });

  it("takes tenant identity from server configuration, not webhook fields", () => {
    expect(parseTnzInbound({ ...payload(), accountScope: OTHER, accountId: OTHER }, config)).toMatchObject({ accountScope: ACCT, externalMsgId: "tnz:fixture-inbound-1" });
    for (const patch of [{ Type: "SMS" }, { Destination: "+64219999999" }, { Sender: "bad" }, { ReceivedID: null }, { Message: "x".repeat(4001) }]) expect(parseTnzInbound({ ...payload(), ...patch }, config)).toBeNull();
  });

  it("submits one exact Unicode SMS without carrier fallback or simulated mode", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => Response.json({ MessageID: JSON.parse(String(init?.body)).MessageID }));
    const adapter = new TnzAdapter(config, fetcher);
    const db = channelDb();
    const link = seedLink(db, { channel: "sms", external_id: env.TNZ_PILOT_PHONE });
    const text = "hey 👋 open https://example.com/AbC with UNC-AB12CD";
    const result = await adapter.send(env.TNZ_PILOT_PHONE, { text }, { link });
    expect(result).toMatchObject({ ok: true, externalMsgId: expect.stringMatching(/^tnz:/) });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(TNZ_API);
    expect(JSON.parse(String(init?.body))).toMatchObject({ Message: text, Destination: env.TNZ_PILOT_PHONE, CharacterConversion: false, FallbackMode: "None", NotificationType: "None", SubAccount: ACCT });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("Mode");
  });

  it("refuses other accounts, phones, unverified links, overlong or template-expanded text", async () => {
    const fetcher = vi.fn();
    const adapter = new TnzAdapter(config, fetcher);
    const link = seedLink(channelDb(), { channel: "sms", external_id: env.TNZ_PILOT_PHONE });
    for (const [to, candidate, text] of [["+64219999999", link, "hi"], [env.TNZ_PILOT_PHONE, { ...link, accountId: OTHER }, "hi"], [env.TNZ_PILOT_PHONE, { ...link, verifiedAt: null }, "hi"], [env.TNZ_PILOT_PHONE, link, "x".repeat(1001)], [env.TNZ_PILOT_PHONE, link, "[[REPLY]]"]] as const) expect((await adapter.send(to, { text }, { link: candidate })).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not treat HTTP success without a matching message ID as confirmed", async () => {
    const link = seedLink(channelDb(), { channel: "sms", external_id: env.TNZ_PILOT_PHONE });
    const fetcher = vi.fn(async () => Response.json({}));
    expect((await new TnzAdapter(config, fetcher).send(env.TNZ_PILOT_PHONE, { text: "hello" }, { link })).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("TNZ durable ingress", () => {
  it("authenticates before storage and rejects oversized payloads", async () => {
    const save = vi.fn(); const wake = vi.fn();
    expect((await receiveTnz(request(payload(), new Headers()), { env, now, save, wake })).status).toBe(401);
    expect((await receiveTnz(request(payload("x".repeat(17000))), { env, now, save, wake })).status).toBe(413);
    expect(save).not.toHaveBeenCalled(); expect(wake).not.toHaveBeenCalled();
  });

  it("returns 503 if durable storage fails and never wakes the consumer", async () => {
    const wake = vi.fn();
    expect((await receiveTnz(request(), { env, now, save: async () => { throw Error("db down"); }, wake })).status).toBe(503);
    expect(wake).not.toHaveBeenCalled();
  });

  it("deduplicates repeated events and links only the permitted business", async () => {
    const db = channelDb(); const adapters = fakeAdapters();
    const code = await issueLinkCode(db, { accountId: ACCT, userId: USER, channel: "sms", now });
    const save = (events: Parameters<typeof saveInboundEvents>[1]) => saveInboundEvents(db, events);
    const wake = vi.fn();
    for (let i = 0; i < 2; i++) expect((await receiveTnz(request(payload(code.code)), { env, now, save, wake })).status).toBe(200);
    expect(db.rows("channel_inbox")).toHaveLength(1);
    await drainInboundEvents(db, e => handleInbound({ db, adapters, store: new MemoryStore(), accounts: new StaticAccountsSource(), now: () => now }, e));
    expect((await findVerifiedLink(db, "sms", env.TNZ_PILOT_PHONE))?.accountId).toBe(ACCT);
    expect(adapters.sms.sent).toHaveLength(1);
    expect(db.rows("channel_inbox")[0].status).toBe("done");
    const wrong = await issueLinkCode(db, { accountId: OTHER, userId: USER, channel: "sms", now });
    await handleInbound({ db, adapters, store: new MemoryStore(), accounts: new StaticAccountsSource(), now: () => now }, parseTnzInbound({ ...payload(wrong.code), ReceivedID: "other-code" }, config)!);
    expect((await findVerifiedLink(db, "sms", env.TNZ_PILOT_PHONE))?.accountId).toBe(ACCT);
  });

  it("does not send a conversation to a different account after linking changes", async () => {
    const db = channelDb(); seedLink(db, { account_id: OTHER, channel: "sms", external_id: env.TNZ_PILOT_PHONE });
    const respond = vi.fn();
    const out = await handleInbound({ db, adapters: fakeAdapters(), store: new MemoryStore(), accounts: new StaticAccountsSource(), now: () => now, respond }, parseTnzInbound(payload(), config)!);
    expect(out).toMatchObject({ kind: "unlinked" });
    expect(respond).not.toHaveBeenCalled();
    expect(db.rows("chat_messages")).toHaveLength(0);
  });

  it.each(["STOP", "CANCEL", "unsubscribe"])("%s disconnects SMS without making a business decision", async keyword => {
    const db = channelDb(); seedLink(db, { channel: "sms", external_id: env.TNZ_PILOT_PHONE });
    const respond = vi.fn(); const decide = vi.fn(); const adapters = fakeAdapters();
    const out = await handleInbound({ db, adapters, store: new MemoryStore(), accounts: new StaticAccountsSource(), now: () => now, respond, decide }, parseTnzInbound(payload(keyword), config)!);
    expect(out).toEqual({ kind: "unsubscribed", accountId: ACCT });
    expect(await findVerifiedLink(db, "sms", env.TNZ_PILOT_PHONE)).toBeNull();
    expect(respond).not.toHaveBeenCalled(); expect(decide).not.toHaveBeenCalled(); expect(adapters.sms.sent).toHaveLength(0);
  });

  it("treats thanks as conversation, not a six-letter linking code", async () => {
    const db = channelDb(); seedLink(db, { channel: "sms", external_id: env.TNZ_PILOT_PHONE });
    const respond = vi.fn(async () => ({ ok: true as const, reply: "anytime 👋" }));
    const out = await handleInbound({ db, adapters: fakeAdapters(), store: new MemoryStore(), accounts: new StaticAccountsSource(), now: () => now, respond }, parseTnzInbound(payload("thanks"), config)!);
    expect(out).toMatchObject({ kind: "replied", reply: "anytime 👋" });
    expect(respond).toHaveBeenCalledTimes(1);
  });
});
