import { DATASET_MAX_AGE_MS, datasetAvailability, datasetQueryHash, datasetSyncEnabled, storedDataEnabled, type DatasetAvailability, type DatasetStore } from "./datasets";
import type { Platform, ReadQuery } from "../runtime/types";

export interface DatasetRequirement { platform: Platform; query: ReadQuery; routineId: string }
export interface DatasetReadiness {
  checkedAt: string;
  accountId: string;
  ready: boolean;
  queries: {
    platform: Platform;
    queryHash: string;
    routineIds: string[];
    availability: DatasetAvailability | "connection_unverified";
    snapshotId: string | null;
    sourceFetchedAt: string | null;
    storedAt: string | null;
    readerEnabled: boolean;
    syncAdmitted: boolean;
  }[];
}

/** Metadata-only pre-cutover inspection. No credential resolution, provider read,
 * write, refresh or fallback. Errors propagate: an unreadable store is not empty.
 * Caller supplies server-owned routine queries; this is not a client HTTP API.
 * "ready" covers the supplied query set at this instant, not scheduler health. */
export async function inspectDatasetReadiness(store: DatasetStore, accountId: string, requirements: DatasetRequirement[], env: Record<string, string | undefined>, now = () => new Date()): Promise<DatasetReadiness> {
  const started = now();
  const grouped = new Map<string, { requirement: DatasetRequirement; queryHash: string; routineIds: Set<string> }>();
  for (const requirement of requirements) {
    const queryHash = datasetQueryHash(requirement.query, started);
    const key = `${requirement.platform}:${queryHash}`;
    const existing = grouped.get(key);
    if (existing) existing.routineIds.add(requirement.routineId);
    else grouped.set(key, { requirement, queryHash, routineIds: new Set([requirement.routineId]) });
  }
  const queries: DatasetReadiness["queries"] = [];
  for (const { requirement, queryHash, routineIds } of grouped.values()) {
    const { platform } = requirement;
    const identity = await store.connection(accountId, platform);
    if (identity && (identity.accountId !== accountId || identity.platform !== platform)) throw new Error("dataset inspection connection identity mismatch");
    const snapshot = identity ? await store.latest(identity, queryHash) : null;
    const availability = identity ? datasetAvailability(snapshot, identity, queryHash, now()) : "connection_unverified";
    // Do not surface metadata from an injected/misbound foreign result.
    const visible = availability === "identity_mismatch" ? null : snapshot;
    queries.push({ platform, queryHash, routineIds: [...routineIds].sort(), availability,
      snapshotId: visible?.id ?? null, sourceFetchedAt: visible?.result.fetchedAt ?? null, storedAt: visible?.storedAt ?? null,
      readerEnabled: storedDataEnabled(accountId, platform, env), syncAdmitted: datasetSyncEnabled(accountId, platform, env) });
  }
  const checked = now();
  if (started.toISOString().slice(0, 10) !== checked.toISOString().slice(0, 10)) throw new Error("dataset inspection reporting day changed; repeat inspection");
  // A long inspection cannot preserve an earlier fresh label past its actual expiry.
  for (const entry of queries) {
    if (entry.availability !== "ready") continue;
    const age = checked.getTime() - Date.parse(entry.sourceFetchedAt!);
    // Reuse the reader policy rather than creating another freshness threshold.
    if (!Number.isFinite(age) || age < -30_000 || age > DATASET_MAX_AGE_MS) entry.availability = "stale";
  }
  return { checkedAt: checked.toISOString(), accountId, ready: queries.length > 0 && queries.every(q => q.availability === "ready"), queries };
}
