/* ActionExecutor: dry-run shaping through the engine, live gating by LIVE_MODE_ENABLED and by
   risk (UNC_LIVE_ACTION_RISKS), guards, idempotency, rate-limit back-off, and the Meta catalog
   specs reaching execute with a typed action id. */

import { describe, expect, it } from "vitest";
import { RulesDecisionProvider } from "../../lib/actions";
import { CATALOG_SPECS, catalogSpec } from "../../lib/runtime/catalog-specs";
import { resumeRun, runRoutine } from "../../lib/runtime/engine";
import { DeterministicDecisionProvider, StaticReader, type Fixtures } from "../../lib/runtime/providers";
import { MemoryStore } from "../../lib/runtime/store/memory";
import type { ExecuteNode, RoutineSpec, RunContext } from "../../lib/runtime/types";
import { account, clock, input } from "../../lib/runtime/__tests__/helpers";
import { FixtureCredentialProvider, type CredentialProvider, type PlatformCredential } from "../credentials";
import { ActionExecutor, disabledRisks, enabledActionRisks, LIVE_DISABLED_REASON, MemoryIdempotencyLedger, NOT_IMPLEMENTED_REASON, parseEnabledRisks, riskDisabledReason } from "../providers/executor";
import { LIVE_MODE_ENABLED } from "../service";

class MetaCreds implements CredentialProvider {
  async get(_a: string, platform: string): Promise<PlatformCredential | null> {
    return platform === "meta_ads" ? { kind: "meta_ads", adAccountId: "123456789012345", accessToken: "EAAB-secret" } : null;
  }
}

const ROWS = [
  { adset_id: "120210000000001", adset_name: "Winner", spend: 420, purchases: 12, purchase_value: 1302, roas: 3.1, frequency: 1.8, ctr: 1.9, daily_budget: 60 },
  { adset_id: "120210000000002", adset_name: "Loser", spend: 260, purchases: 2, purchase_value: 180, roas: 0.69, frequency: 2.1, ctr: 1.1, daily_budget: 40 },
];
const META_FIXTURES: Fixtures = {
  "meta_ads:insights": { rows: ROWS, metrics: { spend: 680, reconciliation_pct: 100, top_adset_id: "120210000000001", top_adset_name: "Winner", top_adset_roas: 3.1, top_adset_daily_budget: 60, worst_ad_id: "120210000000002", worst_ad_name: "Loser", worst_frequency: 2.1, worst_spend: 260 } },
  "meta_ads:adsets": { rows: [{ id: "120210000000001", name: "Winner", daily_budget: 60 }, { id: "120210000000002", name: "Loser", daily_budget: 40 }], metrics: {} },
  "shopify:orders": { rows: [{ i: 1 }], metrics: {} },
  "ga4:report": { rows: [{ i: 1 }], metrics: {} },
};

function fakeFetch(answers: { status?: number; json?: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const a = answers[Math.min(i++, answers.length - 1)];
    const status = a.status ?? 200;
    return { ok: status < 300, status, headers: new Headers(a.headers ?? {}), json: async () => a.json ?? {} } as unknown as Response;
  }) as typeof fetch;
  return { fetch: f, calls };
}

function node(action: string, target: Record<string, unknown> = {}, params: Record<string, unknown> = {}): ExecuteNode {
  return { kind: "execute", id: "execute", platform: "meta_ads", mutation: { action, target, params } };
}

function rctx(overrides: Partial<RunContext> = {}): RunContext {
  return { runId: "run-1", routineId: "D02-W01", version: 1, mode: "live", startedAt: "2026-09-03T07:00:00.000Z", account: account(), caps: { currency: "NZD", perDay: 100, perMonth: 3000 }, triggeredBy: "manual", vars: {}, reads: {}, checks: {}, ...overrides };
}

const ALL_ON = enabledActionRisks({ UNC_LIVE_ACTION_RISKS: "read,reversible,spend,publish" });

describe("enablement map", () => {
  it("parses UNC_LIVE_ACTION_RISKS and defaults to nothing", () => {
    expect([...parseEnabledRisks("reversible, spend")]).toEqual(["reversible", "spend"]);
    expect([...parseEnabledRisks("REVERSIBLE nope")]).toEqual(["reversible"]);
    expect(enabledActionRisks({})).toEqual({ read: false, reversible: false, spend: false, publish: false, destructive: false });
    expect(enabledActionRisks({ UNC_LIVE_ACTION_RISKS: "reversible" })).toMatchObject({ reversible: true, spend: false });
  });
  it("an action with secondary risks needs every one enabled", () => {
    const a = { id: "meta.campaign.create_from_brief", risk: "publish" as const, secondaryRisks: ["spend" as const] };
    expect(disabledRisks(a, enabledActionRisks({ UNC_LIVE_ACTION_RISKS: "publish" }))).toEqual(["spend"]);
    expect(riskDisabledReason(a, enabledActionRisks({}))).toBe("risk_disabled — meta.campaign.create_from_brief carries 'publish' + 'spend' and those risks are not enabled (UNC_LIVE_ACTION_RISKS)");
    expect(disabledRisks(a, ALL_ON)).toEqual([]);
  });
});

describe("dry run through the engine", () => {
  it("records the exact shaped request (token redacted) on the draft receipt", async () => {
    const clk = clock();
    const store = new MemoryStore();
    const executor = new ActionExecutor({ liveModeEnabled: false, credentials: new MetaCreds(), now: clk.now });
    const adapters = { reader: new StaticReader(META_FIXTURES, clk.now), decider: new RulesDecisionProvider(new DeterministicDecisionProvider()), executor, store, now: clk.now };
    const res = await runRoutine(catalogSpec("D02-W01"), input(), adapters, { mode: "dry_run" });
    expect(res.status, res.summary).toBe("done");
    const would = res.receipts.find((r) => r.description.startsWith("Would ") && !r.description.startsWith("Would ask"))!;
    expect(would.description).toBe("Would Pause ad set …000002 — CPA over the cap.");
    const payload = would.payload.action as { actionId: string; risk: string; request: { method: string; url: string; headers: Record<string, string>; body: unknown }; violations: unknown[]; idempotencyKey: string; rollback: unknown; enabled: { liveMode: boolean; disabled: string[] }; connected: boolean };
    expect(payload.actionId).toBe("meta.adset.pause");
    expect(payload.risk).toBe("reversible");
    expect(payload.request).toEqual({ method: "POST", url: "https://graph.facebook.com/v23.0/120210000000002", headers: { Authorization: "Bearer ••••", Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: { status: "PAUSED" }, note: "pause ad set …000002" });
    expect(payload.violations).toEqual([]);
    expect(payload.idempotencyKey).toMatch(/^.+:meta\.adset\.pause:[0-9a-f]+$/);
    expect(payload.rollback).toEqual({ actionId: "meta.adset.resume", params: { adsetId: "120210000000002" }, note: "set ad set back to ACTIVE" });
    expect(payload.enabled).toMatchObject({ liveMode: false, disabled: ["reversible"] });
    expect(payload.connected).toBe(true);
    expect(JSON.stringify(res.receipts)).not.toContain("EAAB");
    expect(res.receipts.some((r) => r.kind === "mutation")).toBe(false);
    expect(await store.listApprovals("acct-1")).toHaveLength(0);
  });

  it("a scale proposal shapes the budget request and says the exact before → after", async () => {
    const clk = clock();
    const executor = new ActionExecutor({ liveModeEnabled: false, credentials: new MetaCreds(), now: clk.now });
    const fixtures: Fixtures = { ...META_FIXTURES, "meta_ads:insights": { rows: [ROWS[0]], metrics: { ...(META_FIXTURES["meta_ads:insights"] as { metrics: Record<string, number | string> }).metrics } } };
    const adapters = { reader: new StaticReader(fixtures, clk.now), decider: new RulesDecisionProvider(new DeterministicDecisionProvider()), executor, store: new MemoryStore(), now: clk.now };
    const res = await runRoutine(catalogSpec("D02-W01"), input(), adapters, { mode: "dry_run" });
    expect(res.status, res.summary).toBe("done");
    const gate = res.receipts.find((r) => r.description.startsWith("Would ask"))!;
    expect((gate.payload.approvalPreview as { title: string }).title).toBe("Scale Winner: NZD 60.00 → NZD 72.00/day (+20%)");
    const would = res.receipts.find((r) => r.description.startsWith("Would ") && !r.description.startsWith("Would ask"))!;
    expect(would.description).toBe("Would Set ad set …000001 daily budget NZD 60.00 → NZD 72.00 (+20%) — CPA 35.00 at/under the 40.00 line.");
    const payload = would.payload.action as { request: { body: unknown }; spend: unknown };
    expect(payload.request.body).toEqual({ daily_budget: 7200 });
    expect(payload.spend).toEqual({ amount: 72, currency: "NZD", perDay: true });
  });

  it("guard violations land on the receipt as 'guards would block it' — nothing fails", async () => {
    const clk = clock();
    const executor = new ActionExecutor({ liveModeEnabled: false, credentials: new MetaCreds(), now: clk.now, spendCeiling: async () => 5 });
    const fixtures: Fixtures = { ...META_FIXTURES, "meta_ads:insights": { rows: [ROWS[0]], metrics: { ...(META_FIXTURES["meta_ads:insights"] as { metrics: Record<string, number | string> }).metrics } } };
    const adapters = { reader: new StaticReader(fixtures, clk.now), decider: new RulesDecisionProvider(new DeterministicDecisionProvider()), executor, store: new MemoryStore(), now: clk.now };
    const res = await runRoutine(catalogSpec("D02-W01"), input(), adapters, { mode: "dry_run" });
    expect(res.status).toBe("done");
    const would = res.receipts.find((r) => r.description.startsWith("Would ") && !r.description.startsWith("Would ask"))!;
    expect(would.description).toContain("— but guards would block it: +NZD 12.00/day is above the NZD 5.00/day you usually approve.");
    expect(would.payload.blocked).toContain("usually approve");
  });

  it("an unregistered verb keeps the engine's generic line (no action payload)", async () => {
    const executor = new ActionExecutor({ liveModeEnabled: false });
    expect(await executor.dryRun(node("update_adset_budget"), { action: "update_adset_budget" }, rctx({ mode: "dry_run" }))).toBeNull();
  });
});

describe("live gating", () => {
  it("LIVE_MODE_ENABLED is false in the worker", () => {
    expect(LIVE_MODE_ENABLED).toBe(false);
  });
  it("unknown action → not_implemented; live off → live_disabled; risk off → risk_disabled — nothing fetched", async () => {
    const { fetch, calls } = fakeFetch([{ json: { success: true } }]);
    const off = new ActionExecutor({ liveModeEnabled: false, credentials: new MetaCreds(), enabledRisks: ALL_ON, fetch });
    expect((await off.execute(node("update_adset_budget"), { action: "update_adset_budget" }, rctx())).error).toBe(NOT_IMPLEMENTED_REASON);
    const live = await off.execute(node("meta.adset.pause", { adsetId: "120210000000002" }), { action: "meta.adset.pause", target: { adsetId: "120210000000002" } }, rctx());
    expect(live).toMatchObject({ ok: false, error: LIVE_DISABLED_REASON, readback: { refused: true, actionId: "meta.adset.pause", risks: ["reversible"] } });
    const riskOff = new ActionExecutor({ liveModeEnabled: true, credentials: new MetaCreds(), enabledRisks: enabledActionRisks({ UNC_LIVE_ACTION_RISKS: "reversible" }), fetch });
    const spend = await riskOff.execute(node("meta.adset.set_daily_budget", { adsetId: "120210000000001" }, { dailyBudget: 72, currentDailyBudget: 60 }), { action: "meta.adset.set_daily_budget", target: { adsetId: "120210000000001" }, params: { dailyBudget: 72, currentDailyBudget: 60 } }, rctx());
    expect(spend.ok).toBe(false);
    expect(spend.error).toBe("risk_disabled — meta.adset.set_daily_budget carries 'spend' and that risk is not enabled (UNC_LIVE_ACTION_RISKS)");
    expect(calls).toHaveLength(0);
    expect(off.refused).toEqual([{ action: "update_adset_budget", platform: "meta_ads", runId: "run-1" }, { action: "meta.adset.pause", platform: "meta_ads", runId: "run-1" }]);
    expect(off.refusalReasons[1]).toBe(LIVE_DISABLED_REASON);
  });

  it("with live + the risk enabled: guards, then idempotency, then the real call (stubbed), then back-off on a rate limit", async () => {
    const { fetch, calls } = fakeFetch([{ json: { success: true } }, { status: 400, json: { error: { code: 4, message: "limit" } } }]);
    const ledger = new MemoryIdempotencyLedger();
    const clk = clock();
    const ex = new ActionExecutor({ liveModeEnabled: true, credentials: new MetaCreds(), enabledRisks: enabledActionRisks({ UNC_LIVE_ACTION_RISKS: "reversible,spend" }), fetch, ledger, now: clk.now });
    // guard violation first
    const bad = await ex.execute(node("meta.adset.set_daily_budget", { adsetId: "120210000000001" }, { dailyBudget: 500, currentDailyBudget: 60 }), { action: "meta.adset.set_daily_budget", target: { adsetId: "120210000000001" }, params: { dailyBudget: 500, currentDailyBudget: 60 } }, rctx());
    expect(bad.error).toMatch(/^guard_violation — NZD 500.00\/day is over your NZD 100.00\/day cap/);
    expect(calls).toHaveLength(0);
    // the real call
    const m = { action: "meta.adset.pause", target: { adsetId: "120210000000002" }, params: { reason: "CPA over the cap" } };
    const ok = await ex.execute(node("meta.adset.pause"), m, rctx());
    expect(ok).toMatchObject({ ok: true, externalRef: "120210000000002", readback: { actionId: "meta.adset.pause", receipt: "Paused ad set …000002", rollback: { actionId: "meta.adset.resume" } } });
    expect(calls).toHaveLength(1);
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe("Bearer EAAB-secret");
    expect(calls[0].init!.body).toBe("status=PAUSED");
    expect(JSON.stringify(ok.readback)).not.toContain("EAAB");
    // the same (run, action, params) again is refused without a call
    const dup = await ex.execute(node("meta.adset.pause"), m, rctx());
    expect(dup.error).toMatch(/^duplicate — /);
    expect(calls).toHaveLength(1);
    // a rate-limited reply sets a back-off that refuses the next mutation
    const limited = await ex.execute(node("meta.ad.pause"), { action: "meta.ad.pause", target: { adId: "120210000000009" } }, rctx());
    expect(limited.ok).toBe(false);
    expect(limited.error).toMatch(/^rate_limited — Meta app request limit reached/);
    expect(ex.backoffUntil).toBeGreaterThan(clk.now().getTime());
    const held = await ex.execute(node("meta.ad.resume"), { action: "meta.ad.resume", target: { adId: "120210000000009" } }, rctx());
    expect(held.error).toMatch(/^rate_limited — backing off Meta until/);
    expect(calls).toHaveLength(2);
    clk.advanceHours(2);
    await ex.execute(node("meta.ad.resume"), { action: "meta.ad.resume", target: { adId: "120210000000009" } }, rctx());
    expect(calls).toHaveLength(3);
  });

  it("engine integration: an approved live run reaches the executor and is refused with live_disabled (nothing mutated, no spend)", async () => {
    const clk = clock();
    const store = new MemoryStore();
    const executor = new ActionExecutor({ liveModeEnabled: LIVE_MODE_ENABLED, credentials: new MetaCreds(), enabledRisks: ALL_ON, now: clk.now });
    const adapters = { reader: new StaticReader(META_FIXTURES, clk.now), decider: new RulesDecisionProvider(new DeterministicDecisionProvider()), executor, store, now: clk.now };
    const paused = await runRoutine(catalogSpec("D02-W01"), input({ triggeredBy: "manual" }), adapters, { mode: "live" });
    expect(paused.status).toBe("waiting_approval");
    expect(paused.approval!.title).toBe("Turn off Loser");
    const done = await resumeRun(paused.runId, "approved", adapters, { now: clk.now } as never);
    expect(done.status).toBe("failed");
    expect(done.error).toBe(LIVE_DISABLED_REASON);
    expect(done.receipts.some((r) => r.kind === "mutation")).toBe(false);
    expect(executor.refused).toEqual([{ action: "meta.adset.pause", platform: "meta_ads", runId: paused.runId }]);
    expect(await store.sumSpend("acct-1", "2026-09-01T00:00:00.000Z", "2026-09-05T00:00:00.000Z")).toBe(0);
  });
});

describe("spec wiring — the Meta routines reach execute with a typed action id", () => {
  const META_MUTATORS = ["D02-W01", "D02-W02", "D02-W03", "D02-W04", "D02-W07", "D02-W08"];
  it("every Meta execute node names a registered action (or a decision-carried one)", () => {
    for (const id of META_MUTATORS) {
      const spec = catalogSpec(id);
      const ex = spec.nodes.find((n) => n.kind === "execute") as ExecuteNode;
      expect(ex.platform).toBe("meta_ads");
      const fromDecision = ex.mutation.action === "{{decision.params.actionId}}";
      if (fromDecision) {
        const decide = spec.nodes.find((n) => n.kind === "decide") as Extract<RoutineSpec["nodes"][number], { kind: "decide" }>;
        for (const o of decide.options.filter((o) => !o.terminal)) expect(typeof o.params?.actionId, `${id} option ${o.id}`).toBe("string");
      } else expect(ex.mutation.action, id).toMatch(/^meta\./);
    }
    for (const spec of CATALOG_SPECS.filter((s) => s.mutates && !META_MUTATORS.includes(s.id))) {
      const ex = spec.nodes.find((n) => n.kind === "execute") as ExecuteNode;
      expect(ex.platform).not.toBe("meta_ads");
    }
  });

  it("each Meta routine dry-runs to an action-shaped 'Would …' receipt under generous fixtures", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ i, ad_id: `12021000000000${i}`, creative_id: `12021000000010${i}` }));
    const metrics = {
      spend: 500, reconciliation_pct: 100, top_adset_roas: 3, top_adset_daily_budget: 50, top_adset_id: "120210000000001", top_adset_name: "Winner", active_tests: 0,
      fatigued_count: 2, most_fatigued_ad_id: "120210000000009", most_fatigued_ad_name: "Tired", next_ad_id: "120210000000010", next_creative_id: "120210000000110", worst_frequency: 5, worst_cpa_vs_target_pct: 60, worst_spend: 120, worst_ad_id: "120210000000009", worst_ad_name: "Tired",
      projected_daily_spend: 999, daily_budget_total: 999, largest_adset_id: "120210000000002", largest_adset_name: "Big", largest_daily_budget: 80,
      top_post_reach: 9000, top_post_like_rate_pct: 2.5, conversions: 3, top_post_id: "17900000000000001", top_post_caption: "Proof post", count: 6,
    };
    const fixtures = Object.fromEntries(["shopify", "ga4", "meta_ads", "google_ads", "instagram"].flatMap((p) => ["orders", "report", "insights", "ads", "adsets", "campaigns", "media"].map((r) => [`${p}:${r}`, { rows, metrics }]))) as Fixtures;
    const expected: Record<string, RegExp> = {
      "D02-W01": /^Would Set ad set …000001 daily budget NZD 50\.00 → NZD 60\.00 \(\+20%\)/,
      "D02-W02": /^Would Create campaign "Creative test — 2026-09-02" \(OUTCOME_SALES\) with 1 ad set at NZD 30\.00\/day and 6 ads — everything PAUSED/,
      "D02-W03": /^Would Resume ad …000010, then pause ad …000009 — hook fatigue/,
      "D02-W04": /^Would Pause ad …000009 — frequency 5, CPA 60% over target/,
      "D02-W07": /^Would Set ad set …000002 daily budget NZD 80\.00 → NZD 60\.00 \(-25%\)/,
      "D02-W08": /^Would Create campaign "Organic-to-paid test — 2026-09-02" \(OUTCOME_TRAFFIC\) with 1 ad set at NZD 20\.00\/day and 1 ad — everything PAUSED/,
    };
    for (const id of META_MUTATORS) {
      const clk = clock();
      const executor = new ActionExecutor({ liveModeEnabled: false, credentials: new FixtureCredentialProvider(), now: clk.now });
      const adapters = { reader: new StaticReader(fixtures, clk.now), decider: new DeterministicDecisionProvider(), executor, store: new MemoryStore(), now: clk.now };
      const res = await runRoutine(catalogSpec(id), input({ vars: { countries: "NZ, AU", metaPixelId: "123456789012345", metaPageId: "100000000000001" } }), adapters, { mode: "dry_run" });
      expect(res.status, `${id}: ${res.summary}`).toBe("done");
      const would = res.receipts.find((r) => r.description.startsWith("Would ") && !r.description.startsWith("Would ask"))!;
      expect(would.description, id).toMatch(expected[id]);
      expect((would.payload.action as { request: { headers: Record<string, string> } }).request.headers.Authorization).toBe("Bearer ••••");
      expect(res.receipts.some((r) => r.kind === "mutation")).toBe(false);
    }
  });
});
