/* handleInbound end to end on the fake: the link handshake, an unknown sender, a message
   through the (scripted) Unc pipeline stored with its channel and sent back, redelivery as a
   no-op, and the decision path — a button press / keyword → the SAME approve/hold resume path
   the app uses (decided_by = the linked founder) on both MemoryStore and SupabaseStore, "Why"
   → the approval's reasoning. */

import { describe, expect, it } from "vitest";
import type { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { runRoutine } from "@/lib/runtime/engine";
import { StaticReader } from "@/lib/runtime/providers";
import type { Store } from "@/lib/runtime/store/interface";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { SupabaseStore } from "@/lib/runtime/store/supabase";
import { budgetMoveSpec, clock as rtClock, input, SPEND_FIXTURE } from "@/lib/runtime/__tests__/helpers";
import { StaticAccountsSource } from "@/worker/accounts";
import { buildAdapters as buildRunAdapters, type ServiceDeps } from "@/worker/service";
import { SMS_NO_MODEL_LINE } from "../approvals";
import { OWNER_DECISION_LINE, type InboundDeps, type RespondFn } from "../inbound";
import { handleTestInbound as handleInbound } from "./helpers";
import { findVerifiedLink, issueLinkCode } from "../links";
import { listOutbound } from "../outbound";
import { listThread } from "../thread";
import { approvalButtonId, shortId, type InboundEvent } from "../types";
import { ACCT, channelDb, clock, fakeAdapters, seedLink, USER } from "./helpers";

const scripted = (reply: string): RespondFn & { calls: { accountId: string; history: { role: string; content: string }[] }[] } => {
  const calls: { accountId: string; history: { role: string; content: string }[] }[] = [];
  const fn = (async ({ accountId, history }) => {
    calls.push({ accountId, history });
    return { ok: true as const, reply };
  }) as RespondFn & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};

type TestDeps = InboundDeps & { db: FakeSupabase; adapters: ReturnType<typeof fakeAdapters> };

function deps(over: Partial<InboundDeps> = {}): TestDeps {
  const db = channelDb();
  const clk = clock();
  return { db, store: new MemoryStore(), accounts: new StaticAccountsSource(), adapters: fakeAdapters(), now: clk.now, log: () => {}, ...over } as TestDeps;
}

const tgText = (text: string, id = "555:1"): InboundEvent => ({ channel: "telegram", externalId: "555", externalMsgId: id, text, handle: "tomh", displayName: "Tom" });

describe("linking + unknown senders", () => {
  it("welcomes a verified SMS link in the texting voice", async () => {
    const d = deps();
    const issued = await issueLinkCode(d.db, { accountId: ACCT, userId: USER, channel: "sms", now: d.now() });
    const out = await handleInbound(d, { channel: "sms", externalId: "+6421", externalMsgId: "SM-link", text: issued.code });
    expect(out.kind).toBe("linked");
    expect(d.adapters.sms.sent[0].payload.text).toMatch(/^hey 👋/);
    expect(d.adapters.sms.sent[0].payload.text).toContain("same conversation");
  });
  it("/start <code> links the device and sends the welcome; nothing lands in the thread", async () => {
    const d = deps();
    const issued = await issueLinkCode(d.db, { accountId: ACCT, userId: USER, channel: "telegram", now: d.now() });
    const out = await handleInbound(d, tgText(`/start ${issued.code}`));
    expect(out).toEqual({ kind: "linked", accountId: ACCT, linkId: issued.linkId });
    expect((await findVerifiedLink(d.db, "telegram", "555"))?.displayName).toBe("Tom");
    expect(d.adapters.telegram.sent[0].payload.text).toContain("same conversation");
    expect((await listOutbound(d.db, ACCT)).map((l) => l.kind)).toEqual(["link"]);
    expect(await listThread(d.db, ACCT)).toEqual([]);
  });

  it("a bad code gets one honest line; an unlinked sender gets one honest line and nothing is stored", async () => {
    const d = deps();
    expect(await handleInbound(d, tgText("UNC-ZZZZZZ"))).toEqual({ kind: "link_failed", reason: "unknown" });
    expect(d.adapters.telegram.sent[0].payload.text).toContain("didn't match");
    expect(await handleInbound(d, tgText("what ran overnight?", "555:2"))).toEqual({ kind: "unlinked" });
    expect(d.adapters.telegram.sent[1].payload.text).toContain("I don't know this number yet");
    expect(d.db.rows("chat_messages")).toEqual([]);
    expect(d.db.rows("outbound_messages")).toEqual([]);
    // a press from an unknown sender is silent
    expect(await handleInbound(d, { channel: "telegram", externalId: "999", externalMsgId: "999:cb:1", action: approvalButtonId("x", "approve") })).toEqual({ kind: "unlinked" });
    expect(d.adapters.telegram.sent).toHaveLength(2);
  });
});

describe("a message → the same Unc", () => {
  it("takes the SMS delivery channel from the verified event for voice selection", async () => {
    const d = deps();
    seedLink(d.db, { channel: "sms", external_id: "+6421" });
    let actualChannel: string | undefined;
    await handleInbound({ ...d, respond: async ({ channel }) => {
      actualChannel = channel;
      return { ok: true, reply: "hey 👋 what do you want to tackle?" };
    } }, { channel: "sms", externalId: "+6421", externalMsgId: "SM-voice", text: "hello" });
    expect(actualChannel).toBe("sms");
    expect(d.adapters.sms.sent[0].payload.text).toBe("hey 👋 what do you want to tackle?");
  });

  it("appends the turn with its channel, runs the pipeline over the cross-channel history, stores + sends the reply; redelivery is a no-op", async () => {
    const d = deps();
    seedLink(d.db, { channel: "telegram", external_id: "555" });
    d.db.seed("chat_messages", [{ account_id: ACCT, thread: "corner", position: 0, lane: "ai", sender: "user", body: "Morning.", channel: "app", created_at: "2026-09-02T08:00:00.000Z" }]);
    const respond = scripted("Two runs finished overnight and one draft is waiting in the app.");
    const out = await handleInbound({ ...d, respond }, tgText("what ran overnight?"));
    expect(out).toEqual({ kind: "replied", accountId: ACCT, reply: "Two runs finished overnight and one draft is waiting in the app.", live: true });
    expect(respond.calls[0].history).toEqual([
      { role: "user", content: "Morning." },
      { role: "user", content: "what ran overnight?" },
    ]);
    expect(d.adapters.telegram.sent[0]).toMatchObject({ to: "555", payload: { text: "Two runs finished overnight and one draft is waiting in the app." } });
    const thread = await listThread(d.db, ACCT);
    expect(thread.map((m) => [m.channel, m.sender, m.body])).toEqual([
      ["app", "user", "Morning."],
      ["telegram", "user", "what ran overnight?"],
      ["telegram", "unc", "Two runs finished overnight and one draft is waiting in the app."],
    ]);
    expect(thread[2].delivery).toMatchObject({ status: "sent", live: true, in_reply_to: "555:1" });
    expect(thread[2].externalMsgId).toBe("out:telegram-out-1");
    expect((await listOutbound(d.db, ACCT)).map((l) => [l.kind, l.status])).toEqual([["reply", "sent"]]);
    expect((await findVerifiedLink(d.db, "telegram", "555"))?.lastInboundAt).not.toBe("2026-09-02T09:00:00.000Z");

    expect(await handleInbound({ ...d, respond }, tgText("what ran overnight?"))).toEqual({ kind: "duplicate" });
    expect(respond.calls).toHaveLength(1);
    expect(d.adapters.telegram.sent).toHaveLength(1);
  });

  it("no model / a pipeline failure → the honest line is stored and sent, never a dead end", async () => {
    const d = deps();
    seedLink(d.db, { channel: "sms", external_id: "+6421" });
    const out = await handleInbound({ ...d, respond: async () => ({ ok: false, reason: "not_configured" }) }, { channel: "sms", externalId: "+6421", externalMsgId: "SM1", text: "hello?" });
    expect(out).toEqual({ kind: "replied", accountId: ACCT, reply: SMS_NO_MODEL_LINE, live: false });
    expect(d.adapters.sms.sent[0].payload.text).toBe(SMS_NO_MODEL_LINE);
    const boom = await handleInbound({ ...d, respond: async () => Promise.reject(new Error("provider down")) }, { channel: "sms", externalId: "+6421", externalMsgId: "SM2", text: "still there?" });
    expect(boom).toMatchObject({ kind: "replied", live: false });
    expect((await listThread(d.db, ACCT)).filter((m) => m.sender === "unc").every((m) => m.delivery.live === false)).toBe(true);
  });
});

// ---------- decisions ----------

interface Harness {
  d: TestDeps;
  store: Store;
  approvalId: string;
  runId: string;
}

/** A paused LIVE run (the only way an approval exists) on the given store, linked to ACCT on telegram + sms. */
async function decisionHarness(kind: "memory" | "supabase"): Promise<Harness> {
  const d = deps();
  const store: Store = kind === "supabase" ? new SupabaseStore(d.db) : new MemoryStore();
  const clk = rtClock();
  const svc: ServiceDeps = { store, accounts: new StaticAccountsSource(), now: clk.now };
  const adapters = { ...buildRunAdapters(svc), reader: new StaticReader(SPEND_FIXTURE, clk.now), now: clk.now };
  const r = await runRoutine(budgetMoveSpec(), input({ account: { accountId: ACCT, currency: "NZD", budgetMonthly: 3000, approver: "Tom" }, triggeredBy: "manual" }), adapters, { mode: "live" });
  expect(r.status).toBe("waiting_approval");
  seedLink(d.db, { channel: "telegram", external_id: "555" });
  seedLink(d.db, { channel: "sms", external_id: "+6421" });
  return { d: { ...d, store }, store, approvalId: r.approval!.id, runId: r.runId };
}

for (const kind of ["memory", "supabase"] as const) {
  describe(`decisions from a channel on ${kind}`, () => {
    it("Hold button → the same resume path: approval held, run skipped, taste_event; receipt line back in Unc's voice; both turns on the thread; press acked", async () => {
      const h = await decisionHarness(kind);
      const press: InboundEvent = { channel: "telegram", externalId: "555", externalMsgId: "555:cb:1", action: approvalButtonId(h.approvalId, "hold"), ackRef: "cbq1" };
      const out = await handleInbound(h.d, press);
      expect(out).toMatchObject({ kind: "decided", accountId: ACCT, approvalId: h.approvalId, decision: "held" });
      const a = await h.store.getApproval(h.approvalId);
      expect(a?.status).toBe("held");
      expect(a?.decidedBy).toBe(USER);
      expect((await h.store.getRun(h.runId))?.status).toBe("skipped");
      expect((await h.store.listTasteEvents(ACCT)).map((t) => t.action)).toEqual(["held"]);
      const reply = h.d.adapters.telegram.sent[0].payload.text;
      expect(reply).toMatch(/^Held — /);
      expect(reply).not.toMatch(/!/);
      expect(h.d.adapters.telegram.acks[0]).toMatchObject({ event: press });
      expect((await listThread(h.d.db, ACCT)).map((m) => [m.sender, m.channel, m.body.slice(0, 6)])).toEqual([
        ["user", "telegram", "Hold —"],
        ["unc", "telegram", "Held —"],
      ]);
      // redelivered press → nothing
      expect(await handleInbound(h.d, press)).toEqual({ kind: "duplicate" });
      expect(h.d.adapters.telegram.sent).toHaveLength(1);
    });

    it("Approve button → approved; the shipped executor refuses so the line says nothing changes yet", async () => {
      const h = await decisionHarness(kind);
      const out = await handleInbound(h.d, { channel: "telegram", externalId: "555", externalMsgId: "555:cb:2", action: approvalButtonId(h.approvalId, "approve") });
      expect(out).toMatchObject({ kind: "decided", decision: "approved" });
      expect((await h.store.getApproval(h.approvalId))?.status).toBe("approved");
      expect(h.d.adapters.telegram.sent[0].payload.text).toMatch(/^Approved — .*live mode is off/);
      // deciding again on another channel → already decided, said plainly
      const again = await handleInbound(h.d, { channel: "sms", externalId: "+6421", externalMsgId: "SM9", text: `HOLD ${shortId(h.approvalId)}` });
      expect(again).toMatchObject({ kind: "decision_failed" });
      expect(h.d.adapters.sms.sent[0].payload.text).toMatch(/already approved/);
    });

    it("a member-owned or stale channel link cannot decide an approval", async () => {
      const h = await decisionHarness(kind);
      h.d.db.rows("account_members")[0].role = "member";
      const out = await handleInbound(h.d, { channel: "telegram", externalId: "555", externalMsgId: "555:cb:member", action: approvalButtonId(h.approvalId, "approve") });
      expect(out).toEqual({ kind: "decision_failed", accountId: ACCT, reply: OWNER_DECISION_LINE });
      expect((await h.store.getApproval(h.approvalId))?.status).toBe("pending");
      expect((await h.store.getRun(h.runId))?.status).toBe("waiting_approval");
      expect(await h.store.listTasteEvents(ACCT)).toEqual([]);
      expect(h.d.adapters.telegram.sent[0].payload.text).toBe(OWNER_DECISION_LINE);
    });

    it("Why → the approval's reasoning, a why_opened taste event, nothing decided", async () => {
      const h = await decisionHarness(kind);
      const out = await handleInbound(h.d, { channel: "telegram", externalId: "555", externalMsgId: "555:cb:3", action: approvalButtonId(h.approvalId, "why") });
      expect(out).toMatchObject({ kind: "why", approvalId: h.approvalId });
      const a = await h.store.getApproval(h.approvalId);
      expect(a?.status).toBe("pending");
      expect(h.d.adapters.telegram.sent[0].payload.text).toBe((out as { reply: string }).reply);
      expect((await h.store.listTasteEvents(ACCT)).map((t) => [t.action, t.context])).toEqual([["why_opened", { channel: "telegram" }]]);
    });

    it("SMS keywords: 'YES' with the single pending approval; a short id; an unknown id; nothing pending", async () => {
      const h = await decisionHarness(kind);
      const bad = await handleInbound(h.d, { channel: "sms", externalId: "+6421", externalMsgId: "SM1", text: "YES deadbeef" });
      expect(bad).toMatchObject({ kind: "decision_failed" });
      expect(h.d.adapters.sms.sent[0].payload.text).toMatch(/can't match that/);
      const ok = await handleInbound(h.d, { channel: "sms", externalId: "+6421", externalMsgId: "SM2", text: `yes ${shortId(h.approvalId).slice(0, 6)}` });
      expect(ok).toMatchObject({ kind: "decided", decision: "approved" });
      expect((await h.store.getApproval(h.approvalId))?.decidedBy).toBe(USER);
      const none = await handleInbound(h.d, { channel: "sms", externalId: "+6421", externalMsgId: "SM3", text: "hold" });
      expect(none).toMatchObject({ kind: "decision_failed", reply: "Nothing is waiting on you right now — I'll bring the next decision here." });
      // the founder's own words are what lands on the thread
      expect((await listThread(h.d.db, ACCT)).filter((m) => m.sender === "user").map((m) => m.body)).toEqual(["YES deadbeef", `yes ${shortId(h.approvalId).slice(0, 6)}`, "hold"]);
    });
  });
}
