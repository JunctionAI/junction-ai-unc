/** Bounded, one-source correction. Default is GET-only. --persist appends one
 * deterministic derived snapshot; never overwrites history or renews freshness.
 * Compile the worker first; run with the linked Vercel production environment. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
const require = createRequire(import.meta.url);
const { metaBudgetMetrics, META_BUDGET_CONTRACT } = require("../dist/worker/lib/data/metaBudgets.js");
const { datasetQueryHash, DATASET_MAX_AGE_MS, DbDatasetStore, StoredDatasetReader } = require("../dist/worker/lib/data/datasets.js");
const projectUrl = "https://ycgayfsvcjpsnryrpukv.supabase.co";
export const accountId = "aa5cfc84-2569-4c99-9b40-67003ae55eda";
export const sourceId = "e1a4b0c9-a7fd-4c1b-bc6b-906c55ff8033";
const connectorId = "e205b686-e207-485e-a8fa-12f0852375b0";
const externalRef = "act_3235248400060604";
const oldHash = "b02e4876cef586c4b4891f26ad3675b905d9e5dd408cc847ca941af9d2a5ca5d";
const query = { limit: 200, fields: ["id", "name", "status", "effective_status", "campaign_id", "daily_budget"], resource: "adsets" };
const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fixedHash = sha([sourceId, META_BUDGET_CONTRACT]);
export const derivedId = `${fixedHash.slice(0, 8)}-${fixedHash.slice(8, 12)}-5${fixedHash.slice(13, 16)}-a${fixedHash.slice(17, 20)}-${fixedHash.slice(20, 32)}`;

export function derive(source, now = new Date()) {
  assert.equal(source.id, sourceId, "wrong_source");
  assert.equal(source.account_id, accountId, "wrong_account");
  assert.equal(source.connector_id, connectorId, "wrong_connector");
  assert.equal(source.external_ref, externalRef, "wrong_asset");
  assert.equal(source.platform, "meta_ads", "wrong_platform");
  assert.equal(source.query_hash, oldHash, "wrong_old_hash");
  assert.deepEqual(source.query, query, "wrong_query");
  assert.equal(source.result.provenance, "ok", "unverified_source");
  assert.equal(source.result.rows.length, 62, "unexpected_source_rows");
  assert.equal(Date.parse(source.result.fetchedAt), Date.parse(source.source_fetched_at), "source_time_mismatch");
  const age = now.getTime() - Date.parse(source.source_fetched_at);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= DATASET_MAX_AGE_MS, "source_not_fresh");
  const hash = datasetQueryHash(query, now, "meta_ads");
  assert.equal(hash, datasetQueryHash(query, new Date(source.source_fetched_at), "meta_ads"), "reporting_day_changed");
  assert.notEqual(hash, oldHash, "normalization_not_versioned");
  const metrics = metaBudgetMetrics("adsets", source.result.rows);
  assert.equal(metrics.active_daily_budget_total, 32.61, "unexpected_active_budget");
  assert.equal(metrics.active_daily_budget_count, 2, "unexpected_active_count");
  assert.equal(metrics.largest_adset_id, "120249470895090580", "unexpected_active_target");
  // Reprocess normalized currency-unit rows, not raw provider minor units.
  const result = { rows: source.result.rows, metrics, provenance: "ok", fetchedAt: source.result.fetchedAt,
    sourceNote: `${source.result.sourceNote ?? ""}; derived ${META_BUDGET_CONTRACT} from snapshot ${sourceId}; source rows sha256 ${sha(source.result.rows)}; no new provider fetch; active daily configurations only, not whole-account budget or projected spend` };
  return { id: derivedId, account_id: accountId, connector_id: connectorId, external_ref: externalRef, platform: "meta_ads",
    query_hash: hash, query, result, source_fetched_at: source.source_fetched_at, stored_at: now.toISOString() };
}

export async function run(persist = false) {
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, ""), projectUrl, "wrong_project");
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, "missing_server_configuration");
  let gets = 0, writes = 0, allowedInsert = null;
  const boundedFetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    assert.equal(url.origin, projectUrl, "foreign_request");
    assert.ok(["account_members", "accounts", "connectors", "account_dataset_snapshots"].some(t => url.pathname === `/rest/v1/${t}`), "forbidden_table");
    if (method === "GET") gets++;
    else {
      assert.ok(persist && method === "POST" && url.pathname === "/rest/v1/account_dataset_snapshots" && writes === 0 && allowedInsert, "write_forbidden");
      assert.deepEqual(JSON.parse(init.body), allowedInsert, "wrong_insert");
      writes++;
    }
    return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000), cache: "no-store" });
  };
  const db = createClient(projectUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } });
  const getSource = async () => {
    const { data, error } = await db.from("account_dataset_snapshots").select("*").eq("id", sourceId).eq("account_id", accountId).single();
    assert.ok(!error && data, "source_read_failed"); return data;
  };
  const verifyContext = async () => {
    const a = await db.from("accounts").select("id,automation_paused,context_generation,currency").eq("id", accountId).single();
    assert.ok(!a.error && a.data?.automation_paused === true && a.data.context_generation === 1 && a.data.currency === "NZD", "context_changed");
    const m = await db.from("account_members").select("user_id,role").eq("account_id", accountId);
    assert.deepEqual(m.data, [{ user_id: "74802c60-149a-4405-b719-dc058d174072", role: "owner" }], "owner_changed");
    const c = await new DbDatasetStore(db).connection(accountId, "meta_ads");
    assert.deepEqual(c, { accountId, connectorId, externalRef, platform: "meta_ads" }, "connection_changed");
  };
  await verifyContext();
  const source = await getSource(), originalDigest = sha(source);
  const candidate = derive(source);
  const existing = await db.from("account_dataset_snapshots").select("*").eq("id", derivedId).maybeSingle();
  assert.ok(!existing.error, "derived_lookup_failed");
  if (existing.data) {
    for (const key of ["account_id", "connector_id", "external_ref", "platform", "query_hash", "query", "result"]) assert.deepEqual(existing.data[key], candidate[key], `existing_${key}_mismatch`);
  } else if (persist) {
    await verifyContext();
    assert.equal(sha(await getSource()), originalDigest, "source_changed");
    allowedInsert = derive(source);
    const inserted = await db.from("account_dataset_snapshots").insert(allowedInsert);
    assert.ok(!inserted.error, "insert_failed_reconcile_before_retry");
  }
  let servedId = null;
  if (persist || existing.data) {
    const served = await new StoredDatasetReader(new DbDatasetStore(db)).read("meta_ads", query, { account: { accountId } });
    assert.equal(served.dataset.id, derivedId, "wrong_readback_snapshot");
    assert.deepEqual(served.rows, source.result.rows, "rows_changed_or_double_converted");
    assert.deepEqual(served.metrics, candidate.result.metrics, "wrong_readback_metrics");
    assert.equal(Date.parse(served.fetchedAt), Date.parse(source.source_fetched_at), "freshness_renewed");
    servedId = served.dataset.id;
  }
  assert.equal(sha(await getSource()), originalDigest, "history_changed");
  await verifyContext();
  const metrics = Object.fromEntries(Object.entries(candidate.result.metrics).filter(([key]) => key !== "largest_adset_name"));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), sourceId, derivedId, servedId, queryHash: candidate.query_hash,
    sourceFetchedAt: source.source_fetched_at, originalDigest, sourceRowsSha256: sha(source.result.rows), metrics,
    databaseGets: gets, databaseWrites: writes, providerCalls: 0, historyPreserved: true, sourceFreshnessPreserved: true, accountPaused: true }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  assert.ok(!args.length || (args.length === 1 && args[0] === "--persist"), "usage: correct-avgar-meta-budget-snapshot.mjs [--persist]");
  await run(args.length === 1);
}
