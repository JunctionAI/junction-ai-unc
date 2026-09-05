import { beforeEach, describe, expect, it, vi } from "vitest";
import { seededDb, deps as makeDeps, NOW } from "../../connectors/__tests__/helpers";
import { handleConnectorsState, type ConnectorsStateListing } from "../../connectors/state";
import { CATALOG_SPECS } from "../../runtime/catalog-specs";
import { connectionDataState } from "../connectionState";
import { datasetQueryHash } from "../datasets";

let h: ReturnType<typeof seededDb>;
const query = { resource: "insights", window: "7d" };
beforeEach(() => { h = seededDb(); h.db.rows("accounts")[0].automation_paused = false; });
function enable(id = "D02-W01", optional = false, freshnessMinutes = 60) {
  const catalog = CATALOG_SPECS.find(s => s.id === id)!;
  return h.db.insertRow("routine_states", { account_id: h.accountId, routine_id: id, enabled: true, version: 1,
    live_spec: { ...catalog, nodes: [{ id: "read", kind: "read", source: "meta_ads", query, optional, freshnessMinutes }] }, draft_spec: null });
}
function snapshot(fetchedAt = NOW.toISOString(), accountId = h.accountId) {
  const c = h.db.insertRow("connectors", { account_id: accountId, platform: "meta_ads", status: "connected", external_ref: "act_test", sync_ref: {} });
  return h.db.insertRow("account_dataset_snapshots", { account_id: accountId, connector_id: c.id, external_ref: "act_test", platform: "meta_ads",
    query_hash: datasetQueryHash(query, NOW), query, source_fetched_at: fetchedAt, stored_at: NOW.toISOString(),
    result: { rows: [{ email: "private@example.test" }], metrics: { privateMetric: 100 }, fetchedAt, provenance: "ok" } });
}
const inspect = () => connectionDataState(h.db, h.accountId, () => NOW);

describe("customer stored-data readiness", () => {
  it("does not label all-off or paused accounts ready and makes no provider calls or writes", async () => {
    h.db.rows("accounts")[0].automation_paused = true;
    const deps = makeDeps({ db: h.db, userId: h.userId });
    const result = await handleConnectorsState(deps);
    expect((result.body as ConnectorsStateListing).dataReadiness).toMatchObject({ status: "no_demand", accountPaused: true, queries: [] });
    expect(deps.calls).toEqual([]);
    expect(h.db.calls.filter(c => ["insert", "update", "upsert", "delete"].includes(c.op))).toEqual([]);
  });
  it("reports required shared queries once with the strictest selected live freshness limit", async () => {
    enable(); enable("D02-W02", false, 5); snapshot("2026-09-02T08:54:00Z");
    expect(await inspect()).toMatchObject({ status: "waiting", queries: [{ routineIds: ["D02-W01", "D02-W02"], availability: "stale", maxAgeMs: 300_000 }] });
    expect((await inspect()).queries).toHaveLength(1);
  });
  it("returns fresh metadata without private rows, environment configuration or credentials", async () => {
    enable(); snapshot();
    const result = await inspect();
    expect(result).toMatchObject({ status: "ready", checkedAt: NOW.toISOString(), accountPaused: false, queries: [{ resource: "insights", availability: "ready", sourceFetchedAt: NOW.toISOString() }] });
    for (const value of ["private@example.test", "privateMetric", "readerEnabled", "syncAdmitted", "connectorId", "act_test"])
      expect(JSON.stringify(result)).not.toContain(value);
  });
  it("never treats another tenant's snapshot as this account's data", async () => {
    enable();
    h.db.userId = "other";
    const other = h.db.rpcs.create_account({ p_name: "Other", p_currency: "NZD" }) as string;
    snapshot(NOW.toISOString(), other);
    expect(await inspect()).toMatchObject({ status: "waiting", queries: [{ availability: "connection_unverified", sourceFetchedAt: null }] });
  });
  it("does not count optional reads, disabled routines or unpublished drafts as required demand", async () => {
    const state = enable("D02-W01", true);
    state.draft_spec = { ...state.live_spec as object, nodes: [{ id: "required", kind: "read", source: "meta_ads", query }] };
    const disabled = enable("D02-W02"); disabled.enabled = false;
    expect(await inspect()).toMatchObject({ status: "no_demand", queries: [] });
  });
  it.each(["context", "pause", "selection"])("discards readiness if %s changes during inspection", async change => {
    const state = enable(); snapshot();
    const original = h.db.from.bind(h.db);
    vi.spyOn(h.db, "from").mockImplementation(table => {
      if (table === "account_dataset_snapshots") {
        if (change === "context") h.db.rows("accounts")[0].context_generation = 1;
        if (change === "pause") h.db.rows("accounts")[0].automation_paused = true;
        if (change === "selection") state.enabled = false;
      }
      return original(table);
    });
    expect(await inspect()).toMatchObject({ status: "unavailable", accountPaused: null, queries: [] });
  });
  it("reports unreadable metadata as unavailable without leaking the database error", async () => {
    const original = h.db.from.bind(h.db);
    vi.spyOn(h.db, "from").mockImplementation(table => { if (table === "routine_states") throw new Error("private database detail"); return original(table); });
    expect(await inspect()).toEqual({ coverage: "required_meta_ads_reads_only", status: "unavailable", accountPaused: null, checkedAt: NOW.toISOString(), queries: [] });
  });
  it("refuses the whole response if membership is revoked during the dataset read", async () => {
    enable(); snapshot();
    const original = h.db.from.bind(h.db);
    vi.spyOn(h.db, "from").mockImplementation(table => {
      if (table === "account_dataset_snapshots") h.db.rows("account_members").splice(0);
      return original(table);
    });
    expect((await handleConnectorsState(makeDeps({ db: h.db, userId: h.userId }))).status).toBe(403);
  });
});
