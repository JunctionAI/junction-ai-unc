/* Link-code lifecycle (issue / consume / expire / re-issue / move device) and the one thread
   (idempotent append, app + channel rows interleaved by time, the client hydrating only app
   rows) — on the schema-checked fake. */

import { describe, expect, it } from "vitest";
import { loadAccountRows } from "@/lib/db/accountState";
import { accountsWithLinks, issueLinkCode, LINK_CODE_TTL_MS, listLinks, looksLikeLinkCode, normaliseLinkCode, normalisePrefs, unlink, updatePrefs, upsertVerifiedLink, verifiedLinks, findVerifiedLink } from "../links";
import { appendInbound, appendOutbound, historyFor, listThread, POSITION_BAND, positionFor } from "../thread";
import { ACCT, channelDb, clock, OTHER, seedLink, USER, consumeCodeForTest as consumeLinkCode } from "./helpers";

describe("link codes", () => {
  it("issue → consume from the device verifies the row and clears the code; the welcome names the channel", async () => {
    const db = channelDb();
    const clk = clock();
    const issued = await issueLinkCode(db, { accountId: ACCT, userId: USER, channel: "telegram", now: clk.now() });
    expect(issued.code).toMatch(/^UNC-[A-Z2-9]{6}$/);
    expect(new Date(issued.expiresAt).getTime() - clk.at().getTime()).toBe(LINK_CODE_TTL_MS);
    expect(await verifiedLinks(db, ACCT)).toEqual([]);
    expect(await findVerifiedLink(db, "telegram", "555")).toBeNull();

    const r = await consumeLinkCode(db, { code: `/start ${issued.code.toLowerCase()}`, channel: "telegram", externalId: "555", handle: "tomh", displayName: "Tom", now: clk.now() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.link).toMatchObject({ id: issued.linkId, accountId: ACCT, userId: USER, channel: "telegram", externalId: "555", handle: "tomh", displayName: "Tom", linkCode: null });
    expect(r.welcome).toContain("Telegram");
    expect(r.welcome).toContain("same conversation");
    expect((await findVerifiedLink(db, "telegram", "555"))?.id).toBe(issued.linkId);
    expect(await accountsWithLinks(db)).toEqual([ACCT]);
    // the code is single-use
    expect(await consumeLinkCode(db, { code: issued.code, channel: "telegram", externalId: "556", now: clk.now() })).toEqual({ ok: false, reason: "unknown" });
  });

  it("expired, unknown and wrong-channel codes are refused; re-issuing replaces the code on the same pending row", async () => {
    const db = channelDb();
    const clk = clock();
    const first = await issueLinkCode(db, { accountId: ACCT, userId: USER, channel: "whatsapp", now: clk.now() });
    const second = await issueLinkCode(db, { accountId: ACCT, userId: USER, channel: "whatsapp", now: clk.now() });
    expect(second.linkId).toBe(first.linkId);
    expect(second.code).not.toBe(first.code);
    expect(await consumeLinkCode(db, { code: first.code, channel: "whatsapp", externalId: "6421", now: clk.now() })).toEqual({ ok: false, reason: "unknown" });
    expect(await consumeLinkCode(db, { code: second.code, channel: "sms", externalId: "+6421", now: clk.now() })).toEqual({ ok: false, reason: "unknown" });
    clk.advance(LINK_CODE_TTL_MS + 1000);
    expect(await consumeLinkCode(db, { code: second.code, channel: "whatsapp", externalId: "6421", now: clk.now() })).toEqual({ ok: false, reason: "unknown" });
    expect(await consumeLinkCode(db, { code: "hello there", channel: "whatsapp", externalId: "6421", now: clk.now() })).toEqual({ ok: false, reason: "unknown" });
  });

  it("a device already linked elsewhere moves to the account whose code it sent; a second device on the same channel adds a row", async () => {
    const db = channelDb();
    const clk = clock();
    seedLink(db, { account_id: OTHER, channel: "telegram", external_id: "555" });
    const issued = await issueLinkCode(db, { accountId: ACCT, userId: USER, channel: "telegram", now: clk.now() });
    const r = await consumeLinkCode(db, { code: issued.code, channel: "telegram", externalId: "555", now: clk.now() });
    expect(r.ok).toBe(true);
    expect((await findVerifiedLink(db, "telegram", "555"))?.accountId).toBe(ACCT);
    expect(await verifiedLinks(db, OTHER)).toEqual([]);
    const more = await issueLinkCode(db, { accountId: ACCT, userId: USER, channel: "telegram", now: clk.now() });
    expect(more.linkId).not.toBe(issued.linkId);
    expect((await listLinks(db, ACCT)).map((l) => [l.channel, !!l.verifiedAt])).toEqual([
      ["telegram", true],
      ["telegram", false],
    ]);
  });

  it("normalises codes and prefs; prefs update and unlink are account-scoped", async () => {
    expect(normaliseLinkCode(" unc-abc234 ")).toBe("UNC-ABC234");
    expect(normaliseLinkCode("/start UNC-ABC234")).toBe("UNC-ABC234");
    expect(normaliseLinkCode("ABC234")).toBe("UNC-ABC234");
    expect(normaliseLinkCode("UNC-ABC10O")).toBeNull(); // 1/0/O are not in the alphabet
    expect(looksLikeLinkCode("what ran overnight")).toBe(false);
    expect(normalisePrefs(null)).toEqual({ brief: true, approvals: true, drafts: true, quiet_hours: null });
    expect(normalisePrefs({ brief: false, quiet_hours: { start: "22:00", end: "07:00" } })).toEqual({ brief: false, approvals: true, drafts: true, quiet_hours: { start: "22:00", end: "07:00" } });
    expect(normalisePrefs({ quiet_hours: { start: "25:00", end: "07:00" } }).quiet_hours).toBeNull();
    expect(normalisePrefs({ quiet_hours: { start: "07:00", end: "07:00" } }).quiet_hours).toBeNull();

    const db = channelDb();
    const link = seedLink(db);
    expect(await updatePrefs(db, OTHER, link.id, { brief: false })).toBeNull();
    expect((await updatePrefs(db, ACCT, link.id, { brief: false }))?.prefs).toEqual({ brief: false, approvals: true, drafts: true, quiet_hours: null });
    expect(await unlink(db, OTHER, link.id)).toBe(false);
    expect(await unlink(db, ACCT, link.id)).toBe(true);
    expect(await listLinks(db, ACCT)).toEqual([]);
  });

  it("upsertVerifiedLink (Slack): verifies straight away, adopts a pending row, and re-points an existing device", async () => {
    const db = channelDb();
    const clk = clock();
    const pending = await issueLinkCode(db, { accountId: ACCT, userId: USER, channel: "slack", now: clk.now() });
    const l1 = await upsertVerifiedLink(db, { accountId: ACCT, userId: USER, channel: "slack", externalId: "U1", displayName: "Acme", meta: { team_id: "T1" }, now: clk.now() });
    expect(l1.id).toBe(pending.linkId);
    expect(l1.meta).toEqual({ team_id: "T1" });
    const l2 = await upsertVerifiedLink(db, { accountId: OTHER, userId: null, channel: "slack", externalId: "U1", meta: { team_name: "Acme" }, now: clk.now() });
    expect(l2.id).toBe(l1.id);
    expect(l2.accountId).toBe(OTHER);
    expect(l2.meta).toEqual({ team_id: "T1", team_name: "Acme" });
    const l3 = await upsertVerifiedLink(db, { accountId: ACCT, userId: USER, channel: "slack", externalId: "U2", now: clk.now() });
    expect(l3.id).not.toBe(l1.id);
  });
});

describe("one thread", () => {
  it("channel positions live in their own band and never collide; append is idempotent on the platform message id", async () => {
    const db = channelDb();
    const clk = clock();
    const at = clk.now();
    expect(positionFor(at)).toBeGreaterThan(POSITION_BAND);
    expect(positionFor(at, 3)).toBe(positionFor(at) + 3);
    const a = await appendInbound(db, { accountId: ACCT, channel: "telegram", text: "what ran overnight?", externalMsgId: "555:1", now: at });
    const again = await appendInbound(db, { accountId: ACCT, channel: "telegram", text: "what ran overnight?", externalMsgId: "555:1", now: at });
    expect(again).toEqual({ id: a.id, created: false });
    // two turns in the same second take consecutive positions
    const b = await appendOutbound(db, { accountId: ACCT, channel: "telegram", text: "Two runs, one draft.", now: at });
    expect(b.created).toBe(true);
    const rows = db.rows("chat_messages");
    expect(rows.map((r) => r.position)).toEqual([positionFor(at), positionFor(at, 1)]);
    expect(rows[0]).toMatchObject({ thread: "corner", lane: "ai", sender: "user", channel: "telegram", external_msg_id: "555:1" });
    expect(rows[1]).toMatchObject({ sender: "unc", channel: "telegram" });
  });

  it("app + telegram turns interleave by time; the client hydrates only app rows; history feeds the model in role order", async () => {
    const db = channelDb();
    // what the client autosave writes (positions 0..n, channel default — null on the fake)
    db.seed("chat_messages", [
      { account_id: ACCT, thread: "corner", position: 0, lane: "ai", sender: "unc", body: "In your corner.", created_at: "2026-09-02T08:00:00.000Z" },
      { account_id: ACCT, thread: "corner", position: 1, lane: "ai", sender: "user", body: "Morning.", channel: "app", created_at: "2026-09-02T08:05:00.000Z" },
      { account_id: ACCT, thread: "onboarding", position: 0, lane: "ai", sender: "unc", body: "plan?", created_at: "2026-09-02T07:00:00.000Z" },
      { account_id: OTHER, thread: "corner", position: 0, lane: "ai", sender: "user", body: "not mine", channel: "app", created_at: "2026-09-02T08:06:00.000Z" },
    ]);
    await appendInbound(db, { accountId: ACCT, channel: "telegram", text: "what ran overnight?", externalMsgId: "555:1", now: new Date("2026-09-02T08:10:00.000Z") });
    await appendOutbound(db, { accountId: ACCT, channel: "telegram", text: "Two runs, one draft.", now: new Date("2026-09-02T08:10:05.000Z") });
    db.seed("chat_messages", [{ account_id: ACCT, thread: "corner", position: 2, lane: "ai", sender: "user", body: "and the draft?", channel: "app", created_at: "2026-09-02T08:20:00.000Z" }]);

    const thread = await listThread(db, ACCT);
    expect(thread.map((m) => [m.channel, m.sender, m.body])).toEqual([
      ["app", "unc", "In your corner."],
      ["app", "user", "Morning."],
      ["telegram", "user", "what ran overnight?"],
      ["telegram", "unc", "Two runs, one draft."],
      ["app", "user", "and the draft?"],
    ]);
    expect((await listThread(db, ACCT, { since: "2026-09-02T08:10:00.000Z" })).map((m) => m.body)).toEqual(["what ran overnight?", "Two runs, one draft.", "and the draft?"]);
    expect((await listThread(db, ACCT, { limit: 2 })).map((m) => m.body)).toEqual(["Two runs, one draft.", "and the draft?"]);

    const history = await historyFor(db, ACCT);
    expect(history).toEqual([
      { role: "assistant", content: "In your corner." },
      { role: "user", content: "Morning." },
      { role: "user", content: "what ran overnight?" },
      { role: "assistant", content: "Two runs, one draft." },
      { role: "user", content: "and the draft?" },
    ]);

    // the client's loader sees only its own rows (channel null before 0012 / 'app' after)
    const rows = await loadAccountRows(db, ACCT);
    expect(rows.chatMessages.map((m) => [m.thread, m.position, m.body]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]))).toEqual([
      ["corner", 0, "In your corner."],
      ["corner", 1, "Morning."],
      ["corner", 2, "and the draft?"],
      ["onboarding", 0, "plan?"],
    ]);
  });
});
