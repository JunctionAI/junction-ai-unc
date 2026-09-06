/* Entirely synthetic identities, credentials and data for the paid-ads shadow lane.
   Nothing here calls Meta, Google Ads, DataForSEO or n8n; nothing is a live pin. */
import type { GadsShadowContract, MetaShadowContract, PaidShadowContract } from "../paidShadowContract";
import { GADS_SHADOW_RECEIVER_URL, META_SHADOW_RECEIVER_URL } from "../paidShadowContract";
import { AVGAR_PILOT_ACCOUNT } from "../shadowContract";
import type { ArtifactDraft, RunContext } from "../../runtime/types";
import { N8N_EXECUTION_API_BASE } from "../../../worker/providers/n8nExecutionReader";

export const start = "2026-09-06T12:00:00.000Z", end = "2026-09-06T12:00:02.000Z";
export const now = () => new Date("2026-09-06T12:00:03.000Z");
export const META_WORKFLOW = "synthetic-meta-wrapper", META_REVISION = "00000000-0000-4000-8000-00000000a001";
export const GADS_WORKFLOW = "synthetic-gads-wrapper", GADS_REVISION = "00000000-0000-4000-8000-00000000b001";
export const policy = { cpaCapPct: 50 as const, cpaCapBasis: "verified_product_price_same_currency" as const };

export const metaContract: MetaShadowContract = { contract: "unc.paid-ads-shadow.v1", lane: "meta", accountId: AVGAR_PILOT_ACCOUNT,
  workflowId: META_WORKFLOW, workflowVersion: META_REVISION, routineId: "D02-W01", routineKey: "daily_decisioning", policy,
  client: { id: "avgar", adAccountId: "act_1234567890", currency: "NZD", timezone: "Pacific/Auckland", reportingWindow: "last_7d", market: "NZ" },
  data: { mode: "provider" } };
export const gadsContract: GadsShadowContract = { contract: "unc.paid-ads-shadow.v1", lane: "google_ads", accountId: AVGAR_PILOT_ACCOUNT,
  workflowId: GADS_WORKFLOW, workflowVersion: GADS_REVISION, routineId: "D02-W09", routineKey: "bofu_campaign_plan", policy,
  client: { id: "avgar", customerId: "1797030595", currency: "NZD", primaryDomain: "avgarsport.com", seedKeyword: "golf travel bag",
    market: "US", locationCode: 2840, languageCode: "en" }, data: { mode: "provider" } };
export const metaFor = (routineId: MetaShadowContract["routineId"], routineKey: MetaShadowContract["routineKey"]): MetaShadowContract =>
  ({ ...structuredClone(metaContract), routineId, routineKey });

export const account = { accountId: AVGAR_PILOT_ACCOUNT, contextGeneration: 1, currency: "NZD", budgetMonthly: 0 };
export const runId = "00000000-0000-4000-8000-000000000104";
export const ctxFor = (c: PaidShadowContract, version = 2): RunContext => ({ account, runId, routineId: c.routineId, version,
  startedAt: start, mode: "dry_run", caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, inputs: {}, reads: {}, checks: {} });
export const identityFor = (c: PaidShadowContract) => ({ accountId: c.accountId, runId, routineId: c.routineId, mode: "dry_run", startedAt: start });

export const env = { NODE_ENV: "production", N8N_SIGNING_SECRET: "synthetic-signing-root-paid",
  N8N_META_SHADOW_RECEIVER_URL: META_SHADOW_RECEIVER_URL, N8N_META_SHADOW_RECEIVER_TOKEN: "synthetic-meta-receiver-credential-xx",
  N8N_GADS_SHADOW_RECEIVER_URL: GADS_SHADOW_RECEIVER_URL, N8N_GADS_SHADOW_RECEIVER_TOKEN: "synthetic-gads-receiver-credential-xx",
  N8N_SHADOW_RECEIVER_TOKEN: "synthetic-other-keyword-receiver-credential",
  N8N_META_SHADOW_WORKFLOW_ID: META_WORKFLOW, N8N_META_SHADOW_TRIGGER_NODE_ID: "incoming-meta", N8N_META_SHADOW_RESULT_NODE_ID: "result-meta",
  N8N_GADS_SHADOW_WORKFLOW_ID: GADS_WORKFLOW, N8N_GADS_SHADOW_TRIGGER_NODE_ID: "incoming-gads", N8N_GADS_SHADOW_RESULT_NODE_ID: "result-gads",
  N8N_EXECUTION_READER_ENABLED: "true", N8N_EXECUTION_API_BASE_URL: N8N_EXECUTION_API_BASE,
  N8N_EXECUTION_API_KEY: "synthetic-independent-paid-execution-key", N8N_DATA_BASE_URL: "https://unc.example.com" };

export const metaRegistration = { id: "00000000-0000-4000-8000-000000000105", accountId: account.accountId, routineId: "D02-W01", active: true, webhookUrl: META_SHADOW_RECEIVER_URL };
export const gadsRegistration = { id: "00000000-0000-4000-8000-000000000106", accountId: account.accountId, routineId: "D02-W09", active: true, webhookUrl: GADS_SHADOW_RECEIVER_URL };

/** A HOLD verdict shaped like Nguyen's packaged sample, translated to the contract vocabulary. */
export function metaArtifact(): ArtifactDraft {
  return { kind: "generic", title: "Today: HOLD Proline align sticks reel", body: "Ad set spent 162.39 for 1 purchase over last_7d; CPA 162.39 is over the 60.00 cap (50% of the verified 120.00 price) but measurement is not reconciled, so this is a hold, not a turn-off.",
    items: [{ title: "HOLD: Proline align sticks reel", body: "Soft off is blocked by unclean measurement. Rollback: leave the ad set unchanged; repair measurement before any off.",
      meta: { routine: "D02-W01", decision_state: "HOLD", status: "observed", adset_id: "120252863530370580", adset_name: "AD_ORG01_PROLINE_ALIGNSTICKS_REEL",
        observed: { spend: 162.39, purchases: 1, cpa: 162.39, ctr: 2.556818181818182, frequency: 1.201018 },
        cpa_cap: { value: 60, currency: "NZD", basis: "product_price_50pct", product_price: 120, product_ref: "shopify:variant:synthetic" },
        rollback_proposal: "Do not pause or scale; keep the current state until measurement is repaired.", window: "last_7d", next_action: "REPAIR_MEASUREMENT",
        raw_private_response: "never-store" } }],
    meta: { private_unused_root: "do not retain" }, evidence: [{ source: "meta_graph", ref: "act_1234567890 insights last_7d" }] };
}
export function gadsArtifact(): ArtifactDraft {
  return { kind: "generic", title: "BOFU Search plan — US: golf travel bag", body: "One PAUSED Search plan from observed US keyword demand. The CPA ceiling is held: no verified USD product price is mapped yet. Nothing is created in Google Ads. PARTIAL.",
    items: [{ title: "Travel bag — phrase", body: "Keywords: golf travel bag (PHRASE). Negatives: free, repair, cheap, diy. Landing: https://avgarsport.com/collections/travel. Campaign PAUSED.",
      meta: { routine: "D02-W09", decision_state: "PLAN_PROPOSED", status: "observed", campaign_status: "PAUSED", customer_id: "1797030595", market: "US",
        ad_group: "Travel bag — phrase", keywords: [{ keyword: "golf travel bag", match_type: "PHRASE", search_volume: 49500, cpc: 1.2, competition: "HIGH", intent: "transactional" }],
        negatives: ["free", "repair", "cheap", "diy"], landing_url: "https://avgarsport.com/collections/travel", headlines: ["Premium Golf Travel Bag", "AVGAR Sport Travel Gear"],
        descriptions: ["Protect your clubs on every trip."], cpa_ceiling: null, cap_reason: "pending_product_price", login_customer_id: null, conversion_action: null,
        mutate_attempted: false, private_note: "never-store" } }],
    meta: {}, evidence: [{ source: "provider", ref: "dataforseo_labs/google/keyword_overview/live task synthetic" }] };
}
export function metaReceipt(c: PaidShadowContract = metaContract): Record<string, unknown> {
  return { contract: c.contract, lane: c.lane, accountId: c.accountId, runId, routineId: c.routineId, routineKey: c.routineKey,
    workflowId: c.workflowId, workflowVersion: null, revisionEvidence: "pending_unc_verification", executionId: "12345",
    startedAt: start, finishedAt: end, mode: "dry_run", status: "succeeded", executedAction: "none", client: { ...c.client },
    provider: { name: "meta_graph", dataset: "ads_insights", adAccountId: (c.client as MetaShadowContract["client"]).adAccountId, currency: c.client.currency,
      reportingWindow: (c.client as MetaShadowContract["client"]).reportingWindow, statusCode: 200, itemsCount: 3, fetchedAt: end, credentialRef: "j6w7zi8lhRivXI0q" } };
}
export function gadsReceipt(c: GadsShadowContract = gadsContract): Record<string, unknown> {
  return { contract: c.contract, lane: c.lane, accountId: c.accountId, runId, routineId: c.routineId, routineKey: c.routineKey,
    workflowId: c.workflowId, workflowVersion: null, revisionEvidence: "pending_unc_verification", executionId: "12346",
    startedAt: start, finishedAt: end, mode: "dry_run", status: "succeeded", executedAction: "none", client: { ...c.client },
    provider: { name: "dataforseo", statusCode: 20000, taskStatusCode: 20000, taskId: "synthetic-task", itemsCount: 1, locationCode: 2840, languageCode: "en", fetchedAt: end } };
}
export function savedExecution(c: PaidShadowContract, body: unknown, reply: unknown, executionId = "12345") {
  const lane = c.lane === "meta" ? "meta" : "gads";
  return { id: executionId, workflowId: c.workflowId, workflowVersionId: c.workflowVersion,
    status: "success", finished: true, mode: "webhook", startedAt: start, stoppedAt: end,
    workflowData: { id: c.workflowId, versionId: c.workflowVersion, nodes: [
      { id: `incoming-${lane}`, name: "Incoming", type: "n8n-nodes-base.webhook" },
      { id: `result-${lane}`, name: "Result", type: "n8n-nodes-base.code" },
    ] }, data: { resultData: { runData: {
      Incoming: [{ executionStatus: "success", data: { main: [[{ json: { body, headers: { authorization: "never-export" } } }]] } }],
      Result: [{ executionStatus: "success", data: { main: [[{ json: reply }]] } }],
    } } } };
}
export const dns = async () => [{ address: "93.184.216.34", family: 4 as const }];
