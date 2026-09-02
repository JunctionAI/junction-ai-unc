import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeRun, runRoutine } from "../../lib/runtime/engine";
import { MemoryStore } from "../../lib/runtime/store/memory";
import type { ExecuteNode, RunContext } from "../../lib/runtime/types";
import { budgetMoveSpec, clock, input, SPEND_FIXTURE } from "../../lib/runtime/__tests__/helpers";
import { StaticReader } from "../../lib/runtime/providers";
import { describeCredential, FixtureCredentialProvider, type CredentialProvider, type PlatformCredential } from "../credentials";
import { createLogger, memorySink, redact, REDACTED } from "../log";
import { WorkerConnectorReader } from "../providers/connectorReader";
import { NOT_IMPLEMENTED_REASON, RefusingExecutor } from "../providers/executor";
import { LlmDecisionProvider } from "../providers/llmDecision";

const NOW = new Date("2026-09-02T07:00:00.000Z");

function ctx(accountId = "acct-1"): RunContext {
  return {
    runId: "run-1",
    routineId: "D05-W02",
    version: 1,
    mode: "dry_run",
    startedAt: NOW.toISOString(),
    account: { accountId, currency: "NZD", budgetMonthly: 3000 },
    caps: { currency: "NZD", perDay: 100, perMonth: 3000 },
    triggeredBy: "schedule",
    vars: {},
    reads: {},
    checks: {},
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("FixtureCredentialProvider", () => {
  it("hands out markers, never tokens, and can be scoped to platforms", async () => {
    const all = new FixtureCredentialProvider();
    expect(await all.get("acct-1", "shopify")).toEqual({ kind: "fixture", platform: "shopify", marker: "fixture:shopify" });
    const scoped = new FixtureCredentialProvider(["shopify"]);
    expect(await scoped.get("acct-1", "klaviyo")).toBeNull();
    expect(describeCredential(await all.get("a", "ga4"))).toBe("fixture:ga4");
    expect(describeCredential({ kind: "shopify", shopDomain: "x", accessToken: "shpat_x" })).toBe("shopify:live");
    expect(describeCredential(null)).toBe("none");
  });
});

describe("WorkerConnectorReader", () => {
  it("dispatches by platform and marks fixture provenance", async () => {
    const reader = new WorkerConnectorReader({ credentials: new FixtureCredentialProvider(), now: () => NOW });
    const res = await reader.read("shopify", { resource: "checkouts", window: "7d" }, ctx());
    expect(res.rows).toHaveLength(5);
    expect(res.metrics.total_value).toBe(510);
    expect(res.provenance).toBe("fixture");
    expect(res.fetchedAt).toBe(NOW.toISOString());
  });

  it("answers platforms without a reader with an empty fixture result (not an incident) under fixture credentials", async () => {
    const reader = new WorkerConnectorReader({ credentials: new FixtureCredentialProvider(), now: () => NOW });
    const res = await reader.read("gorgias", { resource: "tickets" }, ctx());
    expect(res).toEqual({ rows: [], metrics: {}, fetchedAt: NOW.toISOString(), provenance: "fixture" });
  });

  it("throws 'couldn't ask' when nothing is connected, a live read fails, or a platform has no reader", async () => {
    const none: CredentialProvider = { get: async () => null };
    await expect(new WorkerConnectorReader({ credentials: none }).read("shopify", { resource: "orders" }, ctx())).rejects.toThrow("couldn't ask shopify orders: nothing connected for this account");

    const live: CredentialProvider = { get: async (_a, platform): Promise<PlatformCredential | null> => (platform === "shopify" ? { kind: "shopify", shopDomain: "x.myshopify.com", accessToken: "shpat_TEST" } : { kind: "klaviyo", apiKey: "pk_TEST" }) };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response));
    const { sink, entries } = memorySink();
    const reader = new WorkerConnectorReader({ credentials: live, log: createLogger(sink) });
    await expect(reader.read("shopify", { resource: "orders" }, ctx())).rejects.toThrow("couldn't ask shopify orders: HTTP 503 from x.myshopify.com/admin/api/");
    expect(entries[0]).toMatchObject({ event: "read.failed", platform: "shopify", credKind: "shopify:live" });
    expect(JSON.stringify(entries)).not.toContain("shpat_TEST");

    await expect(reader.read("gorgias", { resource: "tickets" }, ctx())).rejects.toThrow("no reader for this platform yet (Wave 2)");
  });

  it("distinguishes 'empty' (asked, nothing there) from 'ok'", async () => {
    const live: CredentialProvider = { get: async () => ({ kind: "shopify", shopDomain: "x.myshopify.com", accessToken: "shpat_TEST" }) };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ orders: [] }) }) as Response));
    const res = await new WorkerConnectorReader({ credentials: live, now: () => NOW }).read("shopify", { resource: "orders", window: "7d" }, ctx());
    expect(res.provenance).toBe("empty");
    expect(res.rows).toEqual([]);
  });
});

describe("RefusingExecutor", () => {
  it("refuses every mutation with the not_implemented reason", async () => {
    const ex = new RefusingExecutor();
    const node: ExecuteNode = { kind: "execute", id: "execute", platform: "meta_ads", mutation: { action: "update_adset_budget" } };
    const res = await ex.execute(node, { action: "update_adset_budget", target: { adsetId: "as-1" }, params: { increase: 20 } }, ctx());
    expect(res).toEqual({ ok: false, error: NOT_IMPLEMENTED_REASON, readback: { refused: true, reason: NOT_IMPLEMENTED_REASON, action: "update_adset_budget", platform: "meta_ads" } });
    expect(NOT_IMPLEMENTED_REASON).toBe("not_implemented — mutations are Wave 2, founder-gated");
    expect(ex.refused).toEqual([{ action: "update_adset_budget", platform: "meta_ads", runId: "run-1" }]);
  });

  it("fails a fully-approved live run closed with a receipt saying why (engine integration)", async () => {
    // The worker never issues live runs; this proves the last line of defence
    // if one ever reached execute with an approved gate.
    const clk = clock();
    const store = new MemoryStore();
    const executor = new RefusingExecutor();
    const adapters = {
      reader: new StaticReader(SPEND_FIXTURE, clk.now),
      decider: new LlmDecisionProvider(null),
      executor,
      store,
      now: clk.now,
    };
    const paused = await runRoutine(budgetMoveSpec(), input(), adapters, { mode: "live" });
    expect(paused.status).toBe("waiting_approval");
    const done = await resumeRun(paused.runId, "approved", adapters, { decidedBy: "user-tom" });
    expect(done.status).toBe("failed");
    expect(done.error).toBe(NOT_IMPLEMENTED_REASON);
    expect(done.receipts.some((r) => r.kind === "mutation")).toBe(false);
    const refusal = done.receipts.find((r) => r.description.includes("not_implemented"))!;
    expect(refusal.kind).toBe("notification");
    expect(refusal.description).toBe(`update_adset_budget on meta_ads failed: ${NOT_IMPLEMENTED_REASON}`);
    expect(executor.refused).toHaveLength(1);
    expect(await store.sumSpend("acct-1", "2026-09-01T00:00:00.000Z", "2026-09-03T00:00:00.000Z")).toBe(0);
  });
});

describe("log redaction", () => {
  it("redacts secret-looking keys and token-shaped values, and never throws", () => {
    const out = redact({ accessToken: "abc", nested: { Authorization: "Bearer x", fine: "ok", key: "sk-ant-123" }, list: ["shpat_abc", "plain"], n: 3 }) as Record<string, unknown>;
    expect(out.accessToken).toBe(REDACTED);
    expect(out.nested).toEqual({ Authorization: REDACTED, fine: "ok", key: REDACTED });
    expect(out.list).toEqual([REDACTED, "plain"]);
    expect(out.n).toBe(3);
    const { sink, entries } = memorySink();
    const log = createLogger(sink, { worker: "unc" }, () => NOW);
    log.info("tick", { apiKey: "secret", routineId: "D01-W01" });
    expect(entries[0]).toEqual({ ts: NOW.toISOString(), level: "info", event: "tick", worker: "unc", apiKey: REDACTED, routineId: "D01-W01" });
    const throwing = createLogger(() => {
      throw new Error("sink down");
    });
    expect(() => throwing.error("x")).not.toThrow();
  });
});
