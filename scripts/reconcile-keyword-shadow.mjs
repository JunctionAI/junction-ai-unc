/** Requires compiled worker and privately injected server env. GET-only externally;
 * the explicit flag permits only archival evidence persistence in the original run. */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { reconcileKeywordShadowArchive } = require("../dist/worker/worker/reconcileKeywordShadow.js");
const { AVGAR_PILOT_ACCOUNT } = require("../dist/worker/lib/n8n/shadowContract.js");
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? "" : process.argv[i + 1] ?? ""; };
const permitId = option("--permit"), generation = option("--original-generation");
if (!process.argv.includes("--persist-verified-archive") || !/^[a-f0-9-]{36}$/i.test(permitId) || !/^\d+$/.test(generation))
  throw new Error("Explicit --permit, --original-generation and --persist-verified-archive required");
const url = "https://ycgayfsvcjpsnryrpukv.supabase.co";
if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== url || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("Approved server configuration unavailable");
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
try {
  const result = await reconcileKeywordShadowArchive({ permitId, accountId: AVGAR_PILOT_ACCOUNT,
    contextGeneration: Number(generation) }, { db, env: process.env });
  console.log(JSON.stringify(result)); // identifiers/status only; no draft, raw response or credential
} catch {
  console.error("Reconciliation incomplete. No provider redispatch performed; inspect the private original permit.");
  process.exitCode = 1;
}
