import { describe, expect, it, vi } from "vitest";
import { seededDb, NOW } from "../../lib/connectors/__tests__/helpers";
import { upsertConnector } from "../../lib/connectors/store";
import { CATALOG_SPEC_BY_ID } from "../../lib/runtime/catalog-specs";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { setEnabled } from "../../lib/runtime/versioning";
import { StaticAccountsSource } from "../accounts";
import { runDatasetSyncTick } from "../datasets";
import { createLogger, memorySink } from "../log";

async function setup() {
  const { db, accountId: blocked } = seededDb();
  db.userId = "second-owner";
  const healthy = db.rpcs.create_account({ p_name: "Second synthetic client", p_currency: "NZD" }) as string;
  const store = new MemoryStore();
  for (const accountId of [blocked, healthy]) {
    await setEnabled({ store }, accountId, "D02-W01", true);
    const state = (await store.getRoutineState(accountId, "D02-W01"))!;
    await store.putRoutineState({ ...state, liveSpec: { ...CATALOG_SPEC_BY_ID["D02-W01"], nodes: [
      { kind: "read", id: "insights", as: "insights", source: "meta_ads", query: { resource: "insights", window: "7d" } },
    ] } });
  }
  await upsertConnector(db, healthy, "meta_ads", { status: "connected", external_ref: "act_healthy" });
  // Orchestration-only lease/commit stubs. Actual fencing SQL has separate PG tests.
  db.rpcs.claim_backend_lease = () => true;
  db.rpcs.commit_dataset_sync = args => {
    db.insertRow("account_dataset_snapshots", { ...(args.p_snapshot as Record<string, unknown>), stored_at: NOW.toISOString() });
    return NOW.toISOString();
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }));
  const credentials = { get: vi.fn(async (accountId: string) => {
    if (accountId !== healthy) throw new Error("must not resolve another tenant's credentials");
    return { kind: "meta_ads" as const, adAccountId: "act_healthy", accessToken: "synthetic-only" };
  }) };
  const { sink, entries } = memorySink();
  const deps = { db, store, fetch, credentials, now: () => NOW, log: createLogger(sink),
    accounts: new StaticAccountsSource([blocked, healthy].map(accountId => ({ account: { accountId, contextGeneration: 0, currency: "NZD", budgetMonthly: 0 } }))) };
  const env = { UNC_DATA_SYNC_ENABLED: "true", UNC_DATA_SYNC_ACCOUNTS: `${blocked},${healthy}` };
  return { db, blocked, healthy, deps, env, fetch, credentials, entries };
}

describe("dataset refresh isolates incomplete client setup", () => {
  it.each(["missing", "unselected", "needs_reconnect"])("moves past %s connection without a credential/provider call for that tenant", async status => {
    const h = await setup();
    if (status !== "missing") await upsertConnector(h.db, h.blocked, "meta_ads", { status: status === "unselected" ? "connected" : "needs_reconnect", external_ref: status === "unselected" ? null : "act_blocked" });
    expect(await runDatasetSyncTick(h.deps, h.env)).toEqual({ synced: 1, failed: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.credentials.get.mock.calls.map(c => c[0])).toEqual([h.healthy]);
    expect(h.db.rows("account_dataset_snapshots").map(r => r.account_id)).toEqual([h.healthy]);
    // A new invocation reuses the healthy snapshot without new provider calls.
    expect(await runDatasetSyncTick({ ...h.deps }, h.env)).toEqual({ synced: 0, failed: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.entries.some(e => e.event === "dataset.connection_unavailable")).toBe(true);
  });
  it("does not use a healthy but non-admitted client as fallback", async () => {
    const h = await setup();
    expect(await runDatasetSyncTick(h.deps, { ...h.env, UNC_DATA_SYNC_ACCOUNTS: h.blocked })).toEqual({ synced: 0, failed: 1 });
    expect(h.credentials.get).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.db.rows("account_dataset_snapshots")).toEqual([]);
  });
  it("still stops after one actual provider failure, without calling the next client", async () => {
    const h = await setup();
    await upsertConnector(h.db, h.blocked, "meta_ads", { status: "connected", external_ref: "act_blocked" });
    h.credentials.get.mockImplementation(async accountId => ({ kind: "meta_ads", adAccountId: accountId === h.blocked ? "act_blocked" : "act_healthy", accessToken: "synthetic-only" }));
    h.fetch.mockRejectedValue(new Error("synthetic provider outage"));
    expect(await runDatasetSyncTick(h.deps, h.env)).toEqual({ synced: 0, failed: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.credentials.get.mock.calls.map(c => c[0])).toEqual([h.blocked]);
    expect(h.db.rows("account_dataset_snapshots")).toEqual([]);
  });
});
