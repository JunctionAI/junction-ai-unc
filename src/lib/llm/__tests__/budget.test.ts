/* The per-account monthly cap: the math, the cap precedence (column → env → 15), the router
   refusing to call a provider over the cap, the chat line, the producer's honest failure, and
   the worker skipping an over-cap account's produce routines. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { setEnabled } from "@/lib/runtime/versioning";
import { clock, FakeProducer } from "@/lib/runtime/__tests__/helpers";
import { StaticAccountsSource } from "@/worker/accounts";
import { FixtureCredentialProvider } from "@/worker/credentials";
import { createLogger, memorySink } from "@/worker/log";
import { Worker, type WorkerDeps } from "@/worker/loop";
import { LlmProducer } from "@/worker/providers/producer";
import { accountCap, BUDGET_EXHAUSTED_LINE, budgetStatus, checkBudget, defaultCap, isBudgetExceeded, monthSpendUsd, monthStartUtc, resetBudgetCache, spendByAccount } from "../budget";
import { complete, createTextClient, setLlmDbForTests, setProviderFactoryForTests } from "../router";
import type { LlmProvider, ProviderId, ProviderRequest } from "../types";
import { clearLlmEnv, restoreLlmEnv } from "./env";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const OTHER = "00000000-0000-4000-8000-00000000acc2";
const NOW = new Date("2026-09-03T07:00:00.000Z");

let db: FakeSupabase;
beforeEach(() => {
  db = new FakeSupabase();
  db.now = () => NOW.toISOString();
  db.seed("accounts", [
    { id: ACCT, name: "Example Co" },
    { id: OTHER, name: "Other Co", monthly_llm_cap_usd: 40 },
  ]);
  resetBudgetCache();
  delete process.env.UNC_ACCOUNT_MONTHLY_USD_CAP;
});
afterEach(() => {
  delete process.env.UNC_ACCOUNT_MONTHLY_USD_CAP;
  resetBudgetCache();
});

const usage = (accountId: string, cost: number | null, at = "2026-09-02T10:00:00.000Z") => ({ account_id: accountId, task: "chat", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 10, output_tokens: 5, est_cost_usd: cost, latency_ms: 1, stop_reason: "end", created_at: at });

describe("the math", () => {
  it("month start, cap precedence, status", () => {
    expect(monthStartUtc(NOW)).toBe("2026-09-01T00:00:00.000Z");
    expect(defaultCap({})).toEqual({ cap: 15, source: "default" });
    expect(defaultCap({ UNC_ACCOUNT_MONTHLY_USD_CAP: "25" })).toEqual({ cap: 25, source: "env" });
    expect(defaultCap({ UNC_ACCOUNT_MONTHLY_USD_CAP: "abc" })).toEqual({ cap: 15, source: "default" });
    expect(budgetStatus("a", 14.999, { cap: 15, source: "default" }, "m")).toMatchObject({ ok: true, remainingUsd: 0.001 });
    expect(budgetStatus("a", 15, { cap: 15, source: "default" }, "m")).toMatchObject({ ok: false, remainingUsd: 0 });
    expect(budgetStatus("a", 0, { cap: 0, source: "account" }, "m").ok).toBe(false);
  });

  it("sums this month's est_cost_usd only (null = 0; last month ignored; other accounts ignored)", async () => {
    db.seed("llm_usage", [usage(ACCT, 1.25), usage(ACCT, null), usage(ACCT, 0.5, "2026-08-31T23:59:59.000Z"), usage(OTHER, 9), usage(ACCT, 2)]);
    expect(await monthSpendUsd(db, ACCT, NOW)).toBe(3.25);
    expect(await accountCap(db, ACCT, {})).toEqual({ cap: 15, source: "default" });
    expect(await accountCap(db, OTHER, {})).toEqual({ cap: 40, source: "account" });
    expect(await accountCap(db, ACCT, { UNC_ACCOUNT_MONTHLY_USD_CAP: "20" })).toEqual({ cap: 20, source: "env" });
    const all = await spendByAccount(db, NOW);
    expect(all.get(ACCT)).toBe(3.25);
    expect(all.get(OTHER)).toBe(9);
  });

  it("checkBudget: cached 30 s for views; a database failure fails closed and is logged", async () => {
    db.seed("llm_usage", [usage(ACCT, 14)]);
    let t = NOW.getTime();
    const now = () => new Date(t);
    expect(await checkBudget(db, ACCT, { now })).toMatchObject({ ok: true, spentUsd: 14, capUsd: 15, remainingUsd: 1, capSource: "default" });
    db.seed("llm_usage", [usage(ACCT, 5)]);
    expect((await checkBudget(db, ACCT, { now })).ok).toBe(true); // cached
    expect((await checkBudget(db, ACCT, { now, cached: false })).ok).toBe(false); // fresh
    t += 31_000;
    expect(await checkBudget(db, ACCT, { now })).toMatchObject({ ok: false, spentUsd: 19 });
    const logs: string[] = [];
    const broken = { from: () => { throw new Error("db down"); }, rpc: () => { throw new Error("db down"); } } as unknown as FakeSupabase;
    expect(await checkBudget(broken, "x", { now, log: (e) => logs.push(e) })).toMatchObject({ ok: false, checkFailed: true, remainingUsd: 0 });
    expect(logs).toEqual(["llm.budget_check_failed"]);
  });
});

type Fake = LlmProvider & { calls: ProviderRequest[] };
function fakeProvider(id: ProviderId): Fake {
  const calls: ProviderRequest[] = [];
  return { id, calls, async complete(req) { calls.push(req); return { text: '{"kind":"post_set","title":"t","body":"A body long enough to pass the validator with ease.","items":[{"title":"a","body":"b"}]}', stopReason: "end", usage: { input: 100, output: 50 }, provider: id, model: req.model, latencyMs: 1 }; } };
}

describe("where it bites", () => {
  let anthropic: Fake;
  const req = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 200 };
  beforeEach(() => {
    clearLlmEnv({ ANTHROPIC_API_KEY: "a" });
    anthropic = fakeProvider("anthropic");
    setProviderFactoryForTests((id) => (id === "anthropic" ? anthropic : null));
    setLlmDbForTests(() => db);
  });
  afterEach(() => {
    restoreLlmEnv();
    setProviderFactoryForTests(undefined);
    setLlmDbForTests(undefined);
  });

  it("router.complete: under the cap calls the provider and writes the ledger; over it answers budget_exceeded, calls nothing, writes nothing", async () => {
    const ok = await complete("chat", req, { accountId: ACCT, db, now: () => NOW });
    expect(ok?.stopReason).toBe("end");
    expect(anthropic.calls).toHaveLength(1);
    expect(db.rows("llm_usage")).toHaveLength(1);
    db.seed("llm_usage", [usage(ACCT, 15)]);
    const over = await complete("chat", req, { accountId: ACCT, db, now: () => NOW });
    expect(over).toMatchObject({ stopReason: "error", errorCode: "budget_exceeded", provider: "anthropic" });
    expect(isBudgetExceeded(over)).toBe(true);
    expect(anthropic.calls).toHaveLength(1);
    expect(db.rows("llm_usage")).toHaveLength(2);
    // no account (onboarding, ping) → never gated
    expect((await complete("chat", req, { accountId: null, db }))?.stopReason).toBe("end");
    // the text client surfaces it as a thrown budget_exceeded
    await expect(createTextClient("routine_produce", { maxTokens: 100 }, { db })!.complete({ system: "s", user: "u", accountId: ACCT })).rejects.toThrow("llm budget_exceeded");
  });

  it("the producer fails the run closed with the honest line", async () => {
    db.seed("llm_usage", [usage(ACCT, 15)]);
    const producer = new LlmProducer(createTextClient("routine_produce", { maxTokens: 100 }, { db }), { context: { async gather() { return { profile: { name: "Example Co", oneLiner: "Marine collagen" }, memories: [], goal: null, plan: null, priorArtifacts: [], founderNotes: null }; } } , playbooks: null });
    const ctx = { runId: "r", routineId: "D01-W01", version: 1, mode: "dry_run" as const, startedAt: NOW.toISOString(), account: { accountId: ACCT, currency: "NZD", budgetMonthly: 0 }, caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual" as const, vars: {}, inputs: {}, reads: {}, checks: {} };
    await expect(producer.produce({ kind: "produce", id: "p", skill: "D01-W01" }, ctx)).rejects.toThrow(BUDGET_EXHAUSTED_LINE);
    expect(anthropic.calls).toHaveLength(0);
  });

  it("the worker skips every over-cap production routine account-wide", async () => {
    const clk = clock("2026-09-02T07:00:30.000Z");
    const store = new MemoryStore();
    const { sink, entries } = memorySink();
    db.seed("llm_usage", [usage(ACCT, 15)]);
    const deps: WorkerDeps = { store, accounts: new StaticAccountsSource([{ account: { accountId: ACCT, currency: "NZD", budgetMonthly: 3000 } }, { account: { accountId: OTHER, currency: "NZD", budgetMonthly: 3000 } }]), credentials: new FixtureCredentialProvider(), llm: null, producer: new FakeProducer(), db, now: clk.now, log: createLogger(sink, {}, clk.now) };
    await setEnabled({ store, now: clk.now }, ACCT, "D01-W01", true); // daily 07:00, produces
    await setEnabled({ store, now: clk.now }, ACCT, "D02-W01", true); // daily 07:00, deterministic decision plus an inspectable proposal
    await setEnabled({ store, now: clk.now }, OTHER, "D01-W01", true); // under its 40 cap
    const worker = new Worker(deps, { intervalSec: 60, heartbeatPath: null, handleSignals: false, jobs: false, briefs: false });
    const report = await worker.tick();
    expect(report.budgetSkipped).toBe(2);
    const byKey = Object.fromEntries(report.started.map((r) => [`${r.accountId}:${r.routineId}`, r]));
    expect(byKey[`${ACCT}:D01-W01`]).toMatchObject({ status: "skipped", summary: BUDGET_EXHAUSTED_LINE });
    expect(byKey[`${ACCT}:D01-W01`].runId).toBeUndefined();
    expect(byKey[`${ACCT}:D02-W01`]).toMatchObject({ status: "skipped", summary: BUDGET_EXHAUSTED_LINE });
    expect(byKey[`${ACCT}:D02-W01`].runId).toBeUndefined();
    expect(byKey[`${OTHER}:D01-W01`]).toMatchObject({ status: "done" });
    expect(await store.listRuns(ACCT)).toEqual([]);
    expect(entries.some((e) => e.event === "run.budget_skipped")).toBe(true);
    // the heartbeat row landed (migration 0014) so /api/health can see the worker
    await new Promise((r) => setTimeout(r, 0));
    expect(db.rows("worker_heartbeats")).toMatchObject([{ worker: "unc", ticks: 1, stopping: false }]);
  });
});
