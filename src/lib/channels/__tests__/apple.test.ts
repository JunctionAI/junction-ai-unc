import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/apple/route";
import { AppleAdapter, normaliseAppleEvent, type VerifiedAppleMessage } from "../adapters/apple";
import { availability, buildAdapters } from "../adapters";
import { handleTestInbound as handleInbound } from "./helpers";
import { findVerifiedLink, issueLinkCode } from "../links";
import { sendOnLink } from "../outbound";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { StaticAccountsSource } from "@/worker/accounts";
import { ACCT, USER, channelDb, clock, FakeAdapter, seedLink } from "./helpers";

const base: VerifiedAppleMessage = { businessId: "business-1", opaqueId: "opaque-1", messageId: "msg-1", kind: "text", text: "hello", at: "2026-09-02T09:00:00Z" };
function setup() {
  const db = channelDb(); const apple = new FakeAdapter("apple");
  const respond = vi.fn(async () => ({ ok: true as const, reply: "your draft is ready. nothing is published." }));
  return { db, adapters: { apple }, store: new MemoryStore(), accounts: new StaticAccountsSource(), now: clock().now, respond };
}
describe("Apple preparation — local contracts, not provider delivery", () => {
  it("cannot be activated by arbitrary env flags and the reserved webhook rejects everything", async () => {
    const env = { APPLE_MESSAGES_ENABLED: "true", INFOBIP_API_KEY: "fake" };
    expect(availability(env).find(c => c.channel === "apple")?.configured).toBe(false);
    const fetch = vi.fn();
    expect(buildAdapters({ env, fetch }).apple?.configured).toBe(false);
    expect(new AppleAdapter().configured).toBe(false);
    expect(POST().status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });
  it("scopes opaque identity by business and rejects malformed or misrouted events", () => {
    expect(normaliseAppleEvent(base, "wrong")).toBeNull();
    expect(normaliseAppleEvent({ ...base, opaqueId: "tom@example.com" }, base.businessId)).toBeNull();
    expect(normaliseAppleEvent({ ...base, at: "bad" }, base.businessId)).toBeNull();
    expect(normaliseAppleEvent({ ...base, text: "" }, base.businessId)).toBeNull();
    const a = normaliseAppleEvent(base, base.businessId)!;
    const b = normaliseAppleEvent({ ...base, businessId: "business-2" }, "business-2")!;
    expect(a.externalId).not.toBe(b.externalId);
    expect(a.externalMsgId).not.toBe(b.externalMsgId);
  });
  it("links using an owner-issued expiring code, never a phone/account ID in prose", async () => {
    const d = setup();
    const code = await issueLinkCode(d.db, { accountId: ACCT, userId: USER, channel: "apple", now: d.now() });
    const event = normaliseAppleEvent({ ...base, text: code.code }, base.businessId)!;
    expect((await handleInbound(d, event)).kind).toBe("linked");
    expect((await findVerifiedLink(d.db, "apple", event.externalId))?.accountId).toBe(ACCT);
    expect(d.respond).not.toHaveBeenCalled();
  });
  it("routes one shared conversation and ignores duplicate messages", async () => {
    const d = setup(); const event = normaliseAppleEvent(base, base.businessId)!;
    seedLink(d.db, { channel: "apple", external_id: event.externalId });
    expect((await handleInbound(d, event)).kind).toBe("replied");
    expect((await handleInbound(d, event)).kind).toBe("duplicate");
    expect(d.respond).toHaveBeenCalledTimes(1);
    expect(d.respond.mock.calls[0]).toBeDefined();
    expect(d.db.rows("chat_messages").every(r => r.account_id === ACCT)).toBe(true);
  });
  it.each(["stop", "closed"])("disconnects on %s without model calls or subsequent proactive messages", async kind => {
    const d = setup(); const event = normaliseAppleEvent(kind === "stop" ? { ...base, text: "STOP" } : { ...base, kind: "conversation_closed" }, base.businessId)!;
    seedLink(d.db, { channel: "apple", external_id: event.externalId });
    expect((await handleInbound(d, event)).kind).toBe("unsubscribed");
    expect(await findVerifiedLink(d.db, "apple", event.externalId)).toBeNull();
    expect(d.respond).not.toHaveBeenCalled(); expect(d.adapters.apple.sent).toHaveLength(0);
  });
  it("pauses automated answers for support without claiming a human was assigned", async () => {
    const d = setup(); const event = normaliseAppleEvent({ ...base, text: "human" }, base.businessId)!;
    seedLink(d.db, { channel: "apple", external_id: event.externalId });
    await handleInbound(d, event);
    expect(d.adapters.apple.sent[0].payload.text).toContain("has not been assigned");
    expect((await handleInbound(d, { ...event, text: "another question", externalMsgId: "next" })).kind).toBe("ignored");
    expect(d.respond).not.toHaveBeenCalled();
    const link = (await findVerifiedLink(d.db, "apple", event.externalId))!;
    expect((await sendOnLink(d, link, "brief", { text: "unsolicited" })).status).toBe("skipped");
    expect((await sendOnLink(d, link, "reply", { text: "automated" })).status).toBe("skipped");
  });
});
