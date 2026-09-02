/* The first certified read after a connect — "Reading your last 90 days now".

   readNowAfterConnect(deps, accountId, platform)
     1. receipt: "Reading your last 90 days from <Platform>…"
     2. snapshotKpis for THIS platform only (the same ConnectorReader + KPI set the nightly
        job uses — src/lib/brain/kpi.ts), through the sealed token (tokens.ts refreshes it
        when needed, or flips the row to needs_reconnect)
     3. platforms with no KPI metric yet (HubSpot, Google Ads) get one probe read instead so
        the card can still say "Read ✓"
     4. connectors.last_sync_at / last_sync_result (ok | empty | error:first_read) and,
        best-effort, last_read_metrics (0011); one summary receipt either way.

   Fire-and-forget from the routes (next/server `after`), awaited in tests. Never throws:
   every failure is a receipt + `error:first_read` on the row, never a zero, never a guess.
   Relative imports only — the worker tree compiles this too. */

import { snapshotKpis, metricsForPlatforms, KPI_METRIC_BY_KEY } from "../brain/kpi";
import type { DbClient } from "../db/types";
import { unwrap } from "../db/types";
import type { ConnectorReader, Platform, ReadQuery, RunContext } from "../runtime/types";
import { DbAccountsSource } from "../../worker/accounts";
import { READERS, WorkerConnectorReader } from "../../worker/providers/connectorReader";
import type { Keyring } from "./crypto";
import type { FetchLike } from "./oauth";
import { connectorEntry } from "./registry";
import { getConnector, updateConnector, writeLastReadMetrics } from "./store";
import { ConnectorCredentialProvider } from "./tokens";

export interface FirstReadDeps {
  db: DbClient;
  keyring: Keyring;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  now: () => Date;
  log?: (line: string) => void;
  /** Tests inject a reader; production builds the worker's from the sealed token. */
  reader?: ConnectorReader;
}

export interface FirstReadOutcome {
  platform: Platform;
  ok: boolean;
  /** KPI metrics written to kpi_snapshots (0 for probe-only platforms). */
  metrics: number;
  keys: string[];
  /** Rows the probe read returned (probe-only platforms). */
  rows: number | null;
  reason: string | null;
}

/** For platforms outside the KPI set: one read that proves the connection. */
export const PROBE_READS: Partial<Record<Platform, ReadQuery>> = {
  hubspot: { resource: "deals", window: "28d", limit: 50 },
  google_ads: { resource: "campaigns", window: "7d" },
};

const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 200);

async function receipt(db: DbClient, accountId: string, platform: Platform, description: string, payload: Record<string, unknown>, now: string) {
  await unwrap("receipts.insert", db.from("receipts").insert({ account_id: accountId, run_id: null, approval_id: null, kind: "notification", platform, description, payload, created_at: now }));
}

function probeContext(accountId: string, currency: string, now: Date): RunContext {
  const account = { accountId, currency, budgetMonthly: 0 };
  return { runId: "first-read", routineId: "first_read", version: 0, mode: "dry_run", startedAt: now.toISOString(), account, caps: { currency, perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, reads: {}, checks: {} };
}

export async function readNowAfterConnect(deps: FirstReadDeps, accountId: string, platform: Platform): Promise<FirstReadOutcome> {
  const entry = connectorEntry(platform);
  const name = entry?.name ?? platform;
  const out: FirstReadOutcome = { platform, ok: false, metrics: 0, keys: [], rows: null, reason: null };
  const fail = async (reason: string, connectorId?: string) => {
    out.reason = short(reason);
    deps.log?.(`connectors.first_read platform=${platform} account=${accountId} result=error`);
    try {
      if (connectorId) await updateConnector(deps.db, connectorId, { last_sync_at: deps.now().toISOString(), last_sync_result: "error:first_read" });
      await receipt(deps.db, accountId, platform, `Couldn't read ${name}: ${out.reason} — reconnect or paste a fresh key and I'll try again.`, { source: "first_read", platform, reason: out.reason }, deps.now().toISOString());
    } catch {
      /* the outcome is the contract */
    }
    return out;
  };

  let row;
  try {
    row = await getConnector(deps.db, accountId, platform);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "couldn't load the connector");
  }
  if (!row || row.status !== "connected") return fail("nothing connected");

  const startedAt = deps.now();
  if (!deps.reader && !READERS[platform]) {
    // Connected and sealed, but nothing can read it yet (Search Console etc.): say so once and
    // leave the row out of the "Reading…" state — the card reads "token sealed, reads come later".
    try {
      await updateConnector(deps.db, row.id, { last_sync_at: startedAt.toISOString(), last_sync_result: "error:no_reader" });
      await receipt(deps.db, accountId, platform, `${name} connected — the key is sealed. I can't read ${name} yet (its reader lands in wave 2), so nothing was written to your numbers.`, { source: "first_read", platform, connector_id: row.id, reason: "no_reader" }, startedAt.toISOString());
    } catch {
      /* advisory */
    }
    out.reason = "no reader for this platform yet";
    return out;
  }
  try {
    await receipt(deps.db, accountId, platform, `Reading your last 90 days from ${name} now…`, { source: "first_read", platform, connector_id: row.id }, startedAt.toISOString());
  } catch {
    /* a missing "starting" receipt must not stop the read */
  }

  const accounts = new DbAccountsSource(deps.db);
  let currency = "NZD";
  let budgetMonthly = 0;
  try {
    const acct = await accounts.getAccount(accountId);
    if (acct) {
      currency = acct.account.currency;
      budgetMonthly = acct.account.budgetMonthly;
    }
  } catch {
    /* defaults are fine for a read */
  }
  const reader = deps.reader ?? new WorkerConnectorReader({ credentials: new ConnectorCredentialProvider({ db: deps.db, keyring: deps.keyring, env: deps.env, fetch: deps.fetch, now: deps.now, log: deps.log }), fetch: deps.fetch as typeof fetch, now: deps.now });

  try {
    if (metricsForPlatforms([platform]).length > 0) {
      const report = await snapshotKpis({ db: deps.db, reader, accountId, account: { currency, budgetMonthly }, now: deps.now, connected: [platform] });
      out.keys = report.written.map((r) => r.metric_key);
      out.metrics = out.keys.length;
      if (!out.metrics) {
        const first = report.couldntAsk[0];
        return fail(first ? first.reason : "the platform answered nothing", row.id);
      }
      out.ok = true;
      const labels = out.keys.map((k) => KPI_METRIC_BY_KEY[k as keyof typeof KPI_METRIC_BY_KEY]?.label.toLowerCase() ?? k);
      const finishedAt = deps.now().toISOString();
      await updateConnector(deps.db, row.id, { last_sync_at: finishedAt, last_sync_result: "ok" });
      await writeLastReadMetrics(deps.db, row.id, out.metrics);
      const skipped = report.couldntAsk.length ? ` ${report.couldntAsk.length} couldn't be answered (${report.couldntAsk.map((c) => KPI_METRIC_BY_KEY[c.key].label.toLowerCase()).join(", ")}) — each has its own line above.` : "";
      await receipt(deps.db, accountId, platform, `Read ✓ · ${out.metrics} metric${out.metrics === 1 ? "" : "s"} from ${name}: ${labels.join(", ")}.${skipped}`, { source: "first_read", platform, connector_id: row.id, metrics: out.keys, couldnt_ask: report.couldntAsk.map((c) => c.key) }, finishedAt);
    } else {
      const query = PROBE_READS[platform] ?? { resource: "report", window: "7d" };
      const result = await reader.read(platform, query, probeContext(accountId, currency, startedAt));
      out.ok = true;
      out.rows = result.rows.length;
      const finishedAt = deps.now().toISOString();
      await updateConnector(deps.db, row.id, { last_sync_at: finishedAt, last_sync_result: result.rows.length ? "ok" : "empty" });
      await writeLastReadMetrics(deps.db, row.id, 0);
      await receipt(deps.db, accountId, platform, `Read ✓ · ${name} answered (${result.rows.length} ${query.resource} in the last ${query.window ?? "window"}). No KPI in the fixed set reads ${name} yet, so nothing was written to your numbers.`, { source: "first_read", platform, connector_id: row.id, resource: query.resource, rows: result.rows.length, provenance: result.provenance ?? null }, finishedAt);
    }
    deps.log?.(`connectors.first_read platform=${platform} account=${accountId} result=ok metrics=${out.metrics}`);
    return out;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), row.id);
  }
}
