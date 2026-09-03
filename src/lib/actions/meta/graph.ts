/* Meta Marketing API (Graph v23.0) plumbing shared by the Meta actions.

   Request shaping   shape(...) builds the exact request: GET with a query string, POST with
                     an application/x-www-form-urlencoded body (the Graph API's native mutation
                     encoding). The token goes in `Authorization: Bearer` — never the query
                     string, never the body — and every ShapedRequest we hand out is REDACTED
                     ("Bearer ••••"), so a dry-run receipt can be stored and shown as-is.
   Money             budgets travel as minor units ("7200" = 72.00) except for the currencies
                     Meta bills in whole units (ZERO_DECIMAL). toMinorUnits / fromMinorUnits.
   Errors            mapMetaError turns Meta's {error:{code, error_subcode, …}} into an honest
                     ActionError: what happened, whether a retry is sane, how long to wait.
   Rate limits       parseRateLimit reads X-Business-Use-Case-Usage / X-Ad-Account-Usage /
                     X-App-Usage and says whether to back off, and for how long.
   send()            performs one shaped request with the live token, a hard timeout, and
                     returns {ok, json, rateLimit} | {ok:false, error}. Only execute() calls it. */

import type { ActionError, RateLimitState, ShapedRequest } from "../types";

export const META_GRAPH_VERSION = "v23.0";
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const REDACTED_BEARER = "Bearer ••••";
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Currencies Meta bills in whole units (no minor-unit offset). Everything else is ×100. */
export const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "TWD", "PYG", "HUF"]);

export function toMinorUnits(amount: number, currency: string): number {
  const c = currency.toUpperCase();
  return ZERO_DECIMAL_CURRENCIES.has(c) ? Math.round(amount) : Math.round(amount * 100);
}

export function fromMinorUnits(minor: number | string, currency: string): number {
  const n = typeof minor === "string" ? Number(minor) : minor;
  if (!Number.isFinite(n)) return 0;
  const c = currency.toUpperCase();
  return ZERO_DECIMAL_CURRENCIES.has(c) ? n : Math.round(n) / 100;
}

export function actId(adAccountId: string): string {
  const id = adAccountId.trim();
  return id.startsWith("act_") ? id : `act_${id}`;
}

/** Ids in receipts and proofs: keep the last 6 characters so two ids can be told apart. */
export function redactId(id: string | number | undefined | null): string {
  const s = String(id ?? "");
  if (s.length <= 6) return s ? "…" + s : "";
  return "…" + s.slice(-6);
}

// ---------- shaping ----------

export function shapeGet(path: string, params: Record<string, string>, note: string): ShapedRequest {
  const qs = new URLSearchParams(params).toString();
  return { method: "GET", url: `${META_GRAPH_BASE}/${path}${qs ? `?${qs}` : ""}`, headers: { Authorization: REDACTED_BEARER, Accept: "application/json" }, note };
}

export function shapePost(path: string, body: Record<string, unknown>, note: string): ShapedRequest {
  return { method: "POST", url: `${META_GRAPH_BASE}/${path}`, headers: { Authorization: REDACTED_BEARER, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body, note };
}

/** Graph API form encoding: scalars as-is, objects/arrays as JSON strings. */
export function encodeBody(body: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    p.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return p.toString();
}

// ---------- error mapping ----------

export interface MetaErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
  is_transient?: boolean;
}

/** Meta error codes we recognise → an honest class. Anything else is "unknown" with Meta's
    own message kept. Sources: Graph API error reference (codes 1–613, 80000-series), Marketing
    API error_subcodes for budgets/permissions. */
const CODE_MAP: Record<number, { code: string; reason: string; retryable: boolean }> = {
  190: { code: "token_expired", reason: "the Meta token is expired or invalid — reconnect Meta", retryable: false },
  102: { code: "token_expired", reason: "the Meta session is invalid — reconnect Meta", retryable: false },
  10: { code: "permission", reason: "the Meta token lacks permission for this action (ads_management)", retryable: false },
  200: { code: "permission", reason: "the Meta token lacks permission for this ad account", retryable: false },
  294: { code: "permission", reason: "the app needs the ads_management permission (Marketing API access level)", retryable: false },
  4: { code: "rate_limited", reason: "Meta app request limit reached — backing off", retryable: true },
  17: { code: "rate_limited", reason: "Meta user request limit reached — backing off", retryable: true },
  32: { code: "rate_limited", reason: "Meta page request limit reached — backing off", retryable: true },
  613: { code: "rate_limited", reason: "Meta custom rate limit reached — backing off", retryable: true },
  80000: { code: "rate_limited", reason: "Meta ads-management call limit reached for this ad account — backing off", retryable: true },
  80004: { code: "rate_limited", reason: "Meta ads-insights call limit reached for this ad account — backing off", retryable: true },
  2: { code: "transient", reason: "Meta reported a temporary service problem — safe to retry later", retryable: true },
  1: { code: "transient", reason: "Meta reported an unknown error — safe to retry once", retryable: true },
  100: { code: "invalid_param", reason: "Meta rejected a parameter", retryable: false },
  368: { code: "policy", reason: "this ad account is temporarily blocked by Meta policy", retryable: false },
  1487: { code: "invalid_param", reason: "Meta rejected the ad set change", retryable: false },
  1815: { code: "invalid_param", reason: "Meta rejected the ad object", retryable: false },
};

const SUBCODE_MAP: Record<number, string> = {
  463: "the Meta token has expired — reconnect Meta",
  467: "the Meta token was invalidated (password change or security check) — reconnect Meta",
  460: "the Meta token was invalidated by a password change — reconnect Meta",
  458: "the app is no longer installed on this Meta user — reconnect Meta",
  1487126: "the daily budget is below Meta's minimum for this ad set",
  1487390: "the budget change would breach Meta's minimum for the optimisation goal",
  1885154: "the ad account has reached its spending limit",
  2446079: "the campaign's objective does not allow this ad set change",
};

export function mapMetaError(status: number | undefined, body: unknown): ActionError {
  const err = (body as { error?: MetaErrorBody } | undefined)?.error;
  if (!err) {
    if (status === 429 || status === 503) return { code: "rate_limited", reason: `HTTP ${status} from Meta — backing off`, retryable: true, backoffMs: 60_000 };
    return { code: "http", reason: `HTTP ${status ?? "?"} from Meta with no error body`, retryable: status === undefined || status >= 500 };
  }
  const known = err.code !== undefined ? CODE_MAP[err.code] : undefined;
  const subReason = err.error_subcode !== undefined ? SUBCODE_MAP[err.error_subcode] : undefined;
  const platform = { code: err.code, subcode: err.error_subcode, type: err.type, traceId: err.fbtrace_id };
  const detail = (err.error_user_msg || err.message || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (subReason) return { code: known?.code ?? "invalid_param", reason: subReason, retryable: false, platform };
  if (known) {
    const reason = known.code === "invalid_param" && detail ? `${known.reason}: ${detail}` : known.reason;
    return { code: known.code, reason, retryable: known.retryable, platform, ...(known.code === "rate_limited" ? { backoffMs: 60_000 } : {}) };
  }
  if (err.is_transient) return { code: "transient", reason: `Meta: ${detail || "transient error"} — safe to retry later`, retryable: true, platform };
  return { code: "unknown", reason: detail ? `Meta error ${err.code ?? "?"}: ${detail}` : `Meta error ${err.code ?? "?"}`, retryable: false, platform };
}

// ---------- rate limits ----------

const THROTTLE_PCT = 90;

function pctOf(obj: unknown, keys: string[]): number {
  if (!obj || typeof obj !== "object") return 0;
  let max = 0;
  for (const k of keys) {
    const v = Number((obj as Record<string, unknown>)[k]);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

function parseJsonHeader(v: string | null | undefined): unknown {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** Reads the three usage headers; the most constrained one wins. Missing headers = no throttle. */
export function parseRateLimit(headers: { get(name: string): string | null } | Record<string, string | undefined> | null | undefined): RateLimitState {
  const get = (name: string): string | null => {
    if (!headers) return null;
    if (typeof (headers as { get?: unknown }).get === "function") return (headers as { get(n: string): string | null }).get(name);
    const rec = headers as Record<string, string | undefined>;
    return rec[name] ?? rec[name.toLowerCase()] ?? null;
  };
  let utilisationPct = 0;
  let regainAccessMinutes = 0;
  let source: RateLimitState["source"] = "none";

  const buc = parseJsonHeader(get("x-business-use-case-usage")) as Record<string, unknown[]> | null;
  if (buc && typeof buc === "object") {
    for (const entries of Object.values(buc)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        const pct = pctOf(e, ["call_count", "total_cputime", "total_time"]);
        const regain = Number((e as Record<string, unknown>)?.estimated_time_to_regain_access ?? 0);
        if (pct > utilisationPct) utilisationPct = pct;
        if (Number.isFinite(regain) && regain > regainAccessMinutes) regainAccessMinutes = regain;
        source = "business_use_case";
      }
    }
  }
  const acct = parseJsonHeader(get("x-ad-account-usage"));
  if (acct) {
    const pct = pctOf(acct, ["acc_id_util_pct"]);
    if (pct > utilisationPct) {
      utilisationPct = pct;
      source = "ad_account";
    }
    const reset = Number((acct as Record<string, unknown>).reset_time_duration ?? 0);
    if (pct >= THROTTLE_PCT && Number.isFinite(reset) && reset / 60 > regainAccessMinutes) regainAccessMinutes = Math.ceil(reset / 60);
  }
  const app = parseJsonHeader(get("x-app-usage"));
  if (app) {
    const pct = pctOf(app, ["call_count", "total_cputime", "total_time"]);
    if (pct > utilisationPct) {
      utilisationPct = pct;
      source = "app";
    }
  }
  const throttled = utilisationPct >= THROTTLE_PCT || regainAccessMinutes > 0;
  const backoffMs = throttled ? Math.max(60_000, regainAccessMinutes * 60_000) : utilisationPct >= 75 ? 15_000 : 0;
  return { utilisationPct: Math.round(utilisationPct), regainAccessMinutes, throttled, backoffMs, source };
}

// ---------- sending (execute only) ----------

export type SendResult = { ok: true; json: unknown; status: number; rateLimit: RateLimitState } | { ok: false; error: ActionError; rateLimit: RateLimitState | null };

export interface SendOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Performs one shaped request with the real token. The ShapedRequest stays redacted; the
    token is added to a copy of the headers here and nowhere else. */
export async function send(req: ShapedRequest, accessToken: string, opts: SendOptions = {}): Promise<SendResult> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") return { ok: false, error: { code: "http", reason: "fetch is not available in this runtime", retryable: false }, rateLimit: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = { ...req.headers, Authorization: `Bearer ${accessToken}` };
  const init: RequestInit = { method: req.method, headers, signal: controller.signal };
  if (req.method !== "GET" && req.body) init.body = encodeBody(req.body);
  try {
    const res = await doFetch(req.url, init);
    const rateLimit = parseRateLimit(res.headers);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const error = mapMetaError(res.status, json);
      if (error.code === "rate_limited") error.backoffMs = Math.max(error.backoffMs ?? 0, rateLimit.backoffMs, 60_000);
      return { ok: false, error, rateLimit };
    }
    if (json && typeof json === "object" && "error" in (json as object)) return { ok: false, error: mapMetaError(res.status, json), rateLimit };
    return { ok: true, json, status: res.status, rateLimit };
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, error: { code: "transient", reason: `timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms calling Meta`, retryable: true }, rateLimit: null };
    return { ok: false, error: { code: "transient", reason: `network error calling Meta: ${err instanceof Error ? err.name : "unknown"}`, retryable: true }, rateLimit: null };
  } finally {
    clearTimeout(timer);
  }
}

/** The Graph API's reply to a mutation is {success:true} or {id:"…"}; pick the id when present. */
export function idFromReply(json: unknown): string | undefined {
  const id = (json as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}
