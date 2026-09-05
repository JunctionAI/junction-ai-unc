import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCT, OTHER, USER, channelDb, clock, fakeAdapters, seedLink } from "../../channels/__tests__/helpers";
import { SupabaseStore } from "../../runtime/store/supabase";
import { artifactView } from "../handlers";
import { artifactMessage, sendArtifact } from "../delivery";
import { installArtifactFixture } from "./deliveryFixture";
import { artifactHeaders, deliveryNotice } from "../client";
import type { Channel, SendResult } from "../../channels/types";

async function setup(channel: Channel = "telegram") {
  const db = channelDb(); const clk = clock(); db.now = () => clk.at().toISOString();
  const adapters = fakeAdapters(); const link = seedLink(db, { channel });
  installArtifactFixture(db);
  const store = new SupabaseStore(db);
  db.seed("routine_runs", [{ id: "run", account_id: ACCT, context_generation: 0, routine_id: "D03-W01", mode: "dry_run", status: "done" }]);
  const artifact = artifactView(await store.putArtifact({ id: "artifact", accountId: ACCT, runId: "run", routineId: "D03-W01", kind: "keyword_list",
    title: "golf travel bag", body: "**Discovery seed**", items: [{ title: "US", body: "Read demand" }], evidence: [], meta: {}, status: "draft", createdAt: db.now() }), 0);
  const input = { accountId: ACCT, contextGeneration: 0, userId: USER, artifact, expectedRevision: 0, channel };
  const deps = { db, adapters, now: clk.now };
  return { db, clk, store, adapters, link, deps, input };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("artifact original delivery request", () => {
  it("concurrent clicks create one durable request/send, then reload reads the same receipt", async () => {
    const { deps, input, db, adapters } = await setup();
    let resolve!: (r: SendResult) => void;
    adapters.telegram.send = vi.fn(() => new Promise<SendResult>(r => { resolve = r; }));
    const first = sendArtifact(deps, input);
    await vi.waitFor(() => expect(adapters.telegram.send).toHaveBeenCalledTimes(1));
    const again = await sendArtifact(deps, input);
    expect(again.sent[0].status).toBe("sending");
    resolve({ ok: true, externalMsgId: "accepted-once" });
    const done = await first;
    expect(done.deliveryId).toBe(again.deliveryId);
    expect((await sendArtifact(deps, input)).sent[0].status).toBe("sent");
    expect(db.rows("artifact_deliveries")).toHaveLength(1);
    expect(db.rows("outbound_messages")).toHaveLength(1);
    expect(db.rows("chat_messages")).toHaveLength(1);
    expect(adapters.telegram.send).toHaveBeenCalledTimes(1);
  });

  it("does not add another device or another member's link when an accepted request is retried", async () => {
    const { deps, input, db, adapters } = await setup();
    seedLink(db, { user_id: "someone-else", external_id: "not-the-requester" });
    const first = await sendArtifact(deps, input);
    seedLink(db, { external_id: "new-device" });
    db.rows("channel_links")[0].external_id = "replacement-device";
    db.rows("channel_links")[0].binding_version = 1;
    expect((await sendArtifact(deps, input)).deliveryId).toBe(first.deliveryId);
    expect(adapters.telegram.sent.map(s => s.to)).toEqual(["tg-chat-1"]);
  });

  it("queued requests cancel after rebind instead of sending to the replacement", async () => {
    const { deps, input, db, adapters } = await setup("whatsapp");
    db.rows("channel_links")[0].last_inbound_at = null;
    expect((await sendArtifact(deps, input)).sent[0].status).toBe("queued");
    Object.assign(db.rows("channel_links")[0], { binding_version: 1, external_id: "new-number", last_inbound_at: db.now() });
    expect((await sendArtifact(deps, input)).sent[0].status).toBe("cancelled");
    expect(db.rows("artifact_deliveries")).toHaveLength(1);
    expect(adapters.whatsapp.sent).toHaveLength(0);
  });

  it.each(["held", "edited", "owner"])("queued copies cannot send when %s changes", async change => {
    const { deps, input, db, adapters, store } = await setup("whatsapp");
    db.rows("channel_links")[0].last_inbound_at = null;
    await sendArtifact(deps, input);
    db.rows("channel_links")[0].last_inbound_at = db.now();
    if (change === "owner") {
      const claim = db.rpcs.claim_channel_outbound;
      db.rpcs.claim_channel_outbound = args => { db.rows("account_members")[0].role = "member"; return claim(args); };
    } else await store.updateArtifact("artifact", change === "held" ? { status: "held" } : { status: "edited", editedBody: "New content" });
    expect((await sendArtifact(deps, input)).sent[0].status).toBe("cancelled");
    expect(adapters.whatsapp.sent).toHaveLength(0);
  });

  it("retains uncertain outcome across retry rather than sending again", async () => {
    const { deps, input, db, adapters } = await setup(); adapters.telegram.fail = true;
    expect((await sendArtifact(deps, input)).sent[0].status).toBe("uncertain");
    adapters.telegram.fail = false;
    expect((await sendArtifact(deps, input)).sent[0].status).toBe("uncertain");
    expect(adapters.telegram.sent).toHaveLength(1);
    expect(db.rows("chat_messages")).toHaveLength(0);
  });

  it("preserves real acceptance across reset while rejecting a stale response/history", async () => {
    const { deps, input, db, adapters } = await setup();
    adapters.telegram.send = vi.fn(async () => {
      db.rows("accounts")[0].context_generation = 1;
      return { ok: true as const, externalMsgId: "accepted-at-reset" };
    });
    await expect(sendArtifact(deps, input)).rejects.toThrow(/context changed/i);
    expect(db.rows("outbound_messages")[0]).toMatchObject({ status: "sent", external_msg_id: "accepted-at-reset", context_generation: 0 });
    expect(db.rows("chat_messages")).toHaveLength(0);
    expect(adapters.telegram.send).toHaveBeenCalledTimes(1);
  });

  it("refuses another tenant and the release-disabled path before reserving/sending", async () => {
    const { deps, input, db, adapters } = await setup();
    await expect(sendArtifact(deps, { ...input, accountId: OTHER })).rejects.toThrow();
    vi.stubEnv("UNC_MESSAGING_ENABLED", "false");
    await expect(sendArtifact(deps, input)).rejects.toThrow(/disabled/i);
    expect(db.rows("artifact_deliveries")).toHaveLength(0);
    expect(adapters.telegram.sent).toHaveLength(0);
  });

  it("filters current artifacts before the limit, with a captured generation envelope", async () => {
    const { db, store } = await setup();
    db.rows("accounts")[0].context_generation = 1;
    db.insertRow("routine_runs", { id: "new-run", account_id: ACCT, context_generation: 1 });
    await store.putArtifact({ ...(await store.getArtifact("artifact"))!, id: "current", runId: "new-run", createdAt: "2020-01-01T00:00:00Z" });
    expect((await store.listArtifacts(ACCT, { contextGeneration: 1, limit: 1 })).map(a => a.id)).toEqual(["current"]);
  });

  it("keeps body and item rendering, and distinguishes queued/uncertain/accepted", async () => {
    const { input } = await setup();
    expect(artifactMessage(input.artifact)).toBe("golf travel bag\n\nDiscovery seed\n\n1. US\nRead demand");
    expect(artifactHeaders(ACCT, 1)).toEqual({ "x-unc-account-id": ACCT, "x-unc-context-generation": "1" });
    expect(deliveryNotice([{ status: "queued" }], "Slack")).toContain("not sent yet");
    expect(deliveryNotice([{ status: "uncertain" }], "Slack")).toContain("not confirmed");
    expect(deliveryNotice([{ status: "sent" }], "Slack")).toContain("Device delivery isn't confirmed");
  });
});
