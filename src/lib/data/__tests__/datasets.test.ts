import { beforeEach, describe, expect, it, vi } from "vitest";
import { seededDb, NOW } from "../../connectors/__tests__/helpers";
import { upsertConnector } from "../../connectors/store";
import type { ConnectorReader, ReadQuery, ReadResult, RunContext } from "../../runtime/types";
import { accountDataReader, datasetQueryHash, DbDatasetStore, StoredDatasetReader, storedDataEnabled, syncDataset, type DatasetIdentity, type DatasetSnapshot, type DatasetStore } from "../datasets";

const query: ReadQuery = { resource: "insights", window: "7d", fields: ["spend", "roas"] };
const identity: DatasetIdentity = { accountId: "account-a", connectorId: "connector-a", externalRef: "act_123", platform: "meta_ads" };
const result: ReadResult = { rows: [{ spend: 17 }], metrics: { spend: 17 }, fetchedAt: NOW.toISOString(), provenance: "ok", sourceNote: "complete read" };
const ctx: RunContext = { account: { accountId: identity.accountId, currency: "NZD", budgetMonthly: 0 }, runId: "test", routineId: "D02-W01", version: 1, mode: "dry_run", startedAt: NOW.toISOString(), caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, reads: {}, checks: {} };
function memoryStore(over: Partial<DatasetSnapshot> = {}): DatasetStore {
  const snapshot: DatasetSnapshot = { id: "snapshot-1", identity, result, queryHash: datasetQueryHash(query, NOW), storedAt: NOW.toISOString(), ...over };
  return { connection: async () => identity, latest: async () => snapshot, save: vi.fn() };
}

describe("exact reporting snapshots", () => {
  it("canonicalizes property order and requested field order, not reporting grain", () => {
    expect(datasetQueryHash(query, NOW)).toBe(datasetQueryHash({ fields: ["roas", "spend", "spend"], window: "7d", resource: "insights" }, NOW));
    for (const other of [{ ...query, window: "1d" }, { ...query, filter: { level: "ad" } }, { ...query, limit: 1 }, { ...query, groupBy: ["campaign_id"] }]) expect(datasetQueryHash(query, NOW)).not.toBe(datasetQueryHash(other, NOW));
    expect(datasetQueryHash(query, NOW)).not.toBe(datasetQueryHash(query, new Date(NOW.getTime() + 86_400_000)));
  });
  it("requires an explicit account and supported platform", () => {
    const env = { UNC_STORED_DATA_ACCOUNTS: " account-a, account-b " };
    expect(storedDataEnabled("account-a", "meta_ads", env)).toBe(true);
    expect(storedDataEnabled("account-c", "meta_ads", env)).toBe(false);
    expect(storedDataEnabled("account-a", "shopify", env)).toBe(false);
  });
  it("serves persisted source timestamps and receipt references after reader recreation", async () => {
    const store = memoryStore();
    for (let i = 0; i < 2; i++) expect(await new StoredDatasetReader(store, () => NOW).read("meta_ads", query, ctx)).toEqual({ ...result, dataset: { id: "snapshot-1", servedFrom: "stored", storedAt: NOW.toISOString() } });
  });
  it.each(["accountId", "connectorId", "externalRef", "platform"] as const)("rejects mismatched %s", async key => {
    const store = memoryStore({ identity: { ...identity, [key]: "another" } as DatasetIdentity });
    await expect(new StoredDatasetReader(store, () => NOW).read("meta_ads", query, ctx)).rejects.toThrow("identity or query mismatch");
  });
  it("rejects a different stored query even if the store returned it", async () => {
    await expect(new StoredDatasetReader(memoryStore({ queryHash: "wrong" }), () => NOW).read("meta_ads", query, ctx)).rejects.toThrow("identity or query mismatch");
  });
  it.each(["not-a-date", new Date(NOW.getTime() - 3_600_001).toISOString(), new Date(NOW.getTime() + 30_001).toISOString()])("rejects invalid or stale source time %s", async fetchedAt => {
    await expect(new StoredDatasetReader(memoryStore({ result: { ...result, fetchedAt } }), () => NOW).read("meta_ads", query, ctx)).rejects.toThrow("source timestamp");
  });
  it("rejects fixture/error provenance and disconnected identities", async () => {
    const store = memoryStore({ result: { ...result, provenance: "fixture" } });
    await expect(new StoredDatasetReader(store, () => NOW).read("meta_ads", query, ctx)).rejects.toThrow("provenance");
    store.connection = async () => null;
    await expect(new StoredDatasetReader(store, () => NOW).read("meta_ads", query, ctx)).rejects.toThrow("identity is not verified");
  });
  it("does not fall back to API calls when stored data is opted in but unavailable", async () => {
    const direct: ConnectorReader = { read: vi.fn(async () => result) };
    const routed = accountDataReader(direct, null, { UNC_STORED_DATA_ACCOUNTS: identity.accountId });
    await expect(async () => routed.read("meta_ads", query, ctx)).rejects.toThrow("database is not configured");
    expect(direct.read).not.toHaveBeenCalled();
    expect(await accountDataReader(direct, null, {}).read("meta_ads", query, ctx)).toEqual(result);
  });
});

describe("database snapshot synchronization", () => {
  let seeded: ReturnType<typeof seededDb>;
  let run: RunContext;
  let direct: ConnectorReader;
  beforeEach(async () => {
    seeded = seededDb();
    await upsertConnector(seeded.db, seeded.accountId, "meta_ads", { status: "connected", external_ref: "act_123" });
    run = { ...ctx, account: { ...ctx.account, accountId: seeded.accountId } };
    direct = { read: vi.fn(async () => result) };
    seeded.db.rpcs.claim_backend_lease = () => true; // SQL locking verified separately in database canary.
  });
  it("persists a complete read and reuses it without another API call", async () => {
    expect(await syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).toBe("synced");
    expect(await syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).toBe("fresh");
    const stored = new StoredDatasetReader(new DbDatasetStore(seeded.db), () => NOW);
    expect(await stored.read("meta_ads", query, run)).toMatchObject({ metrics: result.metrics, fetchedAt: result.fetchedAt, dataset: { servedFrom: "stored" } });
    expect(direct.read).toHaveBeenCalledTimes(1);
    expect(seeded.db.rows("account_dataset_snapshots")).toHaveLength(1);
    await expect(stored.read("meta_ads", { ...query, window: "1d" }, run)).rejects.toThrow("has not synchronized");
  });
  it("does not fetch when another sync owns the lease", async () => {
    seeded.db.rpcs.claim_backend_lease = () => false;
    expect(await syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).toBe("busy");
    expect(direct.read).not.toHaveBeenCalled();
  });
  it("never persists failed/fixture reads and leaves the lease as a bounded cooldown", async () => {
    direct.read = vi.fn(async () => ({ ...result, provenance: "fixture" }));
    await expect(syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).rejects.toThrow("complete provider reads");
    expect(seeded.db.rows("account_dataset_snapshots")).toHaveLength(0);
    expect(seeded.db.callsFor("backend_leases", "delete")).toHaveLength(0);
  });
  it("rejects a connection changed while a request is in flight", async () => {
    direct.read = vi.fn(async () => {
      await upsertConnector(seeded.db, seeded.accountId, "meta_ads", { status: "connected", external_ref: "act_different" });
      return result;
    });
    await expect(syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).rejects.toThrow("changed during data sync");
    expect(seeded.db.rows("account_dataset_snapshots")).toHaveLength(0);
  });
});
