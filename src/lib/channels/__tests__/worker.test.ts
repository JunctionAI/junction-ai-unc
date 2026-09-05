/* The worker's channels tick: briefs, first drafts, new approvals and 2-hour reminders reach
   the founder's linked channels once each (durable dedup on the ledger), per prefs and quiet
   hours; app-only accounts get nothing; no database → skipped. */

import { describe, expect, it } from "vitest";
import { SupabaseStore } from "@/lib/runtime/store/supabase";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { firstDraftPerRun, runChannelsTick } from "@/worker/channels";
import { listOutbound } from "../outbound";
import { listThread } from "../thread";
import { ACCT, channelDb, clock, fakeAdapters, OTHER, PREFS_ON, seedLink } from "./helpers";

const RUN = "00000000-0000-4000-8000-00000000f001";
const RUN2 = "00000000-0000-4000-8000-00000000f002";
const AP = "00000000-0000-4000-8000-00000000a001";
const AP_SOON = "00000000-0000-4000-8000-00000000a002";
const AP_OLD = "00000000-0000-4000-8000-00000000a003";

function seeded() {
  const db = channelDb();
  const clk = clock("2026-09-02T19:00:00.000Z"); // 07:00 NZST
  db.now = () => clk.now().toISOString();
  db.seed("account_profiles", [{ account_id: ACCT, cadence: { timezone: "Pacific/Auckland" } }]);
  db.seed("daily_briefs", [{ id: "00000000-0000-4000-8000-00000000b001", account_id: ACCT, day: "2026-09-03", body: "Overnight I completed 2 runs and wrote 1 draft; 1 decision is waiting on you.", items: [{ kind: "needs_you", text: "Move NZD 20/day to Prospecting NZ — waiting on your okay.", ref: AP }], created_at: "2026-09-02T18:30:00.000Z" }]);
  db.seed("routine_runs", [
    { id: RUN, account_id: ACCT, routine_id: "D02-W01", version: 1, mode: "dry_run", status: "done", started_at: "2026-09-02T15:00:00.000Z", finished_at: "2026-09-02T15:01:00.000Z" },
    { id: RUN2, account_id: ACCT, routine_id: "D01-W01", version: 1, mode: "dry_run", status: "done", started_at: "2026-09-01T15:00:00.000Z", finished_at: "2026-09-01T15:01:00.000Z" },
  ]);
  db.seed("receipts", [
    { account_id: ACCT, run_id: RUN, kind: "read", description: "Read 7d spend", created_at: "2026-09-02T15:00:10.000Z" },
    { account_id: ACCT, run_id: RUN, kind: "draft", description: "Drafted the budget move", created_at: "2026-09-02T15:00:20.000Z" },
    { account_id: ACCT, run_id: RUN, kind: "draft", description: "Would ask Tom: Move NZD 20/day to Prospecting NZ", payload: { approvalPreview: { title: "Move NZD 20/day to Prospecting NZ", detail: "ROAS 3.1 on 7d" } }, created_at: "2026-09-02T15:00:30.000Z" },
    { account_id: ACCT, run_id: RUN2, kind: "draft", description: "old draft", created_at: "2026-08-30T15:00:30.000Z" },
  ]);
  db.seed("approvals", [
    { id: AP, account_id: ACCT, run_id: RUN, routine_id: "D02-W01", title: "Move NZD 20/day to Prospecting NZ", detail: "ROAS 3.1 on 7d", status: "pending", expires_at: "2026-09-04T15:00:00.000Z", created_at: "2026-09-02T15:00:00.000Z" },
    { id: AP_SOON, account_id: ACCT, run_id: RUN, routine_id: "D02-W01", title: "Pause the underperformer", status: "pending", expires_at: "2026-09-02T20:30:00.000Z", created_at: "2026-08-31T20:30:00.000Z" },
    { id: AP_OLD, account_id: ACCT, run_id: RUN, routine_id: "D02-W01", title: "Lapsed one", status: "pending", expires_at: "2026-09-01T00:00:00.000Z", created_at: "2026-08-30T00:00:00.000Z" },
  ]);
  return { db, clk };
}

describe("runChannelsTick", () => {
  it("does not turn archived briefs, receipts or approvals into current-context pushes", async () => {
    const { db, clk } = seeded();
    db.rows("accounts")[0].context_generation = 1;
    seedLink(db);
    const adapters = fakeAdapters();
    const store = new SupabaseStore(db);
    await runChannelsTick({ store, db, now: clk.now, adapters });
    expect(db.rows("outbound_messages")).toEqual([]);
    db.seed("daily_briefs", [{ account_id: ACCT, context_generation: 1, day: "2026-09-03", body: "Current business only", items: [], created_at: "2026-09-02T18:31:00Z" }]);
    await runChannelsTick({ store, db, now: clk.now, adapters });
    expect(db.rows("outbound_messages")).toHaveLength(1);
    expect(db.rows("chat_messages")[0]).toMatchObject({ context_generation: 1, body: expect.stringContaining("Current business only") });
    db.rows("accounts")[0].automation_paused = true;
    const report = await runChannelsTick({ store, db, now: clk.now, adapters });
    expect(report.failed).toBe(1);
    expect(db.rows("outbound_messages")).toHaveLength(1);
  });

  it("no database → skipped; an account with no verified link gets nothing", async () => {
    const r = await runChannelsTick({ store: new MemoryStore(), db: null });
    expect(r).toMatchObject({ skipped: true, accounts: 0 });
    const { db, clk } = seeded();
    seedLink(db, { verified_at: null, external_id: null as unknown as string });
    const r2 = await runChannelsTick({ store: new SupabaseStore(db), db, now: clk.now, adapters: fakeAdapters() });
    expect(r2).toMatchObject({ skipped: false, accounts: 0, briefs: 0 });
    expect(db.rows("outbound_messages")).toEqual([]);
  });

  it("pushes the brief, the run's first draft, the new approval (buttons) and the 2-hour reminder — once; the second tick sends nothing", async () => {
    const { db, clk } = seeded();
    const adapters = fakeAdapters();
    seedLink(db, { channel: "telegram", external_id: "555" });
    seedLink(db, { channel: "sms", external_id: "+6421", prefs: { ...PREFS_ON, drafts: false } });
    seedLink(db, { account_id: OTHER, channel: "telegram", external_id: "777" });
    const deps = { store: new SupabaseStore(db), db, now: clk.now, adapters };

    const r = await runChannelsTick(deps);
    // OTHER has a link too (so it counts as an account) but nothing to push
    expect(r).toMatchObject({ accounts: 2, briefs: 1, drafts: 1, approvals: 1, reminders: 1, failed: 0, queued: 0, quiet: 0 });
    const tg = adapters.telegram.sent.map((s) => s.payload);
    expect(tg.map((p) => p.text.split("\n")[0])).toEqual(["Morning. Here's today:", "A draft just landed from Daily paid decisioning.", "One decision needs you.", "Still waiting on you — about 1 h before this lapses."]);
    expect(tg[0].text).toContain("Needs you: Move NZD 20/day");
    expect(tg[1].text).toContain("Move NZD 20/day to Prospecting NZ");
    expect(tg[1].text).toContain("ROAS 3.1 on 7d");
    expect(tg[2].buttons?.map((b) => b.id)).toEqual([`ap:${AP}:approve`, `ap:${AP}:hold`, `ap:${AP}:why`]);
    expect(tg[3].buttons?.[0].id).toBe(`ap:${AP_SOON}:approve`);
    expect(tg.every((p) => !/!/.test(p.text))).toBe(true);
    // sms: drafts off → 3 sends
    expect(adapters.sms.sent.map((s) => s.payload.text.split("\n")[0])).toEqual(["Morning. Here's today:", "One decision needs you.", "Still waiting on you — about 1 h before this lapses."]);
    // the other account's link never receives ACCT's pushes
    expect(adapters.telegram.sent.every((s) => s.to === "555")).toBe(true);
    // ledger: 7 sends with refs; the thread carries each push once
    const ledger = await listOutbound(db, ACCT);
    expect(ledger).toHaveLength(7);
    expect(new Set(ledger.map((l) => l.ref))).toEqual(new Set([`brief:00000000-0000-4000-8000-00000000b001`, `draft:${RUN}`, `approval:${AP}`, `reminder:${AP_SOON}`]));
    expect((await listThread(db, ACCT)).map((m) => [m.channel, m.sender])).toEqual([
      ["telegram", "unc"],
      ["telegram", "unc"],
      ["telegram", "unc"],
      ["telegram", "unc"],
    ]);

    const r2 = await runChannelsTick(deps);
    expect(r2).toMatchObject({ accounts: 2, briefs: 0, drafts: 0, approvals: 0, reminders: 0 });
    expect(adapters.telegram.sent).toHaveLength(4);
  });

  it("quiet hours hold pushes; an uncertain provider attempt is not retried on the next tick", async () => {
    const { db, clk } = seeded();
    const adapters = fakeAdapters();
    clk.set("2026-09-02T11:00:00.000Z"); // 23:00 NZST
    seedLink(db, { channel: "telegram", external_id: "555", prefs: { ...PREFS_ON, quiet_hours: { start: "22:00", end: "07:00" } } });
    const deps = { store: new SupabaseStore(db), db, now: clk.now, adapters };
    const r = await runChannelsTick(deps);
    expect(r).toMatchObject({ briefs: 0, drafts: 0, approvals: 0, quiet: 3 });
    expect(adapters.telegram.sent).toEqual([]);
    clk.set("2026-09-02T19:30:00.000Z"); // 07:30 NZST
    adapters.telegram.fail = true;
    const r2 = await runChannelsTick(deps);
    expect(r2).toMatchObject({ briefs: 0, failed: 4 });
    adapters.telegram.fail = false;
    const r3 = await runChannelsTick(deps);
    expect(r3).toMatchObject({ briefs: 0, drafts: 0, approvals: 0, reminders: 0, failed: 0 });
    expect(adapters.telegram.sent).toHaveLength(4);
    expect(db.rows("outbound_messages").every(r => r.status === "uncertain")).toBe(true);
  });

  it("firstDraftPerRun prefers the receipt carrying the approval preview, else the earliest draft", () => {
    const base = { id: "", accountId: ACCT, runId: "", kind: "draft" as const, description: "", payload: {}, createdAt: "" };
    const m = firstDraftPerRun([
      { ...base, id: "r3", runId: "A", description: "third", createdAt: "2026-09-02T00:00:03.000Z", payload: { approvalPreview: { title: "t" } } },
      { ...base, id: "r1", runId: "A", description: "first", createdAt: "2026-09-02T00:00:01.000Z" },
      { ...base, id: "b1", runId: "B", description: "b-first", createdAt: "2026-09-02T00:00:02.000Z" },
      { ...base, id: "b0", runId: "B", description: "b-zero", createdAt: "2026-09-02T00:00:01.000Z" },
      { ...base, id: "x", kind: "read", description: "not a draft", createdAt: "2026-09-02T00:00:00.000Z" },
    ]);
    expect(m.get("A")?.id).toBe("r3");
    expect(m.get("B")?.id).toBe("b0");
    expect(m.size).toBe(2);
  });
});
