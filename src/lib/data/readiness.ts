import { DATASET_MAX_AGE_MS, datasetAvailability, datasetNormalizationCurrent, datasetQueryHash, datasetSyncEnabled, storedDataEnabled, type DatasetAvailability, type DatasetStore } from "./datasets";
import type { Platform, ReadQuery } from "../runtime/types";

export interface DatasetRequirement { platform: Platform; query: ReadQuery; routineId: string; maxAgeMs?: number }
export interface DatasetReadiness {
  checkedAt: string;
  accountId: string;
  ready: boolean;
  queries: {
    platform: Platform;
    queryHash: string;
    routineIds: string[];
    availability: DatasetAvailability | "connection_unverified" | "normalization_outdated";
    snapshotId: string | null;
    sourceFetchedAt: string | null;
    storedAt: string | null;
    readerEnabled: boolean;
    syncAdmitted: boolean;
    maxAgeMs: number;
  }[];
}

/** Metadata-only pre-cutover inspection. No credential resolution, provider read,
 * write, refresh or fallback. Errors propagate: an unreadable store is not empty.
 * Caller supplies server-owned routine queries; this is not a client HTTP API.
 * "ready" covers the supplied query set at this instant, not scheduler health. */
export async function inspectDatasetReadiness(store: DatasetStore, accountId: string, requirements: DatasetRequirement[], env: Record<string, string | undefined>, now = () => new Date()): Promise<DatasetReadiness> {
  const started = now();
  const grouped = new Map<string, { requirement: DatasetRequirement; queryHash: string; routineIds: Set<string>; maxAgeMs: number }>();
  for (const requirement of requirements) {
    const maxAgeMs = Math.min(requirement.maxAgeMs ?? DATASET_MAX_AGE_MS, DATASET_MAX_AGE_MS);
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new Error("invalid dataset freshness requirement");
    const queryHash = datasetQueryHash(requirement.query, started, requirement.platform);
    const key = `${requirement.platform}:${queryHash}`;
    const existing = grouped.get(key);
    if (existing) { existing.routineIds.add(requirement.routineId); existing.maxAgeMs = Math.min(existing.maxAgeMs, maxAgeMs); }
    else grouped.set(key, { requirement, queryHash, routineIds: new Set([requirement.routineId]), maxAgeMs });
  }
  const queries: DatasetReadiness["queries"] = [];
  for (const { requirement, queryHash, routineIds, maxAgeMs } of grouped.values()) {
    const { platform } = requirement;
    const identity = await store.connection(accountId, platform);
    if (identity && (identity.accountId !== accountId || identity.platform !== platform)) throw new Error("dataset inspection connection identity mismatch");
    const snapshot = identity ? await store.latest(identity, queryHash) : null;
    let availability: DatasetReadiness["queries"][number]["availability"] = identity ? datasetAvailability(snapshot, identity, queryHash, now(), maxAgeMs) : "connection_unverified";
    if (availability === "ready" && snapshot && !datasetNormalizationCurrent(platform, requirement.query, snapshot.result)) availability = "normalization_outdated";
    // Do not surface metadata from an injected/misbound foreign result.
    const visible = availability === "identity_mismatch" ? null : snapshot;
    queries.push({ platform, queryHash, routineIds: [...routineIds].sort(), availability,
      snapshotId: visible?.id ?? null, sourceFetchedAt: visible?.result.fetchedAt ?? null, storedAt: visible?.storedAt ?? null,
      readerEnabled: storedDataEnabled(accountId, platform, env, requirement.query), syncAdmitted: datasetSyncEnabled(accountId, platform, env, requirement.query), maxAgeMs });
  }
  const checked = now();
  if (started.toISOString().slice(0, 10) !== checked.toISOString().slice(0, 10)) throw new Error("dataset inspection reporting day changed; repeat inspection");
  // A long inspection cannot preserve an earlier fresh label past its actual expiry.
  for (const entry of queries) {
    if (entry.availability !== "ready") continue;
    const age = checked.getTime() - Date.parse(entry.sourceFetchedAt!);
    // Reuse the reader policy rather than creating another freshness threshold.
    if (!Number.isFinite(age) || age < -30_000 || age > entry.maxAgeMs) entry.availability = "stale";
  }
  return { checkedAt: checked.toISOString(), accountId, ready: queries.length > 0 && queries.every(q => q.availability === "ready"), queries };
}
