import { afterEach, describe, expect, it, vi } from "vitest";
import { claimOutbound, enqueueOutbound, finishOutbound, maintainOutbound, projectOutbound, SEND_TIMEOUT_MS } from "../outbox";
import { flushQueued, pushToAccount, sendOnLink } from "../outbound";
import { messagingDisabled } from "../releaseGate";
import type { SendResult } from "../types";
import { ACCT, channelDb, clock, fakeAdapters, OTHER, seedLink } from "./helpers";

function setup() {
  const db = channelDb();
  const clk = clock();
  db.now = () => clk.at().toISOString();
  const adapters = fakeAdapters();
  const link = seedLink(db);
  return { db, clk, adapters, link, deps: { db, adapters, now: clk.now } };
}
const payload = { text: "your draft is ready" };
const options = { contextGeneration: 0, ref: "durable-operation" };
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("durable outbound intent and attempt", () => {
  it("reserves before I/O and lets only one concurrent caller send", async () => {
    const { db, link, adapters, deps } = setup();
    let resolve!: (r: SendResult) => void;
    adapters.telegram.send = vi.fn(() => new Promise<SendResult>(r => { resolve = r; }));
    const first = sendOnLink(deps, link, "reply", payload, options);
    await vi.waitFor(() => expect(adapters.telegram.send).toHaveBeenCalledTimes(1));
    expect(db.rows("outbound_messages")[0]).toMatchObject({ status: "sending", body: payload.text });
    const second = await sendOnLink(deps, link, "reply", payload, options);
    expect(second.status).toBe("uncertain");
    resolve({ ok: true, externalMsgId: "provider-1" });
    expect((await first).status).toBe("sent");
    expect((await sendOnLink(deps, link, "reply", payload, options)).status).toBe("sent");
    expect(adapters.telegram.send).toHaveBeenCalledTimes(1);
    expect(db.rows("chat_messages")).toHaveLength(1);
  });

  it.each(["payload", "template", "projection", "metadata"] as const)("rejects changed %s under the same operation identity", async change => {
    const { db, link, deps, adapters } = setup();
    await enqueueOutbound(db, link, "reply", payload, options);
    await expect(sendOnLink(deps, link, "reply", change === "payload" ? { text: "replacement" } : payload,
      { ...options, ...(change === "template" ? { allowTemplate: true } : {}),
        ...(change === "projection" ? { appendToThread: false } : {}),
        ...(change === "metadata" ? { replyContext: { live: true, inReplyTo: "another" } } : {}) })).rejects.toThrow();
    expect(adapters.telegram.sent).toEqual([]);
  });

  it.each(["reset", "rebind", "membership", "destination", "unverify"] as const)("cancels before the provider when %s changes after enqueue", async change => {
    const { db, link, deps, adapters } = setup();
    const claim = db.rpcs.claim_channel_outbound;
    db.rpcs.claim_channel_outbound = args => {
      if (change === "reset") db.rows("accounts")[0].context_generation = 1;
      if (change === "rebind") db.rows("channel_links")[0].binding_version = 1;
      if (change === "membership") db.deleteRows("account_members", [...db.rows("account_members")]);
      if (change === "destination") db.rows("channel_links")[0].external_id = "replacement-device";
      if (change === "unverify") db.rows("channel_links")[0].verified_at = null;
      return claim(args);
    };
    expect(await sendOnLink(deps, link, "reply", payload, options)).toMatchObject({ status: "skipped", reason: "cancelled" });
    expect(adapters.telegram.sent).toEqual([]);
    expect(db.rows("outbound_messages")[0].status).toBe("cancelled");
  });

  it("cannot use another account or Slack workspace to satisfy the original binding", async () => {
    const { db, link, deps, adapters } = setup();
    await expect(sendOnLink(deps, { ...link, accountId: OTHER }, "reply", payload, options)).rejects.toThrow();
    const slack = seedLink(db, { channel: "slack", external_id: "user-1", meta: { team_id: "T1" } });
    await expect(sendOnLink(deps, { ...slack, meta: { team_id: "T2" } }, "reply", payload, options)).rejects.toThrow();
    expect(adapters.telegram.sent).toEqual([]);
    expect(adapters.slack.sent).toEqual([]);
  });

  it("keeps the original send receipt after a reset but never projects it into the new conversation", async () => {
    const { db, link, deps, adapters } = setup();
    adapters.telegram.send = vi.fn(async () => {
      db.rows("accounts")[0].context_generation = 1;
      db.rows("channel_links")[0].binding_version = 1;
      return { ok: true as const, externalMsgId: "accepted-before-reset" };
    });
    expect((await sendOnLink(deps, link, "reply", payload, options)).status).toBe("sent");
    expect(db.rows("outbound_messages")[0]).toMatchObject({ context_generation: 0, binding_version: 0, status: "sent", external_msg_id: "accepted-before-reset" });
    expect(db.rows("chat_messages")).toEqual([]);
  });

  it("does not retry an ambiguous provider failure and omits raw error secrets", async () => {
    const { db, link, deps, adapters } = setup();
    adapters.telegram.send = vi.fn(async () => { throw new Error("secret-sensitive-provider-body"); });
    expect((await sendOnLink(deps, link, "reply", payload, options)).status).toBe("uncertain");
    expect((await sendOnLink(deps, link, "reply", payload, options)).status).toBe("uncertain");
    expect(adapters.telegram.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.rows("outbound_messages"))).not.toContain("secret-sensitive");
    expect(db.rows("chat_messages")).toEqual([]);
  });

  it("bounds a stalled provider without treating timeout as proof of non-delivery", async () => {
    vi.useFakeTimers();
    const { db, link, deps, adapters } = setup();
    let complete!: (r: SendResult) => void;
    adapters.telegram.send = vi.fn(() => new Promise<SendResult>(r => { complete = r; }));
    const task = sendOnLink(deps, link, "reply", payload, options);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1);
    expect((await task).status).toBe("uncertain");
    complete({ ok: true, externalMsgId: "late-acceptance" });
    await Promise.resolve();
    expect((await sendOnLink(deps, link, "reply", payload, options)).status).toBe("uncertain");
    expect(adapters.telegram.send).toHaveBeenCalledTimes(1);
    expect(db.rows("chat_messages")).toEqual([]);
  });

  it("survives a lost finalization response and recovers the confirmed history without sending again", async () => {
    const { db, link, deps, adapters } = setup();
    const finish = db.rpcs.finish_channel_outbound;
    let lose = true;
    db.rpcs.finish_channel_outbound = args => {
      const r = finish(args);
      if (lose) { lose = false; throw new Error("response lost after commit"); }
      return r;
    };
    expect((await sendOnLink(deps, link, "reply", payload, options)).status).toBe("uncertain");
    expect(db.rows("outbound_messages")[0].status).toBe("sent");
    expect((await sendOnLink(deps, link, "reply", payload, options)).status).toBe("sent");
    expect(adapters.telegram.sent).toHaveLength(1);
    expect(db.rows("chat_messages")).toHaveLength(1);
  });

  it("an interrupted claim becomes uncertain and can only be finalized by its original attempt", async () => {
    const { db, link, clk } = setup();
    const row = await enqueueOutbound(db, link, "reply", payload, options);
    const first = await claimOutbound(db, String(row.id));
    clk.advance(121000);
    const second = await claimOutbound(db, String(row.id));
    expect(second).toMatchObject({ claimed: false, row: { status: "uncertain", attempt_id: first.attempt } });
    await expect(finishOutbound(db, String(row.id), second.attempt, { ok: true, externalMsgId: "fake" })).rejects.toThrow();
    await finishOutbound(db, String(row.id), first.attempt, { ok: true, externalMsgId: "readback-original" });
    await projectOutbound(db, String(row.id));
    expect(db.rows("chat_messages")).toHaveLength(1);
  });

  it("repairs interrupted claims and lost projections without any provider call, even with messaging disabled", async () => {
    const { db, link, deps, clk, adapters } = setup();
    const pending = await enqueueOutbound(db, link, "reply", payload, { ...options, ref: "crash" });
    await claimOutbound(db, String(pending.id));
    const projected = db.rpcs.project_channel_outbound;
    db.rpcs.project_channel_outbound = () => { throw new Error("projection unavailable"); };
    expect((await sendOnLink(deps, link, "reply", payload, options)).status).toBe("sent");
    expect(db.rows("chat_messages")).toEqual([]);
    db.rpcs.project_channel_outbound = projected;
    clk.advance(121000);
    vi.stubEnv("UNC_MESSAGING_ENABLED", "false");
    expect(await maintainOutbound(db)).toEqual({ uncertain: 1, expired: 0, projected: 1 });
    expect(await maintainOutbound(db)).toEqual({ uncertain: 0, expired: 0, projected: 0 });
    expect(adapters.telegram.sent).toHaveLength(1);
    expect(db.rows("chat_messages")).toHaveLength(1);
  });

  it("does not flush legacy queues, another generation or an old binding version", async () => {
    const { db, deps, adapters } = setup();
    const wa = seedLink(db, { channel: "whatsapp", external_id: "wa-1", last_inbound_at: null });
    db.insertRow("outbound_messages", { account_id: ACCT, link_id: wa.id, channel: "whatsapp", kind: "reply", body: "legacy", status: "queued" });
    expect(db.rows("outbound_messages")[0].context_generation).toBeNull();
    await sendOnLink(deps, wa, "reply", payload, options);
    await db.from("channel_links").update({ binding_version: 1, last_inbound_at: db.now() }).eq("id", wa.id);
    expect(await flushQueued(deps, { ...wa, bindingVersion: 1 })).toBe(0);
    expect(await flushQueued(deps, wa, 1)).toBe(0);
    expect(adapters.whatsapp.sent).toEqual([]);
  });

  it("queued is not delivered and multiple accepted channel copies project once", async () => {
    const { db, link, deps } = setup();
    const wa = seedLink(db, { channel: "whatsapp", external_id: "wa-1", last_inbound_at: null });
    const push = { accountId: ACCT, kind: "brief" as const, ref: "shared-ref", payload, timezone: "UTC" };
    expect(await pushToAccount(deps, { ...push, links: [wa] })).toMatchObject({ queued: 1, delivered: false });
    const sms = seedLink(db, { channel: "sms", external_id: "+example" });
    await pushToAccount(deps, { ...push, links: [link, sms] });
    expect(db.rows("chat_messages")).toHaveLength(1);
  });

  it("production requires an explicit messaging release and a disabled send creates no intent", async () => {
    expect(messagingDisabled({ NODE_ENV: "production" })).toBe(true);
    expect(messagingDisabled({ NODE_ENV: "production", UNC_MESSAGING_ENABLED: "true" })).toBe(false);
    const { db, link, deps, adapters } = setup();
    vi.stubEnv("UNC_MESSAGING_ENABLED", "false");
    expect(await sendOnLink(deps, link, "reply", payload, options)).toMatchObject({ status: "skipped", reason: "messaging_disabled" });
    expect(db.rows("outbound_messages")).toEqual([]);
    expect(adapters.telegram.sent).toEqual([]);
  });
});
