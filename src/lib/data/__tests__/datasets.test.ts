import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { META_BUDGET_CONTRACT, metaBudgetMetrics } from "../metaBudgets";
import { seededDb, NOW } from "../../connectors/__tests__/helpers";
import { upsertConnector } from "../../connectors/store";
import type { ConnectorReader, ReadQuery, ReadResult, RunContext } from "../../runtime/types";
import { accountDataReader, datasetQueryHash, datasetSyncEnabled, DbDatasetStore, StoredDatasetReader, storedDataEnabled, syncDataset, type DatasetIdentity, type DatasetSnapshot, type DatasetStore } from "../datasets";

const query: ReadQuery = { resource: "insights", window: "7d", fields: ["spend", "roas"] };
const identity: DatasetIdentity = { accountId: "account-a", connectorId: "connector-a", externalRef: "act_123", platform: "meta_ads" };
const result: ReadResult = { rows: [{ spend: 17 }], metrics: { spend: 17 }, fetchedAt: NOW.toISOString(), provenance: "ok", sourceNote: "complete read" };
const ctx: RunContext = { account: { accountId: identity.accountId, currency: "NZD", budgetMonthly: 0 }, runId: "test", routineId: "D02-W01", version: 1, mode: "dry_run", startedAt: NOW.toISOString(), caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, reads: {}, checks: {} };
function memoryStore(over: Partial<DatasetSnapshot> = {}): DatasetStore {
  const snapshot: DatasetSnapshot = { id: "snapshot-1", identity, result, queryHash: datasetQueryHash(query, NOW), storedAt: NOW.toISOString(), ...over };
  return { connection: async () => identity, latest: async () => snapshot, save: vi.fn() };
}

describe("exact reporting snapshots", () => {
  it("versions Meta budget normalization without invalidating unrelated insights", () => {
    const budgetQuery = { resource: "adsets" };
    const legacyHash = createHash("sha256").update(JSON.stringify({ day: NOW.toISOString().slice(0, 10), query: budgetQuery, version: 1 })).digest("hex");
    expect(datasetQueryHash(budgetQuery, NOW)).not.toBe(legacyHash);
    expect(datasetQueryHash(budgetQuery, NOW, "shopify")).toBe(legacyHash);
    expect(datasetQueryHash(query, NOW, "meta_ads")).toBe(datasetQueryHash(query, NOW, "shopify"));
  });
  it("will not serve legacy budget metrics even if they are placed under a current hash", async () => {
    const budgetQuery = { resource: "adsets" };
    const s = memoryStore({ queryHash: datasetQueryHash(budgetQuery, NOW), result: { ...result, metrics: { daily_budget_total: 173.67 } } });
    await expect(new StoredDatasetReader(s, () => NOW).read("meta_ads", budgetQuery, ctx)).rejects.toThrow("normalization contract");
  });
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
  it("separates warming and reader cutover in both directions", () => {
    const warming = { UNC_DATA_SYNC_ENABLED: "true", UNC_DATA_SYNC_ACCOUNTS: " account-a,account-b " };
    expect(datasetSyncEnabled("account-a", "meta_ads", warming)).toBe(true);
    expect(storedDataEnabled("account-a", "meta_ads", warming)).toBe(false);
    expect(datasetSyncEnabled("account-c", "meta_ads", warming)).toBe(false);
    expect(datasetSyncEnabled("account-a", "shopify", warming)).toBe(false);
    expect(datasetSyncEnabled("account-a", "meta_ads", { ...warming, UNC_DATA_SYNC_ENABLED: "false" })).toBe(false);
    expect(datasetSyncEnabled("account-a", "meta_ads", { UNC_DATA_SYNC_ENABLED: "true", UNC_STORED_DATA_ACCOUNTS: "account-a" })).toBe(false);
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
    seeded.db.rpcs.commit_dataset_sync = args => {
      seeded.db.insertRow("account_dataset_snapshots", { ...(args.p_snapshot as Record<string, unknown>), stored_at: NOW.toISOString() });
      return NOW.toISOString();
    }; // Call-shape stub only; actual fencing and concurrency tested in PostgreSQL.
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
  it.each([-1, NaN, Infinity, 900_001])("rejects invalid refresh interval %s before claiming or fetching", async refreshAfterMs => {
    const claim = vi.fn(seeded.db.rpcs.claim_backend_lease);
    seeded.db.rpcs.claim_backend_lease = claim;
    await expect(syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW, refreshAfterMs)).rejects.toThrow("refresh interval");
    expect(claim).not.toHaveBeenCalled();
    expect(direct.read).not.toHaveBeenCalled();
  });
  it("commits with the exact claimed holder and captured context, without a direct insert", async () => {
    let holder: unknown;
    seeded.db.rpcs.claim_backend_lease = args => { holder = args.p_holder; return true; };
    const commit = vi.fn(seeded.db.rpcs.commit_dataset_sync);
    seeded.db.rpcs.commit_dataset_sync = commit;
    run.account.contextGeneration = 7;
    expect(await syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).toBe("synced");
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ p_holder: holder, p_context_generation: 7,
      p_snapshot: expect.objectContaining({ account_id: seeded.accountId, query_hash: datasetQueryHash(query, NOW), source_fetched_at: result.fetchedAt }) }));
    expect(seeded.db.callsFor("account_dataset_snapshots", "insert")).toHaveLength(0);
    expect(seeded.db.callsFor("backend_leases", "delete")).toHaveLength(0);
  });
  it("does not accept a lost lease or revoked context, and never releases a successor", async () => {
    seeded.db.rpcs.commit_dataset_sync = () => null;
    await expect(syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).rejects.toThrow("completion refused");
    expect(seeded.db.rows("account_dataset_snapshots")).toHaveLength(0);
    expect(seeded.db.callsFor("backend_leases", "delete")).toHaveLength(0);
    expect(direct.read).toHaveBeenCalledTimes(1);
  });
  it("fails closed if the new database RPC is unavailable, without direct-insert fallback", async () => {
    seeded.db.rpcs.commit_dataset_sync = () => { throw new Error("RPC unavailable"); };
    await expect(syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).rejects.toThrow("RPC unavailable");
    expect(seeded.db.callsFor("account_dataset_snapshots", "insert")).toHaveLength(0);
    expect(seeded.db.callsFor("backend_leases", "delete")).toHaveLength(0);
  });
  it("uses the server's storage timestamp, not the caller's clock", async () => {
    const store = new DbDatasetStore(seeded.db);
    const id = (await store.connection(seeded.accountId, "meta_ads"))!;
    const serverTime = new Date(NOW.getTime() + 2000).toISOString();
    seeded.db.rpcs.commit_dataset_sync = () => serverTime;
    expect(await store.save(id, query, datasetQueryHash(query, NOW), result, NOW, { holder: "holder", contextGeneration: 0 }))
      .toMatchObject({ storedAt: serverTime, result: { fetchedAt: result.fetchedAt } });
  });
  it.each([-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid captured generation %s", async contextGeneration => {
    const store = new DbDatasetStore(seeded.db);
    const id = (await store.connection(seeded.accountId, "meta_ads"))!;
    const commit = vi.fn(seeded.db.rpcs.commit_dataset_sync);
    seeded.db.rpcs.commit_dataset_sync = commit;
    await expect(store.save(id, query, datasetQueryHash(query, NOW), result, NOW, { holder: "holder", contextGeneration })).rejects.toThrow("captured context");
    expect(commit).not.toHaveBeenCalled();
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
  it.each(["fixture", "error"])("does not reuse recent %s data as fresh", async provenance => {
    const store = new DbDatasetStore(seeded.db);
    const id = (await store.connection(seeded.accountId, "meta_ads"))!;
    seeded.db.insertRow("account_dataset_snapshots", { id: "bad", account_id: id.accountId, connector_id: id.connectorId,
      external_ref: id.externalRef, platform: id.platform, query_hash: datasetQueryHash(query, NOW),
      result: { ...result, provenance }, source_fetched_at: NOW.toISOString(), stored_at: NOW.toISOString() });
    expect(await syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).toBe("synced");
    expect(direct.read).toHaveBeenCalledTimes(1);
  });
  it.each([new Date(NOW.getTime() - 3_600_001).toISOString(), new Date(NOW.getTime() + 30_001).toISOString()])("does not store out-of-policy observation %s", async fetchedAt => {
    direct.read = vi.fn(async () => ({ ...result, fetchedAt }));
    await expect(syncDataset(seeded.db, direct, "meta_ads", query, run, () => NOW)).rejects.toThrow("source timestamp");
    expect(seeded.db.rows("account_dataset_snapshots")).toHaveLength(0);
  });
  it("does not mislabel a provider query crossing UTC midnight", async () => {
    let time = new Date("2026-09-02T23:59:59Z");
    direct.read = vi.fn(async () => {
      time = new Date("2026-09-03T00:00:01Z");
      return { ...result, fetchedAt: time.toISOString() };
    });
    await expect(syncDataset(seeded.db, direct, "meta_ads", query, run, () => time)).rejects.toThrow("reporting day changed");
    expect(seeded.db.rows("account_dataset_snapshots")).toHaveLength(0);
  });
  it("requires current budget normalization at persistence and does not reuse a malformed legacy row", async () => {
    const budgetQuery = { resource: "adsets" };
    const store = new DbDatasetStore(seeded.db);
    const id = (await store.connection(seeded.accountId, "meta_ads"))!;
    await expect(store.save(id, budgetQuery, datasetQueryHash(budgetQuery, NOW), result, NOW, { holder: "holder", contextGeneration: 0 })).rejects.toThrow("normalization contract");
    seeded.db.insertRow("account_dataset_snapshots", { id: "legacy", account_id: id.accountId, connector_id: id.connectorId,
      external_ref: id.externalRef, platform: id.platform, query_hash: datasetQueryHash(budgetQuery, NOW), result,
      source_fetched_at: NOW.toISOString(), stored_at: NOW.toISOString() });
    direct.read = vi.fn(async () => ({ ...result, rows: [], metrics: metaBudgetMetrics("adsets", []) }));
    expect(await syncDataset(seeded.db, direct, "meta_ads", budgetQuery, run, () => NOW)).toBe("synced");
    expect(direct.read).toHaveBeenCalledTimes(1);
    expect(seeded.db.rows("account_dataset_snapshots").at(-1)?.result).toMatchObject({ metrics: { budget_metric_contract: META_BUDGET_CONTRACT } });
  });
});
