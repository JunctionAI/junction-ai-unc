import { CATALOG_SPECS } from "../lib/runtime/catalog-specs";
import { effectiveSpec } from "../lib/runtime/versioning";
import { datasetQueryHash, storedDataEnabled, syncDataset } from "../lib/data/datasets";
import type { RunContext } from "../lib/runtime/types";
import { WorkerConnectorReader } from "./providers/connectorReader";
import { defaultCredentialProvider } from "./wiring";
import type { ServiceDeps } from "./service";

/** Bounded background read-only sync. Opt-in accounts only; never dispatches a routine.
 * Returns after at most one provider query (which may paginate), with a shared lease. */
export async function runDatasetSyncTick(deps: ServiceDeps, env: Record<string, string | undefined> = process.env): Promise<{ synced: number; failed: number }> {
  const report = { synced: 0, failed: 0 };
  if (env.UNC_DATA_SYNC_ENABLED !== "true" || !deps.db) return report;
  const now = deps.now ?? (() => new Date());
  const direct = new WorkerConnectorReader({ credentials: deps.credentials ?? defaultCredentialProvider(env), now, fetch: deps.fetch, log: deps.log });
  for (const acct of await deps.accounts.listAccounts()) {
    if (!storedDataEnabled(acct.account.accountId, "meta_ads", env)) continue;
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
