import { CATALOG_SPECS } from "../lib/runtime/catalog-specs";
import { effectiveSpec } from "../lib/runtime/versioning";
import { DbDatasetStore, datasetQueryHash, datasetSyncEnabled, syncDataset } from "../lib/data/datasets";
import { inspectDatasetReadiness, type DatasetRequirement } from "../lib/data/readiness";
import { assertSameRuntimeContext } from "../lib/runtime/contextFence";
import type { RunContext } from "../lib/runtime/types";
import { WorkerConnectorReader } from "./providers/connectorReader";
import { defaultCredentialProvider } from "./wiring";
import type { ServiceDeps } from "./service";

/** Inspect enabled demand, or explicitly proposed routines, without enabling them.
 * This remains an internal operator read, never a grant or a scheduler receipt. */
export async function inspectAccountDatasets(deps: ServiceDeps, accountId: string, proposedRoutineIds?: string[], env: Record<string, string | undefined> = process.env) {
  if (!deps.db) throw new Error("dataset inspection database unavailable");
  const account = await deps.accounts.getAccount(accountId);
  if (!account) throw new Error("dataset inspection account unavailable");
  if (proposedRoutineIds?.some(id => !CATALOG_SPECS.some(spec => spec.id === id))) throw new Error("unknown proposed dataset routine");
  const requirements: DatasetRequirement[] = [];
  for (const catalog of CATALOG_SPECS) {
    if (proposedRoutineIds && !proposedRoutineIds.includes(catalog.id)) continue;
    const state = await deps.store.getRoutineState(accountId, catalog.id);
    if (!proposedRoutineIds && !state?.enabled) continue;
    const spec = state ? effectiveSpec(state, catalog) : catalog;
    for (const node of spec.nodes) {
      if (node.kind === "read" && node.source === "meta_ads") requirements.push({ platform: node.source, query: node.query, routineId: spec.id });
    }
  }
  const report = await inspectDatasetReadiness(new DbDatasetStore(deps.db), accountId, requirements, env, deps.now);
  const after = await deps.accounts.getAccount(accountId);
  if (!after || !!after.automationPaused !== !!account.automationPaused) throw new Error("dataset inspection account changed");
  assertSameRuntimeContext(account.account, after.account);
  return { ...report, accountPaused: !!account.automationPaused, contextGeneration: account.account.contextGeneration ?? 0,
    selection: proposedRoutineIds ? "proposed" : "enabled", coverage: "meta_ads_only" as const };
}

/** Bounded background read-only sync. Opt-in accounts only; never dispatches a routine.
 * Returns after at most one provider query (which may paginate), with a shared lease. */
export async function runDatasetSyncTick(deps: ServiceDeps, env: Record<string, string | undefined> = process.env): Promise<{ synced: number; failed: number }> {
  const report = { synced: 0, failed: 0 };
  if (env.UNC_DATA_SYNC_ENABLED !== "true" || !deps.db) return report;
  const now = deps.now ?? (() => new Date());
  const direct = new WorkerConnectorReader({ credentials: deps.credentials ?? defaultCredentialProvider(env), now, fetch: deps.fetch, log: deps.log });
  for (const acct of await deps.accounts.listAccounts()) {
    if (acct.automationPaused || !datasetSyncEnabled(acct.account.accountId, "meta_ads", env)) continue;
    const seen = new Set<string>();
    for (const catalog of CATALOG_SPECS) {
      const state = await deps.store.getRoutineState(acct.account.accountId, catalog.id);
      if (!state?.enabled) continue;
      const spec = effectiveSpec(state, catalog);
      for (const node of spec.nodes) {
        if (node.kind !== "read" || node.source !== "meta_ads") continue;
        const key = datasetQueryHash(node.query, now());
        if (seen.has(key)) continue;
        seen.add(key);
        const ctx: RunContext = { runId: `dataset-sync:${key}`, routineId: spec.id, version: spec.version, mode: "dry_run",
          startedAt: now().toISOString(), account: acct.account, caps: { currency: acct.account.currency, perDay: 0, perMonth: 0 },
          triggeredBy: "schedule", vars: acct.vars ?? {}, inputs: {}, reads: {}, checks: {} };
        try {
          const result = await syncDataset(deps.db, direct, node.source, node.query, ctx, now);
          if (result !== "synced") continue;
          report.synced++;
          deps.log?.info("dataset.synced", { accountId: acct.account.accountId, queryHash: key, routineId: spec.id });
          return report;
        } catch {
          report.failed++;
          deps.log?.warn("dataset.sync_failed", { accountId: acct.account.accountId, queryHash: key, routineId: spec.id });
          // Later queries can still progress; provider calls remain bounded to one failure.
          return report;
        }
      }
    }
  }
  return report;
}
