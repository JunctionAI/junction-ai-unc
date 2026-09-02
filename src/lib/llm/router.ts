/* The router — the one seam every Unc call site goes through.

     resolveModel(task, { accountOverride?, envOverride?, env? })   sync, pure
     complete(task, req, ctx?)                                       resolve → call → ledger
     completeModel(modelId, req, ctx?)                               same, for a named model (dev ping)
     createTextClient(task, ctx?)                                    { complete({system,user,accountId?}) → string }
                                                                     (throws on refusal/error — the shape
                                                                     selfReview.ts and llmDecision.ts expect)

   Precedence: account setting (account_model_prefs) → env LLM_MODEL_<TASK> → per-task
   default. If the chosen model's provider isn't configured, the same tier on the first
   configured provider (anthropic → openai → gemini → openrouter → custom) stands in; when
   nothing is configured the answer is null and the call site keeps its canned fallback.

   Relative imports only — src/worker's standalone build has no "@/" resolver. */

import { asDb } from "../db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "../db/server";
import type { DbClient } from "../db/types";
import { readModelPref } from "./prefs";
import { defaultProviderFactory, type ProviderFactory } from "./providers";
import { CATALOGUE, configuredProviders, isProviderConfigured, parseModelId, PROVIDER_FALLBACK_ORDER, TIER_EQUIVALENTS, type Env } from "./registry";
import { defaultLlmLog, recordUsage, usageRecord, type LlmLog } from "./telemetry";
import type { LlmRequest, LlmResult, LlmTask, ModelTier, ResolvedModel } from "./types";

export const TASK_DEFAULTS: Record<LlmTask, { id: string } | { tier: ModelTier }> = {
  chat: { id: "claude-sonnet-5" },
  plan_narrative: { id: "claude-sonnet-5" },
  business_scan: { tier: "fast" },
  self_review: { id: "claude-sonnet-5" },
  routine_decision: { tier: "fast" },
  memory_extract: { tier: "fast" },
  daily_brief: { tier: "balanced" },
  kpi_insight: { tier: "fast" },
  eval_judge: { id: "claude-sonnet-5" }, // scripts/eval-chat.ts; env LLM_MODEL_EVAL_JUDGE overrides
};

export const envOverrideKey = (task: LlmTask) => `LLM_MODEL_${task.toUpperCase()}`;

export interface ResolveOptions {
  accountOverride?: string | null;
  /** Defaults to env[LLM_MODEL_<TASK>]. Pass null to ignore the env override. */
  envOverride?: string | null;
  env?: Env;
}

function tierFallback(tier: ModelTier, env: Env): ResolvedModel | null {
  for (const p of PROVIDER_FALLBACK_ORDER) {
    if (!isProviderConfigured(p, env)) continue;
    const entry = parseModelId(TIER_EQUIVALENTS[p][tier], env);
    if (entry) return { ...entry, tier, source: "fallback" }; // it stands in for the requested tier
  }
  return null;
}

/** null ⇒ no provider is configured at all (call sites keep their deterministic fallbacks). */
export function resolveModel(task: LlmTask, opts: ResolveOptions = {}): ResolvedModel | null {
  const env = opts.env ?? process.env;
  const envOverride = opts.envOverride === undefined ? env[envOverrideKey(task)] : opts.envOverride;
  const chain: { id: string | null | undefined; source: ResolvedModel["source"] }[] = [
    { id: opts.accountOverride, source: "account" },
    { id: envOverride, source: "env" },
  ];
  const d = TASK_DEFAULTS[task];
  if ("id" in d) chain.push({ id: d.id, source: "default" });

  for (const step of chain) {
    const entry = parseModelId(step.id, env);
    if (!entry) continue; // unknown / blank id → next in the chain
    if (isProviderConfigured(entry.provider, env)) return { ...entry, source: step.source };
    const fb = tierFallback(entry.tier, env);
    return fb ? { ...fb, fallbackFrom: entry.id } : null;
  }
  // tier-only default (scan, routine decisions): the first configured provider's tier equivalent
  const tier = "tier" in d ? d.tier : "balanced";
  const fb = tierFallback(tier, env);
  return fb ? { ...fb, source: "default" } : null;
}

export interface CompleteContext {
  accountId?: string | null;
  /** Service-role (or member) client for prefs + the ledger. undefined = use the service role when configured; null = none. */
  db?: DbClient | null;
  log?: LlmLog;
  env?: Env;
  now?: () => Date;
}

let providerFactory: ProviderFactory = defaultProviderFactory;
/** Tests swap the factory for fakes; pass undefined to restore. */
export function setProviderFactoryForTests(f: ProviderFactory | undefined): void {
  providerFactory = f ?? defaultProviderFactory;
}

let dbResolver: () => DbClient | null = () => {
  try {
    return isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null;
  } catch {
    return null;
  }
};
export function setLlmDbForTests(f: (() => DbClient | null) | undefined): void {
  dbResolver = f ?? (() => (isServiceRoleConfigured() ? asDb(getServiceSupabase()) : null));
}

function ctxDb(ctx: CompleteContext): DbClient | null {
  return ctx.db === undefined ? dbResolver() : ctx.db;
}

async function accountPref(task: LlmTask, ctx: CompleteContext, db: DbClient | null, log: LlmLog): Promise<string | null> {
  if (!ctx.accountId || !db) return null;
  try {
    return await readModelPref(db, ctx.accountId, task);
  } catch (err) {
    log("llm.pref_read_failed", { accountId: ctx.accountId, task, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function run(task: LlmTask | "ping", resolved: ResolvedModel, req: LlmRequest, ctx: CompleteContext, db: DbClient | null, log: LlmLog): Promise<LlmResult> {
  const env = ctx.env ?? process.env;
  const now = ctx.now ?? (() => new Date());
  const provider = providerFactory(resolved.provider, env);
  const t0 = Date.now();
  const result: LlmResult = provider
    ? await provider.complete({ ...req, effort: resolved.supportsEffort ? req.effort : undefined, model: resolved.model })
    : { text: "", stopReason: "error", errorCode: "not_configured", errorMessage: `${resolved.provider} is not configured`, usage: { input: 0, output: 0 }, provider: resolved.provider, model: resolved.model, latencyMs: Date.now() - t0 };
  await recordUsage(usageRecord(task, ctx.accountId ?? null, resolved, result, now()), db, log);
  if (result.stopReason === "error") log("llm.error", { task, provider: result.provider, model: result.model, code: result.errorCode, message: result.errorMessage });
  return result;
}

/** Resolve the model for this task (+ account), call it, write the ledger. null = nothing configured. */
export async function complete(task: LlmTask, req: LlmRequest, ctx: CompleteContext = {}): Promise<LlmResult | null> {
  const log = ctx.log ?? defaultLlmLog;
  const db = ctxDb(ctx);
  const resolved = resolveModel(task, { accountOverride: await accountPref(task, ctx, db, log), env: ctx.env });
  if (!resolved) return null;
  return run(task, resolved, req, ctx, db, log);
}

/** Call a named catalogue / "<provider>:<model>" id directly (the dev ping route). */
export async function completeModel(modelId: string, req: LlmRequest, ctx: CompleteContext = {}): Promise<LlmResult | null> {
  const env = ctx.env ?? process.env;
  const entry = parseModelId(modelId, env);
  if (!entry) return null;
  const resolved: ResolvedModel = { ...entry, source: "env" };
  if (!isProviderConfigured(entry.provider, env)) {
    return { text: "", stopReason: "error", errorCode: "not_configured", errorMessage: `${entry.provider} is not configured`, usage: { input: 0, output: 0 }, provider: entry.provider, model: entry.model, latencyMs: 0 };
  }
  return run("ping", resolved, req, ctx, ctxDb(ctx), ctx.log ?? defaultLlmLog);
}

/* ------------------------------------------------------------------ */
/* Text client — the {system,user} → string shape the worker + self-review already use */
/* ------------------------------------------------------------------ */

export interface TextPrompt {
  system: string;
  user: string;
  /** Lets a shared client (the worker's) honour per-account model settings. */
  accountId?: string;
}

export interface TextClient {
  /** Returns the model's text. Throws on refusal / transport failure / nothing configured. */
  complete(prompt: TextPrompt): Promise<string>;
}

export interface TextClientOptions {
  maxTokens: number;
  effort?: LlmRequest["effort"];
  jsonMode?: boolean;
}

/** null when no provider is configured (the callers then take their deterministic path). */
export function createTextClient(task: LlmTask, opts: TextClientOptions, ctx: CompleteContext = {}): TextClient | null {
  if (!resolveModel(task, { env: ctx.env })) return null;
  return {
    async complete({ system, user, accountId }) {
      const r = await complete(task, { system, messages: [{ role: "user", content: user }], maxTokens: opts.maxTokens, effort: opts.effort, jsonMode: opts.jsonMode }, { ...ctx, accountId: accountId ?? ctx.accountId });
      if (!r) throw new Error("no LLM provider configured");
      if (r.stopReason === "refusal") throw new Error("refusal");
      if (r.stopReason === "error") throw new Error(`llm ${r.errorCode ?? "error"}`);
      return r.text.trim();
    },
  };
}

/** For boot logs: which providers can be called right now. */
export function describeLlm(env: Env = process.env): string {
  const p = configuredProviders(env);
  return p.length ? `router (${p.join(", ")})` : "none (fallback decisions)";
}

export { CATALOGUE, configuredProviders, isProviderConfigured, parseModelId };
