import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCT, channelDb, clock, fakeAdapters, seedLink, USER } from "../../channels/__tests__/helpers";
import { installCommandDeliveryFixture } from "./deliveryFixture";
import { DbCommandQueue, commandId } from "../queue";
import { commandOwner } from "../deps";
import { notifyCommand } from "../../../worker/commands";
import { flushQueued } from "../../channels/outbound";
import type { CommandActor, RoutineCommand } from "../types";
import { freezeCommandActor } from "../binding";

async function setup(channel: "telegram" | "whatsapp" = "telegram") {
  const db = channelDb(), clk = clock();
  db.now = () => clk.now().toISOString();
  installCommandDeliveryFixture(db);
  const link = seedLink(db, { channel, external_id: "device", last_inbound_at: channel === "whatsapp" ? null : db.now() });
  const actor: CommandActor = { accountId: ACCT, userId: USER, channel, contextGeneration: 0, requestId: "request",
    linkId: link.id, channelBinding: { bindingVersion: 0, externalId: "device" } };
  const queue = new DbCommandQueue(db), at = db.now();
  const initial: RoutineCommand = { id: commandId(actor), actor, contextGeneration: 0, requestHash: "hash", routineId: "D01-W01", specHash: "s",
    workflowHash: "w", version: 1, request: "run", status: "queued", reply: "queued", runId: null, createdAt: at, updatedAt: at };
  await queue.enqueue(initial);
  const c = (await queue.transition(initial, "queued", { status: "waiting", reply: "needs input", updatedAt: db.now() }))!;
  const adapters = fakeAdapters(), injected = { adapters, now: clk.now };
  return { db, clk, link, actor, queue, c, injected, adapters };
}
afterEach(() => vi.unstubAllEnvs());
describe("captured command notification", () => {
  it("persists the original binding and freezes nested caller identity", async () => {
    const { c, actor, db } = await setup();
    expect(c.actor.channelBinding).toEqual(actor.channelBinding);
    expect(db.rows("routine_commands")[0].channel_binding).toMatchObject({ externalId: "device", bindingVersion: 0, contextGeneration: 0 });
    const mutable = { ...actor, channelBinding: { ...actor.channelBinding! } };
    const frozen = freezeCommandActor(mutable);
    mutable.channelBinding.externalId = "other";
    expect(frozen.channelBinding?.externalId).toBe("device");
    expect(commandId(actor)).not.toBe(commandId({ ...actor, channelBinding: { ...actor.channelBinding!, bindingVersion: 1 } }));
  });
  it("uses persisted reply, allows only one notification per result revision and one per later result", async () => {
    const { db, c, queue, injected, adapters } = await setup();
    await Promise.all([notifyCommand(db, { ...c, reply: "untrusted polling replacement" }, injected), notifyCommand(db, c, injected)]);
    expect(adapters.telegram.sent).toHaveLength(1);
    expect(adapters.telegram.sent[0].payload.text).toContain("needs input");
    const done = (await queue.transition(c, "waiting", { status: "done", reply: "done" }))!;
    await notifyCommand(db, done, injected);
    expect(adapters.telegram.sent).toHaveLength(2);
    expect(db.rows("outbound_messages").map(r => r.ref)).toEqual([
      ["command", c.id, c.notificationRevision].join(":"), ["command", c.id, done.notificationRevision].join(":") ]);
  });
  it.each(["revision", "destination", "owner", "membership"] as const)("refuses a changed %s before enqueue or provider I/O", async change => {
    const { db, c, injected, adapters, queue } = await setup();
    if (change === "revision") db.rows("channel_links")[0].binding_version = 1;
    if (change === "destination") db.rows("channel_links")[0].external_id = "other-device";
    if (change === "owner") db.rows("account_members")[0].role = "member";
    if (change === "membership") db.deleteRows("account_members", [...db.rows("account_members")]);
    await notifyCommand(db, c, injected);
    expect(await queue.notifications(20)).toEqual([]);
    expect(db.rows("outbound_messages")).toEqual([]);
    expect(adapters.telegram.sent).toEqual([]);
    expect(await commandOwner(db, c.actor)).toBe(false);
  });
  it("cancels a superseded result at claim and drains only the latest queued WhatsApp notification", async () => {
    const { db, c, queue, injected, link, adapters } = await setup("whatsapp");
    await notifyCommand(db, c, injected);
    expect(db.rows("outbound_messages")[0].status).toBe("queued");
    expect(db.rows("routine_commands")[0].notification_status).not.toBe("sent");
    const done = (await queue.transition(c, "waiting", { status: "done", reply: "done" }))!;
    await notifyCommand(db, done, injected);
    await db.from("channel_links").update({ last_inbound_at: db.now() }).eq("id", link.id);
    expect(await flushQueued({ db, ...injected }, link, 0)).toBe(1);
    expect(adapters.whatsapp.sent).toHaveLength(1);
    expect(adapters.whatsapp.sent[0].payload.text).toContain("done");
    expect(db.rows("outbound_messages").map(r => r.status)).toEqual(["cancelled", "sent"]);
  });
  it("never retries uncertainty and still records the original receipt after a reset", async () => {
    const { db, c, injected, adapters } = await setup();
    adapters.telegram.send = vi.fn(async () => {
      db.rows("accounts")[0].context_generation = 1;
      return { ok: true as const, externalMsgId: "accepted" };
    });
    await notifyCommand(db, c, injected);
    expect(db.rows("outbound_messages")[0]).toMatchObject({ status: "sent", context_generation: 0, external_msg_id: "accepted" });
    expect(db.rows("chat_messages")).toEqual([]);
    await expect(notifyCommand(db, c, injected)).rejects.toThrow();
    expect(adapters.telegram.send).toHaveBeenCalledTimes(1);
  });
  it("same result reconciliation does not invent another notification revision", async () => {
    const { queue, c, db } = await setup();
    const again = await queue.transition(c, c.status, { status: c.status, reply: c.reply, updatedAt: db.now() });
    expect(again?.notificationRevision).toBe(c.notificationRevision);
  });
  it("does not reserve a message while the release switch is disabled", async () => {
    const { db, c, injected, adapters } = await setup();
    vi.stubEnv("UNC_MESSAGING_ENABLED", "false");
    await notifyCommand(db, c, injected);
    expect(db.rows("outbound_messages")).toEqual([]);
    expect(adapters.telegram.sent).toEqual([]);
  });
});
