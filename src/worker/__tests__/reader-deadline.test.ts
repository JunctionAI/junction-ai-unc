import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerConnectorReader } from "../providers/connectorReader";
import type { RunContext } from "../../lib/runtime/types";
import { fetchJson } from "../readers/http";
import { seededDb } from "../../lib/connectors/__tests__/helpers";
import { upsertConnector } from "../../lib/connectors/store";
import { syncDataset } from "../../lib/data/datasets";
import { createServer } from "node:http";

const credential = { kind: "meta_ads" as const, adAccountId: "act_test", accessToken: "private-test-token" };
const context: RunContext = { runId: "deadline-test", routineId: "D02-W01", version: 1, mode: "dry_run",
  startedAt: "2026-09-05T07:00:00Z", account: { accountId: "synthetic", currency: "NZD", budgetMonthly: 0 },
  caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "schedule", vars: {}, reads: {}, checks: {} };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const outcome = <T>(promise: Promise<T>) => promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
beforeEach(() => vi.useFakeTimers({ now: new Date(context.startedAt) }));
afterEach(() => vi.useRealTimers());

describe("whole provider-read deadline", () => {
  it("does not reset the total deadline for every Meta page or accept partial data", async () => {
    let pages = 0;
    const signals: AbortSignal[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      signals.push(init!.signal!);
      await delay(10); // Deliberately non-cooperative transport; the wrapper still refuses late output.
      pages++;
      return Response.json({ data: [{ spend: "1", actions: [] }], ...(pages < 5 ? { paging: { next: "not-followed", cursors: { after: String(pages) } } } : {}) });
    });
    const reader = new WorkerConnectorReader({ credentials: { get: async () => credential }, fetch, timeoutMs: 100, totalTimeoutMs: 25 });
    const result = outcome(reader.read("meta_ads", { resource: "insights" }, context));
    await vi.advanceTimersByTimeAsync(60);
    const settled = await result;
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.error.message).toContain("total read timeout");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(signals[2].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out credential resolution and never starts a late provider call", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
    const reader = new WorkerConnectorReader({ credentials: { get: async () => { await delay(50); return credential; } }, fetch, totalTimeoutMs: 20 });
    const result = outcome(reader.read("meta_ads", { resource: "insights" }, context));
    await vi.advanceTimersByTimeAsync(25);
    expect((await result).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not accept a body arriving after timeout even when the custom body reader ignores abort", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => ({ ok: true, status: 200, headers: new Headers(),
      json: async () => { await delay(50); return { data: [] }; } }) as Response);
    const reader = new WorkerConnectorReader({ credentials: { get: async () => credential }, fetch, totalTimeoutMs: 20 });
    const result = outcome(reader.read("meta_ads", { resource: "insights" }, context));
    await vi.advanceTimersByTimeAsync(25);
    expect((await result).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans up successful reads without leaking credentials into the outcome", async () => {
    const reader = new WorkerConnectorReader({ credentials: { get: async () => credential }, fetch: async () => Response.json({ data: [] }), totalTimeoutMs: 20 });
    const result = await reader.read("meta_ads", { resource: "insights" }, context);
    expect(result.provenance).toBe("empty");
    expect(JSON.stringify(result)).not.toContain(credential.accessToken);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves an already-aborted request signal instead of starting a fetch", async () => {
    const controller = new AbortController(); controller.abort();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
    const result = await fetchJson("https://example.test/read?private=secret", { signal: controller.signal }, { fetch });
    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("does not commit a dataset after a timed-out read eventually completes", async () => {
    const { db, accountId } = seededDb();
    await upsertConnector(db, accountId, "meta_ads", { status: "connected", external_ref: credential.adAccountId });
    db.rpcs.claim_backend_lease = () => true;
    const commit = vi.fn(() => new Date().toISOString()); db.rpcs.commit_dataset_sync = commit;
    const reader = new WorkerConnectorReader({ credentials: { get: async () => credential }, totalTimeoutMs: 20,
      fetch: async () => { await delay(50); return Response.json({ data: [] }); } });
    const result = outcome(syncDataset(db, reader, "meta_ads", { resource: "insights" }, { ...context, account: { ...context.account, accountId } }));
    await vi.advanceTimersByTimeAsync(25);
    expect((await result).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(commit).not.toHaveBeenCalled();
    expect(db.rows("account_dataset_snapshots")).toEqual([]);
    expect(db.calls.filter(c => c.table === "backend_leases" && c.op === "delete")).toEqual([]);
  });
  it("includes the final credential validation in the deadline", async () => {
    let validations = 0;
    const validate = vi.fn(async () => { if (++validations === 4) await delay(50); });
    const reader = new WorkerConnectorReader({ credentials: { get: async () => credential, validate }, totalTimeoutMs: 20,
      fetch: async () => Response.json({ data: [] }) });
    const result = outcome(reader.read("meta_ads", { resource: "insights" }, context));
    await vi.advanceTimersByTimeAsync(25);
    expect((await result).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(validations).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses a late result even if synchronous parsing delayed the timer callback", async () => {
    const reader = new WorkerConnectorReader({ credentials: { get: async () => credential }, totalTimeoutMs: 20,
      fetch: async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => {
        vi.setSystemTime(Date.now() + 50); // Advances the clock without firing timer callbacks.
        return { data: [] };
      } }) as Response });
    await expect(reader.read("meta_ads", { resource: "insights" }, context)).rejects.toThrow("total read timeout");
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, -1, NaN, Infinity, 2_147_483_648])("rejects invalid total limit %s before resolving credentials", async totalTimeoutMs => {
    const get = vi.fn(async () => credential);
    await expect(new WorkerConnectorReader({ credentials: { get }, totalTimeoutMs }).read("meta_ads", { resource: "insights" }, context)).rejects.toThrow("invalid total read timeout");
    expect(get).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a real native HTTP body read, not just a synthetic promise", async () => {
    vi.useRealTimers();
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    let received = 0;
    const server = createServer((_request, response) => {
      received++;
      response.writeHead(200, { "content-type": "application/json" }); response.write('{"data":');
      bodyTimer = setTimeout(() => response.end('[]}'), 2000);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server unavailable");
      const signals: AbortSignal[] = [];
      const reader = new WorkerConnectorReader({ credentials: { get: async () => credential }, totalTimeoutMs: 150,
        fetch: (_url, init) => { signals.push(init!.signal!); return globalThis.fetch(`http://127.0.0.1:${address.port}/slow-body`, { signal: init?.signal }); } });
      await expect(reader.read("meta_ads", { resource: "insights" }, context)).rejects.toThrow("total read timeout");
      expect(received).toBe(1);
      expect(signals[0].aborted).toBe(true);
    } finally {
      clearTimeout(bodyTimer); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
