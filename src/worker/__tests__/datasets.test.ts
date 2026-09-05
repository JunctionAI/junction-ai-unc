import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { setEnabled } from "../../lib/runtime/versioning";
import { FakeSupabase } from "../../lib/db/__tests__/fakeSupabase";
import { StaticAccountsSource, DEMO_ACCOUNT } from "../accounts";
import { FixtureCredentialProvider } from "../credentials";
import { syncDataset } from "../../lib/data/datasets";
import { inspectAccountDatasets, runDatasetSyncTick } from "../datasets";
import { CATALOG_SPEC_BY_ID } from "../../lib/runtime/catalog-specs";
vi.mock("../../lib/data/datasets", async importOriginal => ({ ...await importOriginal<typeof import("../../lib/data/datasets")>(), syncDataset: vi.fn() }));
const env = { UNC_DATA_SYNC_ENABLED: "true", UNC_DATA_SYNC_ACCOUNTS: "demo" };
const now = () => new Date("2026-09-05T01:00:00Z");
function deps() { return { store: new MemoryStore(), db: new FakeSupabase(), accounts: new StaticAccountsSource(), credentials: new FixtureCredentialProvider(), now }; }
beforeEach(() => { vi.mocked(syncDataset).mockReset(); });

describe("bounded dataset background job", () => {
  it("is inert without both flags and enabled routines", async () => {
    const d = deps();
    await runDatasetSyncTick(d, {});
    await runDatasetSyncTick(d, { ...env, UNC_DATA_SYNC_ACCOUNTS: "another" });
    await runDatasetSyncTick(d, env);
    expect(syncDataset).not.toHaveBeenCalled();
  });
  it("does not let a reader cutover authorize provider sync", async () => {
    const d = deps();
    await setEnabled(d, "demo", "D02-W01", true);
    await runDatasetSyncTick(d, { UNC_DATA_SYNC_ENABLED: "true", UNC_STORED_DATA_ACCOUNTS: "demo" });
    expect(syncDataset).not.toHaveBeenCalled();
  });
  it("does not sync a paused account even when an accounts source includes it", async () => {
    const d = deps();
    d.accounts = new StaticAccountsSource([{ ...DEMO_ACCOUNT, automationPaused: true }]);
    await setEnabled(d, "demo", "D02-W01", true);
    await runDatasetSyncTick(d, env);
    expect(syncDataset).not.toHaveBeenCalled();
  });
  it("syncs only an enabled routine's query, without dispatching that routine", async () => {
    const d = deps();
    await setEnabled(d, DEMO_ACCOUNT.account.accountId, "D02-W01", true);
    vi.mocked(syncDataset).mockResolvedValue("synced");
    expect(await runDatasetSyncTick(d, env)).toEqual({ synced: 1, failed: 0 });
    expect(syncDataset).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncDataset).mock.calls[0][3]).toMatchObject({ resource: "insights", filter: { level: "adset" } });
  });
  it("moves past a busy query but stops after one actual synchronization", async () => {
    const d = deps();
    await setEnabled(d, "demo", "D02-W01", true);
    vi.mocked(syncDataset).mockResolvedValueOnce("busy").mockResolvedValueOnce("synced");
    expect(await runDatasetSyncTick(d, env)).toEqual({ synced: 1, failed: 0 });
    expect(vi.mocked(syncDataset).mock.calls[1][3].resource).toBe("adsets");
  });
  it("bounds failures rather than hammering every query in one tick", async () => {
    const d = deps();
    await setEnabled(d, "demo", "D02-W01", true);
    vi.mocked(syncDataset).mockRejectedValue(new Error("unavailable"));
    expect(await runDatasetSyncTick(d, env)).toEqual({ synced: 0, failed: 1 });
    expect(syncDataset).toHaveBeenCalledTimes(1);
  });
  it("deduplicates shared enabled demand using its strictest consumer refresh interval", async () => {
    const d = deps();
    for (const [id, freshnessMinutes] of [["D02-W01", 30], ["D02-W02", 2]] as const) {
      await setEnabled(d, "demo", id, true);
      const state = (await d.store.getRoutineState("demo", id))!;
      await d.store.putRoutineState({ ...state, liveSpec: { ...CATALOG_SPEC_BY_ID[id], nodes: [
        { kind: "read", id: "read", as: "stats", source: "meta_ads", query: { resource: "insights" }, freshnessMinutes },
      ] } });
    }
    vi.mocked(syncDataset).mockResolvedValue("fresh");
    await runDatasetSyncTick(d, env);
    expect(syncDataset).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncDataset).mock.calls[0][6]).toBe(120_000);
  });
});

describe("account dataset inspection", () => {
  it("does not make all-off accounts look ready", async () => {
    const d = deps();
    expect(await inspectAccountDatasets(d, "demo", undefined, env)).toMatchObject({ ready: false, queries: [], selection: "enabled", coverage: "meta_ads_and_klaviyo_campaigns" });
    expect(syncDataset).not.toHaveBeenCalled();
  });
  it("inspects proposed Meta demand while paused without changing any switch", async () => {
    const d = deps();
    d.accounts = new StaticAccountsSource([{ ...DEMO_ACCOUNT, automationPaused: true }]);
    const report = await inspectAccountDatasets(d, "demo", ["D02-W01"], env);
    expect(report).toMatchObject({ ready: false, accountPaused: true, selection: "proposed" });
    expect(report.queries.length).toBeGreaterThan(0);
    expect(report.queries.every(q => q.availability === "connection_unverified")).toBe(true);
    expect(await d.store.getRoutineState("demo", "D02-W01")).toBeNull();
    expect(syncDataset).not.toHaveBeenCalled();
  });
  it("refuses an unknown account or routine without a provider call", async () => {
    await expect(inspectAccountDatasets(deps(), "foreign", undefined, env)).rejects.toThrow("account unavailable");
    await expect(inspectAccountDatasets(deps(), "demo", ["D02-W99"], env)).rejects.toThrow("unknown proposed");
    expect(syncDataset).not.toHaveBeenCalled();
  });
  it("does not certify a report across a context reset", async () => {
    const d = deps();
    d.accounts.getAccount = vi.fn().mockResolvedValueOnce(DEMO_ACCOUNT).mockResolvedValueOnce({ ...DEMO_ACCOUNT, account: { ...DEMO_ACCOUNT.account, contextGeneration: 1 } });
    await expect(inspectAccountDatasets(d, "demo", undefined, env)).rejects.toThrow("business context changed");
  });
});
