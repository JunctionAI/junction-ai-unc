import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { saveInboundEvents, drainInboundEvents } from "../../channels/inbox";
import type { InboundEvent } from "../../channels/types";

const event: InboundEvent = { channel: "slack", scopeId: "team-a", externalId: "user-a", externalMsgId: "message-a", text: "Run the SEO routine" };
describe("durable channel inbox", () => {
  it("deduplicates redeliveries and persists across processor instances", async () => {
    const db = new FakeSupabase();
    await saveInboundEvents(db, [event, event]);
    const handle = vi.fn(async () => {});
    await Promise.all([drainInboundEvents(db, handle), drainInboundEvents(db, handle)]);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(event);
    await drainInboundEvents(db, handle);
    expect(handle).toHaveBeenCalledTimes(1);
  });
  it("separates workspace and sender identities", async () => {
    const db = new FakeSupabase();
    await saveInboundEvents(db, [event, { ...event, scopeId: "team-b" }, { ...event, externalId: "user-b" }]);
    const handle = vi.fn(async () => {});
    await drainInboundEvents(db, handle);
    expect(handle).toHaveBeenCalledTimes(3);
  });
  it("does not repeat an ambiguous handler failure", async () => {
    const db = new FakeSupabase();
    await saveInboundEvents(db, [event]);
    const handle = vi.fn(async () => { throw new Error("lost response"); });
    await drainInboundEvents(db, handle);
    await drainInboundEvents(db, handle);
    expect(handle).toHaveBeenCalledTimes(1);
    const { data } = await db.from("channel_inbox").select("status");
    expect(data).toEqual([{ status: "uncertain" }]);
  });
  it("rejects oversized messages without saving them", async () => {
    const db = new FakeSupabase();
    await expect(saveInboundEvents(db, [{ ...event, text: "x".repeat(20_000) }])).rejects.toThrow("size limit");
  });
});
