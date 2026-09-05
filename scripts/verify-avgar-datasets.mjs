/** Explicit, one-account read-only-provider canary. Persists reporting data, not actions.
 * Run with production configuration via `vercel env run`; no secrets/customer rows printed.
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { keyringFromEnv } = require("../dist/worker/lib/connectors/crypto.js");
const { ConnectorCredentialProvider } = require("../dist/worker/lib/connectors/tokens.js");
const { WorkerConnectorReader } = require("../dist/worker/worker/providers/connectorReader.js");
const { CATALOG_SPEC_BY_ID } = require("../dist/worker/lib/runtime/catalog-specs.js");
const { DbDatasetStore, StoredDatasetReader, syncDataset } = require("../dist/worker/lib/data/datasets.js");
if (!process.argv.includes("--persist-readonly-snapshot")) throw new Error("explicit_snapshot_flag_required");
const accountId = "aa5cfc84-2569-4c99-9b40-67003ae55eda";
const projectUrl = "https://ycgayfsvcjpsnryrpukv.supabase.co";
if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== projectUrl) throw new Error("wrong_project");
const keyring = keyringFromEnv();
if (!keyring || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("missing_server_configuration");
const db = createClient(projectUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: members, error: memberError } = await db.from("account_members").select("user_id,role").eq("account_id", accountId);
if (memberError || members?.length !== 1 || members[0].role !== "owner") throw new Error("unexpected_membership");
const owner = await db.auth.admin.getUserById(members[0].user_id);
if (owner.error || owner.data.user.email !== "halltaylor.tom@gmail.com") throw new Error("wrong_owner");
const { data: connector, error } = await db.from("connectors").select("status,external_ref").eq("account_id", accountId).eq("platform", "meta_ads").single();
if (error || connector.status !== "connected" || connector.external_ref !== "act_3235248400060604") throw new Error("wrong_meta_account");
const readonlyAuthDb = { from(table) {
  return new Proxy(db.from(table), { get(target, prop) {
    if (["insert", "update", "upsert", "delete"].includes(prop)) return () => { throw new Error("auth_write_forbidden"); };
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  } });
} };
const getOnly = (input, init = {}) => {
  if (init.method && init.method.toUpperCase() !== "GET") throw new Error("provider_mutation_forbidden");
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000), cache: "no-store" });
};
const credentials = new ConnectorCredentialProvider({ db: readonlyAuthDb, keyring, env: { ...process.env, CONNECTOR_REFRESH_LEASES_ENABLED: "false" }, fetch: getOnly, now: () => new Date() });
const provider = new WorkerConnectorReader({ credentials, fetch: getOnly, timeoutMs: 20_000 });
let providerQueries = 0;
const direct = { read(...args) { providerQueries++; return provider.read(...args); } };
const startedAt = new Date().toISOString();
const spec = CATALOG_SPEC_BY_ID["D02-W01"];
const query = spec.nodes.find(n => n.kind === "read" && n.as === "spend").query;
const ctx = { runId: "data-foundation-canary", routineId: spec.id, version: spec.version, mode: "dry_run", startedAt,
  account: { accountId, currency: "NZD", budgetMonthly: 0 }, caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, reads: {}, checks: {} };
const sync = await syncDataset(db, direct, "meta_ads", query, ctx);
if (!["synced", "fresh"].includes(sync)) throw new Error("sync_busy");
const secondSync = await syncDataset(db, direct, "meta_ads", query, ctx);
if (secondSync !== "fresh") throw new Error("snapshot_not_reused");
const stored = await new StoredDatasetReader(new DbDatasetStore(db)).read("meta_ads", query, ctx);
const again = await new StoredDatasetReader(new DbDatasetStore(db)).read("meta_ads", query, ctx);
if (again.dataset.id !== stored.dataset.id || providerQueries > 1) throw new Error("snapshot_not_stable");
let isolation = false;
try { await new StoredDatasetReader(new DbDatasetStore(db)).read("meta_ads", query, { ...ctx, account: { ...ctx.account, accountId: "00000000-0000-4000-8000-000000000000" } }); }
catch { isolation = true; }
if (!isolation) throw new Error("tenant_isolation_failed");
console.log(JSON.stringify({ accountId, startedAt, completedAt: new Date().toISOString(), routineId: spec.id, sync, secondSync,
  snapshotId: stored.dataset.id, sourceFetchedAt: stored.fetchedAt, rows: stored.rows.length, providerQueries,
  readerRecreationPassed: true, crossAccountRejected: true, authWrites: false, providerMutations: false,
  flagsChanged: false, routinesExecuted: false }, null, 2));
