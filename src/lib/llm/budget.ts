/* Per-account model-spend cap — the beta's cost rail.

   Cap (USD per UTC month): accounts.monthly_llm_cap_usd (migration 0014; null = default) →
   env UNC_ACCOUNT_MONTHLY_USD_CAP → 15. Spend = Σ llm_usage.est_cost_usd for the account since
   the start of the current UTC month (the router writes one row per call; a null estimate —
   price unknown — legacy rows count as 0; new account calls refuse unpriced hosted models).

   Where it bites:
     • router.complete(): an account over its cap gets an LlmResult with errorCode
       "budget_exceeded" and no provider call (no ledger row either — nothing was spent);
     • chat (src/lib/unc/respond.ts): the honest line below is the reply;
     • produce (src/worker/providers/producer.ts): the run fails closed with the same line;
     • the worker loop skips an over-cap account's produce routines for the tick (deterministic
       routines — reads, checks, threshold decisions — still run).

   Read-only status views may cache for 30 s. Provider admission always asks for a fresh
   status and is serialised per account in the router. Relative imports only (worker-buildable). */

import { unwrap, type DbClient } from "../db/types";
import type { LlmResult, ResolvedModel } from "./types";

export const DEFAULT_MONTHLY_CAP_USD = 15;
export const CAP_ENV = "UNC_ACCOUNT_MONTHLY_USD_CAP";
export const BUDGET_EXHAUSTED_LINE = "I’ve used this month’s thinking budget — Tom can raise it.";
export const BUDGET_UNAVAILABLE_LINE = "I can’t verify this account’s thinking budget right now, so I didn’t call a model.";
export const BUDGET_CACHE_MS = 30_000;
export const RESERVE_LLM_SPEND_RPC = "reserve_llm_spend";
export const RELEASE_LLM_SPEND_RPC = "release_llm_spend_reservation";

export interface BudgetStatus {
  ok: boolean;
  accountId: string;
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  /** ISO start of the UTC month the spend covers. */
  monthStart: string;
  capSource: "account" | "env" | "default";
  /** True when the database read failed. Such a status always fails closed. */
  checkFailed?: true;
}

export function monthStartUtc(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function defaultCap(env: Record<string, string | undefined> = process.env): { cap: number; source: "env" | "default" } {
  const raw = Number((env[CAP_ENV] ?? "").trim());
  return Number.isFinite(raw) && (env[CAP_ENV] ?? "").trim() !== "" ? { cap: raw, source: "env" } : { cap: DEFAULT_MONTHLY_CAP_USD, source: "default" };
}

/** Pure: spent vs cap → status. Exceeded when spent ≥ cap. */
export function budgetStatus(accountId: string, spentUsd: number, cap: { cap: number; source: BudgetStatus["capSource"] }, monthStart: string): BudgetStatus {
  const spent = Math.round(spentUsd * 1e6) / 1e6;
  return { ok: spent < cap.cap, accountId, spentUsd: spent, capUsd: cap.cap, remainingUsd: Math.max(0, Math.round((cap.cap - spent) * 1e6) / 1e6), monthStart, capSource: cap.source };
}

export async function accountCap(db: DbClient, accountId: string, env: Record<string, string | undefined> = process.env): Promise<{ cap: number; source: BudgetStatus["capSource"] }> {
  const row = await unwrap<{ monthly_llm_cap_usd: number | string | null } | null>("accounts.cap", db.from("accounts").select("monthly_llm_cap_usd").eq("id", accountId).maybeSingle());
  const v = row?.monthly_llm_cap_usd;
  if (v !== null && v !== undefined && Number.isFinite(Number(v))) return { cap: Number(v), source: "account" };
  return defaultCap(env);
}

export async function monthSpendUsd(db: DbClient, accountId: string, now: Date): Promise<number> {
  const rows = await unwrap<{ est_cost_usd: number | string | null }[]>("llm_usage.spend", db.from("llm_usage").select("est_cost_usd").eq("account_id", accountId).gte("created_at", monthStartUtc(now)));
  return rows.reduce((sum, r) => sum + (Number(r.est_cost_usd) || 0), 0);
}

const cache = new Map<string, { at: number; status: BudgetStatus }>();
export function resetBudgetCache(): void {
  cache.clear();
}

export interface CheckOptions {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Default true; false forces fresh reads (the settings view). */
  cached?: boolean;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface SpendReservation {
  id: string;
  accountId: string;
  ceilingUsd: number;
  spentUsd: number;
  reservedUsd: number;
  capUsd: number;
  expiresAt: string;
}

export type SpendAdmission =
  | { ok: true; reservation: SpendReservation }
  | { ok: false; reason: "budget_exceeded"; status: BudgetStatus; reservedUsd: number }
  | { ok: false; reason: "unavailable" };

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function resultObject(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, unknown>) : null;
}

/** Atomic cross-instance admission. The RPC locks accounts(id), then counts committed usage
    plus active reservations before inserting this request's conservative ceiling. */
export async function reserveLlmSpend(
  db: DbClient,
  accountId: string,
  ceilingUsd: number,
  opts: Pick<CheckOptions, "env" | "now"> = {},
): Promise<SpendAdmission> {
  if (!accountId || !Number.isFinite(ceilingUsd) || ceilingUsd <= 0) return { ok: false, reason: "unavailable" };
  const fallback = defaultCap(opts.env);
  try {
    const raw = resultObject(await unwrap<unknown>(RESERVE_LLM_SPEND_RPC, db.rpc(RESERVE_LLM_SPEND_RPC, { p_account_id: accountId, p_ceiling_usd: ceilingUsd, p_default_cap_usd: fallback.cap })));
    if (!raw) return { ok: false, reason: "unavailable" };
    const spentUsd = finiteNumber(raw.spent_usd);
    const reservedUsd = finiteNumber(raw.reserved_usd);
    const capUsd = finiteNumber(raw.cap_usd);
    if (spentUsd === null || reservedUsd === null || capUsd === null || spentUsd < 0 || reservedUsd < 0) return { ok: false, reason: "unavailable" };
    if (raw.ok === false && raw.reason === "budget_exceeded") {
      const now = (opts.now ?? (() => new Date()))();
      return {
        ok: false,
        reason: "budget_exceeded",
        status: { ...budgetStatus(accountId, spentUsd + reservedUsd, { cap: capUsd, source: fallback.source }, monthStartUtc(now)), ok: false },
        reservedUsd,
      };
    }
    const id = typeof raw.reservation_id === "string" ? raw.reservation_id : "";
    const expiresAt = typeof raw.expires_at === "string" ? raw.expires_at : "";
    if (raw.ok !== true || !id || !expiresAt || !Number.isFinite(new Date(expiresAt).getTime())) return { ok: false, reason: "unavailable" };
    return { ok: true, reservation: { id, accountId, ceilingUsd, spentUsd, reservedUsd, capUsd, expiresAt } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Release only after llm_usage is durable. False deliberately leaves capacity to TTL expiry. */
export async function releaseLlmSpendReservation(db: DbClient, reservation: Pick<SpendReservation, "id" | "accountId">): Promise<boolean> {
  try {
    return (await unwrap<unknown>(RELEASE_LLM_SPEND_RPC, db.rpc(RELEASE_LLM_SPEND_RPC, { p_account_id: reservation.accountId, p_reservation_id: reservation.id }))) === true;
  } catch {
    return false;
  }
}

/** The account's status this month. Never throws: a database problem fails closed and is logged. */
export async function checkBudget(db: DbClient, accountId: string, opts: CheckOptions = {}): Promise<BudgetStatus> {
  const now = (opts.now ?? (() => new Date()))();
  const hit = opts.cached === false ? undefined : cache.get(accountId);
  if (hit && now.getTime() - hit.at < BUDGET_CACHE_MS && now.getTime() >= hit.at) return hit.status;
  const monthStart = monthStartUtc(now);
  let status: BudgetStatus;
  try {
    const [cap, spent] = await Promise.all([accountCap(db, accountId, opts.env), monthSpendUsd(db, accountId, now)]);
    status = budgetStatus(accountId, spent, cap, monthStart);
  } catch (err) {
    opts.log?.("llm.budget_check_failed", { accountId, errorType: err instanceof Error ? err.name : "unknown" });
    status = { ...budgetStatus(accountId, 0, defaultCap(opts.env), monthStart), ok: false, remainingUsd: 0, checkFailed: true };
  }
  cache.set(accountId, { at: now.getTime(), status });
  return status;
}

/** Admin view: every account's spend this month (service role — reads across accounts). */
export async function spendByAccount(db: DbClient, now: Date): Promise<Map<string, number>> {
  const rows = await unwrap<{ account_id: string | null; est_cost_usd: number | string | null }[]>("llm_usage.spend_all", db.from("llm_usage").select("account_id, est_cost_usd").gte("created_at", monthStartUtc(now)));
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.account_id) continue;
    out.set(r.account_id, (out.get(r.account_id) ?? 0) + (Number(r.est_cost_usd) || 0));
  }
  return out;
}

/** The result the router answers with instead of calling a provider. */
export function budgetExceededResult(resolved: Pick<ResolvedModel, "provider" | "model">, status: BudgetStatus): LlmResult {
  return { text: "", stopReason: "error", errorCode: "budget_exceeded", errorMessage: `monthly cap reached (US$${status.spentUsd.toFixed(2)} of US$${status.capUsd.toFixed(2)})`, usage: { input: 0, output: 0 }, provider: resolved.provider, model: resolved.model, latencyMs: 0 };
}

export function budgetUnavailableResult(resolved: Pick<ResolvedModel, "provider" | "model">): LlmResult {
  return { text: "", stopReason: "error", errorCode: "budget_unavailable", errorMessage: "monthly cap could not be verified", usage: { input: 0, output: 0 }, provider: resolved.provider, model: resolved.model, latencyMs: 0 };
}

export const isBudgetExceeded = (r: Pick<LlmResult, "stopReason" | "errorCode"> | null | undefined): boolean => !!r && r.stopReason === "error" && r.errorCode === "budget_exceeded";
export const isBudgetUnavailable = (r: Pick<LlmResult, "stopReason" | "errorCode"> | null | undefined): boolean => !!r && r.stopReason === "error" && r.errorCode === "budget_unavailable";
