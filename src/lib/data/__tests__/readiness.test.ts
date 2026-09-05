import { describe, expect, it, vi } from "vitest";
import { datasetQueryHash, type DatasetIdentity, type DatasetSnapshot, type DatasetStore } from "../datasets";
import { inspectDatasetReadiness, type DatasetRequirement } from "../readiness";

const time = new Date("2026-09-05T12:00:00Z");
const requirement: DatasetRequirement = { platform: "meta_ads", routineId: "D02-W01", query: { resource: "insights", window: "7d" } };
const identity: DatasetIdentity = { accountId: "account-a", connectorId: "meta-a", externalRef: "act_1", platform: "meta_ads" };
const snapshot: DatasetSnapshot = { id: "snapshot-a", identity, queryHash: datasetQueryHash(requirement.query, time), storedAt: time.toISOString(),
  result: { rows: [{ private: "not in report" }], metrics: { spend: 3 }, fetchedAt: time.toISOString(), provenance: "ok" } };
function store(value: DatasetSnapshot | null = snapshot): DatasetStore {
  return { connection: vi.fn(async () => identity), latest: vi.fn(async () => value), save: vi.fn() };
}
const env = { UNC_DATA_SYNC_ENABLED: "true", UNC_DATA_SYNC_ACCOUNTS: "account-a" };
const inspect = (s: DatasetStore, requirements = [requirement]) => inspectDatasetReadiness(s, "account-a", requirements, env, () => time);

describe("read-only dataset cutover coverage", () => {
  it("proves supplied coverage before reader cutover without exposing data or writing", async () => {
    const s = store();
    const report = await inspect(s);
    expect(report).toMatchObject({ ready: true, accountId: "account-a", checkedAt: time.toISOString(),
      queries: [{ availability: "ready", readerEnabled: false, syncAdmitted: true, snapshotId: "snapshot-a", sourceFetchedAt: time.toISOString() }] });
    expect(JSON.stringify(report)).not.toContain("not in report");
    expect(JSON.stringify(report)).not.toContain("spend");
    expect(s.save).not.toHaveBeenCalled();
  });
  it("deduplicates shared queries but retains all consumer routines", async () => {
    const s = store();
    const report = await inspect(s, [requirement, { ...requirement, routineId: "D02-W02" }, requirement]);
    expect(s.latest).toHaveBeenCalledTimes(1);
    expect(report.queries[0].routineIds).toEqual(["D02-W01", "D02-W02"]);
  });
  it("does not declare empty demand launch-ready", async () => {
    const s = store();
    expect(await inspect(s, [])).toMatchObject({ ready: false, queries: [] });
    expect(s.connection).not.toHaveBeenCalled();
  });
  it("does not certify a recent budget snapshot with an old normalization marker", async () => {
    const budget = { ...requirement, query: { resource: "adsets" } };
    const s = store({ ...snapshot, queryHash: datasetQueryHash(budget.query, time) });
    expect(await inspect(s, [budget])).toMatchObject({ ready: false, queries: [{ availability: "normalization_outdated" }] });
  });
  it.each(["missing", "unverified", "stale", "identity_mismatch"] as const)("reports %s as not ready", async availability => {
    const value = availability === "missing" ? null : availability === "unverified" ? { ...snapshot, result: { ...snapshot.result, provenance: "fixture" as const } } :
      availability === "stale" ? { ...snapshot, result: { ...snapshot.result, fetchedAt: "2026-09-05T10:00:00Z" } } :
        { ...snapshot, identity: { ...identity, accountId: "foreign" } };
    const report = await inspect(store(value));
    expect(report.ready).toBe(false);
    expect(report.queries[0].availability).toBe(availability);
    if (availability === "identity_mismatch") expect(report.queries[0]).toMatchObject({ snapshotId: null, storedAt: null, sourceFetchedAt: null });
  });
  it("does not treat selected asset absence as expired authorization", async () => {
    const s = store();
    s.connection = vi.fn(async () => null);
    expect(await inspect(s)).toMatchObject({ ready: false, queries: [{ availability: "connection_unverified" }] });
    expect(s.latest).not.toHaveBeenCalled();
  });
  it("fails on misbound connection identity before reading its metadata", async () => {
    const s = store();
    s.connection = vi.fn(async () => ({ ...identity, accountId: "foreign" }));
    await expect(inspect(s)).rejects.toThrow("connection identity mismatch");
    expect(s.latest).not.toHaveBeenCalled();
  });
  it("propagates database failures instead of reporting empty coverage", async () => {
    const s = store();
    s.latest = vi.fn(async () => { throw new Error("database unavailable"); });
    await expect(inspect(s)).rejects.toThrow("database unavailable");
  });
  it("refuses a reporting day change during inspection", async () => {
    const s = store();
    let clock = new Date("2026-09-05T23:59:59Z");
    s.latest = vi.fn(async () => { clock = new Date("2026-09-06T00:00:01Z"); return null; });
    await expect(inspectDatasetReadiness(s, "account-a", [requirement], env, () => clock)).rejects.toThrow("reporting day changed");
  });
  it("rechecks earlier observations at the end of a slow inspection", async () => {
    const s = store({ ...snapshot, result: { ...snapshot.result, fetchedAt: "2026-09-05T11:00:01Z" } });
    let clock = time;
    const firstRead = s.latest;
    s.latest = vi.fn(async (id, hash) => {
      if (hash !== snapshot.queryHash) clock = new Date("2026-09-05T12:00:02Z");
      return firstRead(id, hash);
    });
    const report = await inspectDatasetReadiness(s, "account-a", [requirement, { ...requirement, query: { resource: "adsets" } }], env, () => clock);
    expect(report.queries[0].availability).toBe("stale");
    expect(report.ready).toBe(false);
  });
});
