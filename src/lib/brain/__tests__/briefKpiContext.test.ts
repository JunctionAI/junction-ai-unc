import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { MemoryStore } from "../../runtime/store/memory";
import { SupabaseStore } from "../../runtime/store/supabase";
import { generateDailyBrief, gatherBriefEvidence, getDailyBrief, type GenerateBriefDeps } from "../brief";
import { snapshotKpis, kpiDeltas } from "../kpi";
import { deriveDecisionStyle, tastePatterns, writeDecisionStyle } from "../taste";
import { dueBriefs, sanitiseBriefMarkers } from "../../../worker/jobs";
import { runDailyBrief, runKpiSnapshot } from "../../../worker/telemetry";
import { StaticAccountsSource } from "../../../worker/accounts";
import type { ConnectorReader, ReadResult } from "../../runtime/types";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-05T06:31:00Z");
const result: ReadResult = { rows: [], metrics: { roas: 2 }, provenance: "live", fetchedAt: NOW.toISOString() };
const account = (contextGeneration: number) => ({ contextGeneration, currency: "NZD", budgetMonthly: 0 });
function setup(generation = 0, paused = false) {
  const db = new FakeSupabase();
  db.seed("accounts", [{ id: A, context_generation: generation, automation_paused: paused }, { id: B }]);
  return { db, store: new MemoryStore(), accountId: A, now: () => NOW };
}

describe("brief and KPI captured identity", () => {
  it("refuses omitted old context or paused controls before a cached brief, provider or model", async () => {
    const d = setup(1);
    const llm = { complete: vi.fn() };
    const reader = { read: vi.fn() };
    await expect(generateDailyBrief({ ...d, llm })).rejects.toMatchObject({ code: "context_changed" });
    await expect(snapshotKpis({ ...d, reader, connected: ["meta_ads"] })).rejects.toMatchObject({ code: "context_changed" });
    d.db.rows("accounts")[0].automation_paused = true;
    d.db.seed("daily_briefs", [{ account_id: A, context_generation: 1, day: "2026-09-05", body: "saved", items: [] }]);
    await expect(generateDailyBrief({ ...d, contextGeneration: 1, llm })).rejects.toMatchObject({ code: "automation_paused" });
    expect((await getDailyBrief(d.db, A, "2026-09-05", 1))?.body).toBe("saved"); // read remains available
    expect(llm.complete).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
  });

  it.each([false, true])("rejects a late model result, including failed-call fallback (%s)", async fail => {
    const d = setup();
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const entered = vi.fn();
    const deps: GenerateBriefDeps = { ...d, llm: { complete: async () => { entered(); await blocked; if (fail) throw new Error("provider unavailable"); return '{"body":"Quiet.","items":[]}'; } } };
    const pending = generateDailyBrief(deps);
    await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
    d.db.rows("accounts")[0].context_generation = 1;
    deps.contextGeneration = 1; // a caller must not rebase an already-started operation
    deps.accountId = B;
    finish();
    await expect(pending).rejects.toMatchObject({ code: "context_changed" });
    expect(d.db.rows("daily_briefs")).toHaveLength(0);
  });

  it.each(["reset", "pause", "failed-read"] as const)("does not save provider results/receipts after %s during a read", async change => {
    const d = setup();
    const reader: ConnectorReader = { read: vi.fn(async () => {
      if (change === "pause") d.db.rows("accounts")[0].automation_paused = true;
      else d.db.rows("accounts")[0].context_generation = 1;
      if (change === "failed-read") throw new Error("provider rejected");
      return result;
    }) };
    await expect(snapshotKpis({ ...d, reader, account: account(0), connected: ["meta_ads", "ga4"] })).rejects.toMatchObject({ code: change === "pause" ? "automation_paused" : "context_changed" });
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(d.db.rows("kpi_snapshots")).toHaveLength(0);
    expect(d.db.rows("receipts")).toHaveLength(0);
  });

  it("retains both same-day histories and stamps current run-less failure receipts", async () => {
    const d = setup();
    const reader: ConnectorReader = { read: vi.fn(async () => result) };
    const old = await generateDailyBrief(d);
    await snapshotKpis({ ...d, reader, account: account(0), connected: ["meta_ads"] });
    d.db.rows("accounts")[0].context_generation = 1;
    const fresh = await generateDailyBrief({ ...d, contextGeneration: 1 });
    const snapshot = await snapshotKpis({ ...d, reader, account: account(1), connected: ["meta_ads"] });
    expect(fresh.record.id).not.toBe(old.record.id);
    expect(fresh.record.contextGeneration).toBe(1);
    expect(d.db.rows("daily_briefs")).toHaveLength(2);
    expect(d.db.rows("kpi_snapshots")).toHaveLength(2);
    expect(snapshot.written[0].context_generation).toBe(1);
    expect((await getDailyBrief(d.db, A, "2026-09-05", 1))?.id).toBe(fresh.record.id);
    await snapshotKpis({ ...d, reader: { read: async () => { throw new Error("unavailable"); } }, account: account(1), connected: ["meta_ads"] });
    expect(d.db.rows("receipts")[0]).toMatchObject({ account_id: A, run_id: null, context_generation: 1 });
  });

  it("filters historical evidence before receipt limits, including other tenants and yesterday's brief", async () => {
    const d = setup(1);
    const db = d.db;
    db.seed("routine_runs", [0, 1].map(g => ({ id: "run-" + g, account_id: A, context_generation: g, routine_id: "D03-W01", version: 1, mode: "dry_run", status: "done", started_at: NOW.toISOString() })));
    db.seed("receipts", [
      ...Array.from({ length: 250 }, (_, i) => ({ account_id: A, context_generation: 0, kind: "draft", description: "old " + i, created_at: NOW.toISOString() })),
      { account_id: A, context_generation: 1, kind: "draft", description: "current", created_at: NOW.toISOString() },
      { account_id: B, context_generation: 1, kind: "draft", description: "not yours", created_at: NOW.toISOString() },
    ]);
    db.seed("approvals", [0, 1].map(g => ({ id: "ap-" + g, account_id: A, context_generation: g, run_id: "run-" + g, routine_id: "D03-W01", status: "pending", title: "generation " + g, expires_at: "2026-09-06T00:00:00Z" })));
    db.seed("memories", [0, 1].map(g => ({ account_id: A, context_generation: g, kind: "event", text: "event " + g, happens_at: "2026-09-06T00:00:00Z" })));
    db.seed("daily_briefs", [{ account_id: A, context_generation: 0, day: "2026-09-04", body: "old", items: [] }]);
    db.seed("kpi_snapshots", [
      { account_id: A, context_generation: 0, metric_key: "roas_7d", value: 10, window_end: "2026-08-29", provenance: "live" },
      { account_id: A, context_generation: 1, metric_key: "roas_7d", value: 2, window_end: "2026-09-05", provenance: "live" },
    ]);
    const ev = await gatherBriefEvidence({ ...d, store: new SupabaseStore(db), contextGeneration: 1, now: NOW, timezone: null });
    expect(ev.receipts).toMatchObject({ total: 1, drafts: 1, runsDone: 1, lines: [{ id: expect.any(String), kind: "draft", text: "current" }] });
    expect(ev.pending.map(a => a.id)).toEqual(["ap-1"]);
    expect(ev.events.map(e => e.text)).toEqual(["event 1"]);
    expect(ev.yesterday).toBeNull();
    expect(ev.deltas[0]).toMatchObject({ latest: 2, previous: null, deltaPct: null });
    expect((await kpiDeltas(db, A, NOW, 1))[0].previous).toBeNull();
  });

  it("rejects a reset between a stored brief read and its return", async () => {
    const d = setup();
    d.db.seed("daily_briefs", [{ account_id: A, day: "2026-09-05", body: "old", items: [] }]);
    const rows = d.db.rows.bind(d.db);
    vi.spyOn(d.db, "rows").mockImplementation(table => {
      if (table === "daily_briefs") rows("accounts")[0].context_generation = 1;
      return rows(table);
    });
    await expect(getDailyBrief(d.db, A, "2026-09-05")).rejects.toMatchObject({ code: "context_changed" });
  });

  it("derives style only from current approvals and refuses a delayed profile write", async () => {
    const d = setup(1);
    for (const g of [0, 1]) {
      await d.store.createRun({ id: "r" + g, accountId: A, contextGeneration: g, routineId: "D03-W01", version: 1, mode: "dry_run", status: "done", startedAt: NOW.toISOString() });
      await d.store.createApproval({ id: "a" + g, accountId: A, runId: "r" + g, routineId: "D03-W01", title: "decision", status: g ? "held" : "approved", createdAt: NOW.toISOString(), expiresAt: NOW.toISOString(), decidedAt: NOW.toISOString() });
    }
    await d.store.appendTasteEvent({ id: "e", accountId: A, action: "why_opened", createdAt: NOW.toISOString(), context: {} });
    const p = await tastePatterns(d.store, A, { now: d.now, contextGeneration: 1 });
    expect(p).toMatchObject({ approved: 0, held: 1, decided: 1, whyOpened: 0 });
    const style = deriveDecisionStyle(p, NOW);
    d.db.rows("accounts")[0].context_generation = 2;
    await expect(writeDecisionStyle(d.db, A, style, NOW, 1)).rejects.toMatchObject({ code: "context_changed" });
    expect(d.db.rows("account_profiles")).toHaveLength(0);
  });

  it("does not let yesterday's generation marker suppress a fresh context or rebase a queued candidate", async () => {
    const d = setup(1);
    const marker = { [A]: { day: "2026-09-05", ranAt: NOW.toISOString(), ok: true } };
    expect(dueBriefs(NOW, [{ accountId: A, contextGeneration: 1, timezone: null }], marker)).toHaveLength(1);
    expect(sanitiseBriefMarkers({ [A]: { ...marker[A], contextGeneration: null } })).toEqual({});
    const accounts = new StaticAccountsSource([{ account: { accountId: A, ...account(1) } }]);
    await expect(runDailyBrief({ ...d, accounts, reader: { read: vi.fn() } }, { accountId: A, contextGeneration: 0 })).rejects.toMatchObject({ code: "context_changed" });
    expect(d.db.rows("account_profiles")).toHaveLength(0);
    expect(d.db.rows("daily_briefs")).toHaveLength(0);
  });

  it("skips a paused/missing KPI job target and fails closed on malformed runtime controls", async () => {
    const d = setup(1, true);
    const reader = { read: vi.fn() };
    const accounts = new StaticAccountsSource([{ account: { accountId: A, ...account(1) }, automationPaused: true }]);
    const report = await runKpiSnapshot({ ...d, accounts, reader }, { accountId: A });
    expect(report.accounts).toBe(0);
    expect(reader.read).not.toHaveBeenCalled();
    d.db.rows("accounts")[0].context_generation = null;
    await expect(generateDailyBrief({ ...d, contextGeneration: 1 })).rejects.toMatchObject({ code: "context_unavailable" });
  });
});
