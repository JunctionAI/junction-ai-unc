import { afterEach, describe, expect, it, vi } from "vitest";
import { seededDb } from "../../lib/connectors/__tests__/helpers";
import { upsertConnector } from "../../lib/connectors/store";
import { CATALOG_SPEC_BY_ID } from "../../lib/runtime/catalog-specs";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { setEnabled } from "../../lib/runtime/versioning";
import type { RoutineSpec } from "../../lib/runtime/types";
import { StaticAccountsSource } from "../accounts";
import { Worker, type WorkerDeps } from "../loop";
import { createLogger, memorySink } from "../log";

afterEach(() => vi.unstubAllEnvs());

async function harness() {
  const { db, accountId } = seededDb();
  let time = new Date("2026-09-05T07:00:00Z");
  const now = () => time;
  vi.stubEnv("UNC_COMMANDS_ENABLED", "false");
  vi.stubEnv("UNC_MESSAGING_ENABLED", "false");
  vi.stubEnv("UNC_DATA_SYNC_ENABLED", "true");
  vi.stubEnv("UNC_DATA_SYNC_ACCOUNTS", accountId);
  vi.stubEnv("UNC_STORED_DATA_ACCOUNTS", accountId);
  await upsertConnector(db, accountId, "meta_ads", { status: "connected", external_ref: "act_123" });
  const store = new MemoryStore();
  const spec: RoutineSpec = { ...CATALOG_SPEC_BY_ID["D02-W01"], mutates: false, nodes: [
    { kind: "trigger", id: "trigger", cadence: "0 7 * * *" },
    { kind: "read", id: "insights", source: "meta_ads", as: "insights", query: { resource: "insights", window: "7d" } },
    { kind: "read", id: "budgets", source: "meta_ads", as: "budgets", query: { resource: "adsets" } },
    { kind: "receipt", id: "receipt", summary: "Synthetic dataset scheduling check; no external action." },
  ] };
  await setEnabled({ store, now }, accountId, spec.id, true);
  const state = (await store.getRoutineState(accountId, spec.id))!;
  await store.putRoutineState({ ...state, liveSpec: spec });
  // These RPC stubs model storage/leases for orchestration tests only. Real SQL
  // completion fencing is covered separately by verify-dataset-sync-fence.mjs.
  db.rpcs.claim_backend_lease = () => true;
  db.rpcs.commit_dataset_sync = args => {
    db.insertRow("account_dataset_snapshots", { ...(args.p_snapshot as Record<string, unknown>), stored_at: now().toISOString() });
    return now().toISOString();
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
  const credentials = { get: vi.fn(async () => ({ kind: "meta_ads" as const, adAccountId: "act_123", accessToken: "synthetic-test-only" })) };
  const { sink, entries } = memorySink();
  const deps: WorkerDeps = { db, store, now, fetch, credentials, producer: null, n8n: null, presets: null,
    accounts: new StaticAccountsSource([{ account: { accountId, contextGeneration: 0, currency: "NZD", budgetMonthly: 0 } }]),
    log: createLogger(sink, {}, now) };
  const worker = () => new Worker(deps, { jobs: false, briefs: false, heartbeatPath: null, handleSignals: false });
  return { db, accountId, store, deps, worker, fetch, credentials, entries, spec, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}

describe("scheduled consumers wait for independent stored-data refresh", () => {
  it("warms two required queries across ticks, then serves one run after restart without extra provider reads", async () => {
    const h = await harness();
    const first = await h.worker().tick();
    expect(first.started).toHaveLength(0);
    expect(first).toMatchObject({ dataDeferred: 1, datasets: { synced: 1, failed: 0 } });
    expect(await h.store.listRuns(h.accountId)).toHaveLength(0);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    h.advance(60_000);
    const second = await h.worker().tick();
    expect(second.started).toHaveLength(1);
    expect(second.started[0].status).toBe("done");
    expect(h.fetch).toHaveBeenCalledTimes(2);
    const reads = (await h.store.listReceipts(h.accountId)).filter(r => r.kind === "read");
    expect(reads).toHaveLength(2);
    expect(reads.every(r => JSON.stringify(r.payload).includes('"servedFrom":"stored"'))).toBe(true);
    h.advance(60_000);
    expect((await h.worker().tick()).started).toHaveLength(0);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(await h.store.listRuns(h.accountId)).toHaveLength(1);
    // Refresh proceeds after the routine has served its slot, across newly
    // constructed workers, without dispatching it again.
    h.advance(14 * 60_000);
    expect((await h.worker().tick()).datasets).toEqual({ synced: 1, failed: 0 });
    h.advance(60_000);
    expect((await h.worker().tick()).datasets).toEqual({ synced: 1, failed: 0 });
    expect(h.fetch).toHaveBeenCalledTimes(4);
    expect(await h.store.listRuns(h.accountId)).toHaveLength(1);
    expect(h.db.rows("account_dataset_snapshots")).toHaveLength(4);
  });

  it("does not consume the cron slot or fall back to provider reads when the producer fails", async () => {
    const h = await harness();
    h.fetch.mockRejectedValue(new Error("synthetic outage"));
    const report = await h.worker().tick();
    expect(report).toMatchObject({ started: [], dataDeferred: 1, datasets: { synced: 0, failed: 1 } });
    expect(await h.store.listRuns(h.accountId)).toHaveLength(0);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("defers instead of starting a run when required dataset metadata cannot be inspected", async () => {
    const h = await harness();
    h.deps.db = null;
    const report = await h.worker().tick();
    expect(report).toMatchObject({ started: [], dataDeferred: 1 });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(await h.store.listRuns(h.accountId)).toHaveLength(0);
    expect(h.entries.some(e => e.event === "dataset.readiness_failed")).toBe(true);
  });

  it("stops warming and leaves no scheduled run when the only routine is switched off while waiting", async () => {
    const h = await harness();
    await h.worker().tick();
    await setEnabled({ store: h.store }, h.accountId, h.spec.id, false);
    h.advance(60_000);
    expect((await h.worker().tick()).started).toHaveLength(0);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(await h.store.listRuns(h.accountId)).toHaveLength(0);
  });

  it("leaves non-opted-in direct readers on their existing path", async () => {
    const h = await harness();
    vi.stubEnv("UNC_DATA_SYNC_ENABLED", "false");
    vi.stubEnv("UNC_STORED_DATA_ACCOUNTS", "");
    const report = await h.worker().tick();
    expect(report.dataDeferred).toBe(0);
    expect(report.started[0].status).toBe("done");
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.db.rows("account_dataset_snapshots")).toHaveLength(0);
  });

  it("keeps optional unavailable reads optional rather than blocking the routine", async () => {
    const h = await harness();
    vi.stubEnv("UNC_DATA_SYNC_ENABLED", "false");
    const state = (await h.store.getRoutineState(h.accountId, h.spec.id))!;
    await h.store.putRoutineState({ ...state, liveSpec: { ...h.spec,
      nodes: h.spec.nodes.map(n => n.kind === "read" ? { ...n, optional: true } : n) } });
    const report = await h.worker().tick();
    expect(report.dataDeferred).toBe(0);
    expect(report.started[0].status).toBe("done");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refreshes to a stricter consumer freshness limit rather than waiting the default fifteen minutes", async () => {
    const h = await harness();
    await h.worker().tick();
    h.advance(60_000);
    await h.worker().tick();
    const state = (await h.store.getRoutineState(h.accountId, h.spec.id))!;
    await h.store.putRoutineState({ ...state, liveSpec: { ...h.spec,
      nodes: h.spec.nodes.map(n => n.kind === "read" ? { ...n, freshnessMinutes: 2 } : n) } });
    h.advance(2 * 60_000);
    expect((await h.worker().tick()).datasets?.synced).toBe(1);
    expect(h.fetch).toHaveBeenCalledTimes(3);
  });
});
