/** Paid-ads shadow lane: AVGAR's six Meta routines and the Google Ads BOFU plan, served by
 * Nguyen's n8n workflows through their NATIVE provider credentials. Shadow recommendations
 * only — the built specs carry no execute node, the receipt must say executedAction "none",
 * and every stated CPA ceiling must be exactly 50% of a verified product price in the SAME
 * currency (Tom, 5 September 2026 — docs/integration/AVGAR-PILOT-POLICY.md). This contract
 * deliberately does not reuse the keyword pilot's provider semantics or credential pin. */
import { z } from "zod";
import { validateArtifactObject } from "../artifacts/validate";
import { round2 } from "../actions/rules/meta";
import { SKILL_BY_ID } from "../runtime/skills";
import type { ArtifactDraft, ArtifactItem } from "../runtime/types";
import { AVGAR_PILOT_ACCOUNT, type ShadowRunIdentity } from "./shadowContract";

export const PAID_SHADOW_CONTRACT = "unc.paid-ads-shadow.v1" as const;
/** Proposed receiver pins. Nguyen's wrapper handoff must confirm the exact callable URLs;
 * the bridge refuses any URL that is not also pinned in server configuration. */
export const META_SHADOW_RECEIVER_URL = "https://junctionai8.app.n8n.cloud/webhook/unc/d02/meta-shadow";
export const GADS_SHADOW_RECEIVER_URL = "https://junctionai8.app.n8n.cloud/webhook/unc/d02-w09/gads-bofu-shadow";
export const CPA_CAP_PCT = 50 as const;

export const META_SHADOW_ROUTINES = Object.freeze({
  "D02-W01": "daily_decisioning", "D02-W02": "creative_testing", "D02-W03": "hook_rotation",
  "D02-W04": "ad_fatigue", "D02-W06": "creative_test_planner", "D02-W07": "budget_pacing",
} as const);
export const GADS_SHADOW_ROUTINES = Object.freeze({ "D02-W09": "bofu_campaign_plan" } as const);
export type MetaShadowRoutineId = keyof typeof META_SHADOW_ROUTINES;
export type GadsShadowRoutineId = keyof typeof GADS_SHADOW_ROUTINES;
export type PaidShadowRoutineId = MetaShadowRoutineId | GadsShadowRoutineId;
export type PaidLane = "meta" | "google_ads";
export const PAID_SHADOW_ROUTINE_IDS: readonly PaidShadowRoutineId[] = Object.freeze([
  ...(Object.keys(META_SHADOW_ROUTINES) as MetaShadowRoutineId[]), ...(Object.keys(GADS_SHADOW_ROUTINES) as GadsShadowRoutineId[]),
]);
export const isPaidShadowRoutine = (id: string): id is PaidShadowRoutineId => (PAID_SHADOW_ROUTINE_IDS as readonly string[]).includes(id);
export const paidLaneOf = (id: PaidShadowRoutineId): PaidLane => id in META_SHADOW_ROUTINES ? "meta" : "google_ads";

/** DataForSEO location codes per approved market (docs/integration/AVGAR-PILOT-POLICY.md). */
export const PAID_MARKETS = Object.freeze({ US: 2840, NZ: 2554, AU: 2036 } as const);
export type PaidMarket = keyof typeof PAID_MARKETS;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const market = z.enum(["US", "NZ", "AU"]);
const timezone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
});
const domain = z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/);
const policy = z.object({
  cpaCapPct: z.literal(CPA_CAP_PCT),
  cpaCapBasis: z.literal("verified_product_price_same_currency"),
}).strict();
const base = {
  contract: z.literal(PAID_SHADOW_CONTRACT), accountId: z.literal(AVGAR_PILOT_ACCOUNT),
  workflowId: id, workflowVersion: z.string().uuid(), policy,
  data: z.object({ mode: z.literal("provider") }).strict(),
};
const metaRoutine = z.enum(Object.keys(META_SHADOW_ROUTINES) as [MetaShadowRoutineId, ...MetaShadowRoutineId[]]);
const gadsRoutine = z.enum(Object.keys(GADS_SHADOW_ROUTINES) as [GadsShadowRoutineId, ...GadsShadowRoutineId[]]);
const metaObject = z.object({
  ...base, lane: z.literal("meta"), routineId: metaRoutine,
  routineKey: z.enum(Object.values(META_SHADOW_ROUTINES) as [string, ...string[]]),
  client: z.object({
    id: z.literal("avgar"), adAccountId: z.string().regex(/^act_\d{5,20}$/), currency, timezone,
    reportingWindow: z.enum(["last_7d", "last_14d", "last_28d"]), market,
  }).strict(),
}).strict();
const gadsObject = z.object({
  ...base, lane: z.literal("google_ads"), routineId: gadsRoutine,
  routineKey: z.enum(Object.values(GADS_SHADOW_ROUTINES) as [string, ...string[]]),
  client: z.object({
    id: z.literal("avgar"), customerId: z.string().regex(/^\d{10}$/), currency, primaryDomain: domain,
    seedKeyword: z.string().trim().min(1).max(200), market, locationCode: z.number().int().positive(), languageCode: z.literal("en"),
  }).strict(),
}).strict();
export const paidShadowSchema = z.discriminatedUnion("lane", [metaObject, gadsObject]).superRefine((c, ctx) => {
  const key = c.lane === "meta" ? META_SHADOW_ROUTINES[c.routineId as MetaShadowRoutineId] : GADS_SHADOW_ROUTINES[c.routineId as GadsShadowRoutineId];
  if (key !== c.routineKey) ctx.addIssue({ code: "custom", message: "routineKey does not match routineId", path: ["routineKey"] });
  if (c.lane === "google_ads" && PAID_MARKETS[c.client.market] !== c.client.locationCode)
    ctx.addIssue({ code: "custom", message: "locationCode does not match market", path: ["client", "locationCode"] });
});
export type MetaShadowContract = z.infer<typeof metaObject>;
export type GadsShadowContract = z.infer<typeof gadsObject>;
export type PaidShadowContract = MetaShadowContract | GadsShadowContract;

export function paidShadowProblem(value: unknown): string | null {
  return paidShadowSchema.safeParse(value).success ? null : "invalid paid-ads shadow contract";
}
export const paidShadowReceiver = (c: PaidShadowContract) => c.lane === "meta" ? META_SHADOW_RECEIVER_URL : GADS_SHADOW_RECEIVER_URL;
export const paidShadowEnvPrefix = (c: PaidShadowContract) => c.lane === "meta" ? "N8N_META_SHADOW" : "N8N_GADS_SHADOW";
export function assertPaidShadowRequest(contract: PaidShadowContract, run: ShadowRunIdentity): void {
  if (paidShadowProblem(contract)) throw new Error("invalid paid-ads shadow contract");
  if (run.mode !== "dry_run" || run.accountId !== contract.accountId || run.routineId !== contract.routineId)
    throw new Error("paid-ads shadow account, routine or dry-run authority mismatch");
}

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
function fail(why: string): never { throw new Error(`paid-ads shadow artifact rejected: ${why}`); }
const ENTITY_ID = /^\d{5,30}$/;
const ENTITY_KEYS = ["ad_id", "adset_id", "campaign_id", "creative_id", "winner_ad_id", "underperformer_ad_id", "next_ad_id", "next_creative_id"] as const;
const OBSERVED_KEYS = new Set(["spend", "purchases", "purchase_value", "cpa", "roas", "ctr", "frequency", "impressions", "clicks", "daily_budget", "window_spend", "daily_budget_total", "projected_daily_spend"]);
/** Per-routine decision vocabulary. *_PROPOSED states are proposals for a founder, never executed changes. */
export const PAID_DECISION_STATES: Readonly<Record<PaidShadowRoutineId, readonly string[]>> = Object.freeze({
  "D02-W01": ["SCALE", "TURN_OFF", "HOLD", "KEEP", "NOT_ENOUGH_DATA"],
  "D02-W02": ["LAUNCH_PROPOSED", "WAIT", "BLOCKED"],
  "D02-W03": ["ROTATE_PROPOSED", "NONE_READY", "BLOCKED"],
  "D02-W04": ["PAUSE_PROPOSED", "KEEP", "BLOCKED"],
  "D02-W06": ["HYPOTHESIS", "BLOCKED"],
  "D02-W07": ["CUT_PROPOSED", "WITHIN_CAP", "BLOCKED"],
  "D02-W09": ["PLAN_PROPOSED", "BLOCKED"],
});
const PROPOSALS = new Set(["SCALE", "TURN_OFF", "LAUNCH_PROPOSED", "ROTATE_PROPOSED", "PAUSE_PROPOSED", "CUT_PROPOSED", "PLAN_PROPOSED"]);
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const numOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function forbidExecution(meta: Record<string, unknown>, where: string): void {
  if (meta.executed_action !== undefined && meta.executed_action !== "none") fail(`${where} claims an executed action`);
  if (meta.apply_ready === true || meta.mutation !== undefined || meta.action_id !== undefined || meta.scheduled === true ||
      meta.mutate_attempted === true || meta.meta_mutation_attempted === true) fail(`${where} is not a shadow recommendation`);
}

/** The cap rule as arithmetic: value must equal 50% of a positive verified price in the contract currency. */
function cleanCap(raw: unknown, contract: PaidShadowContract, where: string): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return null;
  const cap = object(raw);
  if (!cap || !num(cap.value) || !num(cap.product_price) || cap.product_price <= 0 || cap.currency !== contract.client.currency ||
      cap.basis !== "product_price_50pct" || round2(cap.value) !== round2(cap.product_price * CPA_CAP_PCT / 100))
    return fail(`${where} CPA cap is not 50% of a verified product price in ${contract.client.currency}`);
  return { value: round2(cap.value), currency: cap.currency, basis: "product_price_50pct", product_price: round2(cap.product_price),
    ...(text(cap.product_ref, 200) ? { product_ref: (cap.product_ref as string).slice(0, 200) } : {}) };
}

function cleanObserved(raw: unknown, where: string): Record<string, number | null> | undefined {
  if (raw === undefined) return undefined;
  const observed = object(raw);
  if (!observed) return fail(`${where} observed metrics must be an object`);
  const out: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(observed)) {
    if (!OBSERVED_KEYS.has(key) || !numOrNull(value)) return fail(`${where} observed.${key} is not a numeric observation`);
    out[key] = value as number | null;
  }
  return out;
}

function cleanMetaItem(item: ArtifactItem, contract: MetaShadowContract, index: number): ArtifactItem {
  const where = `item ${index + 1}`;
  const meta = object(item.meta) ?? fail(`${where} needs meta`);
  if (meta.routine !== undefined && meta.routine !== contract.routineId) fail(`${where} belongs to another routine`);
  if (Array.isArray(meta.routines)) fail(`${where} bundles several routines; one routine per run`);
  forbidExecution(meta, where);
  const state = meta.decision_state;
  if (typeof state !== "string" || !PAID_DECISION_STATES[contract.routineId].includes(state)) fail(`${where} decision_state is not one of ${PAID_DECISION_STATES[contract.routineId].join("|")}`);
  if (!["hypothesis", "observed", "blocked"].includes(String(meta.status))) fail(`${where} status must be hypothesis, observed or blocked`);
  if (meta.currency !== undefined && meta.currency !== contract.client.currency) fail(`${where} currency differs from the ad account`);
  const out: Record<string, unknown> = { routine: contract.routineId, decision_state: state, status: meta.status, executed_action: "none" };
  for (const key of ENTITY_KEYS) {
    if (meta[key] === undefined || meta[key] === null) continue;
    if (typeof meta[key] !== "string" || !ENTITY_ID.test(meta[key] as string)) fail(`${where} ${key} is not a platform entity ID`);
    out[key] = meta[key];
  }
  for (const key of ["ad_name", "adset_name", "campaign_name", "window", "blocked_field", "budget_source", "cap_reason", "next_action"] as const) {
    if (meta[key] === undefined || meta[key] === null) continue;
    if (!text(meta[key], 200)) fail(`${where} ${key} must be short text`);
    out[key] = (meta[key] as string).slice(0, 200);
  }
  const observed = cleanObserved(meta.observed, where);
  if (observed) out.observed = observed;
  const cap = cleanCap(meta.cpa_cap, contract, where);
  if (cap) out.cpa_cap = cap;
  if (meta.rollback_proposal !== undefined) {
    if (!text(meta.rollback_proposal, 400)) fail(`${where} rollback_proposal must be short text`);
    out.rollback_proposal = (meta.rollback_proposal as string).slice(0, 400);
  }
  if (meta.daily_budget_cap !== undefined && meta.daily_budget_cap !== null) {
    const cap = object(meta.daily_budget_cap);
    if (!cap || !num(cap.value) || cap.value <= 0 || cap.currency !== contract.client.currency) fail(`${where} daily_budget_cap needs a positive value in ${contract.client.currency}`);
    out.daily_budget_cap = { value: round2(cap.value), currency: cap.currency };
  }
  if (Array.isArray(meta.needs)) {
    if (meta.needs.length > 10 || meta.needs.some(n => !text(n, 200))) fail(`${where} needs must be up to ten short lines`);
    out.needs = meta.needs.map(n => (n as string).slice(0, 200));
  }
  for (const key of ["hook", "format", "offer", "hypothesis"] as const) {
    if (meta[key] === undefined) continue;
    if (!text(meta[key], 400)) fail(`${where} ${key} must be short text`);
    out[key] = (meta[key] as string).slice(0, 400);
  }
  if (typeof meta.experiment_ledger_connected === "boolean") out.experiment_ledger_connected = meta.experiment_ledger_connected;
  if (meta.test_budget_per_variant !== undefined) {
    if (!numOrNull(meta.test_budget_per_variant)) fail(`${where} test_budget_per_variant must be a number or null`);
    out.test_budget_per_variant = meta.test_budget_per_variant;
  }
  // Proposals must be reversible and bound to a real entity; a cap-based verdict must carry the cap it used.
  if (PROPOSALS.has(state)) {
    if (!out.rollback_proposal) fail(`${where} ${state} needs a rollback proposal`);
    const anchor: Record<string, readonly string[]> = { SCALE: ["adset_id"], TURN_OFF: ["adset_id"], PAUSE_PROPOSED: ["ad_id"],
      ROTATE_PROPOSED: ["ad_id", "next_ad_id"], CUT_PROPOSED: ["adset_id"], LAUNCH_PROPOSED: ["winner_ad_id"] };
    for (const key of anchor[state] ?? []) if (!out[key]) fail(`${where} ${state} needs ${key}`);
  }
  if (["SCALE", "TURN_OFF", "PAUSE_PROPOSED"].includes(state)) {
    if (!cap) fail(`${where} ${state} needs the CPA cap it was judged against`);
    const cpa = observed?.cpa, spend = observed?.spend, purchases = observed?.purchases;
    if (state === "SCALE" && !(num(cpa) && cpa <= (cap.value as number))) fail(`${where} SCALE requires an observed CPA at or under the cap`);
    if (state !== "SCALE" && !((num(cpa) && cpa > (cap.value as number)) || (purchases === 0 && num(spend) && spend >= (cap.value as number))))
      fail(`${where} ${state} requires an observed CPA over the cap, or spend past the cap with no purchases`);
  }
  if (meta.cap_reason === "pending_product_price" && cap) fail(`${where} cannot both hold for a price and state a cap`);
  return { title: item.title, body: item.body, meta: out };
}

const MATCH_TYPES = new Set(["EXACT", "PHRASE", "BROAD"]);
function cleanGadsItem(item: ArtifactItem, contract: GadsShadowContract, index: number): ArtifactItem {
  const where = `item ${index + 1}`;
  const meta = object(item.meta) ?? fail(`${where} needs meta`);
  if (meta.routine !== undefined && meta.routine !== contract.routineId) fail(`${where} belongs to another routine`);
  forbidExecution(meta, where);
  const state = meta.decision_state;
  if (typeof state !== "string" || !PAID_DECISION_STATES["D02-W09"].includes(state)) fail(`${where} decision_state must be PLAN_PROPOSED or BLOCKED`);
  if (!["hypothesis", "observed", "blocked"].includes(String(meta.status))) fail(`${where} status must be hypothesis, observed or blocked`);
  if (meta.campaign_status !== "PAUSED") fail(`${where} campaign_status must be PAUSED`);
  if (meta.customer_id !== undefined && meta.customer_id !== contract.client.customerId) fail(`${where} customer_id is not the bound Google Ads customer`);
  if (meta.market !== undefined && meta.market !== contract.client.market) fail(`${where} market differs from the contract`);
  if (meta.login_customer_id !== undefined && meta.login_customer_id !== null && !/^\d{10}$/.test(String(meta.login_customer_id))) fail(`${where} login_customer_id is invalid`);
  if (meta.conversion_action !== undefined && meta.conversion_action !== null && !text(meta.conversion_action, 200)) fail(`${where} conversion_action is invalid`);
  const out: Record<string, unknown> = { routine: contract.routineId, decision_state: state, status: meta.status, executed_action: "none",
    campaign_status: "PAUSED", customer_id: contract.client.customerId, market: contract.client.market, mutate_attempted: false,
    login_customer_id: meta.login_customer_id ?? null, conversion_action: meta.conversion_action ?? null };
  if (meta.ad_group !== undefined) { if (!text(meta.ad_group, 200)) fail(`${where} ad_group must be short text`); out.ad_group = (meta.ad_group as string).slice(0, 200); }
  if (meta.keywords !== undefined) {
    if (!Array.isArray(meta.keywords) || meta.keywords.length > 50) fail(`${where} keywords must be up to 50 entries`);
    out.keywords = meta.keywords.map((raw, i) => {
      const k = object(raw) ?? fail(`${where} keywords[${i}] must be an object`);
      if (!text(k.keyword, 200) || !MATCH_TYPES.has(String(k.match_type))) fail(`${where} keywords[${i}] needs a keyword and EXACT|PHRASE|BROAD match type`);
      for (const key of ["search_volume", "cpc"]) if (k[key] !== undefined && !numOrNull(k[key])) fail(`${where} keywords[${i}].${key} must be a number or null`);
      return { keyword: (k.keyword as string).slice(0, 200), match_type: k.match_type, search_volume: k.search_volume ?? null, cpc: k.cpc ?? null,
        competition: text(k.competition, 40) ? (k.competition as string) : num(k.competition) ? k.competition : null, intent: text(k.intent, 40) ? (k.intent as string) : null };
    });
  }
  if (meta.negatives !== undefined) {
    if (!Array.isArray(meta.negatives) || meta.negatives.length > 100 || meta.negatives.some(n => !text(n, 100))) fail(`${where} negatives must be up to 100 short terms`);
    out.negatives = meta.negatives.map(n => (n as string).slice(0, 100));
  }
  if (meta.landing_url !== undefined && meta.landing_url !== null) {
    let url: URL;
    try { url = new URL(String(meta.landing_url)); } catch { return fail(`${where} landing_url is not a URL`); }
    if (url.protocol !== "https:" || (url.hostname !== contract.client.primaryDomain && !url.hostname.endsWith(`.${contract.client.primaryDomain}`)))
      fail(`${where} landing_url is not on ${contract.client.primaryDomain}`);
    out.landing_url = url.href.slice(0, 400);
  }
  for (const [key, max, each] of [["headlines", 15, 30], ["descriptions", 4, 90]] as const) {
    if (meta[key] === undefined) continue;
    if (!Array.isArray(meta[key]) || (meta[key] as unknown[]).length > max || (meta[key] as unknown[]).some(v => !text(v, each))) fail(`${where} ${key} exceed Google Ads limits`);
    out[key] = (meta[key] as string[]).map(v => v.slice(0, each));
  }
  const cap = cleanCap(meta.cpa_ceiling ?? meta.cpa_cap, contract, where);
  out.cpa_ceiling = cap;
  if (meta.cap_reason !== undefined) { if (!text(meta.cap_reason, 200)) fail(`${where} cap_reason must be short text`); out.cap_reason = meta.cap_reason; }
  if (state === "PLAN_PROPOSED") {
    if (!Array.isArray(out.keywords) || !out.keywords.length) fail(`${where} PLAN_PROPOSED needs at least one keyword line`);
    if (!cap && meta.cap_reason !== "pending_product_price") fail(`${where} PLAN_PROPOSED needs a CPA ceiling or cap_reason pending_product_price`);
  }
  if (Array.isArray(meta.needs)) {
    if (meta.needs.length > 10 || meta.needs.some(n => !text(n, 200))) fail(`${where} needs must be up to ten short lines`);
    out.needs = meta.needs.map(n => (n as string).slice(0, 200));
  }
  return { title: item.title, body: item.body, meta: out };
}

/** Structural validation is not usefulness acceptance. Only whitelisted, checked fields survive:
 * no raw provider payloads, notes or executed-change claims are checkpointed. */
export function paidShadowArtifact(value: unknown, contract: PaidShadowContract, run: ShadowRunIdentity): ArtifactDraft {
  assertPaidShadowRequest(contract, run);
  const maxItems = SKILL_BY_ID[contract.routineId]?.maxItems ?? 1;
  const parsed = validateArtifactObject(value, { kind: "generic", maxItems, allowedNumbers: null, requireItems: true });
  if (!parsed.ok) fail(parsed.reason);
  const draft = parsed.artifact;
  const root = draft.meta ?? {};
  forbidExecution(root, "artifact");
  if (root.executed_action !== undefined && root.executed_action !== "none") fail("artifact claims an executed action");
  const items = (draft.items ?? []).map((item, index) => contract.lane === "meta" ? cleanMetaItem(item, contract, index) : cleanGadsItem(item, contract, index));
  const out: ArtifactDraft = { ...draft, items, meta: {} };
  if (Buffer.byteLength(JSON.stringify(out), "utf8") > 256_000) fail("artifact is too large to checkpoint");
  return out;
}

export function validatePaidShadowReceipt(value: unknown, contract: PaidShadowContract, run: ShadowRunIdentity, now: Date): Record<string, unknown> {
  assertPaidShadowRequest(contract, run);
  const receipt = object(value);
  const expected = { contract: contract.contract, accountId: run.accountId, runId: run.runId,
    routineId: run.routineId, routineKey: contract.routineKey, workflowId: contract.workflowId, lane: contract.lane,
    mode: "dry_run", status: "succeeded", executedAction: "none" };
  for (const [key, val] of Object.entries(expected)) if (receipt?.[key] !== val) throw new Error(`paid-ads receipt ${key} mismatch`);
  if (!receipt || receipt.workflowVersion !== null || receipt.revisionEvidence !== "pending_unc_verification" ||
      typeof receipt.executionId !== "string" || !/^[1-9]\d{0,29}$/.test(receipt.executionId))
    throw new Error("paid-ads receipt requires actual execution and pending independent revision verification");
  for (const [key, val] of Object.entries(contract.client))
    if (object(receipt.client)?.[key] !== val) throw new Error(`paid-ads receipt client.${key} mismatch`);
  const started = Date.parse(String(receipt.startedAt)), finished = Date.parse(String(receipt.finishedAt));
  const runStart = Date.parse(run.startedAt), clock = now.getTime();
  if (![started, finished, runStart, clock].every(Number.isFinite) || started < runStart - 30000 ||
      finished < started || finished > clock + 30000 || clock - finished > 900000)
    throw new Error("paid-ads receipt timing is stale or invalid");
  const provider = object(receipt.provider);
  if (!provider) throw new Error("paid-ads receipt lacks provider evidence");
  const fetched = Date.parse(String(provider.fetchedAt));
  if (!Number.isFinite(fetched) || fetched < started - 30000 || fetched > finished + 30000) throw new Error("paid-ads provider read is outside this execution");
  let cleanProvider: Record<string, unknown>;
  if (contract.lane === "meta") {
    if (provider.name !== "meta_graph" || provider.dataset !== "ads_insights" || provider.adAccountId !== contract.client.adAccountId ||
        provider.currency !== contract.client.currency || provider.reportingWindow !== contract.client.reportingWindow ||
        provider.statusCode !== 200 || !Number.isSafeInteger(provider.itemsCount) || Number(provider.itemsCount) < 0 ||
        (provider.credentialRef !== undefined && !id.safeParse(provider.credentialRef).success))
      throw new Error("paid-ads Meta evidence is incomplete or bound to another ad account, currency or window");
    cleanProvider = { name: "meta_graph", dataset: "ads_insights", adAccountId: provider.adAccountId, currency: provider.currency,
      reportingWindow: provider.reportingWindow, statusCode: 200, itemsCount: provider.itemsCount, fetchedAt: provider.fetchedAt,
      ...(provider.credentialRef !== undefined ? { credentialRef: provider.credentialRef } : {}) };
  } else {
    if (provider.name !== "dataforseo" || provider.statusCode !== 20000 || provider.taskStatusCode !== 20000 || !text(provider.taskId, 200) ||
        !Number.isInteger(provider.itemsCount) || Number(provider.itemsCount) < 1 || provider.locationCode !== contract.client.locationCode ||
        provider.languageCode !== contract.client.languageCode)
      throw new Error("paid-ads receipt lacks successful DataForSEO task evidence for the contract market");
    cleanProvider = { name: "dataforseo", statusCode: 20000, taskStatusCode: 20000, taskId: provider.taskId, itemsCount: provider.itemsCount,
      locationCode: provider.locationCode, languageCode: provider.languageCode, fetchedAt: provider.fetchedAt };
  }
  return { ...expected, workflowVersion: null, expectedWorkflowVersion: contract.workflowVersion, revisionEvidence: "pending_unc_verification",
    executionId: receipt.executionId, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, client: { ...contract.client }, provider: cleanProvider };
}

export function verifyPaidShadowExecution(value: unknown, observation: unknown, contract: PaidShadowContract, run: ShadowRunIdentity,
  now: Date, expectedDigest: string, expectedResultDigest: string): Record<string, unknown> {
  const receipt = validatePaidShadowReceipt(value, contract, run, now), seen = object(observation);
  for (const [key, expected] of Object.entries({ source: "n8n_execution_record", executionId: receipt.executionId,
    workflowId: contract.workflowId, workflowVersion: contract.workflowVersion, status: "success", finished: true }))
    if (seen?.[key] !== expected) throw new Error(`independent paid-ads execution ${key} mismatch`);
  for (const [key, expected] of Object.entries({ accountId: run.accountId, runId: run.runId, routineId: run.routineId }))
    if (object(seen?.request)?.[key] !== expected) throw new Error(`independent paid-ads request ${key} mismatch`);
  if (!hash.safeParse(expectedDigest).success || seen?.requestDigest !== expectedDigest) throw new Error("independent paid-ads request digest mismatch");
  if (!hash.safeParse(expectedResultDigest).success || seen?.resultDigest !== expectedResultDigest) throw new Error("independent paid-ads result digest mismatch");
  const started = Date.parse(String(seen?.startedAt)), stopped = Date.parse(String(seen?.stoppedAt));
  if (![started, stopped].every(Number.isFinite) || stopped < started ||
      Math.abs(started - Date.parse(String(receipt.startedAt))) > 30000 ||
      stopped < Date.parse(String(receipt.finishedAt)) - 30000 || stopped > now.getTime() + 30000 || now.getTime() - stopped > 900000)
    throw new Error("independent paid-ads execution timing is invalid");
  return { ...receipt, workflowVersion: contract.workflowVersion, revisionEvidence: "verified_execution_record",
    revisionVerification: { source: "n8n_execution_record", verifiedAt: now.toISOString(),
      startedAt: seen!.startedAt, stoppedAt: seen!.stoppedAt, requestDigest: expectedDigest, resultDigest: expectedResultDigest } };
}

/** Recovery never extends a provider allowance or relabels old ad data as fresh. */
export function verifyHistoricalPaidShadowExecution(value: unknown, observation: unknown, contract: PaidShadowContract,
  run: ShadowRunIdentity, now: Date, requestDigest: string, resultDigest: string,
  admission: { dispatchedAt: string; authorizedAt: string }): Record<string, unknown> {
  const seen = object(observation), start = Date.parse(String(seen?.startedAt)), end = Date.parse(String(seen?.stoppedAt));
  const runStart = Date.parse(run.startedAt), dispatch = Date.parse(admission.dispatchedAt), auth = Date.parse(admission.authorizedAt);
  const clock = now.getTime();
  if (![start, end, runStart, dispatch, auth, clock].every(Number.isFinite) || dispatch < runStart - 30000 ||
      dispatch > runStart + 900000 || auth < dispatch || auth > dispatch + 900000 || start < dispatch - 30000 ||
      start > auth + 30000 || end < start || end < auth - 30000 || end > start + 900000 || end > clock + 30000)
    throw new Error("paid-ads recovery is outside its original authorized window");
  const verified = verifyPaidShadowExecution(value, seen, contract, run, new Date(end), requestDigest, resultDigest);
  return { ...verified, revisionVerification: { ...(verified.revisionVerification as Record<string, unknown>),
    verifiedAt: now.toISOString(), method: "historical_reconciliation", dispatchedAt: admission.dispatchedAt, authorizedAt: admission.authorizedAt } };
}
