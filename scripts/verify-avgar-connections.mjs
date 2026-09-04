/** Run via `vercel env run -e production -- node scripts/verify-avgar-connections.mjs`.
 * Uses the existing encrypted connections; no credential values or customer rows are logged.
 * Database writes and provider mutations are disabled for this diagnostic.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { keyringFromEnv } = require("../dist/worker/lib/connectors/crypto.js");
const { ConnectorCredentialProvider } = require("../dist/worker/lib/connectors/tokens.js");
const { WorkerConnectorReader } = require("../dist/worker/worker/providers/connectorReader.js");

const accountId = "aa5cfc84-2569-4c99-9b40-67003ae55eda";
const projectUrl = "https://ycgayfsvcjpsnryrpukv.supabase.co";
if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== projectUrl) throw new Error("wrong_project");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("missing_service_configuration");
const keyring = keyringFromEnv();
if (!keyring) throw new Error("missing_connector_keyring");
const db = createClient(projectUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: members, error: memberError } = await db.from("account_members").select("user_id,role").eq("account_id", accountId);
if (memberError || !members || members.length !== 1 || members[0].role !== "owner") throw new Error("unexpected_membership");
const owner = await db.auth.admin.getUserById(members[0].user_id);
if (owner.error || owner.data.user.email !== "halltaylor.tom@gmail.com") throw new Error("wrong_owner");
const readonlyDb = { from(table) {
  const query = db.from(table);
  return new Proxy(query, { get(target, prop) {
    if (["insert", "update", "upsert", "delete"].includes(prop)) return () => { throw new Error("diagnostic_write_forbidden"); };
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  } });
} };
const getOnly = (input, init = {}) => {
  if (init.method && init.method.toUpperCase() !== "GET") throw new Error("diagnostic_mutation_forbidden");
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000), cache: "no-store" });
};
const credentials = new ConnectorCredentialProvider({ db: readonlyDb, keyring, env: process.env, fetch: getOnly, now: () => new Date() });
const reader = new WorkerConnectorReader({ credentials, fetch: getOnly, timeoutMs: 20_000 });
const startedAt = new Date().toISOString();
const checkId = randomUUID();
const ctx = { runId: checkId, routineId: "connection_diagnostic", version: 0, mode: "dry_run", startedAt,
  account: { accountId, currency: "NZD", budgetMonthly: 0 }, caps: { currency: "NZD", perDay: 0, perMonth: 0 },
  triggeredBy: "manual", vars: {}, reads: {}, checks: {} };
const checks = [];
for (const [platform, expectedRef, resource] of [
  ["shopify", "avgar-sport.myshopify.com", "orders"],
  ["meta_ads", "act_3235248400060604", "insights"],
]) {
  const { data: connection, error } = await db.from("connectors").select("external_ref,status").eq("account_id", accountId).eq("platform", platform).single();
  if (error || connection?.external_ref !== expectedRef || connection.status !== "connected") throw new Error(`unexpected_${platform}_connection`);
  try {
    const result = await reader.read(platform, { resource, window: "7d" }, ctx);
    if (!["ok", "empty"].includes(result.provenance)) throw new Error("non_live_result");
    checks.push({ platform, externalRef: expectedRef, resource, window: "7d", ok: true,
      fetchedAt: result.fetchedAt, provenance: result.provenance, rows: result.rows.length, metrics: result.metrics });
  } catch (err) {
    // Readers emit reason codes, but keep arbitrary provider/error text out of this receipt.
    checks.push({ platform, externalRef: expectedRef, ok: false, errorType: err instanceof Error ? err.name : "unknown", reason: "fresh_read_failed" });
  }
}
console.log(JSON.stringify({ checkId, accountId, startedAt, completedAt: new Date().toISOString(), databaseWrites: false, providerMutations: false, checks }, null, 2));
if (checks.some(c => !c.ok)) process.exitCode = 1;
