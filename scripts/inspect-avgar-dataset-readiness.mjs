/** GET-only rollout inspection. No provider/credential access or database writes.
 * Compile worker first. Run using the linked project's `vercel env run -e production`.
 * Default: enabled Meta query demand. Optional --routine D02-W01 inspects proposed
 * demand without changing its switch. Report is metadata only, never launch proof. */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DbAccountsSource } = require("../dist/worker/worker/accounts.js");
const { SupabaseStore } = require("../dist/worker/lib/runtime/store/supabase.js");
const { inspectAccountDatasets } = require("../dist/worker/worker/datasets.js");
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--routine" || !/^D\d{2}-W\d{2}$/.test(args[1]))) throw new Error("usage: inspect-avgar-dataset-readiness.mjs [--routine D02-W01]");
const accountId = "aa5cfc84-2569-4c99-9b40-67003ae55eda";
const projectUrl = "https://ycgayfsvcjpsnryrpukv.supabase.co";
if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== projectUrl) throw new Error("wrong_project");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("missing_server_configuration");
let databaseGets = 0;
const readOnlyFetch = async (input, init = {}) => {
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (method !== "GET" || url.origin !== projectUrl || !url.pathname.startsWith("/rest/v1/")) throw new Error("non_database_read_forbidden");
  databaseGets++;
  return fetch(input, { ...init, signal: AbortSignal.timeout(20_000), cache: "no-store" });
};
const db = createClient(projectUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: readOnlyFetch },
});
const { data: members, error } = await db.from("account_members").select("user_id,role").eq("account_id", accountId);
if (error || members?.length !== 1 || members[0].role !== "owner" || members[0].user_id !== "74802c60-149a-4405-b719-dc058d174072") throw new Error("unexpected_account_owner");
const deps = { db, store: new SupabaseStore(db), accounts: new DbAccountsSource(db) };
const report = await inspectAccountDatasets(deps, accountId, args.length ? [args[1]] : undefined);
console.log(JSON.stringify({ ...report, databaseGets, providerCalls: 0, databaseWrites: 0, flagsChanged: false,
  configurationSource: "operator_process_environment_not_worker_runtime" }, null, 2));
