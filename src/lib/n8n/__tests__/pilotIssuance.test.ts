import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keywordPilotContract, keywordPilotReservation, KeywordPilotAlreadyIssued, KEYWORD_PILOT_PIN, runKeywordShadowPilot, type KeywordPilotApproval } from "../../../worker/issueKeywordShadowPilot";
import { runRoutine } from "../../runtime/engine";
import { keywordShadowSpec } from "../keywordShadowSpec";
import { adapters as testAdapters } from "../../runtime/__tests__/helpers";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import type { RunRecord } from "../../runtime/store/interface";
import { HttpN8nBridge } from "../../../worker/providers/n8n";
import { CATALOG_SPEC_BY_ID } from "../../runtime/catalog-specs";
import type { N8nNode, RunContext, RoutineSpec } from "../../runtime/types";
import { DbAccountsSource } from "../../../worker/accounts";
import { SupabaseStore } from "../../runtime/store/supabase";
import { N8N_EXECUTION_API_BASE } from "../../../worker/providers/n8nExecutionReader";

const now = () => new Date("2026-09-05T08:30:00.000Z");
const approval = (): KeywordPilotApproval => ({ authorizedBy: "11111111-1111-4111-8111-111111111111",
  approvalReference: "SYNTHETIC-TEST-NOT-AUTHORITY", idempotencyKey: "synthetic-keyword-US-one-call", market: "US",
  contextGeneration: 1, maxProviderCalls: 1, expiresAt: "2026-09-05T08:35:00.000Z" });

describe("operator-only keyword pilot approval", () => {
  it.each([["US", 2840], ["NZ", 2554], ["AU", 2036]] as const)("pins %s independently", (market, code) => {
    expect(keywordPilotContract({ ...approval(), market }, now())).toMatchObject({
      workflowId: KEYWORD_PILOT_PIN.workflowId, workflowVersion: KEYWORD_PILOT_PIN.workflowVersion,
    });
    expect(keywordPilotContract({ ...approval(), market }, now()).client).toEqual({ id: "avgar", primaryDomain: "avgarsport.com",
      seedKeyword: "golf travel bag", locationCode: code, languageCode: "en" });
  });
  it.each([
    { market: "UK" }, { market: "__proto__" }, { maxProviderCalls: 2 }, { maxProviderCalls: 0 },
    { authorizedBy: "the founder" }, { approvalReference: "" }, { idempotencyKey: "" },
    { contextGeneration: -1 }, { contextGeneration: 1.5 }, { expiresAt: "bad-time" },
    { expiresAt: "2026-09-05T08:30:00.000Z" }, { expiresAt: "2026-09-05T08:41:00.000Z" },
  ])("refuses invalid approval %j", fault => {
    expect(() => keywordPilotContract({ ...approval(), ...fault } as KeywordPilotApproval, now())).toThrow();
  });
});

async function fixture() {
  const db = new FakeSupabase(), a = approval(), contract = keywordPilotContract(a, now()), spec = keywordShadowSpec(contract, 2);
  const { adapters, store } = testAdapters();
  const account = { accountId: contract.accountId, contextGeneration: 1, currency: "NZD", budgetMonthly: 0 };
  let previous: { created: boolean; runId: string; permitId: string; registrationId: string } | undefined;
  // Application wiring seam, not a SQL transaction/concurrency proof.
  db.rpcs.issue_keyword_shadow_pilot = ({ input }) => {
    const packet = input as { run: RunRecord; approval: KeywordPilotApproval };
    if (previous) return { ...previous, created: false };
    previous = { created: true, runId: packet.run.id, permitId: randomUUID(), registrationId: randomUUID() };
    void store.createRun(structuredClone(packet.run));
    return previous;
  };
  const call = vi.fn(async () => ({ kind: "needs" as const, needs: [{ input: "synthetic", why: "Synthetic test only" }] }));
  const read = vi.spyOn(adapters.reader, "read"), create = vi.spyOn(store, "createRun");
  const reserve = keywordPilotReservation(db, a, now);
  const start = (otherSpec: RoutineSpec = spec, options = {}) => runRoutine(otherSpec, { account, vars: { website: "avgarsport.com" }, triggeredBy: "manual" },
    { ...adapters, now, n8n: { call }, completeKeywordShadow: vi.fn() },
    { mode: "dry_run", reserveKeywordShadowRun: reserve, ...options });
  return { db, a, spec, start, store, read, create, call, reserve, account };
}

describe("atomic pilot issuance wiring", () => {
  it("creates the original run once before reads and dispatch, without promoting or enabling a routine", async () => {
    const f = await fixture();
    const original = f.db.rpcs.issue_keyword_shadow_pilot;
    f.db.rpcs.issue_keyword_shadow_pilot = args => {
      expect(f.read).not.toHaveBeenCalled(); expect(f.call).not.toHaveBeenCalled();
      const run = (args.input as { run: RunRecord }).run;
      expect(run.snapshot).toMatchObject({ awaiting: "keyword_start", nextNodeIndex: 0, ctx: { reads: {}, checks: {}, inputs: {} } });
      return original(args);
    };
    const result = await f.start();
    expect(result.status).toBe("waiting_input"); expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.read).toHaveBeenCalledTimes(2); expect(f.call).toHaveBeenCalledTimes(1);
    expect(await f.store.getRoutineState(f.account.accountId, "D03-W01")).toBeNull();
  });
  it("a duplicate operation returns the first identity and cannot restart any reads/provider work", async () => {
    const f = await fixture(), first = await f.start(); f.read.mockClear();
    await expect(f.start()).rejects.toMatchObject({ original: { runId: first.runId, created: false } });
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.read).not.toHaveBeenCalled(); expect(f.call).toHaveBeenCalledTimes(1);
  });
  it("a lost issuance response leaves the original start snapshot, and retry does not call the provider", async () => {
    const f = await fixture(), original = f.db.rpcs.issue_keyword_shadow_pilot;
    f.db.rpcs.issue_keyword_shadow_pilot = args => { original(args); throw new Error("response lost after commit"); };
    await expect(f.start()).rejects.toThrow("response lost");
    f.db.rpcs.issue_keyword_shadow_pilot = original;
    await expect(f.start()).rejects.toBeInstanceOf(KeywordPilotAlreadyIssued);
    expect(f.read).not.toHaveBeenCalled(); expect(f.call).not.toHaveBeenCalled(); expect(f.create).toHaveBeenCalledTimes(1);
    expect((await f.store.listRuns(f.account.accountId))[0].snapshot?.awaiting).toBe("keyword_start");
  });
  it("failed issuance creates no normal engine run", async () => {
    const f = await fixture(); f.db.rpcs.issue_keyword_shadow_pilot = () => { throw new Error("database refused"); };
    await expect(f.start()).rejects.toThrow("database refused");
    expect(f.create).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled(); expect(f.call).not.toHaveBeenCalled();
  });
  it("captures approval before the caller mutates it", async () => {
    const f = await fixture(), original = f.db.rpcs.issue_keyword_shadow_pilot;
    f.a.market = "AU";
    f.db.rpcs.issue_keyword_shadow_pilot = args => {
      expect((args.input as { approval: KeywordPilotApproval }).approval.market).toBe("US"); return original(args);
    };
    await f.start();
  });
  it("does not persist unrelated approval fields", async () => {
    const f = await fixture(), original = f.db.rpcs.issue_keyword_shadow_pilot;
    const withExtra = { ...f.a, unrelated: "not part of the approval" };
    const reserve = keywordPilotReservation(f.db, withExtra, now);
    f.db.rpcs.issue_keyword_shadow_pilot = args => {
      expect((args.input as { approval: object }).approval).not.toHaveProperty("unrelated"); return original(args);
    };
    await f.start(f.spec, { reserveKeywordShadowRun: reserve });
  });
  it("refuses wrong run identity returned by a reservation before any reads", async () => {
    const f = await fixture();
    await expect(f.start(f.spec, { reserveKeywordShadowRun: async (run: RunRecord) => ({ ...run, id: randomUUID() }) })).rejects.toThrow("captured original");
    expect(f.read).not.toHaveBeenCalled(); expect(f.call).not.toHaveBeenCalled();
  });
  it("refuses ordinary built-in and live runs before invoking the issuance hook", async () => {
    const f = await fixture(), reserve = vi.fn();
    await expect(f.start(CATALOG_SPEC_BY_ID["D03-W01"], { reserveKeywordShadowRun: reserve })).rejects.toThrow("explicit manual");
    await expect(f.start(f.spec, { mode: "live", reserveKeywordShadowRun: reserve })).rejects.toThrow("refuses live");
    expect(reserve).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
  });
  it("cannot reach the reserved receiver through a built-in registration fallback", async () => {
    const f = await fixture(), fetch = vi.fn(), bridge = new HttpN8nBridge({ fetch });
    const ctx = { account: f.account, runId: randomUUID(), routineId: "D03-W01", mode: "dry_run", startedAt: now().toISOString() } as RunContext;
    await expect(bridge.call({ kind: "produce", id: "produce" }, ctx, {
      id: randomUUID(), accountId: f.account.accountId, routineId: "D03-W01", active: true, webhookUrl: KEYWORD_PILOT_PIN.receiverUrl,
    })).rejects.toThrow("explicit shadow contract");
    expect(fetch).not.toHaveBeenCalled();
    const changed = structuredClone(f.spec); (changed.nodes[3] as N8nNode).shadowContract!.client.seedKeyword = "unapproved";
    await expect(f.start(changed)).rejects.toThrow("contract mismatch"); expect(f.create).not.toHaveBeenCalled();
  });
});

describe("actual pilot service preflight", () => {
  afterEach(() => vi.unstubAllEnvs());
  function configured(website = "https://avgarsport.com/", paused = false) {
    const a = approval(), db = new FakeSupabase(), accountId = keywordPilotContract(a, now()).accountId;
    db.seed("accounts", [{ id: accountId, currency: "NZD", context_generation: 1, automation_paused: paused }]);
    db.seed("resource_profiles", [{ account_id: accountId, website, budget_monthly: null }]);
    const rpc = vi.fn(() => { throw new Error("synthetic stop at issuance, no writes or provider work"); });
    db.rpcs.issue_keyword_shadow_pilot = rpc;
    for (const [key, value] of Object.entries({ N8N_SHADOW_RECEIVER_URL: KEYWORD_PILOT_PIN.receiverUrl,
      N8N_DATA_BASE_URL: "https://junction-unc.vercel.app", N8N_SIGNING_SECRET: "synthetic-signing-test-value-only",
      N8N_SHADOW_RECEIVER_TOKEN: "synthetic-receiver-test-value-only", N8N_EXECUTION_READER_ENABLED: "true",
      N8N_EXECUTION_API_BASE_URL: N8N_EXECUTION_API_BASE, N8N_EXECUTION_API_KEY: "synthetic-reader-test-value-only",
      N8N_SHADOW_TRIGGER_NODE_ID: "synthetic-trigger", N8N_SHADOW_WORKFLOW_ID: KEYWORD_PILOT_PIN.workflowId })) vi.stubEnv(key, value);
    const start = () => runKeywordShadowPilot({ db, store: new SupabaseStore(db), accounts: new DbAccountsSource(db), now, producer: null, n8n: null }, a);
    return { db, start, rpc };
  }
  it.each(["avgarsport.com", "https://avgarsport.com", "https://avgarsport.com/"])("accepts the canonical website representation %s without rewriting it", async website => {
    const f = configured(website);
    await expect(f.start()).rejects.toThrow("synthetic stop at issuance");
    expect(f.rpc).toHaveBeenCalledOnce(); expect(f.db.rows("resource_profiles")[0].website).toBe(website);
    expect(f.db.rows("routine_runs")).toHaveLength(0);
  });
  it.each(["https://other.example/", "https://avgarsport.com/other", "https://avgarsport.com@other.example/"])("refuses mismatched website %s before issuance", async website => {
    const f = configured(website); await expect(f.start()).rejects.toThrow("AVGAR context"); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("does not unpause the account or issue an allowance", async () => {
    const f = configured("https://avgarsport.com/", true);
    await expect(f.start()).rejects.toThrow("unpaused AVGAR"); expect(f.rpc).not.toHaveBeenCalled();
    expect(f.db.rows("accounts")[0].automation_paused).toBe(true);
  });
  it("refuses missing execution-reader access before issuance", async () => {
    const f = configured(); vi.stubEnv("N8N_EXECUTION_READER_ENABLED", "false");
    await expect(f.start()).rejects.toThrow("access configuration"); expect(f.rpc).not.toHaveBeenCalled();
  });
});
