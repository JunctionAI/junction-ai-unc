/* Per-account model-spend cap — the beta's cost rail.

   Cap (USD per UTC month): accounts.monthly_llm_cap_usd (migration 0014; null = default) →
   env UNC_ACCOUNT_MONTHLY_USD_CAP → 15. Spend = Σ llm_usage.est_cost_usd for the account since
   the start of the current UTC month (the router writes one row per call; a null estimate —
   price unknown — counts as 0, so the cap is approximate in the account's favour).

   Where it bites:
     • router.complete(): an account over its cap gets an LlmResult with errorCode
       "budget_exceeded" and no provider call (no ledger row either — nothing was spent);
     • chat (src/lib/unc/respond.ts): the honest line below is the reply;
     • produce (src/worker/providers/producer.ts): the run fails closed with the same line;
     • the worker loop skips an over-cap account's produce routines for the tick (deterministic
       routines — reads, checks, threshold decisions — still run).

   The status is cached 30 s per account in-process so a chat turn costs at most one extra
   pair of reads. Relative imports only (worker-buildable). */

import { unwrap, type DbClient } from "../db/types";
import type { LlmResult, ResolvedModel } from "./types";

export const DEFAULT_MONTHLY_CAP_USD = 15;
export const CAP_ENV = "UNC_ACCOUNT_MONTHLY_USD_CAP";
export const BUDGET_EXHAUSTED_LINE = "I’ve used this month’s thinking budget — Tom can raise it.";
export const BUDGET_CACHE_MS = 30_000;

export interface BudgetStatus {
  ok: boolean;
  accountId: string;
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  /** ISO start of the UTC month the spend covers. */
  monthStart: string;
  capSource: "account" | "env" | "default";
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

/** The account's status this month. Never throws: a database problem reads as ok (the cap is a
    rail, not a gate that can lock a founder out because a query failed) and is logged. */
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
    opts.log?.("llm.budget_check_failed", { accountId, error: err instanceof Error ? err.message : String(err) });
    status = budgetStatus(accountId, 0, defaultCap(opts.env), monthStart);
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

export const isBudgetExceeded = (r: Pick<LlmResult, "stopReason" | "errorCode"> | null | undefined): boolean => !!r && r.stopReason === "error" && r.errorCode === "budget_exceeded";
