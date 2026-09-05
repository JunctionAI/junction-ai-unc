import { createHash, randomUUID } from "node:crypto";
import { unwrap, type DbClient } from "../db/types";
import { getConnector } from "../connectors/store";
import { claimLease, releaseLease } from "../connectors/lease";
import { META_BUDGET_CONTRACT } from "./metaBudgets";
import type { ConnectorReader, Platform, ReadQuery, ReadResult, RunContext } from "../runtime/types";

export const DATASET_MAX_AGE_MS = 60 * 60_000;
export const DATASET_SYNC_INTERVAL_MS = 15 * 60_000;

export function datasetNormalizationCurrent(platform: Platform, query: ReadQuery, result: ReadResult): boolean {
  return platform !== "meta_ads" || !["adsets", "campaigns"].includes(query.resource) || result.metrics.budget_metric_contract === META_BUDGET_CONTRACT;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}

/** Exact query/UTC reporting day: never substitute a different grain, filter or window. */
export function datasetQueryHash(query: ReadQuery, now: Date, platform: Platform = "meta_ads"): string {
  const normalization = platform === "meta_ads" && ["adsets", "campaigns"].includes(query.resource) ? META_BUDGET_CONTRACT : undefined;
  return createHash("sha256").update(JSON.stringify(stable({ version: 1, normalization, day: now.toISOString().slice(0, 10), query: { ...query, ...(query.fields ? { fields: [...new Set(query.fields)].sort() } : {}) } }))).digest("hex");
}

export function storedDataEnabled(accountId: string, platform: Platform, env: Record<string, string | undefined>): boolean {
  return platform === "meta_ads" && (env.UNC_STORED_DATA_ACCOUNTS ?? "").split(",").map(x => x.trim()).filter(Boolean).includes(accountId);
}

/** Producer admission is independent of reader cutover: warm and verify first.
 * The reader allowlist must never implicitly authorize scheduled provider calls. */
export function datasetSyncEnabled(accountId: string, platform: Platform, env: Record<string, string | undefined>): boolean {
  return env.UNC_DATA_SYNC_ENABLED === "true" && platform === "meta_ads" &&
    (env.UNC_DATA_SYNC_ACCOUNTS ?? "").split(",").map(x => x.trim()).filter(Boolean).includes(accountId);
}

export interface DatasetIdentity { accountId: string; connectorId: string; externalRef: string; platform: Platform }
function sameIdentity(a: DatasetIdentity, b: DatasetIdentity): boolean {
  return a.accountId === b.accountId && a.connectorId === b.connectorId && a.externalRef === b.externalRef && a.platform === b.platform;
}
export interface DatasetSnapshot { id: string; identity: DatasetIdentity; queryHash: string; result: ReadResult; storedAt: string }
export interface DatasetSyncFence { holder: string; contextGeneration: number }
export type DatasetAvailability = "missing" | "identity_mismatch" | "unverified" | "stale" | "ready";

/** Shared by actual readers and read-only rollout inspection. Storage time never
 * renews source freshness; a recent fixture/error is not a usable observation. */
export function datasetAvailability(snapshot: DatasetSnapshot | null, identity: DatasetIdentity, queryHash: string, now: Date, maxAgeMs = DATASET_MAX_AGE_MS): DatasetAvailability {
  if (!snapshot) return "missing";
  if (!sameIdentity(snapshot.identity, identity) || snapshot.queryHash !== queryHash) return "identity_mismatch";
  if (!["ok", "empty"].includes(snapshot.result.provenance ?? "")) return "unverified";
  const age = now.getTime() - Date.parse(snapshot.result.fetchedAt);
  if (!Number.isFinite(age) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 || age < -30_000 || age > maxAgeMs) return "stale";
  return "ready";
}
export interface DatasetStore {
  connection(accountId: string, platform: Platform): Promise<DatasetIdentity | null>;
  latest(identity: DatasetIdentity, queryHash: string): Promise<DatasetSnapshot | null>;
  save(identity: DatasetIdentity, query: ReadQuery, queryHash: string, result: ReadResult, now: Date, fence: DatasetSyncFence): Promise<DatasetSnapshot>;
}

export class DbDatasetStore implements DatasetStore {
  constructor(readonly db: DbClient) {}
  async connection(accountId: string, platform: Platform): Promise<DatasetIdentity | null> {
    const c = await getConnector(this.db, accountId, platform);
    return c?.status === "connected" && c.external_ref ? { accountId, connectorId: c.id, externalRef: c.external_ref, platform } : null;
  }
  async latest(identity: DatasetIdentity, queryHash: string): Promise<DatasetSnapshot | null> {
    const r = await unwrap<{ id: string; result: ReadResult; stored_at: string; source_fetched_at: string } | null>("read account dataset", this.db.from("account_dataset_snapshots")
      .select("id,result,stored_at,source_fetched_at").eq("account_id", identity.accountId).eq("connector_id", identity.connectorId)
      .eq("external_ref", identity.externalRef).eq("platform", identity.platform).eq("query_hash", queryHash)
      .order("source_fetched_at", { ascending: false }).limit(1).maybeSingle());
    return r ? { id: r.id, identity, queryHash, result: { ...r.result, fetchedAt: r.source_fetched_at }, storedAt: r.stored_at } : null;
  }
  async save(identity: DatasetIdentity, query: ReadQuery, queryHash: string, result: ReadResult, now: Date, fence: DatasetSyncFence): Promise<DatasetSnapshot> {
    if (!["ok", "empty"].includes(result.provenance ?? "") || !Number.isFinite(Date.parse(result.fetchedAt))) throw new Error("only complete provider reads can enter stored datasets");
    if (datasetAvailability({ id: "pending", identity, queryHash, result, storedAt: now.toISOString() }, identity, queryHash, now) !== "ready")
      throw new Error("dataset sync returned stale or invalid source timestamp");
    // Relative windows can change at UTC midnight while the provider is in flight.
    // Never label yesterday's request as today's reporting query (or vice versa).
    if (queryHash !== datasetQueryHash(query, now, identity.platform) || queryHash !== datasetQueryHash(query, new Date(result.fetchedAt), identity.platform))
      throw new Error("dataset reporting day changed during data sync");
    if (!datasetNormalizationCurrent(identity.platform, query, result))
      throw new Error("dataset budget normalization contract is not current");
    if (!fence?.holder || !Number.isSafeInteger(fence.contextGeneration) || fence.contextGeneration < 0)
      throw new Error("dataset sync completion requires its lease and captured context");
    const id = randomUUID();
    const storedAt = await unwrap<string | null>("commit account dataset", this.db.rpc("commit_dataset_sync", { p_holder: fence.holder,
      p_context_generation: fence.contextGeneration, p_snapshot: { id, account_id: identity.accountId,
      connector_id: identity.connectorId, external_ref: identity.externalRef, platform: identity.platform, query_hash: queryHash,
      query: stable(query), result, source_fetched_at: result.fetchedAt } }));
    if (typeof storedAt !== "string" || !Number.isFinite(Date.parse(storedAt)))
      throw new Error("dataset sync completion refused: lease expired or account/connection changed");
    return { id, identity, queryHash, result, storedAt };
  }
}

/** Reads stored provider observations without resolving credentials or making API calls. */
export class StoredDatasetReader implements ConnectorReader {
  constructor(private readonly store: DatasetStore, private readonly now = () => new Date(), private readonly maxAgeMs = DATASET_MAX_AGE_MS) {}
  async read(platform: Platform, query: ReadQuery, ctx: RunContext): Promise<ReadResult> {
    const identity = await this.store.connection(ctx.account.accountId, platform);
    if (!identity) throw new Error(`stored data unavailable: ${platform} connection identity is not verified`);
    const queryHash = datasetQueryHash(query, this.now(), platform);
    const snapshot = await this.store.latest(identity, queryHash);
    const availability = datasetAvailability(snapshot, identity, queryHash, this.now(), this.maxAgeMs);
    if (!snapshot || availability === "missing") throw new Error(`stored data unavailable: ${platform} ${query.resource} has not synchronized for this query`);
    if (availability === "identity_mismatch") throw new Error("stored data identity or query mismatch");
    if (availability === "unverified") throw new Error("stored data has no verified provider provenance");
    if (availability === "stale") throw new Error("stored data is stale or has an invalid source timestamp; synchronization required");
    if (queryHash !== datasetQueryHash(query, this.now(), platform)) throw new Error("stored data reporting day changed; synchronization required");
    if (!datasetNormalizationCurrent(platform, query, snapshot.result))
      throw new Error("stored data budget normalization contract is not current");
    return { ...snapshot.result, dataset: { id: snapshot.id, servedFrom: "stored", storedAt: snapshot.storedAt } };
  }
}

export function accountDataReader(direct: ConnectorReader, db: DbClient | null, env: Record<string, string | undefined>, now = () => new Date()): ConnectorReader {
  const stored = db ? new StoredDatasetReader(new DbDatasetStore(db), now) : null;
  return { read: (platform, query, ctx) => {
    if (!storedDataEnabled(ctx.account.accountId, platform, env)) return direct.read(platform, query, ctx);
    if (!stored) throw new Error("stored dataset database is not configured");
    return stored.read(platform, query, ctx);
  } };
}

/** Sync and read are separate paths. One distributed lease prevents duplicate fetches.
 * This stores exact reporting snapshots; daily-grain historical backfills remain separate work. */
export async function syncDataset(db: DbClient, direct: ConnectorReader, platform: Platform, query: ReadQuery, ctx: RunContext, now = () => new Date(), refreshAfterMs = DATASET_SYNC_INTERVAL_MS): Promise<"synced" | "fresh" | "busy"> {
  if (!Number.isFinite(refreshAfterMs) || refreshAfterMs < 0 || refreshAfterMs > DATASET_SYNC_INTERVAL_MS)
    throw new Error("invalid dataset refresh interval");
  const store = new DbDatasetStore(db);
  const identity = await store.connection(ctx.account.accountId, platform);
  if (!identity) throw new Error("dataset sync has no verified connection identity");
  const hash = datasetQueryHash(query, now(), platform);
  const key = `dataset:${identity.accountId}:${identity.connectorId}:${hash}`;
  const holder = await claimLease(db, key, 120);
  if (!holder) return "busy";
  let completed = false;
  try {
    const previous = await store.latest(identity, hash);
    const age = previous ? now().getTime() - Date.parse(previous.result.fetchedAt) : Infinity;
    if (age >= 0 && age < refreshAfterMs && previous && datasetAvailability(previous, identity, hash, now()) === "ready" && datasetNormalizationCurrent(platform, query, previous.result)) { completed = true; return "fresh"; }
    const result = await direct.read(platform, query, ctx);
    const current = await store.connection(ctx.account.accountId, platform);
    if (!current || !sameIdentity(current, identity)) throw new Error("connection changed during data sync");
    await store.save(identity, query, hash, result, now(), { holder, contextGeneration: ctx.account.contextGeneration ?? 0 });
    // Successful completion already consumed this holder's lease atomically.
    return "synced";
  } finally {
    // A failure keeps the bounded lease as a cooldown, letting the next tick skip
    // this query and progress other datasets. Expiry survives process restarts.
    if (completed) await releaseLease(db, key, holder);
  }
}
