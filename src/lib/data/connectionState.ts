import { unwrap, type DbClient } from "../db/types";
import { CATALOG_SPECS } from "../runtime/catalog-specs";
import { runtimeGeneration } from "../runtime/contextFence";
import { SupabaseStore } from "../runtime/store/supabase";
import { effectiveSpec } from "../runtime/versioning";
import { DbDatasetStore, datasetQueryHash } from "./datasets";
import { inspectDatasetReadiness, type DatasetReadiness, type DatasetRequirement } from "./readiness";

/** Public metadata only. Web-app configuration is deliberately NOT used as
 * evidence of the separate worker's configuration or scheduling health. */
export interface ConnectionDataState {
  coverage: "required_meta_ads_reads_only";
  status: "ready" | "waiting" | "no_demand" | "unavailable";
  checkedAt: string;
  accountPaused: boolean | null;
  queries: {
    key: string;
    resource: string;
    routineIds: string[];
    availability: DatasetReadiness["queries"][number]["availability"];
    sourceFetchedAt: string | null;
    maxAgeMs: number;
  }[];
}

/** Caller must resolve and authorize the account from the session. This is a
 * read-only status observation, never an instruction to enable or refresh. */
export async function connectionDataState(db: DbClient, accountId: string, now = () => new Date()): Promise<ConnectionDataState> {
  const unavailable = (): ConnectionDataState => ({ coverage: "required_meta_ads_reads_only", status: "unavailable", checkedAt: now().toISOString(), accountPaused: null, queries: [] });
  try {
    const readAccount = () => unwrap<{ id: string; context_generation?: number; automation_paused: boolean } | null>("dataset.account", db.from("accounts").select("id,context_generation,automation_paused").eq("id", accountId).maybeSingle());
    const store = new SupabaseStore(db);
    const [account, states] = await Promise.all([readAccount(), store.listRoutineStates(accountId)]);
    if (!account || account.id !== accountId || typeof account.automation_paused !== "boolean") return unavailable();
    const generation = runtimeGeneration(account.context_generation);
    const requirements: DatasetRequirement[] = [];
    for (const catalog of CATALOG_SPECS) {
      const state = states.find(s => s.routineId === catalog.id);
      if (!state?.enabled) continue;
      if (state.accountId !== accountId) return unavailable();
      const spec = effectiveSpec(state, catalog);
      for (const node of spec.nodes) {
        if (node.kind === "read" && node.source === "meta_ads" && !node.optional)
          requirements.push({ platform: node.source, query: node.query, routineId: catalog.id,
            ...(node.freshnessMinutes !== undefined ? { maxAgeMs: node.freshnessMinutes * 60_000 } : {}) });
      }
    }
    const report = await inspectDatasetReadiness(new DbDatasetStore(db), accountId, requirements, {}, now);
    const [after, statesAfter] = await Promise.all([readAccount(), store.listRoutineStates(accountId)]);
    // A changed selection or business context cannot retain an earlier ready label.
    const selection = (items: typeof states) => JSON.stringify(items.filter(s => s.enabled).sort((a, b) => a.routineId.localeCompare(b.routineId)));
    if (!after || after.id !== accountId || runtimeGeneration(after.context_generation) !== generation ||
        after.automation_paused !== account.automation_paused || selection(states) !== selection(statesAfter)) return unavailable();
    return { coverage: "required_meta_ads_reads_only", status: !report.queries.length ? "no_demand" : report.ready ? "ready" : "waiting",
      checkedAt: report.checkedAt, accountPaused: account.automation_paused,
      queries: report.queries.map(q => ({ key: q.queryHash,
        resource: requirements.find(r => datasetQueryHash(r.query, new Date(report.checkedAt), r.platform) === q.queryHash)!.query.resource,
        routineIds: q.routineIds, availability: q.availability, sourceFetchedAt: q.sourceFetchedAt, maxAgeMs: q.maxAgeMs })) };
  } catch {
    // Never expose database errors, private rows or a false empty/ready result.
    return unavailable();
  }
}
