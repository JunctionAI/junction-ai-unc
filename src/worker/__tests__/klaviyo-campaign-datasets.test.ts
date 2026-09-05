import { describe, expect, it, vi } from "vitest";
import { seededDb, NOW } from "../../lib/connectors/__tests__/helpers";
import { upsertConnector } from "../../lib/connectors/store";
import { CATALOG_SPEC_BY_ID } from "../../lib/runtime/catalog-specs";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { setEnabled } from "../../lib/runtime/versioning";
import { accountDataReader, datasetSyncEnabled, storedDataEnabled } from "../../lib/data/datasets";
import type { RunContext } from "../../lib/runtime/types";
import { StaticAccountsSource } from "../accounts";
import { inspectAccountDatasets, runDatasetSyncTick, scheduledDatasetsReady } from "../datasets";
import { authenticate, readForToken } from "../../lib/n8n/proxy";
import { issueDataToken } from "../../lib/n8n/dataToken";

const query = { resource: "campaigns", window: "90d", fields: ["id", "subject", "send_time", "revenue", "unsubscribes"] };
async function setup() {
  const { db, accountId } = seededDb();
  await upsertConnector(db, accountId, "klaviyo", { status: "connected", external_ref: "klaviyo-client-a" });
  const store = new MemoryStore();
  await setEnabled({ store }, accountId, "D05-W07", true);
  // Same production query twice: verifies shared demand without extra provider work.
  const state = (await store.getRoutineState(accountId, "D05-W07"))!;
  const campaignNode = CATALOG_SPEC_BY_ID["D05-W07"].nodes.find(n => n.kind === "read" && n.source === "klaviyo")!;
  await store.putRoutineState({ ...state, liveSpec: { ...CATALOG_SPEC_BY_ID["D05-W07"], nodes: [campaignNode, { ...campaignNode, id: "duplicate-read" }] } });
  db.rpcs.claim_backend_lease = () => true;
  db.rpcs.commit_dataset_sync = args => {
    db.insertRow("account_dataset_snapshots", { ...(args.p_snapshot as Record<string, unknown>), stored_at: NOW.toISOString() });
    return NOW.toISOString();
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [{ id: "campaign-a", attributes: { name: "Real-source-shaped example", status: "Sent", send_time: new Date(NOW.getTime() - 86_400_000).toISOString() } }], links: { next: null } }));
  const credentials = { get: vi.fn(async (id: string) => {
    if (id !== accountId) throw new Error("foreign credential lookup");
    return { kind: "klaviyo" as const, apiKey: "synthetic-only" };
  }) };
  const account = { accountId, contextGeneration: 0, currency: "NZD", budgetMonthly: 0 };
  const deps = { db, store, fetch, credentials, now: () => NOW, accounts: new StaticAccountsSource([{ account }]) };
  const env = { UNC_DATA_SYNC_ENABLED: "true", UNC_KLAVIYO_CAMPAIGN_SYNC_ACCOUNTS: accountId, UNC_KLAVIYO_CAMPAIGN_STORED_ACCOUNTS: accountId };
  const ctx: RunContext = { account, runId: "synthetic-run", routineId: "D05-W07", version: 1, mode: "dry_run", startedAt: NOW.toISOString(), caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, reads: {}, checks: {} };
  return { db, accountId, store, deps, fetch, credentials, env, ctx };
}

describe("Klaviyo campaign shared-data path", () => {
  it("separates Meta, campaign refresh, campaign stored routing and unsupported resources", () => {
    const legacy = { UNC_DATA_SYNC_ENABLED: "true", UNC_DATA_SYNC_ACCOUNTS: "a", UNC_STORED_DATA_ACCOUNTS: "a" };
    expect(datasetSyncEnabled("a", "klaviyo", legacy, query)).toBe(false);
    expect(storedDataEnabled("a", "klaviyo", legacy, query)).toBe(false);
    const warm = { UNC_DATA_SYNC_ENABLED: "true", UNC_KLAVIYO_CAMPAIGN_SYNC_ACCOUNTS: "a" };
    expect(datasetSyncEnabled("a", "klaviyo", warm, query)).toBe(true);
    expect(storedDataEnabled("a", "klaviyo", warm, query)).toBe(false);
    const cutover = { UNC_KLAVIYO_CAMPAIGN_STORED_ACCOUNTS: "a" };
    expect(datasetSyncEnabled("a", "klaviyo", cutover, query)).toBe(false);
    expect(storedDataEnabled("a", "klaviyo", cutover, query)).toBe(true);
    for (const q of [{ resource: "flows" }, { ...query, filter: { tag: "winback" } }]) {
      expect(datasetSyncEnabled("a", "klaviyo", warm, q)).toBe(false);
      expect(storedDataEnabled("a", "klaviyo", cutover, q)).toBe(false);
    }
    expect(storedDataEnabled("other", "klaviyo", cutover, query)).toBe(false);
    expect(datasetSyncEnabled("a", "klaviyo", { ...warm, UNC_DATA_SYNC_ENABLED: "false" }, query)).toBe(false);
  });
  it("warms exact calendar demand once and reuses persisted history across readers and ticks", async () => {
    const h = await setup();
    expect(await runDatasetSyncTick(h.deps, h.env)).toEqual({ synced: 1, failed: 0 });
    expect(await runDatasetSyncTick({ ...h.deps }, h.env)).toEqual({ synced: 0, failed: 0 });
    const direct = { read: vi.fn() };
    for (let i = 0; i < 2; i++) {
      const result = await accountDataReader(direct, h.db, h.env, () => NOW).read("klaviyo", query, h.ctx);
      expect(result).toMatchObject({ rows: [{ id: "campaign-a", subject: null }], metrics: { revenue: null }, dataset: { servedFrom: "stored" } });
    }
    expect(direct.read).not.toHaveBeenCalled();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const readiness = await inspectAccountDatasets(h.deps, h.accountId, undefined, h.env);
    expect(readiness).toMatchObject({ ready: true, queries: [{ platform: "klaviyo", readerEnabled: true, syncAdmitted: true, routineIds: ["D05-W07"] }] });
    expect(h.db.rows("account_dataset_snapshots")).toHaveLength(1);
  });
  it("does not refresh paused or disabled accounts", async () => {
    const h = await setup();
    expect(await runDatasetSyncTick({ ...h.deps, accounts: new StaticAccountsSource([{ account: h.ctx.account, automationPaused: true }]) }, h.env)).toEqual({ synced: 0, failed: 0 });
    await setEnabled({ store: h.store }, h.accountId, "D05-W07", false);
    expect(await runDatasetSyncTick(h.deps, h.env)).toEqual({ synced: 0, failed: 0 });
    expect(h.credentials.get).not.toHaveBeenCalled();
  });
  it("serves the same snapshot through an authenticated n8n run token without unsealing credentials", async () => {
    const h = await setup();
    await runDatasetSyncTick(h.deps, h.env);
    await h.store.createRun({ id: h.ctx.runId, accountId: h.accountId, routineId: "D05-W07", version: 1, mode: "dry_run", status: "running", startedAt: NOW.toISOString() });
    const credentials = { get: vi.fn(async () => { throw new Error("stored reads must not unseal credentials"); }) };
    const deps = { ...h.deps, credentials, credentialsKind: "none" as const, dataEnv: h.env, secret: "synthetic-secret" };
    const token = issueDataToken(deps.secret, { accountId: h.accountId, runId: h.ctx.runId, routineId: "D05-W07", scopes: ["klaviyo:campaigns"] }, { now: () => NOW }).token;
    const auth = await authenticate(deps, new Request("https://unc.example/api/n8n/reads", { headers: { authorization: `Bearer ${token}` } }));
    expect(auth.ok).toBe(true);
    if (!auth.ok) throw new Error(auth.error);
    expect(await readForToken(deps, auth, { platform: "klaviyo", ...query })).toMatchObject({ ok: true, rows: [{ id: "campaign-a" }], provenance: { via: "n8n", dataset: { servedFrom: "stored" } } });
    expect(await readForToken(deps, auth, { platform: "klaviyo", resource: "profiles" })).toMatchObject({ ok: false, status: 403 });
    expect(credentials.get).not.toHaveBeenCalled();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const foreign = issueDataToken(deps.secret, { accountId: "another-client", runId: h.ctx.runId, routineId: "D05-W07", scopes: ["klaviyo:campaigns"] }, { now: () => NOW }).token;
    expect(await authenticate(deps, new Request("https://unc.example/api/n8n/reads", { headers: { authorization: `Bearer ${foreign}` } }))).toMatchObject({ ok: false });
  });
  it("reader-only admission never starts a refresh", async () => {
    const h = await setup();
    expect(await runDatasetSyncTick(h.deps, { ...h.env, UNC_KLAVIYO_CAMPAIGN_SYNC_ACCOUNTS: "" })).toEqual({ synced: 0, failed: 0 });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("a missing Meta connection does not block admitted Klaviyo on the same client", async () => {
    const h = await setup();
    await setEnabled({ store: h.store }, h.accountId, "D02-W01", true);
    expect(await runDatasetSyncTick(h.deps, { ...h.env, UNC_DATA_SYNC_ACCOUNTS: h.accountId })).toEqual({ synced: 1, failed: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.credentials.get.mock.calls.map(c => c[0])).toEqual([h.accountId]);
  });
  it("a missing/stale stored campaign cannot fall back to the provider", async () => {
    const h = await setup(), direct = { read: vi.fn() };
    await expect(accountDataReader(direct, h.db, h.env, () => NOW).read("klaviyo", query, h.ctx)).rejects.toThrow("has not synchronized");
    await runDatasetSyncTick(h.deps, h.env);
    await expect(accountDataReader(direct, h.db, h.env, () => new Date(NOW.getTime() + 3_600_001)).read("klaviyo", query, h.ctx)).rejects.toThrow("stale");
    expect(direct.read).not.toHaveBeenCalled();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not block a scheduled optional campaign read but defers required stored demand", async () => {
    const h = await setup();
    expect(await scheduledDatasetsReady(h.deps, h.accountId, "D05-W07", h.env)).toBe(true);
    const state = (await h.store.getRoutineState(h.accountId, "D05-W07"))!;
    await h.store.putRoutineState({ ...state, liveSpec: { ...state.liveSpec!, nodes: state.liveSpec!.nodes.map(n => n.kind === "read" ? { ...n, optional: false } : n) } });
    expect(await scheduledDatasetsReady(h.deps, h.accountId, "D05-W07", h.env)).toBe(false);
    await runDatasetSyncTick(h.deps, h.env);
    expect(await scheduledDatasetsReady(h.deps, h.accountId, "D05-W07", h.env)).toBe(true);
  });
  it("refuses old normalization and another selected asset without another read", async () => {
    const h = await setup(), direct = { read: vi.fn() };
    await runDatasetSyncTick(h.deps, h.env);
    const snapshot = h.db.rows("account_dataset_snapshots")[0];
    (snapshot.result as { metrics: Record<string, unknown> }).metrics.campaign_history_contract = "old";
    await expect(accountDataReader(direct, h.db, h.env, () => NOW).read("klaviyo", query, h.ctx)).rejects.toThrow("normalization contract");
    await upsertConnector(h.db, h.accountId, "klaviyo", { status: "connected", external_ref: "different-asset" });
    await expect(accountDataReader(direct, h.db, h.env, () => NOW).read("klaviyo", query, h.ctx)).rejects.toThrow("has not synchronized");
    expect(direct.read).not.toHaveBeenCalled();
  });
});
