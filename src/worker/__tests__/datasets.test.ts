import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { setEnabled } from "../../lib/runtime/versioning";
import { FakeSupabase } from "../../lib/db/__tests__/fakeSupabase";
import { StaticAccountsSource, DEMO_ACCOUNT } from "../accounts";
import { FixtureCredentialProvider } from "../credentials";
import { syncDataset } from "../../lib/data/datasets";
import { runDatasetSyncTick } from "../datasets";
vi.mock("../../lib/data/datasets", async importOriginal => ({ ...await importOriginal<typeof import("../../lib/data/datasets")>(), syncDataset: vi.fn() }));
const env = { UNC_DATA_SYNC_ENABLED: "true", UNC_STORED_DATA_ACCOUNTS: "demo" };
const now = () => new Date("2026-09-05T01:00:00Z");
function deps() { return { store: new MemoryStore(), db: new FakeSupabase(), accounts: new StaticAccountsSource(), credentials: new FixtureCredentialProvider(), now }; }
beforeEach(() => { vi.mocked(syncDataset).mockReset(); });

describe("bounded dataset background job", () => {
  it("is inert without both flags and enabled routines", async () => {
    const d = deps();
    await runDatasetSyncTick(d, {});
    await runDatasetSyncTick(d, { ...env, UNC_STORED_DATA_ACCOUNTS: "another" });
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
});
