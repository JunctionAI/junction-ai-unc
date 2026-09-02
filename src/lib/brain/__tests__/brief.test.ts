/* The daily brief: timezone maths, evidence from MemoryStore + the schema-checked fake,
   the deterministic copy, the validator (invented number rejected, > 5 items trimmed,
   exactly one "noticed", refs must exist), and generate → store (idempotent per local day,
   force regenerates, model output honoured only when it validates). */

import { describe, expect, it } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { MemoryStore } from "../../runtime/store/memory";
import { allowedNumbers, briefSlotUtc, BRIEF_MAX_ITEMS, deterministicBrief, gatherBriefEvidence, generateDailyBrief, isValidTimezone, localDay, numbersOk, parseBrief, previousDay, readTimezone, type BriefEvidence, type BriefLlm } from "../brief";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const NOW = new Date("2026-09-02T18:31:00.000Z"); // 06:31 Thu 3 Sep in Auckland (NZST, +12)
const H = 3_600_000;

describe("timezone helpers", () => {
  it("local day + the 06:30-local slot as a UTC instant; unknown zones read as UTC", () => {
    expect(isValidTimezone("Pacific/Auckland")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(localDay(NOW, "Pacific/Auckland")).toBe("2026-09-03");
    expect(localDay(NOW, "UTC")).toBe("2026-09-02");
    expect(localDay(NOW, null)).toBe("2026-09-02");
    expect(localDay(NOW, "Mars/Olympus")).toBe("2026-09-02");
    expect(briefSlotUtc(NOW, "Pacific/Auckland").toISOString()).toBe("2026-09-02T18:30:00.000Z");
    expect(briefSlotUtc(NOW, "UTC").toISOString()).toBe("2026-09-02T06:30:00.000Z");
    expect(briefSlotUtc(NOW, "America/Los_Angeles").toISOString()).toBe("2026-09-02T13:30:00.000Z"); // PDT −7
    expect(briefSlotUtc(new Date("2026-09-02T02:00:00.000Z"), "Pacific/Auckland").toISOString()).toBe("2026-09-01T18:30:00.000Z"); // 14:00 NZ → today's slot was 06:30 NZ
    expect(previousDay("2026-09-01")).toBe("2026-08-31");
  });

  it("readTimezone: only a real zone from account_profiles.cadence", async () => {
    const db = new FakeSupabase();
    db.seed("account_profiles", [{ account_id: ACCT, cadence: { timezone: "Pacific/Auckland" } }, { account_id: "00000000-0000-4000-8000-00000000acc2", cadence: { timezone: "Nowhere/Land" } }]);
    expect(await readTimezone(db, ACCT)).toBe("Pacific/Auckland");
    expect(await readTimezone(db, "00000000-0000-4000-8000-00000000acc2")).toBeNull();
    expect(await readTimezone(db, "00000000-0000-4000-8000-00000000acc3")).toBeNull();
  });
});

async function seeded() {
  const db = new FakeSupabase();
  const store = new MemoryStore();
  db.seed("accounts", [{ id: ACCT, name: "Example", currency: "NZD" }]);
  db.seed("kpi_snapshots", [
    { account_id: ACCT, metric_key: "revenue_7d", value: 4120, currency: "NZD", window_start: "2026-08-26", window_end: "2026-09-02", platform: "shopify", provenance: "live", captured_at: "2026-09-02T01:30:00.000Z" },
    { account_id: ACCT, metric_key: "revenue_7d", value: 3500, currency: "NZD", window_start: "2026-08-19", window_end: "2026-08-26", platform: "shopify", provenance: "live", captured_at: "2026-08-26T01:30:00.000Z" },
    { account_id: ACCT, metric_key: "orders_7d", value: 60, currency: null, window_start: "2026-08-26", window_end: "2026-09-02", platform: "shopify", provenance: "live", captured_at: "2026-09-02T01:30:00.000Z" },
    { account_id: ACCT, metric_key: "orders_7d", value: 58, currency: null, window_start: "2026-08-19", window_end: "2026-08-26", platform: "shopify", provenance: "live", captured_at: "2026-08-26T01:30:00.000Z" },
  ]);
  db.seed("memories", [
    { id: "00000000-0000-4000-8000-00000000eve1", account_id: ACCT, kind: "event", text: "Spring launch goes live", source: "chat", happens_at: "2026-09-05T21:00:00.000Z" },
    { id: "00000000-0000-4000-8000-00000000eve2", account_id: ACCT, kind: "event", text: "Old event", source: "chat", happens_at: "2026-08-01T00:00:00.000Z" },
    { id: "00000000-0000-4000-8000-00000000eve3", account_id: ACCT, kind: "event", text: "Far event", source: "chat", happens_at: "2026-10-01T00:00:00.000Z" },
    { id: "00000000-0000-4000-8000-00000000eve4", account_id: ACCT, kind: "event", text: "Forgotten event", source: "chat", happens_at: "2026-09-04T00:00:00.000Z", valid_to: "2026-09-01T00:00:00.000Z" },
    { id: "00000000-0000-4000-8000-00000000fac1", account_id: ACCT, kind: "fact", text: "Ships from Tauranga", source: "chat" },
  ]);
  await store.createRun({ id: "run-1", accountId: ACCT, routineId: "D02-W01", version: 1, mode: "dry_run", status: "done", startedAt: new Date(NOW.getTime() - 3 * H).toISOString() });
  await store.createRun({ id: "run-old", accountId: ACCT, routineId: "D02-W01", version: 1, mode: "dry_run", status: "done", startedAt: new Date(NOW.getTime() - 30 * H).toISOString() });
  await store.appendReceipt({ id: "rc-1", accountId: ACCT, runId: "run-1", kind: "read", description: "Read meta_ads insights over 7d: 2 rows.", payload: {}, createdAt: new Date(NOW.getTime() - 3 * H).toISOString() });
  await store.appendReceipt({ id: "rc-2", accountId: ACCT, runId: "run-1", kind: "draft", description: "Would ask Tom: Move NZD 20/day to Prospecting NZ", payload: {}, createdAt: new Date(NOW.getTime() - 3 * H).toISOString() });
  await store.appendReceipt({ id: "rc-old", accountId: ACCT, runId: "run-old", kind: "draft", description: "yesterday's draft", payload: {}, createdAt: new Date(NOW.getTime() - 30 * H).toISOString() });
  await store.createApproval({ id: "ap-1", accountId: ACCT, runId: "run-1", routineId: "D02-W01", title: "Move NZD 20/day to Prospecting NZ", status: "pending", createdAt: new Date(NOW.getTime() - 3 * H).toISOString(), expiresAt: new Date(NOW.getTime() + 21 * H).toISOString() });
  await store.createApproval({ id: "ap-expired", accountId: ACCT, runId: "run-old", routineId: "D02-W01", title: "Stale", status: "pending", createdAt: new Date(NOW.getTime() - 60 * H).toISOString(), expiresAt: new Date(NOW.getTime() - 12 * H).toISOString() });
  return { db, store };
}

describe("evidence + the deterministic brief", () => {
  it("gathers the last 24 h, live pending approvals, deltas, the next 7 days of events and yesterday's brief", async () => {
    const { db, store } = await seeded();
    db.seed("daily_briefs", [{ account_id: ACCT, day: "2026-09-02", body: "Yesterday's body with 77 in it", items: [] }]);
    const ev = await gatherBriefEvidence({ store, db, accountId: ACCT, now: NOW, timezone: "Pacific/Auckland" });
    expect(ev.day).toBe("2026-09-03");
    expect(ev.receipts).toMatchObject({ total: 2, drafts: 1, reads: 1, runsDone: 1 });
    expect(ev.receipts.lines).toEqual([{ id: "rc-2", kind: "draft", text: "Would ask Tom: Move NZD 20/day to Prospecting NZ" }]);
    expect(ev.pending).toEqual([{ id: "ap-1", routineId: "D02-W01", title: "Move NZD 20/day to Prospecting NZ", expiresAt: new Date(NOW.getTime() + 21 * H).toISOString() }]);
    expect(ev.deltas.map((d) => [d.key, d.notable])).toEqual([
      ["revenue_7d", true],
      ["orders_7d", false],
    ]);
    expect(ev.events).toEqual([{ id: "00000000-0000-4000-8000-00000000eve1", text: "Spring launch goes live", happensAt: "2026-09-05T21:00:00.000Z" }]);
    expect(ev.yesterday?.body).toBe("Yesterday's body with 77 in it");

    const b = deterministicBrief(ev);
    expect(b.day).toBe("2026-09-03");
    expect(b.body).toBe("Overnight I completed 1 run and wrote 1 draft; 1 decision is waiting on you. Revenue (7d) NZD 4,120, up 17.7% on a week ago.");
    expect(b.items.map((i) => i.kind)).toEqual(["needs_you", "noticed", "reminder", "happened"]);
    expect(b.items[0]).toEqual({ kind: "needs_you", text: "Move NZD 20/day to Prospecting NZ — waiting on your okay.", ref: "ap-1" });
    expect(b.items[1]).toEqual({ kind: "noticed", text: "Revenue (7d) NZD 4,120, up 17.7% on a week ago.", ref: "revenue_7d" });
    expect(b.items[2]).toMatchObject({ kind: "reminder", ref: "00000000-0000-4000-8000-00000000eve1", at: "2026-09-05T21:00:00.000Z", text: "Spring launch goes live — Sun, 6 Sept." });
    expect(b.items[3]).toEqual({ kind: "happened", text: "I completed 1 run and left 1 draft for you.", ref: "rc-2" });
    // yesterday's numbers are not evidence for today
    expect(allowedNumbers(ev).has("77")).toBe(false);
    expect(numbersOk("Revenue is 4,120 and 17.7% up", allowedNumbers(ev))).toBe(true);
    expect(numbersOk("Revenue is 4,121", allowedNumbers(ev))).toBe(false);
  });

  it("a quiet night with nothing waiting says so, with no numbers to claim", async () => {
    const db = new FakeSupabase();
    const ev = await gatherBriefEvidence({ store: new MemoryStore(), db, accountId: ACCT, now: NOW, timezone: null });
    const b = deterministicBrief(ev);
    expect(b.body).toBe("Quiet night — nothing ran and nothing is waiting on you. I have no new numbers to claim.");
    expect(b.items).toEqual([]);
    expect(ev.timezone).toBe("UTC");
  });
});

describe("parseBrief (the validator)", () => {
  let ev: BriefEvidence;
  const evidence = async () => {
    const { db, store } = await seeded();
    return gatherBriefEvidence({ store, db, accountId: ACCT, now: NOW, timezone: "Pacific/Auckland" });
  };

  it("accepts a clean brief whose numbers and refs exist", async () => {
    ev = await evidence();
    const p = parseBrief(
      {
        body: "One dry run overnight and one draft on the table. Revenue is up 17.7% on last week at NZD 4,120.",
        items: [
          { kind: "needs_you", text: "The NZD 20/day move to Prospecting NZ is waiting on you.", ref: "ap-1" },
          { kind: "noticed", text: "Revenue (7d) is NZD 4,120, up 17.7% week on week.", ref: "revenue_7d" },
          { kind: "reminder", text: "Spring launch goes live on the 6th.", ref: "00000000-0000-4000-8000-00000000eve1" },
          { kind: "happened", text: "I read Meta insights and drafted the budget move.", ref: "rc-2" },
        ],
      },
      ev,
    );
    expect(p.liveBody).toBe(true);
    expect(p.liveItems).toBe(4);
    expect(p.rejected).toEqual([]);
    expect(p.brief.items.map((i) => i.kind)).toEqual(["needs_you", "noticed", "reminder", "happened"]);
    expect(p.brief.items[2].at).toBe("2026-09-05T21:00:00.000Z");
  });

  it("an invented number in the body → deterministic body; in an item → that item dropped", async () => {
    ev = await evidence();
    const p = parseBrief({ body: "Revenue is up 22% to NZD 4,500.", items: [{ kind: "happened", text: "I completed 19 runs.", ref: null }, { kind: "noticed", text: "Revenue (7d) NZD 4,120, up 17.7% on a week ago.", ref: "revenue_7d" }] }, ev);
    expect(p.liveBody).toBe(false);
    expect(p.brief.body).toBe(deterministicBrief(ev).body);
    expect(p.rejected).toEqual(["body: number not in the evidence", "happened: text failed validation"]);
    expect(p.brief.items).toEqual([{ kind: "noticed", text: "Revenue (7d) NZD 4,120, up 17.7% on a week ago.", ref: "revenue_7d" }]);
  });

  it("more than five items are trimmed to five, needs_you and noticed first", async () => {
    ev = await evidence();
    const items = [
      { kind: "happened", text: "One.", ref: null },
      { kind: "happened", text: "Two.", ref: null },
      { kind: "happened", text: "Three.", ref: null },
      { kind: "happened", text: "Four.", ref: null },
      { kind: "happened", text: "Five.", ref: null },
      { kind: "needs_you", text: "The budget move is waiting.", ref: "ap-1" },
      { kind: "noticed", text: "Revenue (7d) is NZD 4,120, up 17.7%.", ref: "revenue_7d" },
    ];
    const p = parseBrief({ body: "Busy night.", items }, ev);
    expect(p.brief.items).toHaveLength(BRIEF_MAX_ITEMS);
    expect(p.brief.items.map((i) => i.kind)).toEqual(["needs_you", "noticed", "happened", "happened", "happened"]);
    expect(p.rejected).toEqual(["items: 2 trimmed"]);
  });

  it("exactly one 'noticed' when a delta is notable: a missing one is added, a second is dropped, a wrong metric is dropped", async () => {
    ev = await evidence();
    const none = parseBrief({ body: "Steady.", items: [{ kind: "happened", text: "I drafted the budget move.", ref: "rc-2" }] }, ev);
    expect(none.brief.items.filter((i) => i.kind === "noticed")).toEqual([{ kind: "noticed", text: "Revenue (7d) NZD 4,120, up 17.7% on a week ago.", ref: "revenue_7d" }]);
    const two = parseBrief({ body: "Steady.", items: [{ kind: "noticed", text: "Revenue up 17.7%.", ref: "revenue_7d" }, { kind: "noticed", text: "Orders at 60.", ref: "orders_7d" }, { kind: "noticed", text: "Revenue NZD 4,120.", ref: "revenue_7d" }] }, ev);
    expect(two.brief.items.filter((i) => i.kind === "noticed")).toEqual([{ kind: "noticed", text: "Revenue up 17.7%.", ref: "revenue_7d" }]);
    expect(two.rejected).toEqual(['noticed: "orders_7d" is not a notable metric', "noticed: more than one"]);
  });

  it("no notable delta → no 'noticed' at all, even if the model writes one", async () => {
    const db = new FakeSupabase();
    const quiet = await gatherBriefEvidence({ store: new MemoryStore(), db, accountId: ACCT, now: NOW, timezone: null });
    const p = parseBrief({ body: "Quiet.", items: [{ kind: "noticed", text: "Revenue is up 12%.", ref: "revenue_7d" }, { kind: "happened", text: "Nothing ran.", ref: null }] }, quiet);
    expect(p.brief.items).toEqual([{ kind: "happened", text: "Nothing ran.", ref: null }]);
    expect(p.rejected).toEqual(["noticed: no notable delta in the evidence"]);
  });

  it("refs must exist: needs_you without a real pending approval, reminders without an event, unknown kinds, markdown, exclamation marks", async () => {
    ev = await evidence();
    const p = parseBrief(
      {
        body: "**Big** night!",
        items: [
          { kind: "needs_you", text: "Approve the thing.", ref: "ap-expired" },
          { kind: "needs_you", text: "Approve the thing.", ref: null },
          { kind: "reminder", text: "Launch soon.", ref: "00000000-0000-4000-8000-00000000eve3" },
          { kind: "todo", text: "x", ref: null },
          { kind: "happened", text: "Great work!", ref: null },
        ],
      },
      ev,
    );
    expect(p.liveBody).toBe(false);
    expect(p.liveItems).toBe(0);
    expect(p.rejected).toEqual(["body: empty or formatted", "needs_you: not a pending approval", "needs_you: not a pending approval", "reminder: not an upcoming event", 'item: unknown kind "todo"', "happened: text failed validation"]);
    // everything fell back → the deterministic items
    expect(p.brief).toEqual(deterministicBrief(ev));
    expect(parseBrief("nope", ev).brief).toEqual(deterministicBrief(ev));
  });
});

describe("generateDailyBrief", () => {
  const llm = (reply: string | (() => Promise<string>)): BriefLlm & { prompts: { system: string; user: string; accountId?: string }[] } => {
    const prompts: { system: string; user: string; accountId?: string }[] = [];
    return {
      prompts,
      async complete(p) {
        prompts.push(p);
        return typeof reply === "string" ? reply : reply();
      },
    };
  };

  it("writes today's row (deterministic without a model), is idempotent per local day, and force regenerates", async () => {
    const { db, store } = await seeded();
    db.seed("account_profiles", [{ account_id: ACCT, cadence: { timezone: "Pacific/Auckland" } }]);
    const first = await generateDailyBrief({ store, db, accountId: ACCT, now: () => NOW, llm: null });
    expect(first.existed).toBe(false);
    expect(first.author).toBe("deterministic");
    expect(first.record).toMatchObject({ accountId: ACCT, day: "2026-09-03", createdAt: NOW.toISOString() });
    expect(first.record.items.map((i) => i.kind)).toEqual(["needs_you", "noticed", "reminder", "happened"]);
    expect(db.rows("daily_briefs")).toHaveLength(1);
    expect(db.lastCall("daily_briefs", "upsert").onConflict).toBe("account_id,day");

    const again = await generateDailyBrief({ store, db, accountId: ACCT, now: () => new Date(NOW.getTime() + 2 * H), llm: llm("should not be called") });
    expect(again.existed).toBe(true);
    expect(again.record.id).toBe(first.record.id);
    expect(db.rows("daily_briefs")).toHaveLength(1);

    const forced = await generateDailyBrief({ store, db, accountId: ACCT, now: () => new Date(NOW.getTime() + 2 * H), llm: null, force: true });
    expect(forced.existed).toBe(false);
    expect(forced.record.id).toBe(first.record.id); // same row, rewritten
    expect(db.rows("daily_briefs")).toHaveLength(1);

    // the next local day is a new row
    const tomorrow = await generateDailyBrief({ store, db, accountId: ACCT, now: () => new Date(NOW.getTime() + 24 * H), llm: null });
    expect(tomorrow.record.day).toBe("2026-09-04");
    expect(db.rows("daily_briefs")).toHaveLength(2);
  });

  it("a validating model reply is stored as the model's; a refusal or garbage falls back to the deterministic brief", async () => {
    const { db, store } = await seeded();
    const good = llm(JSON.stringify({ body: "One dry run overnight; the NZD 20/day move is waiting on you.", items: [{ kind: "needs_you", text: "The NZD 20/day move to Prospecting NZ.", ref: "ap-1" }, { kind: "noticed", text: "Revenue (7d) NZD 4,120, up 17.7%.", ref: "revenue_7d" }] }));
    const g = await generateDailyBrief({ store, db, accountId: ACCT, now: () => NOW, llm: good, timezone: "Pacific/Auckland" });
    expect(g.author).toBe("model");
    expect(g.liveItems).toBe(2);
    expect(g.record.body).toBe("One dry run overnight; the NZD 20/day move is waiting on you.");
    expect(good.prompts[0].accountId).toBe(ACCT);
    expect(good.prompts[0].system).toContain("You are Unc");
    expect(good.prompts[0].user).toContain('"ap-1"');

    const bad = llm(async () => {
      throw new Error("refusal");
    });
    const f = await generateDailyBrief({ store, db, accountId: ACCT, now: () => NOW, llm: bad, timezone: "Pacific/Auckland", force: true });
    expect(f.author).toBe("deterministic");
    const garbage = await generateDailyBrief({ store, db, accountId: ACCT, now: () => NOW, llm: llm("not json"), timezone: "Pacific/Auckland", force: true });
    expect(garbage.author).toBe("deterministic");
    expect(garbage.record.items.length).toBeGreaterThan(0);
  });
});
