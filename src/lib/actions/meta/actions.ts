/* The Meta action set (Graph API v23.0). Request shapes follow the Marketing API reference:

     insights      GET  act_{id}/insights?level=&fields=&date_preset=|time_range=&limit=
     ad sets       GET  act_{id}/adsets?fields=id,name,status,effective_status,daily_budget,…
     pause/resume  POST /{adset_id} status=PAUSED|ACTIVE       (same for /{ad_id})
     budget        POST /{adset_id} daily_budget=<minor units>
     campaign      POST act_{id}/campaigns  name, objective, status=PAUSED, special_ad_categories
     ad set        POST act_{id}/adsets     campaign_id, daily_budget, billing_event, optimization_goal,
                                            bid_strategy, targeting, promoted_object, status=PAUSED
     ad            POST act_{id}/ads        adset_id, creative={creative_id}|{source_instagram_media_id},
                                            status=PAUSED
     image         POST act_{id}/adimages   url=<https image url>

   Every mutation is PAUSED-by-default where it creates, exact-inverse where it changes, and
   every dry run is the literal request with the bearer token redacted. Guards are pure and
   run against the account caps, the taste ceiling and the preset's change bounds. */

import { withPresetDefaults } from "../presets";
import type { Action, ActionContext, ActionError, ExecuteResult, ShapedRequest, Violation } from "../types";
import { actId, fromMinorUnits, redactId, send, shapeGet, shapePost, toMinorUnits } from "./graph";
import { summarise, toPerformanceRow, type PerformanceRow, type PerformanceSummary, type Row } from "./insights";

// ---------- shared helpers ----------

const ID_RE = /^\d{6,25}$/;

function fmt(currency: string, n: number): string {
  return `${currency} ${n.toFixed(2)}`;
}

function pct(from: number, to: number): number {
  return from > 0 ? Math.round(((to - from) / from) * 1000) / 10 : 0;
}

function violation(code: string, message: string, extra: Partial<Violation> = {}): Violation {
  return { code, message, ...extra };
}

function requireId(params: Record<string, unknown>, key: string, what: string): Violation[] {
  const v = params[key];
  if (v === undefined || v === null || v === "") return [violation("missing_param", `${what} id is required (${key})`, { param: key })];
  if (!ID_RE.test(String(v))) return [violation("invalid_param", `${what} id "${String(v).slice(0, 30)}" is not a Meta object id`, { param: key, actual: String(v).slice(0, 30) })];
  return [];
}

function account(ctx: ActionContext): string {
  return ctx.credential?.kind === "meta_ads" ? actId(ctx.credential.adAccountId) : "act_<not-connected>";
}

function noCredential(receipt: string): ExecuteResult {
  return { ok: false, receipt, error: { code: "not_connected", reason: "Meta is not connected for this account — nothing was sent", retryable: false } };
}

function fail(receipt: string, error: ActionError, sent: ShapedRequest[] = [], rateLimit: ExecuteResult["rateLimit"] = null): ExecuteResult {
  return { ok: false, receipt, error, sent, rateLimit };
}

/** A budget change bounded by the caps, the taste ceiling and the preset's change bound. */
export function budgetGuards(dailyBudget: unknown, currentDailyBudget: unknown, ctx: ActionContext, key = "dailyBudget"): Violation[] {
  const out: Violation[] = [];
  const next = typeof dailyBudget === "number" ? dailyBudget : Number(dailyBudget);
  if (dailyBudget === undefined || dailyBudget === null || dailyBudget === "" || !Number.isFinite(next)) {
    return [violation("missing_param", `${key} must be a number in ${ctx.currency} (or give changePct with currentDailyBudget)`, { param: key })];
  }
  if (next <= 0) out.push(violation("invalid_param", `${key} must be above zero`, { param: key, actual: next }));
  if (next > ctx.caps.perDay) out.push(violation("cap_per_day", `${fmt(ctx.currency, next)}/day is over your ${fmt(ctx.currency, ctx.caps.perDay)}/day cap`, { param: key, limit: ctx.caps.perDay, actual: next }));
  if (next * 30 > ctx.caps.perMonth) out.push(violation("cap_per_month", `${fmt(ctx.currency, next)}/day would be ${fmt(ctx.currency, next * 30)} over a month, over your ${fmt(ctx.currency, ctx.caps.perMonth)}/month cap`, { param: key, limit: ctx.caps.perMonth, actual: next * 30 }));
  const cur = currentDailyBudget === undefined || currentDailyBudget === null || currentDailyBudget === "" ? null : Number(currentDailyBudget);
  if (cur === null || !Number.isFinite(cur)) {
    out.push(violation("missing_param", "currentDailyBudget is required to bound the change", { param: "currentDailyBudget" }));
    return out;
  }
  const preset = withPresetDefaults(ctx.preset);
  const change = cur > 0 ? Math.abs(pct(cur, next)) : null;
  if (change !== null && change > preset.maxBudgetChangePct) {
    out.push(violation("step_limit", `a ${change}% change is over the ${preset.maxBudgetChangePct}% per-day bound in your preset`, { param: key, limit: preset.maxBudgetChangePct, actual: change }));
  }
  const delta = next - cur;
  if (ctx.spendCeiling !== null && delta > ctx.spendCeiling) {
    out.push(violation("taste_ceiling", `+${fmt(ctx.currency, delta)}/day is above the ${fmt(ctx.currency, ctx.spendCeiling)}/day you usually approve`, { param: key, limit: ctx.spendCeiling, actual: delta }));
  }
  return out;
}

// ---------- read: campaign performance ----------

export type InsightsLevel = "campaign" | "adset" | "ad";
export const DATE_PRESETS = ["today", "yesterday", "last_3d", "last_7d", "last_14d", "last_28d", "last_30d", "last_90d", "this_month", "last_month"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export interface ReadPerformanceParams extends Record<string, unknown> {
  level?: InsightsLevel;
  datePreset?: DatePreset;
  /** YYYY-MM-DD; both required to use a time_range instead of a preset. */
  since?: string;
  until?: string;
  limit?: number;
  /** Also read daily budgets (a second GET) so rows carry dailyBudget. Default true for adset/campaign. */
  withBudgets?: boolean;
}

export interface ReadPerformanceResponse extends Record<string, unknown> {
  level: InsightsLevel;
  window: string;
  rows: PerformanceRow[];
  summary: PerformanceSummary;
  budgetsRead: boolean;
}

const INSIGHT_FIELDS = ["spend", "impressions", "clicks", "ctr", "frequency", "purchase_roas", "actions", "action_values"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function windowParams(p: ReadPerformanceParams): { params: Record<string, string>; label: string } {
  if (p.since && p.until && DATE_RE.test(p.since) && DATE_RE.test(p.until)) return { params: { time_range: JSON.stringify({ since: p.since, until: p.until }) }, label: `${p.since}..${p.until}` };
  const preset = p.datePreset && (DATE_PRESETS as readonly string[]).includes(p.datePreset) ? p.datePreset : "last_7d";
  return { params: { date_preset: preset }, label: preset };
}

function insightsRequest(p: ReadPerformanceParams, ctx: ActionContext): { request: ShapedRequest; level: InsightsLevel; label: string } {
  const level: InsightsLevel = p.level && ["campaign", "adset", "ad"].includes(p.level) ? p.level : "adset";
  const fields = [...INSIGHT_FIELDS, `${level}_id`, `${level}_name`, ...(level === "ad" ? ["adset_id"] : []), ...(level !== "campaign" ? ["campaign_id"] : [])];
  const w = windowParams(p);
  const request = shapeGet(`${account(ctx)}/insights`, { level, fields: fields.join(","), ...w.params, limit: String(Math.min(Math.max(1, p.limit ?? 100), 500)) }, `read ${level}-level performance over ${w.label}`);
  return { request, level, label: w.label };
}

function budgetsRequest(level: InsightsLevel, ctx: ActionContext, limit: number): ShapedRequest {
  const noun = level === "adset" ? "adsets" : "campaigns";
  return shapeGet(`${account(ctx)}/${noun}`, { fields: "id,name,status,effective_status,daily_budget,lifetime_budget", limit: String(limit) }, `read ${noun} daily budgets (minor units)`);
}

export const readPerformance: Action<ReadPerformanceParams, ReadPerformanceResponse> = {
  id: "meta.campaign.read_performance",
  platform: "meta_ads",
  title: "Read paid performance",
  description: "Spend, results, CPA, ROAS and frequency per campaign / ad set / ad over a window, plus daily budgets. Reads only.",
  risk: "read",
  params: {
    type: "object",
    properties: {
      level: { type: "string", description: "campaign | adset | ad (default adset)", enum: ["campaign", "adset", "ad"] },
      datePreset: { type: "string", description: "Meta date preset (default last_7d)", enum: DATE_PRESETS },
      since: { type: "string", description: "YYYY-MM-DD — with until, replaces the preset" },
      until: { type: "string", description: "YYYY-MM-DD" },
      limit: { type: "integer", description: "rows per page, 1–500 (default 100)", minimum: 1, maximum: 500 },
      withBudgets: { type: "boolean", description: "also read daily budgets (default true)" },
    },
  },
  guards(p) {
    const out: Violation[] = [];
    if (p.level && !["campaign", "adset", "ad"].includes(p.level)) out.push(violation("invalid_param", `level "${p.level}" is not campaign | adset | ad`, { param: "level" }));
    if (p.datePreset && !(DATE_PRESETS as readonly string[]).includes(p.datePreset)) out.push(violation("invalid_param", `datePreset "${p.datePreset}" is not a Meta preset`, { param: "datePreset" }));
    if ((p.since && !DATE_RE.test(p.since)) || (p.until && !DATE_RE.test(p.until))) out.push(violation("invalid_param", "since/until must be YYYY-MM-DD", { param: "since" }));
    if ((p.since && !p.until) || (!p.since && p.until)) out.push(violation("invalid_param", "since and until go together", { param: "until" }));
    return out;
  },
  dryRun(p, ctx) {
    const { request, level, label } = insightsRequest(p, ctx);
    const withBudgets = p.withBudgets ?? level !== "ad";
    return { request, ...(withBudgets ? { followUps: [budgetsRequest(level, ctx, 200)] } : {}), preview: `Read ${level}-level performance over ${label}${withBudgets ? " with daily budgets" : ""} — no change to the account` };
  },
  async execute(p, ctx) {
    const { request, level, label } = insightsRequest(p, ctx);
    if (ctx.credential?.kind !== "meta_ads") return noCredential(`Read ${level} performance: not connected`) as ExecuteResult<ReadPerformanceResponse>;
    const token = ctx.credential.accessToken;
    const sent: ShapedRequest[] = [];
    const raw: Row[] = [];
    let url: string | null = request.url;
    let pages = 0;
    let rateLimit: ExecuteResult["rateLimit"] = null;
    while (url && pages < 5) {
      const req: ShapedRequest = { ...request, url };
      sent.push(req);
      const res = await send(req, token, { fetch: ctx.fetch, timeoutMs: ctx.timeoutMs });
      rateLimit = res.rateLimit;
      if (!res.ok) return fail(`Read ${level} performance failed: ${res.error.reason}`, res.error, sent, res.rateLimit) as ExecuteResult<ReadPerformanceResponse>;
      const data = (res.json as { data?: unknown })?.data;
      if (!Array.isArray(data)) return fail(`Read ${level} performance failed: no data array`, { code: "unknown", reason: "Meta answered without a data array", retryable: false }, sent, res.rateLimit) as ExecuteResult<ReadPerformanceResponse>;
      raw.push(...(data as Row[]));
      pages++;
      const paging = (res.json as { paging?: { cursors?: { after?: string }; next?: string } }).paging;
      url = paging?.next && paging.cursors?.after ? `${request.url}&after=${encodeURIComponent(paging.cursors.after)}` : null;
      if (rateLimit?.throttled) break;
    }
    let rows = raw.map((r) => toPerformanceRow(r, level));
    const withBudgets = p.withBudgets ?? level !== "ad";
    let budgetsRead = false;
    if (withBudgets && !rateLimit?.throttled) {
      const breq = budgetsRequest(level, ctx, 200);
      sent.push(breq);
      const bres = await send(breq, token, { fetch: ctx.fetch, timeoutMs: ctx.timeoutMs });
      if (bres.ok) {
        rateLimit = bres.rateLimit;
        const budgets = new Map<string, { daily: number | null; status?: string }>();
        for (const o of ((bres.json as { data?: Row[] }).data ?? []) as Row[]) {
          budgets.set(String(o.id), { daily: o.daily_budget === undefined || o.daily_budget === null ? null : fromMinorUnits(o.daily_budget as string, ctx.currency), status: typeof o.effective_status === "string" ? o.effective_status : undefined });
        }
        rows = rows.map((r) => {
          const b = budgets.get(r.id);
          return b ? { ...r, dailyBudget: b.daily, ...(b.status ? { status: b.status } : {}) } : r;
        });
        budgetsRead = true;
      }
    }
    const summary = summarise(rows);
    return {
      ok: true,
      receipt: `Read ${rows.length} ${level}${rows.length === 1 ? "" : "s"} over ${label}: ${fmt(ctx.currency, summary.spend)} spend, ${summary.purchases} purchases, CPA ${summary.cpa === null ? "—" : fmt(ctx.currency, summary.cpa)}, ROAS ${summary.roas}×`,
      response: { level, window: label, rows, summary, budgetsRead },
      sent,
      rateLimit,
    };
  },
};

// ---------- status changes (pause / resume) ----------

type Noun = "adset" | "ad";
type Status = "PAUSED" | "ACTIVE";

function statusAction(noun: Noun, status: Status): Action<{ [k: string]: unknown }> {
  const key = noun === "adset" ? "adsetId" : "adId";
  const what = noun === "adset" ? "ad set" : "ad";
  const verb = status === "PAUSED" ? "pause" : "resume";
  const inverse: Status = status === "PAUSED" ? "ACTIVE" : "PAUSED";
  const id = `meta.${noun}.${verb}`;
  const shape = (p: Record<string, unknown>) => shapePost(String(p[key] ?? ""), { status }, `${verb} ${what} ${redactId(String(p[key] ?? ""))}`);
  return {
    id,
    platform: "meta_ads",
    title: `${verb === "pause" ? "Pause" : "Resume"} ${what}`,
    description: `Sets the ${what}'s status to ${status}. Exact inverse: meta.${noun}.${verb === "pause" ? "resume" : "pause"}.`,
    risk: "reversible",
    params: { type: "object", properties: { [key]: { type: "string", description: `Meta ${what} id`, required: true, example: `{{decision.params.${key}}}` }, reason: { type: "string", description: "why (lands on the receipt)" } } },
    guards: (p) => requireId(p, key, what),
    dryRun: (p) => ({ request: shape(p), preview: `${verb === "pause" ? "Pause" : "Resume"} ${what} ${redactId(String(p[key]))}${p.reason ? ` — ${String(p.reason)}` : ""}`, before: `${what} ${inverse}`, after: `${what} ${status}` }),
    async execute(p, ctx) {
      const req = shape(p);
      const receipt = `${verb === "pause" ? "Paused" : "Resumed"} ${what} ${redactId(String(p[key]))}`;
      if (ctx.credential?.kind !== "meta_ads") return noCredential(`${receipt}: not connected`);
      const res = await send(req, ctx.credential.accessToken, { fetch: ctx.fetch, timeoutMs: ctx.timeoutMs });
      if (!res.ok) return fail(`${verb} ${what} ${redactId(String(p[key]))} failed: ${res.error.reason}`, res.error, [req], res.rateLimit);
      return { ok: true, externalId: String(p[key]), receipt, response: { success: true }, sent: [req], rateLimit: res.rateLimit };
    },
    rollback: (p) => ({ actionId: `meta.${noun}.${verb === "pause" ? "resume" : "pause"}`, params: { [key]: p[key] }, note: `set ${what} back to ${inverse}` }),
  };
}

export const adsetPause = statusAction("adset", "PAUSED");
export const adsetResume = statusAction("adset", "ACTIVE");
export const adPause = statusAction("ad", "PAUSED");
export const adResume = statusAction("ad", "ACTIVE");

// ---------- ad set daily budget ----------

export interface SetDailyBudgetParams extends Record<string, unknown> {
  adsetId: string;
  /** New daily budget in the account currency. Either this or changePct. */
  dailyBudget?: number;
  /** Relative change (+20 = up 20%, -25 = down 25%) applied to currentDailyBudget. */
  changePct?: number;
  /** The budget it has now — required so the change can be bounded and the receipt can say before → after. */
  currentDailyBudget: number;
  reason?: string;
}

/** The budget the params ask for: an explicit dailyBudget, else currentDailyBudget × (1 + changePct/100). */
export function resolveTargetBudget(p: Pick<SetDailyBudgetParams, "dailyBudget" | "changePct" | "currentDailyBudget">): number | null {
  const explicit = p.dailyBudget === undefined || p.dailyBudget === null || (p.dailyBudget as unknown) === "" ? null : Number(p.dailyBudget);
  if (explicit !== null && Number.isFinite(explicit)) return Math.round(explicit * 100) / 100;
  const cur = Number(p.currentDailyBudget);
  const pctChange = p.changePct === undefined || p.changePct === null || (p.changePct as unknown) === "" ? null : Number(p.changePct);
  if (pctChange !== null && Number.isFinite(pctChange) && Number.isFinite(cur) && cur > 0) return Math.round(cur * (1 + pctChange / 100) * 100) / 100;
  return null;
}

export const adsetSetDailyBudget: Action<SetDailyBudgetParams> = {
  id: "meta.adset.set_daily_budget",
  platform: "meta_ads",
  title: "Set ad set daily budget",
  description: "Changes an ad set's daily budget. Bounded by the account caps, the taste ceiling and the preset's per-day change bound. Rollback restores the previous budget.",
  risk: "spend",
  params: {
    type: "object",
    properties: {
      adsetId: { type: "string", description: "Meta ad set id", required: true, example: "{{decision.params.adsetId}}" },
      dailyBudget: { type: "number", description: "new daily budget (account currency) — or give changePct", minimum: 0, example: "{{decision.params.dailyBudget}}" },
      changePct: { type: "number", description: "relative change in % (+20 up, -25 down) on currentDailyBudget — or give dailyBudget", example: 20 },
      currentDailyBudget: { type: "number", description: "current daily budget (account currency)", required: true, example: "{{decision.params.currentDailyBudget}}" },
      reason: { type: "string", description: "why (lands on the receipt)" },
    },
  },
  guards: (p, ctx) => [...requireId(p, "adsetId", "ad set"), ...budgetGuards(resolveTargetBudget(p) ?? undefined, p.currentDailyBudget, ctx)],
  dryRun(p, ctx) {
    const next = resolveTargetBudget(p) ?? NaN;
    const cur = Number(p.currentDailyBudget);
    const minor = toMinorUnits(Number.isFinite(next) ? next : 0, ctx.currency);
    const request = shapePost(String(p.adsetId ?? ""), { daily_budget: minor }, `set ad set ${redactId(p.adsetId)} daily_budget=${minor} (minor units of ${ctx.currency})`);
    const change = Number.isFinite(cur) && cur > 0 ? pct(cur, next) : null;
    return {
      request,
      preview: `Set ad set ${redactId(p.adsetId)} daily budget ${Number.isFinite(cur) ? `${fmt(ctx.currency, cur)} → ` : ""}${fmt(ctx.currency, next)}${change !== null ? ` (${change >= 0 ? "+" : ""}${change}%)` : ""}${p.reason ? ` — ${p.reason}` : ""}`,
      spend: { amount: next, currency: ctx.currency, perDay: true },
      before: Number.isFinite(cur) ? `${fmt(ctx.currency, cur)}/day` : undefined,
      after: `${fmt(ctx.currency, next)}/day`,
    };
  },
  async execute(p, ctx) {
    const dry = this.dryRun(p, ctx);
    if (ctx.credential?.kind !== "meta_ads") return noCredential(`${dry.preview}: not connected`);
    const res = await send(dry.request, ctx.credential.accessToken, { fetch: ctx.fetch, timeoutMs: ctx.timeoutMs });
    if (!res.ok) return fail(`${dry.preview} failed: ${res.error.reason}`, res.error, [dry.request], res.rateLimit);
    return { ok: true, externalId: String(p.adsetId), receipt: dry.preview, response: { success: true, daily_budget_minor: dry.request.body?.daily_budget }, sent: [dry.request], rateLimit: res.rateLimit };
  },
  rollback: (p) => (Number.isFinite(Number(p.currentDailyBudget)) ? { actionId: "meta.adset.set_daily_budget", params: { adsetId: p.adsetId, dailyBudget: Number(p.currentDailyBudget), currentDailyBudget: resolveTargetBudget(p) ?? Number(p.currentDailyBudget) }, note: "restore the previous daily budget" } : null),
};

// ---------- ad rotation (pause one, resume another) ----------

export interface RotateAdParams extends Record<string, unknown> {
  pauseAdId: string;
  resumeAdId: string;
  reason?: string;
}

export const adRotate: Action<RotateAdParams> = {
  id: "meta.ad.rotate",
  platform: "meta_ads",
  title: "Rotate a fresh ad in",
  description: "Resumes the next variant, then pauses the fatigued ad — two status calls, both reversible.",
  risk: "reversible",
  params: {
    type: "object",
    properties: {
      pauseAdId: { type: "string", description: "the fatigued ad", required: true, example: "{{decision.params.adId}}" },
      resumeAdId: { type: "string", description: "the variant to bring in", required: true, example: "{{decision.params.nextAdId}}" },
      reason: { type: "string", description: "why (lands on the receipt)" },
    },
  },
  guards(p) {
    const out = [...requireId(p, "pauseAdId", "fatigued ad"), ...requireId(p, "resumeAdId", "next ad")];
    if (p.pauseAdId && p.pauseAdId === p.resumeAdId) out.push(violation("invalid_param", "pauseAdId and resumeAdId are the same ad", { param: "resumeAdId" }));
    return out;
  },
  dryRun(p) {
    const resume = shapePost(String(p.resumeAdId ?? ""), { status: "ACTIVE" }, `resume ad ${redactId(p.resumeAdId)}`);
    const pause = shapePost(String(p.pauseAdId ?? ""), { status: "PAUSED" }, `pause ad ${redactId(p.pauseAdId)}`);
    return { request: resume, followUps: [pause], preview: `Resume ad ${redactId(p.resumeAdId)}, then pause ad ${redactId(p.pauseAdId)}${p.reason ? ` — ${p.reason}` : ""}`, before: `${redactId(p.pauseAdId)} ACTIVE, ${redactId(p.resumeAdId)} PAUSED`, after: `${redactId(p.resumeAdId)} ACTIVE, ${redactId(p.pauseAdId)} PAUSED` };
  },
  async execute(p, ctx) {
    const dry = this.dryRun(p, ctx);
    if (ctx.credential?.kind !== "meta_ads") return noCredential(`${dry.preview}: not connected`);
    const sent: ShapedRequest[] = [];
    for (const req of [dry.request, ...(dry.followUps ?? [])]) {
      sent.push(req);
      const res = await send(req, ctx.credential.accessToken, { fetch: ctx.fetch, timeoutMs: ctx.timeoutMs });
      if (!res.ok) return fail(`${req.note} failed: ${res.error.reason}${sent.length > 1 ? " (the resume went through; the fatigued ad is still active)" : ""}`, res.error, sent, res.rateLimit);
    }
    return { ok: true, externalId: String(p.resumeAdId), receipt: `Resumed ad ${redactId(p.resumeAdId)} and paused ad ${redactId(p.pauseAdId)}`, response: { success: true }, sent };
  },
  rollback: (p) => ({ actionId: "meta.ad.rotate", params: { pauseAdId: p.resumeAdId, resumeAdId: p.pauseAdId }, note: "swap them back" }),
};

// ---------- campaign from a brief (PAUSED; dry-run only until wave 2) ----------

export const OBJECTIVES = ["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export type CreativeRef = { creativeId: string } | { instagramMediaId: string } | { imageHash: string; primaryText: string; headline: string; linkUrl: string; pageId: string };

export interface AudienceDescriptor {
  countries: string[];
  ageMin?: number;
  ageMax?: number;
  /** 1 = male, 2 = female; absent = all. */
  genders?: (1 | 2)[];
  /** Interest ids from the targeting search. */
  interestIds?: string[];
  customAudienceIds?: string[];
  /** Advantage+ audience expansion; default true. */
  advantageAudience?: boolean;
}

export interface CreateFromBriefParams extends Record<string, unknown> {
  name: string;
  objective: Objective;
  dailyBudget: number;
  audience: AudienceDescriptor;
  creatives: CreativeRef[];
  pixelId?: string;
  pageId?: string;
  durationDays?: number;
  /** Default: OFFSITE_CONVERSIONS for sales/leads with a pixel, LINK_CLICKS otherwise. */
  optimizationGoal?: string;
}

/** Countries may arrive as an array or a comma-separated string ("NZ, AU") from a template. */
export function countriesOf(a: unknown): string[] {
  const raw = (a as { countries?: unknown } | undefined)?.countries;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  return list.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
}

/** Creative refs may arrive as one ref, a list of refs, or reader rows (creative_id / id). */
export function creativeRefsOf(v: unknown): CreativeRef[] {
  const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  const out: CreativeRef[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    if (typeof r.creativeId === "string" && r.creativeId) out.push({ creativeId: r.creativeId });
    else if (typeof r.creative_id === "string" && r.creative_id) out.push({ creativeId: r.creative_id });
    else if (typeof r.instagramMediaId === "string" && r.instagramMediaId) out.push({ instagramMediaId: r.instagramMediaId });
    else if (typeof r.imageHash === "string" && typeof r.primaryText === "string" && typeof r.headline === "string" && typeof r.linkUrl === "string" && typeof r.pageId === "string") out.push({ imageHash: r.imageHash, primaryText: r.primaryText, headline: r.headline, linkUrl: r.linkUrl, pageId: r.pageId });
    else if (typeof r.id === "string" && r.id && r.creative && typeof r.creative === "object" && typeof (r.creative as Record<string, unknown>).id === "string") out.push({ creativeId: String((r.creative as Record<string, unknown>).id) });
  }
  return out;
}

function optimisationFor(p: CreateFromBriefParams): string {
  if (p.optimizationGoal) return p.optimizationGoal;
  if ((p.objective === "OUTCOME_SALES" || p.objective === "OUTCOME_LEADS") && p.pixelId) return "OFFSITE_CONVERSIONS";
  if (p.objective === "OUTCOME_AWARENESS") return "REACH";
  if (p.objective === "OUTCOME_ENGAGEMENT") return "POST_ENGAGEMENT";
  return "LINK_CLICKS";
}

function targetingFor(a: AudienceDescriptor): Record<string, unknown> {
  const t: Record<string, unknown> = { geo_locations: { countries: countriesOf(a) } };
  if (a.ageMin !== undefined) t.age_min = a.ageMin;
  if (a.ageMax !== undefined) t.age_max = a.ageMax;
  if (a.genders?.length) t.genders = a.genders;
  if (a.interestIds?.length) t.flexible_spec = [{ interests: a.interestIds.map((id) => ({ id })) }];
  if (a.customAudienceIds?.length) t.custom_audiences = a.customAudienceIds.map((id) => ({ id }));
  t.targeting_automation = { advantage_audience: a.advantageAudience === false ? 0 : 1 };
  return t;
}

function creativeBody(c: CreativeRef): Record<string, unknown> {
  if ("creativeId" in c) return { creative_id: c.creativeId };
  if ("instagramMediaId" in c) return { source_instagram_media_id: c.instagramMediaId };
  return { object_story_spec: { page_id: c.pageId, link_data: { image_hash: c.imageHash, message: c.primaryText, name: c.headline, link: c.linkUrl } } };
}

export const campaignCreateFromBrief: Action<CreateFromBriefParams> = {
  id: "meta.campaign.create_from_brief",
  platform: "meta_ads",
  title: "Create a campaign from a brief (paused)",
  description: "Creates campaign + ad set + one ad per creative, ALL PAUSED, from an objective, an audience descriptor, a daily budget and creative refs. Dry-run only until wave 2: execute answers not_available.",
  risk: "publish",
  secondaryRisks: ["spend"],
  params: {
    type: "object",
    properties: {
      name: { type: "string", description: "campaign name", required: true },
      objective: { type: "string", description: "Meta ODAX objective", required: true, enum: OBJECTIVES },
      dailyBudget: { type: "number", description: "ad set daily budget (account currency)", required: true, minimum: 0 },
      audience: {
        type: "object",
        description: "who: countries (ISO-2), age band, genders, interest ids, custom audience ids",
        required: true,
        properties: { countries: { type: "array", description: "ISO-2 country codes", required: true, items: { type: "string", description: "e.g. NZ" } }, ageMin: { type: "integer", description: "18–65", minimum: 18, maximum: 65 }, ageMax: { type: "integer", description: "18–65", minimum: 18, maximum: 65 } },
      },
      creatives: { type: "array", description: "creative refs: {creativeId} | {instagramMediaId} | {imageHash, primaryText, headline, linkUrl, pageId}", required: true, items: { type: "object", description: "one creative ref" } },
      pixelId: { type: "string", description: "pixel for conversion optimisation" },
      pageId: { type: "string", description: "Facebook page the ads run from" },
      durationDays: { type: "integer", description: "informational; the founder ends it", minimum: 1 },
      optimizationGoal: { type: "string", description: "override the default optimisation goal" },
    },
  },
  guards(p, ctx) {
    const out: Violation[] = [];
    if (!p.name || typeof p.name !== "string") out.push(violation("missing_param", "name is required", { param: "name" }));
    if (!(OBJECTIVES as readonly string[]).includes(p.objective)) out.push(violation("invalid_param", `objective "${String(p.objective)}" is not one of ${OBJECTIVES.join(", ")}`, { param: "objective" }));
    const next = Number(p.dailyBudget);
    if (!Number.isFinite(next) || next <= 0) out.push(violation("missing_param", `dailyBudget must be a number above zero in ${ctx.currency}`, { param: "dailyBudget" }));
    else {
      if (next > ctx.caps.perDay) out.push(violation("cap_per_day", `${fmt(ctx.currency, next)}/day is over your ${fmt(ctx.currency, ctx.caps.perDay)}/day cap`, { param: "dailyBudget", limit: ctx.caps.perDay, actual: next }));
      if (ctx.spendCeiling !== null && next > ctx.spendCeiling) out.push(violation("taste_ceiling", `${fmt(ctx.currency, next)}/day is above the ${fmt(ctx.currency, ctx.spendCeiling)}/day you usually approve`, { param: "dailyBudget", limit: ctx.spendCeiling, actual: next }));
    }
    const a = p.audience;
    const countries = countriesOf(a);
    if (!a || typeof a !== "object" || !countries.length) out.push(violation("missing_param", "audience.countries needs at least one ISO-2 country", { param: "audience.countries" }));
    else if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) out.push(violation("invalid_param", "audience.countries must be ISO-2 codes (NZ, AU)", { param: "audience.countries" }));
    const ageMin = a && typeof a === "object" && a.ageMin !== undefined && (a.ageMin as unknown) !== "" ? Number(a.ageMin) : undefined;
    const ageMax = a && typeof a === "object" && a.ageMax !== undefined && (a.ageMax as unknown) !== "" ? Number(a.ageMax) : undefined;
    if (ageMin !== undefined && (ageMin < 18 || ageMin > 65)) out.push(violation("invalid_param", "audience.ageMin must be 18–65", { param: "audience.ageMin" }));
    if (ageMax !== undefined && (ageMax < 18 || ageMax > 65 || (ageMin !== undefined && ageMax < ageMin))) out.push(violation("invalid_param", "audience.ageMax must be 18–65 and ≥ ageMin", { param: "audience.ageMax" }));
    const refs = creativeRefsOf(p.creatives);
    if (!refs.length) out.push(violation("missing_param", "creatives needs at least one ref ({creativeId} | {instagramMediaId} | {imageHash, primaryText, headline, linkUrl, pageId})", { param: "creatives" }));
    if (p.pixelId && (p.pixelId as unknown) !== "" && !ID_RE.test(String(p.pixelId))) out.push(violation("invalid_param", "pixelId is not a Meta id", { param: "pixelId" }));
    if ((p.objective === "OUTCOME_SALES" || p.objective === "OUTCOME_LEADS") && !p.pixelId && !p.optimizationGoal) out.push(violation("missing_param", `${p.objective} without a pixelId cannot optimise for conversions — add pixelId or set optimizationGoal`, { param: "pixelId" }));
    return out;
  },
  dryRun(p, ctx) {
    const act = account(ctx);
    const budget = Number(p.dailyBudget);
    const campaign = shapePost(`${act}/campaigns`, { name: p.name, objective: p.objective, status: "PAUSED", special_ad_categories: [], buying_type: "AUCTION" }, `create campaign "${p.name}" PAUSED`);
    const adset: Record<string, unknown> = {
      name: `${p.name} — ad set`,
      campaign_id: "{{campaign.id}}",
      daily_budget: toMinorUnits(Number.isFinite(budget) ? budget : 0, ctx.currency),
      billing_event: "IMPRESSIONS",
      optimization_goal: optimisationFor(p),
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting: targetingFor(p.audience ?? { countries: [] }),
      status: "PAUSED",
    };
    if (p.pixelId && (p.pixelId as unknown) !== "" && (p.objective === "OUTCOME_SALES" || p.objective === "OUTCOME_LEADS")) adset.promoted_object = { pixel_id: p.pixelId, custom_event_type: p.objective === "OUTCOME_SALES" ? "PURCHASE" : "LEAD" };
    const adsetReq = shapePost(`${act}/adsets`, adset, `create ad set at ${fmt(ctx.currency, budget)}/day PAUSED`);
    const ads = creativeRefsOf(p.creatives).map((c, i) => shapePost(`${act}/ads`, { name: `${p.name} — ad ${i + 1}`, adset_id: "{{adset.id}}", creative: creativeBody(c), status: "PAUSED" }, `create ad ${i + 1} PAUSED`));
    const n = ads.length;
    return {
      request: campaign,
      followUps: [adsetReq, ...ads],
      preview: `Create campaign "${p.name}" (${p.objective}) with 1 ad set at ${fmt(ctx.currency, budget)}/day and ${n} ad${n === 1 ? "" : "s"} — everything PAUSED until you switch it on`,
      spend: { amount: Number.isFinite(budget) ? budget : 0, currency: ctx.currency, perDay: true },
      before: "No campaign",
      after: `Campaign, ad set and ${n} ad${n === 1 ? "" : "s"} exist, all PAUSED`,
    };
  },
  async execute(p, ctx) {
    const dry = this.dryRun(p, ctx);
    return { ok: false, receipt: `${dry.preview} — not executed: campaign creation is dry-run only until wave 2`, error: { code: "not_available", reason: "meta.campaign.create_from_brief executes in wave 2; today it only shapes the requests", retryable: false } };
  },
  // No rollback: everything is created PAUSED; deleting objects is a founder action in Ads Manager.
};

// ---------- creative image upload ----------

export interface UploadImageParams extends Record<string, unknown> {
  imageUrl: string;
  name?: string;
}

export interface UploadImageResponse extends Record<string, unknown> {
  hash: string;
  url?: string;
}

export const creativeUploadImageFromUrl: Action<UploadImageParams, UploadImageResponse> = {
  id: "meta.creative.upload_image_from_url",
  platform: "meta_ads",
  title: "Upload an ad image from a URL",
  description: "Adds an image to the ad account's image library from an https URL; returns the image hash creatives reference. Nothing runs from it until an ad uses it.",
  risk: "publish",
  params: { type: "object", properties: { imageUrl: { type: "string", description: "https URL of the image (jpg/png)", required: true }, name: { type: "string", description: "library name" } } },
  guards(p) {
    const out: Violation[] = [];
    if (!p.imageUrl || typeof p.imageUrl !== "string") return [violation("missing_param", "imageUrl is required", { param: "imageUrl" })];
    try {
      const u = new URL(p.imageUrl);
      if (u.protocol !== "https:") out.push(violation("invalid_param", "imageUrl must be https", { param: "imageUrl" }));
    } catch {
      out.push(violation("invalid_param", "imageUrl is not a URL", { param: "imageUrl" }));
    }
    return out;
  },
  dryRun(p, ctx) {
    const request = shapePost(`${account(ctx)}/adimages`, { url: p.imageUrl, ...(p.name ? { name: p.name } : {}) }, `upload image from ${safeHost(p.imageUrl)}`);
    return { request, preview: `Upload an ad image from ${safeHost(p.imageUrl)} to the image library`, before: "Not in the library", after: "Image hash available to creatives" };
  },
  async execute(p, ctx) {
    const dry = this.dryRun(p, ctx);
    if (ctx.credential?.kind !== "meta_ads") return noCredential(`${dry.preview}: not connected`) as ExecuteResult<UploadImageResponse>;
    const res = await send(dry.request, ctx.credential.accessToken, { fetch: ctx.fetch, timeoutMs: ctx.timeoutMs });
    if (!res.ok) return fail(`${dry.preview} failed: ${res.error.reason}`, res.error, [dry.request], res.rateLimit) as ExecuteResult<UploadImageResponse>;
    const images = (res.json as { images?: Record<string, { hash?: string; url?: string }> })?.images ?? {};
    const first = Object.values(images)[0];
    if (!first?.hash) return fail(`${dry.preview} failed: no image hash in the reply`, { code: "unknown", reason: "Meta answered without an image hash", retryable: false }, [dry.request], res.rateLimit) as ExecuteResult<UploadImageResponse>;
    return { ok: true, externalId: first.hash, receipt: `Uploaded ad image ${redactId(first.hash)} from ${safeHost(p.imageUrl)}`, response: { hash: first.hash, ...(first.url ? { url: first.url } : {}) }, sent: [dry.request], rateLimit: res.rateLimit };
  },
};

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<invalid url>";
  }
}

export const META_ACTIONS = [readPerformance, adsetPause, adsetResume, adsetSetDailyBudget, adPause, adResume, adRotate, campaignCreateFromBrief, creativeUploadImageFromUrl] as const;
