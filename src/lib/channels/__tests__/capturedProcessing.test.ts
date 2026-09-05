import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../runtime/store/memory";
import { StaticAccountsSource } from "@/worker/accounts";
import { acceptInboundEvent } from "../acceptedInbox";
import { handleInbound, type InboundDeps } from "../inbound";
import { drainInboundEvents } from "../inbox";
import type { InboundEvent } from "../types";
import { ACCT, USER, channelDb, fakeAdapters, seedLink } from "./helpers";

const command = vi.hoisted(() => ({ route: vi.fn(async () => null) }));
vi.mock("../../commands/message", () => ({ routeCommand: command.route }));
afterEach(() => { vi.unstubAllEnvs(); command.route.mockClear(); });

const event: InboundEvent = { channel: "sms", externalId: "+64210000001", externalMsgId: "SM-captured", text: "what should we do next?" };
function setup() {
  const db = channelDb();
  const link = seedLink(db, { channel: "sms", external_id: event.externalId });
  const respond = vi.fn(async () => ({ ok: true as const, reply: "your draft is ready. nothing is published." }));
  const deps = { db, store: new MemoryStore(), accounts: new StaticAccountsSource(), adapters: fakeAdapters(), now: () => new Date(db.now()), respond } satisfies InboundDeps;
  const drain = () => drainInboundEvents(db, message => handleInbound(deps, message));
  return { db, link, deps, respond, drain };
}

describe("captured message processing, fake providers only", () => {
  it("passes the first acceptance's nonzero generation into command dispatch and the model", async () => {
    const h = setup();
    await h.db.from("accounts").update({ context_generation: 1 }).eq("id", ACCT);
    await acceptInboundEvent(h.db, event);
    await h.drain();
    expect(command.route).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ accountId: ACCT, contextGeneration: 1, userId: USER, linkId: h.link.id }), event.text);
    expect(h.respond).toHaveBeenCalledWith(expect.objectContaining({ accountId: ACCT, contextGeneration: 1, guard: expect.any(Function) }));
    expect(h.deps.adapters.sms.sent).toHaveLength(1);
    expect(h.db.rows("channel_inbox")[0].status).toBe("done");
    await h.drain();
    expect(h.deps.adapters.sms.sent).toHaveLength(1);
  });
  it.each(["reset", "reconnect", "membership"])("does not start work after a queued %s", async change => {
    const h = setup();
    const original = await acceptInboundEvent(h.db, event);
    if (change === "reset") await h.db.from("accounts").update({ context_generation: 1 }).eq("id", ACCT);
    if (change === "reconnect") await h.db.from("channel_links").update({ binding_version: 1 }).eq("id", h.link.id);
    if (change === "membership") await h.db.from("account_members").delete().eq("account_id", ACCT);
    await h.drain();
    expect(h.respond).not.toHaveBeenCalled();
    expect(command.route).not.toHaveBeenCalled();
    expect(h.deps.adapters.sms.sent).toHaveLength(0);
    expect(h.db.rows("chat_messages")).toHaveLength(0);
    expect(h.db.rows("channel_inbox")[0]).toMatchObject({ binding: original.binding, status: "uncertain" });
  });
  it.each(["success", "failure", "reconnect", "membership"])("does not send stale model output or fallback after %s", async change => {
    const h = setup();
    h.respond.mockImplementationOnce(async () => {
      if (change === "reconnect") await h.db.from("channel_links").update({ binding_version: 1 }).eq("id", h.link.id);
      else if (change === "membership") await h.db.from("account_members").delete().eq("account_id", ACCT);
      else await h.db.from("accounts").update({ context_generation: 1 }).eq("id", ACCT);
      if (change === "failure") throw new Error("provider unavailable");
      return { ok: true, reply: "obsolete context output" };
    });
    await acceptInboundEvent(h.db, event);
    await h.drain();
    expect(h.respond).toHaveBeenCalledTimes(1);
    expect(h.deps.adapters.sms.sent).toHaveLength(0);
    expect(h.db.rows("outbound_messages")).toHaveLength(0);
    expect(h.db.rows("chat_messages").filter(r => r.sender === "unc")).toHaveLength(0);
    expect(h.db.rows("channel_inbox")[0].status).toBe("uncertain");
    await h.drain();
    expect(h.respond).toHaveBeenCalledTimes(1);
  });
  it("keeps an originally unknown sender unknown after they connect", async () => {
    const h = setup();
    await h.db.from("channel_links").delete().eq("id", h.link.id);
    await acceptInboundEvent(h.db, event);
    seedLink(h.db, { channel: "sms", external_id: event.externalId });
    await h.drain();
    expect(h.respond).not.toHaveBeenCalled();
    expect(h.db.rows("chat_messages")).toHaveLength(0);
    expect(h.deps.adapters.sms.sent[0].payload.text).toContain("don't know this number yet");
  });
  it("does not disconnect a new binding with an old queued STOP", async () => {
    const h = setup();
    await acceptInboundEvent(h.db, { ...event, text: "STOP" });
    await h.db.from("channel_links").update({ binding_version: 1 }).eq("id", h.link.id);
    await h.drain();
    expect(h.db.rows("channel_links")).toHaveLength(1);
    expect(h.deps.adapters.sms.sent).toHaveLength(0);
    expect(h.respond).not.toHaveBeenCalled();
  });
  it("honors a current opt-out while account automation is paused", async () => {
    const h = setup();
    await h.db.from("accounts").update({ automation_paused: true }).eq("id", ACCT);
    await acceptInboundEvent(h.db, { ...event, text: "STOP" });
    await h.drain();
    expect(h.db.rows("channel_links")).toHaveLength(0);
    expect(h.db.rows("channel_inbox")[0].control_result).toMatchObject({ kind: "unsubscribed", accountId: ACCT });
    expect(h.respond).not.toHaveBeenCalled();
    expect(h.deps.adapters.sms.sent).toHaveLength(0);
  });
  it("does not model or send when the release gate changes after acceptance", async () => {
    const h = setup();
    await acceptInboundEvent(h.db, event);
    vi.stubEnv("UNC_MESSAGING_ENABLED", "false");
    await h.drain();
    expect(h.respond).not.toHaveBeenCalled();
    expect(h.deps.adapters.sms.sent).toHaveLength(0);
    expect(h.db.rows("channel_inbox")[0].status).toBe("uncertain");
  });
  it("rejects raw provider events as a processor input", async () => {
    const h = setup();
    // Runtime denial as well as the compile-time CapturedInbound boundary.
    // @ts-expect-error a raw event has no trusted identity
    await expect(handleInbound(h.deps, event)).rejects.toThrow("original channel identity");
    expect(h.respond).not.toHaveBeenCalled();
  });
});
