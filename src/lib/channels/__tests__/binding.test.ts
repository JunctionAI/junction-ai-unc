import { describe, expect, it } from "vitest";
import { acceptInboundEvent, claimAcceptedInbound, verifiedEventSnapshot } from "../acceptedInbox";
import { assertInboundBinding, readCapturedInbound, readInboundBinding, type CapturedInbound } from "../binding";
import { issueLinkCode } from "../links";
import { ACCT, OTHER, USER, channelDb, seedLink } from "./helpers";
import type { InboundEvent } from "../types";

const event: InboundEvent = { channel: "telegram", externalId: "device", externalMsgId: "m1", text: "hello" };
function setup() {
  const db = channelDb();
  const link = seedLink(db, { external_id: event.externalId });
  const captured: CapturedInbound = { id: "a".repeat(64), event, binding: { version: 1, kind: "linked", accountId: ACCT,
    contextGeneration: 0, linkId: link.id, bindingVersion: 0, userId: USER } };
  return { db, link, captured };
}

describe("accepted channel binding", () => {
  it("reads the original verified account without changing its captured identity", async () => {
    const { db, link, captured } = setup();
    expect(await assertInboundBinding(db, captured)).toEqual(link);
    expect(captured.binding).toMatchObject({ accountId: ACCT, contextGeneration: 0 });
  });
  it("rejects a reset instead of attaching an old message to a fresh context", async () => {
    const { db, captured } = setup();
    await db.from("accounts").update({ context_generation: 1 }).eq("id", ACCT);
    await expect(assertInboundBinding(db, captured)).rejects.toMatchObject({ code: "context_changed" });
  });
  it.each(["account", "owner", "revision", "destination", "verification", "deleted"])("rejects changed %s on the original link", async change => {
    const { db, link, captured } = setup();
    const patch = { account: { account_id: OTHER }, owner: { user_id: "another-user" }, revision: { binding_version: 1 },
      destination: { external_id: "another-device" }, verification: { verified_at: null }, deleted: {} }[change]!;
    if (change === "deleted") await db.from("channel_links").delete().eq("id", link.id);
    else await db.from("channel_links").update(patch).eq("id", link.id);
    await expect(assertInboundBinding(db, captured)).rejects.toMatchObject({ code: "context_changed" });
  });
  it("does not look up a newly connected account for an originally unlinked message", async () => {
    const { db, captured } = setup();
    expect(await assertInboundBinding(db, { ...captured, binding: { version: 1, kind: "unlinked" } })).toBeNull();
    expect(db.calls).toHaveLength(0);
  });
  it("checks current sender membership, and preserves STOP identity while the account is paused", async () => {
    const { db, link, captured } = setup();
    await db.from("accounts").update({ automation_paused: true }).eq("id", ACCT);
    expect(await assertInboundBinding(db, captured)).toEqual(link);
    await db.from("account_members").delete().eq("account_id", ACCT);
    await expect(assertInboundBinding(db, captured)).rejects.toMatchObject({ code: "context_changed" });
  });
  it("rechecks generation after the membership lookup", async () => {
    const { db, captured } = setup();
    const from = db.from.bind(db);
    db.from = (table: string) => {
      if (table === "account_members") db.rows("accounts").find(a => a.id === ACCT)!.context_generation = 1;
      return from(table);
    };
    await expect(assertInboundBinding(db, captured)).rejects.toMatchObject({ code: "context_changed" });
  });
  it.each([null, {}, { version: 0, kind: "unlinked" }, { version: 1, kind: "bad" },
    { version: 1, kind: "linked", accountId: ACCT, linkId: "l", userId: USER, bindingVersion: 0 },
    { version: 1, kind: "linked", accountId: ACCT, linkId: "l", userId: USER, bindingVersion: 0, contextGeneration: "0" },
  ])("rejects missing, legacy or malformed binding %j", raw => expect(() => readInboundBinding(raw)).toThrow());
  it("keeps provider fields separate from trusted identity and rejects unknown binding versions", () => {
    const { captured } = setup();
    const extra = { ...event, binding: { accountId: OTHER }, contextGeneration: 999 };
    expect(verifiedEventSnapshot(extra)).toEqual(event);
    expect(readCapturedInbound({ ...captured, event: extra }).binding).toEqual(captured.binding);
    expect(() => readCapturedInbound({ ...captured, binding: { ...captured.binding, version: 99 } })).toThrow();
  });
  it("enforces Slack workspace and pilot account scope", async () => {
    const { db, captured } = setup();
    await expect(assertInboundBinding(db, { ...captured, event: { ...event, accountScope: OTHER } })).rejects.toThrow();
    await db.from("channel_links").update({ channel: "slack", meta: { team_id: "workspace-a" } }).eq("id", captured.binding.kind === "linked" ? captured.binding.linkId : "");
    await expect(assertInboundBinding(db, { ...captured, event: { ...event, channel: "slack", scopeId: "workspace-b" } })).rejects.toThrow();
  });
  it("issues pending codes with a fixed generation, including while automation is paused", async () => {
    const { db } = setup();
    await db.from("accounts").update({ context_generation: 3, automation_paused: true }).eq("id", ACCT);
    const code = await issueLinkCode(db, { accountId: ACCT, userId: USER, channel: "sms", now: new Date() });
    expect(db.rows("channel_links").find(l => l.id === code.linkId)?.link_code_generation).toBe(3);
  });
  it("rejects a pending code from a different generation", async () => {
    const { db, captured, link } = setup();
    await db.from("channel_links").update({ verified_at: null, link_code: "UNC-ABC234", link_code_generation: 1 }).eq("id", link.id);
    await expect(assertInboundBinding(db, { ...captured, binding: { ...captured.binding, kind: "link_code" } as CapturedInbound["binding"] })).rejects.toThrow();
  });
});

describe("accepted inbox application contract (RPC fixtures, not SQL proof)", () => {
  it("awaits the durable receipt and tolerates jsonb key order", async () => {
    const { db, captured } = setup();
    let release!: () => void;
    let written = false;
    db.rpcs.accept_channel_inbound = async args => {
      await new Promise<void>(resolve => { release = resolve; });
      written = true;
      return { id: args.inbox_id, event: { text: "hello", externalMsgId: "m1", externalId: "device", channel: "telegram" }, binding: captured.binding };
    };
    const pending = acceptInboundEvent(db, event);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(written).toBe(false);
    release();
    expect((await pending).binding).toEqual(captured.binding);
  });
  it("does not acknowledge storage errors or mismatched persisted content", async () => {
    const { db, captured } = setup();
    db.rpcs.accept_channel_inbound = () => { throw new Error("storage down"); };
    await expect(acceptInboundEvent(db, event)).rejects.toThrow("storage down");
    db.rpcs.accept_channel_inbound = args => ({ id: args.inbox_id, binding: captured.binding, event: { ...event, text: "changed" } });
    await expect(acceptInboundEvent(db, event)).rejects.toThrow("does not match");
  });
  it("rejects oversized events before calling storage", async () => {
    const { db } = setup();
    await expect(acceptInboundEvent(db, { ...event, text: "x".repeat(20_000) })).rejects.toThrow("size limit");
  });
  it("returns the stored envelope from a claim, not a fresh sender lookup", async () => {
    const { db, captured } = setup();
    db.rpcs.claim_channel_inbound = () => captured;
    expect(await claimAcceptedInbound(db)).toEqual(captured);
    db.rpcs.claim_channel_inbound = () => null;
    expect(await claimAcceptedInbound(db)).toBeNull();
    db.rpcs.claim_channel_inbound = () => ({ ...captured, binding: null });
    await expect(claimAcceptedInbound(db)).rejects.toThrow("unavailable");
  });
});
