/* First certified read after connect. Account generation and selected connector
 * identity are captured once; metrics, card status and receipt commit together.
 * A pause/reset/selection change is not an authentication failure. */
import { snapshotKpis, metricsForPlatforms, KPI_METRIC_BY_KEY, type KpiSnapshotRow, type SnapshotReport } from "../brain/kpi";
import { unwrap, type DbClient } from "../db/types";
import { assertRuntimeContext } from "../db/runtimeContext";
import { RuntimeContextError } from "../runtime/contextFence";
import type { AccountContext, ConnectorReader, Platform, ReadQuery, RunContext } from "../runtime/types";
import { DbAccountsSource } from "../../worker/accounts";
import { READERS, WorkerConnectorReader } from "../../worker/providers/connectorReader";
import type { Keyring } from "./crypto";
import type { FetchLike } from "./oauth";
import { connectorEntry } from "./registry";
import { getConnector } from "./store";
import { ConnectorCredentialProvider } from "./tokens";

export interface FirstReadDeps {
  db: DbClient; keyring: Keyring; env: Record<string, string | undefined>;
  fetch: FetchLike; now: () => Date; log?: (line: string) => void; reader?: ConnectorReader;
}
export interface FirstReadOutcome {
  platform: Platform; ok: boolean; metrics: number; keys: string[]; rows: number | null; reason: string | null;
}
export interface FirstReadCapture {
  connectorId?: string; contextGeneration?: number; externalRef?: string | null; initiatedBy?: string | null;
}
export const PROBE_READS: Partial<Record<Platform, ReadQuery>> = {
  hubspot: { resource: "deals", window: "28d", limit: 50 },
  google_ads: { resource: "campaigns", window: "7d" },
};
const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 200);
function probeContext(account: AccountContext, now: Date): RunContext {
  return { runId: "first-read", routineId: "first_read", version: 0, mode: "dry_run", startedAt: now.toISOString(), account,
    caps: { currency: account.currency, perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, reads: {}, checks: {} };
}

export async function readNowAfterConnect(deps: FirstReadDeps, accountId: string, platform: Platform, capture: FirstReadCapture = {}): Promise<FirstReadOutcome> {
  const name = connectorEntry(platform)?.name ?? platform;
  const out: FirstReadOutcome = { platform, ok: false, metrics: 0, keys: [], rows: null, reason: null };
  let record: ((result: string | null, description: string, payload?: Record<string, unknown>, metrics?: KpiSnapshotRow[]) => Promise<void>) | undefined;
  let commitUncertain = false;
  try {
    const acct = await new DbAccountsSource(deps.db).getAccount(accountId);
    if (!acct || (capture.contextGeneration !== undefined && capture.contextGeneration !== acct.account.contextGeneration))
      throw new RuntimeContextError("context_changed", "The connection's business context changed before its first read.");
    const account = { ...acct.account };
    await assertRuntimeContext(deps.db, account);
    const row = await getConnector(deps.db, accountId, platform);
    if (!row || row.status !== "connected") { out.reason = "nothing connected"; return out; }
    if ((capture.connectorId && capture.connectorId !== row.id) ||
        (capture.externalRef !== undefined && capture.externalRef !== row.external_ref))
      throw new RuntimeContextError("context_changed", "The selected connection changed before its first read.");
    const binding = { id: row.id, accountId, platform, externalRef: row.external_ref, syncRef: row.sync_ref };
    const guard = async () => {
      await assertRuntimeContext(deps.db, account);
      const current = await getConnector(deps.db, accountId, platform);
      if (!current || current.id !== row.id || current.status !== "connected" || current.external_ref !== binding.externalRef ||
          JSON.stringify(current.sync_ref) !== JSON.stringify(binding.syncRef))
        throw new RuntimeContextError("context_changed", "The selected connection changed during its first read.");
    };
    record = async (result, description, payload = {}, metrics = []) => {
      commitUncertain = true;
      const accepted = await unwrap<boolean>("connectors.first_read.commit", deps.db.rpc("record_connector_first_read", {
        input: { binding, contextGeneration: account.contextGeneration, actor: capture.initiatedBy ?? null,
          result, description, payload: { source: "first_read", platform, connector_id: row.id, ...payload }, metrics },
      }));
      commitUncertain = false;
      if (accepted !== true) throw new RuntimeContextError("context_changed", "The first-read result was not accepted for the original connection.");
    };
    if (!deps.reader && !READERS[platform]) {
      await record("error:no_reader", `${name} connected — its credential is sealed, but a verified reader is not available yet. Nothing was written to your numbers.`, { reason: "no_reader" });
      out.reason = "no reader for this platform yet";
      return out;
    }
    await record(null, `Reading your recent data from ${name} now…`);
    const baseReader = deps.reader ?? new WorkerConnectorReader({
      credentials: new ConnectorCredentialProvider({ db: deps.db, keyring: deps.keyring, env: deps.env, fetch: deps.fetch, now: deps.now, log: deps.log }),
      fetch: deps.fetch as typeof fetch, now: deps.now,
    });
    const reader: ConnectorReader = { read: async (source, query, context) => {
      await guard();
      const result = await baseReader.read(source, query, context);
      await guard();
      return result;
    } };
    if (metricsForPlatforms([platform]).length) {
      const commit = async (metrics: KpiSnapshotRow[], failures: SnapshotReport["couldntAsk"]) => {
        const keys = metrics.map(m => m.metric_key);
        const reason = failures[0]?.reason ?? "the platform answered nothing";
        const skipped = failures.length ? ` ${failures.length} metrics could not be answered; the missing values were not filled with zero.` : "";
        const labels = keys.map(k => KPI_METRIC_BY_KEY[k].label.toLowerCase());
        await record!(metrics.length ? "ok" : "error:first_read", metrics.length
          ? `Read ✓ · ${metrics.length} metric${metrics.length === 1 ? "" : "s"} from ${name}: ${labels.join(", ")}.${skipped}`
          : `Couldn't read ${name}. Check the connection diagnostics before reconnecting; no metrics were accepted.`,
        { metrics: keys, couldnt_ask: failures.map(f => f.key), ...(metrics.length ? {} : { reason_code: "provider_read_failed" }) }, metrics);
        out.keys = keys; out.metrics = keys.length; out.ok = keys.length > 0;
        if (!out.ok) out.reason = short(reason);
      };
      await snapshotKpis({ db: deps.db, reader, accountId, account, now: deps.now, connected: [platform], commit });
    } else {
      const query = PROBE_READS[platform] ?? { resource: "report", window: "7d" };
      const result = await reader.read(platform, query, probeContext(account, deps.now()));
      await record(result.rows.length ? "ok" : "empty", `Read ✓ · ${name} answered (${result.rows.length} ${query.resource} in the last ${query.window ?? "window"}). No KPI in the fixed set reads ${name} yet, so nothing was written to your numbers.`,
        { resource: query.resource, rows: result.rows.length, provenance: result.provenance ?? null });
      out.ok = true; out.rows = result.rows.length;
    }
    deps.log?.(`connectors.first_read platform=${platform} account=${accountId} result=${out.ok ? "ok" : "error"} metrics=${out.metrics}`);
    return out;
  } catch (e) {
    // Do not turn a stale callback, paused account or database problem into a
    // reconnect request, or include provider exception text in user receipts.
    out.ok = false; out.metrics = 0; out.keys = []; out.rows = null;
    out.reason = e instanceof RuntimeContextError ? e.code : "first_read_unavailable";
    deps.log?.(`connectors.first_read platform=${platform} account=${accountId} result=${out.reason}`);
    if (!(e instanceof RuntimeContextError) && record && !commitUncertain) {
      try { await record("error:first_read", `Couldn't read ${name}. Check the connection diagnostics before reconnecting; no new read was confirmed.`, { reason_code: "first_read_unavailable" }); } catch { /* a failed/stale result cannot overwrite the connection */ }
    }
    return out;
  }
}
