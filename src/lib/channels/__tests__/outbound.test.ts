/* Outbound selection: prefs per kind, quiet hours in the account's zone, per-ref dedup, the
   thread row written once per push, the WhatsApp 24-hour window (template for briefs, queue
   for everything else, flush on the next inbound), failures ledgered. */

import { describe, expect, it } from "vitest";
import { alreadyPushed, flushQueued, inQuietHours, listOutbound, prefAllows, pushToAccount, sendOnLink, whatsappWindowOpen, type OutboundDeps } from "../outbound";
import { listThread } from "../thread";
import { approvalButtons } from "../types";
import { ACCT, channelDb, clock, fakeAdapters, PREFS_ON, seedLink } from "./helpers";

const AP = "00000000-0000-4000-8000-0000000000a1";

describe("inQuietHours (pure)", () => {
  it("same-day and overnight windows, in the account's timezone", () => {
    const q = { start: "22:00", end: "07:00" };
    // 2026-09-02T09:00Z = 21:00 NZST (Pacific/Auckland, +12)
    expect(inQuietHours(q, new Date("2026-09-02T09:00:00.000Z"), "Pacific/Auckland")).toBe(false);
    expect(inQuietHours(q, new Date("2026-09-02T10:30:00.000Z"), "Pacific/Auckland")).toBe(true); // 22:30
    expect(inQuietHours(q, new Date("2026-09-02T18:30:00.000Z"), "Pacific/Auckland")).toBe(true); // 06:30
    expect(inQuietHours(q, new Date("2026-09-02T19:30:00.000Z"), "Pacific/Auckland")).toBe(false); // 07:30
    expect(inQuietHours({ start: "12:00", end: "14:00" }, new Date("2026-09-02T13:00:00.000Z"), "UTC")).toBe(true);
    expect(inQuietHours({ start: "12:00", end: "14:00" }, new Date("2026-09-02T14:00:00.000Z"), "UTC")).toBe(false);
    expect(inQuietHours(null, new Date(), "UTC")).toBe(false);
    expect(inQuietHours(q, new Date("2026-09-02T23:00:00.000Z"), "Not/AZone")).toBe(true); // falls back to UTC
  });

  it("prefs gate kinds; replies and link lines always go", () => {
    const link = seedLink(channelDb(), { prefs: { brief: false, approvals: true, drafts: false, quiet_hours: null } });
    expect(prefAllows(link, "brief")).toBe(false);
    expect(prefAllows(link, "draft_landed")).toBe(false);
    expect(prefAllows(link, "approval")).toBe(true);
    expect(prefAllows(link, "reminder")).toBe(true);
    expect(prefAllows(link, "reply")).toBe(true);
    expect(prefAllows(link, "link")).toBe(true);
  });
});

describe("pushToAccount", () => {
  it("sends to every verified link whose prefs allow the kind, once per ref, writing one thread row; failures are ledgered", async () => {
    const db = channelDb();
    const clk = clock();
    const adapters = fakeAdapters();
    const tg = seedLink(db, { channel: "telegram", external_id: "555" });
    const sms = seedLink(db, { channel: "sms", external_id: "+6421", prefs: { ...PREFS_ON, brief: false } });
    const pending = seedLink(db, { channel: "whatsapp", external_id: "6421", verified_at: null });
    const deps: OutboundDeps = { db, adapters, now: clk.now };
    const links = [tg, sms, pending];

    const r1 = await pushToAccount(deps, { accountId: ACCT, kind: "brief", ref: "brief:b1", payload: { text: "Morning. Here's today:" }, links, timezone: "UTC" });
    expect(r1).toEqual({ sent: 1, failed: 0, queued: 0, quiet: 0, skipped: 2, delivered: true });
    expect(adapters.telegram.sent).toHaveLength(1);
    expect(adapters.sms.sent).toHaveLength(0);
    // the thread carries the brief once, on the channel it went to
    expect((await listThread(db, ACCT)).map((m) => [m.channel, m.sender, m.body])).toEqual([["telegram", "unc", "Morning. Here's today:"]]);

    // same ref again → nothing
    const r2 = await pushToAccount(deps, { accountId: ACCT, kind: "brief", ref: "brief:b1", payload: { text: "Morning. Here's today:" }, links, timezone: "UTC" });
    expect(r2.sent).toBe(0);
    expect(adapters.telegram.sent).toHaveLength(1);
    expect(await alreadyPushed(db, ACCT, tg.id, "brief:b1")).toBe(true);
    expect(await alreadyPushed(db, ACCT, sms.id, "brief:b1")).toBe(false);

    // an approval goes to both; the thread row is written once even with two sends
    adapters.sms.fail = true;
    const r3 = await pushToAccount(deps, { accountId: ACCT, kind: "approval", ref: `approval:${AP}`, payload: { text: "One decision needs you.", buttons: approvalButtons(AP) }, links, timezone: "UTC" });
    expect(r3).toMatchObject({ sent: 1, failed: 1, delivered: true });
    expect(adapters.telegram.sent[1].payload.buttons).toHaveLength(3);
    const ledger = await listOutbound(db, ACCT);
    expect(ledger.map((l) => [l.channel, l.kind, l.status, l.ref])).toEqual([
      ["sms", "approval", "failed", `approval:${AP}`],
      ["telegram", "approval", "sent", `approval:${AP}`],
      ["telegram", "brief", "sent", "brief:b1"],
    ]);
    expect(ledger[0].error).toBe("sms down");
    expect((await listThread(db, ACCT)).filter((m) => m.body === "One decision needs you.")).toHaveLength(1);
    // a failed send is not "pushed": the next tick retries that link
    expect(await alreadyPushed(db, ACCT, sms.id, `approval:${AP}`)).toBe(false);
  });

  it("quiet hours skip without a ledger row so the next tick outside the window sends", async () => {
    const db = channelDb();
    const clk = clock("2026-09-02T11:00:00.000Z"); // 23:00 NZST
    const adapters = fakeAdapters();
    const link = seedLink(db, { prefs: { ...PREFS_ON, quiet_hours: { start: "22:00", end: "07:00" } } });
    const deps: OutboundDeps = { db, adapters, now: clk.now };
    const r = await pushToAccount(deps, { accountId: ACCT, kind: "draft_landed", ref: "draft:r1", payload: { text: "A draft just landed." }, links: [link], timezone: "Pacific/Auckland" });
    expect(r).toMatchObject({ sent: 0, quiet: 1, delivered: false });
    expect(await listOutbound(db, ACCT)).toEqual([]);
    clk.set("2026-09-02T20:00:00.000Z"); // 08:00 NZST
    const r2 = await pushToAccount(deps, { accountId: ACCT, kind: "draft_landed", ref: "draft:r1", payload: { text: "A draft just landed." }, links: [link], timezone: "Pacific/Auckland" });
    expect(r2).toMatchObject({ sent: 1, quiet: 0 });
  });

  it("unconfigured or missing adapters skip; another account's link is never used", async () => {
    const db = channelDb();
    const clk = clock();
    const adapters = fakeAdapters();
    (adapters as { sms?: unknown }).sms = undefined;
    const tg = seedLink(db, { channel: "telegram", external_id: "1", account_id: "00000000-0000-4000-8000-00000000acc2" });
    const sms = seedLink(db, { channel: "sms", external_id: "+1" });
    const r = await pushToAccount({ db, adapters, now: clk.now }, { accountId: ACCT, kind: "brief", ref: "brief:x", payload: { text: "x" }, links: [tg, sms], timezone: null });
    expect(r).toMatchObject({ sent: 0, skipped: 1, delivered: false });
    expect(adapters.telegram.sent).toEqual([]);
  });
});

describe("WhatsApp 24-hour window", () => {
  it("open within 24 h of the last inbound; briefs use the template outside it; other kinds queue and flush on the next inbound", async () => {
    const db = channelDb();
    const clk = clock("2026-09-03T12:00:00.000Z");
    const adapters = fakeAdapters();
    const fresh = seedLink(db, { channel: "whatsapp", external_id: "6421", last_inbound_at: "2026-09-03T11:00:00.000Z" });
    const stale = seedLink(db, { channel: "whatsapp", external_id: "6422", last_inbound_at: "2026-09-02T09:00:00.000Z" });
    const never = seedLink(db, { channel: "whatsapp", external_id: "6423", last_inbound_at: null });
    expect(whatsappWindowOpen(fresh, clk.at())).toBe(true);
    expect(whatsappWindowOpen(stale, clk.at())).toBe(false);
    expect(whatsappWindowOpen(never, clk.at())).toBe(false);
    expect(whatsappWindowOpen(seedLink(db, { channel: "telegram", external_id: "9", last_inbound_at: null }), clk.at())).toBe(true);

    const deps: OutboundDeps = { db, adapters, now: clk.now };
    const brief = await sendOnLink(deps, stale, "brief", { text: "Morning. Here's today:" }, { ref: "brief:b1", allowTemplate: true });
    expect(brief.status).toBe("sent");
    expect(adapters.whatsapp.sent[0].opts.template).toBe(true);
    const inside = await sendOnLink(deps, fresh, "brief", { text: "Morning." }, { ref: "brief:b1", allowTemplate: true });
    expect(inside.status).toBe("sent");
    expect(adapters.whatsapp.sent[1].opts.template).toBe(false);

    const q = await sendOnLink(deps, stale, "approval", { text: "One decision needs you.", buttons: approvalButtons(AP) }, { ref: `approval:${AP}` });
    expect(q.status).toBe("queued");
    expect(adapters.whatsapp.sent).toHaveLength(2);
    expect(await alreadyPushed(db, ACCT, stale.id, `approval:${AP}`)).toBe(true); // queued counts: no double-queue
    expect((await listThread(db, ACCT)).map((m) => m.body)).toEqual(["Morning. Here's today:", "Morning."]); // nothing in the thread until it is actually sent

    // the founder writes back → the window opens → the queue drains
    const flushed = await flushQueued(deps, { ...stale, lastInboundAt: clk.now().toISOString() });
    expect(flushed).toBe(1);
    expect(adapters.whatsapp.sent[2].payload.text).toBe("One decision needs you.");
    const ledger = await listOutbound(db, ACCT);
    expect(ledger.find((l) => l.kind === "approval")).toMatchObject({ status: "sent", externalMsgId: "whatsapp-out-3" });
    expect(await flushQueued(deps, stale)).toBe(0);
    expect(await flushQueued(deps, seedLink(db, { channel: "telegram", external_id: "77" }))).toBe(0);
  });
});
