/* eslint-disable @typescript-eslint/no-require-imports -- Executed by CommonJS node -e on the existing worker; no ESM loader is installed there. */
/* Bounded operator warm, executed on the existing worker with its server credentials.
 * Caller must explicitly open/close the account's temporary read-only test window.
 * Never changes pause, routine switches, env, provider objects or credentials.
 * Default is inspection; --apply requires an unpaused account with ALL routines off.
 * This script is not a background schedule or n8n execution. */
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const compiled = relative => require(path.resolve("dist/worker", relative));
const accountId = "aa5cfc84-2569-4c99-9b40-67003ae55eda";
const ownerId = "74802c60-149a-4405-b719-dc058d174072";
const asset = "act_3235248400060604";
const project = "https://ycgayfsvcjpsnryrpukv.supabase.co";
const build = "7cf363cadee7e1c72e86a014812550f7b000fee0";

async function run(apply = process.argv.includes("--apply")) {
  if (process.env.UNC_BUILD_SHA !== build || process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== project) throw new Error("wrong_runtime");
  for (const flag of ["UNC_COMMANDS_ENABLED", "UNC_MESSAGING_ENABLED", "LIVE_MODE_ENABLED", "TNZ_SMS_ENABLED", "APPLE_MESSAGES_ENABLED", "UNC_DATA_SYNC_ENABLED"])
    if (process.env[flag] && process.env[flag] !== "false") throw new Error("runtime_not_held");
  if (process.env.UNC_COMMAND_RELEASE_SCOPES && process.env.UNC_COMMAND_RELEASE_SCOPES !== "[]") throw new Error("command_scope_not_empty");
  const { DbAccountsSource } = compiled("worker/accounts.js");
  const { SupabaseStore } = compiled("lib/runtime/store/supabase.js");
  const { inspectAccountDatasets } = compiled("worker/datasets.js");
  const { CATALOG_SPEC_BY_ID } = compiled("lib/runtime/catalog-specs.js");
  const { datasetQueryHash, syncDataset, DbDatasetStore, StoredDatasetReader } = compiled("lib/data/datasets.js");
  const { ConnectorCredentialProvider } = compiled("lib/connectors/tokens.js");
  const { keyringFromEnv } = compiled("lib/connectors/crypto.js");
  const { WorkerConnectorReader } = compiled("worker/providers/connectorReader.js");
  const { META_GRAPH_VERSION } = compiled("worker/readers/meta.js");
  const spec = CATALOG_SPEC_BY_ID["D02-W01"];
  const queries = spec.nodes.filter(n => n.kind === "read" && n.source === "meta_ads").map(n => n.query);
  if (queries.length !== 2) throw new Error("unexpected_query_set");
  const hashes = queries.map(q => datasetQueryHash(q, new Date()));
  let databaseGets = 0, providerGets = 0, snapshotWrites = 0;
  const deadline = Date.now() + 110_000;
  const dbFetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin !== project || !url.pathname.startsWith("/rest/v1/")) throw new Error("database_target_refused");
    if (method === "GET") databaseGets++;
    else {
      if (!apply) throw new Error("inspection_write_refused");
      const body = init.body ? JSON.parse(String(init.body)) : null;
      const rpc = url.pathname.split("/rpc/")[1];
      const readRpc = method === "POST" && ["capture_connector_token", "check_connector_token_context"].includes(rpc);
      const settle = method === "POST" && rpc === "settle_connector_token" && body?.input?.kind === "success" && !body.input.sealed && !body.input.refreshAttempt;
      const lease = method === "POST" && rpc === "claim_backend_lease" && body?.p_key?.startsWith(`dataset:${accountId}:`);
      const release = method === "DELETE" && url.pathname === "/rest/v1/backend_leases" && url.searchParams.get("lease_key")?.startsWith(`eq.dataset:${accountId}:`);
      const snapshot = method === "POST" && url.pathname === "/rest/v1/account_dataset_snapshots" && body?.account_id === accountId && body.platform === "meta_ads" && body.external_ref === asset && hashes.includes(body.query_hash);
      if (!readRpc && !settle && !lease && !release && !snapshot) throw new Error("database_mutation_refused");
      if (snapshot && ++snapshotWrites > 2) throw new Error("snapshot_limit");
    }
    return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
  };
  const db = createClient(project, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: dbFetch } });
  const deps = { db, store: new SupabaseStore(db), accounts: new DbAccountsSource(db) };
  const must = async query => { const r = await query; if (r.error) throw new Error("database_check_failed"); return r.data; };
  const check = async () => {
    const account = await deps.accounts.getAccount(accountId);
    const members = await must(db.from("account_members").select("user_id,role").eq("account_id", accountId));
    const enabled = await must(db.from("routine_states").select("routine_id").eq("account_id", accountId).eq("enabled", true));
    const connection = await must(db.from("connectors").select("external_ref,status,last_sync_result").eq("account_id", accountId).eq("platform", "meta_ads").single());
    if (!account || account.account.contextGeneration !== 1 || members.length !== 1 || members[0].user_id !== ownerId || members[0].role !== "owner" || enabled.length || connection.external_ref !== asset || connection.status !== "connected" || connection.last_sync_result !== "ok") throw new Error("account_precondition_failed");
    if (apply && (account.automationPaused || Date.now() > deadline)) throw new Error("test_window_closed");
    return account;
  };
  const account = await check();
  if (!apply) return { ...(await inspectAccountDatasets(deps, accountId, [spec.id])), databaseGets, providerGets, snapshotWrites, mode: "inspection" };
  const providerFetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" || url.origin !== "https://graph.facebook.com" || ![`/${META_GRAPH_VERSION}/${asset}`, `/${META_GRAPH_VERSION}/${asset}/insights`, `/${META_GRAPH_VERSION}/${asset}/adsets`].includes(url.pathname) || url.searchParams.has("access_token") || ++providerGets > 11) throw new Error("provider_scope_refused");
    await check();
    return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
  };
  const keyring = keyringFromEnv();
  if (!keyring) throw new Error("missing_keyring");
  const credentials = new ConnectorCredentialProvider({ db, keyring, env: process.env, expectedOwner: ownerId, fetch: providerFetch, now: () => new Date() });
  const credential = await credentials.get(accountId, "meta_ads", account.account);
  if (!credential || credential.kind !== "meta_ads" || credential.adAccountId !== asset) throw new Error("credential_binding_failed");
  await credentials.validate(credential);
  const response = await providerFetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${asset}?fields=account_id,currency`, { headers: { Authorization: `Bearer ${credential.accessToken}` } });
  if (!response.ok) throw new Error("currency_read_failed");
  const business = await response.json();
  await credentials.validate(credential);
  if (business.account_id !== asset.slice(4) || business.currency !== account.account.currency) throw new Error("currency_identity_mismatch");
  const reader = new WorkerConnectorReader({ credentials, fetch: providerFetch, timeoutMs: 15_000 });
  const ctx = { account: account.account, runId: `dataset-warm:${Date.now()}`, routineId: spec.id, version: spec.version, mode: "dry_run", startedAt: new Date().toISOString(), caps: { currency: business.currency, perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, inputs: {}, reads: {}, checks: {} };
  const results = [];
  for (const query of queries) {
    await check();
    const status = await syncDataset(db, reader, "meta_ads", query, ctx);
    if (!["synced", "fresh"].includes(status)) throw new Error("dataset_busy_reconcile_before_retry");
    const stored = await new StoredDatasetReader(new DbDatasetStore(db)).read("meta_ads", query, ctx);
    const beforeReuse = providerGets;
    if (await syncDataset(db, reader, "meta_ads", query, ctx) !== "fresh") throw new Error("reuse_failed");
    const again = await new StoredDatasetReader(new DbDatasetStore(db)).read("meta_ads", query, ctx);
    if (again.dataset.id !== stored.dataset.id || providerGets !== beforeReuse) throw new Error("duplicate_provider_read");
    results.push({ resource: query.resource, status, snapshotId: stored.dataset.id, fetchedAt: stored.fetchedAt, rows: stored.rows.length, reusedWithoutProvider: true });
  }
  await check();
  const report = await inspectAccountDatasets(deps, accountId, [spec.id]);
  if (!report.ready) throw new Error("coverage_not_ready");
  return { ...report, currency: business.currency, results, databaseGets, providerGets, snapshotWrites, mode: "bounded_operator_warm", routineRuns: 0, providerMutations: 0, credentialWrites: 0 };
}

module.exports = { run };
if (require.main === module) run().then(result => console.log(JSON.stringify(result))).catch(() => { console.error("dataset_warm_failed_reconcile_before_retry"); process.exitCode = 1; });
