/* Model-provider layer — the neutral request/result shape every Unc call site speaks.

   One rule: a provider never throws past the router. Transport failures, auth failures,
   bad model ids, timeouts and refusals all come back as an LlmResult with a stopReason of
   "error" (plus a code) or "refusal", so every call site keeps exactly the deterministic /
   canned fallback it had when the Anthropic SDK was wired in directly. */

export type LlmTask = "chat" | "plan_narrative" | "business_scan" | "self_review" | "routine_decision" | "routine_produce" | "memory_extract" | "daily_brief" | "kpi_insight" | "eval_judge" | "niche_brief";

/** The founder-settable tasks (the settings UI + account_model_prefs, whose check constraint
    lists exactly these). memory_extract is an internal task: default fast tier, env override
    LLM_MODEL_MEMORY_EXTRACT, no per-account setting. daily_brief (balanced tier) and
    kpi_insight (fast tier) are internal too — docs/PROACTIVE.md. */
/** eval_judge (balanced tier, env LLM_MODEL_EVAL_JUDGE) is internal too — the chat eval harness,
    scripts/eval-chat.ts — and is deliberately not listed below. routine_produce (balanced tier,
    env LLM_MODEL_ROUTINE_PRODUCE) writes the artifacts routines produce (docs/ROUTINES-REAL-WORK.md).
    niche_brief (balanced tier, env LLM_MODEL_NICHE_BRIEF) is the one-call market read after the scan
    (docs/PRESETS.md) — internal too. */
export const LLM_TASKS: readonly LlmTask[] = ["chat", "plan_narrative", "business_scan", "self_review", "routine_decision"] as const;

export type ProviderId = "anthropic" | "openai" | "gemini" | "openrouter" | "custom";

export const PROVIDER_IDS: readonly ProviderId[] = ["anthropic", "openai", "gemini", "openrouter", "custom"] as const;

export type ModelTier = "fast" | "balanced" | "best";

export type LlmEffort = "low" | "medium" | "high";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  /** Output cap. Keep it generous — on Sonnet 5 / Opus 5 adaptive-thinking tokens count against it. */
  maxTokens: number;
  /** Only sent when set (Sonnet 5 / Opus 5 reject sampling params; gpt-5 reasoning models reject ≠ 1). */
  temperature?: number;
  /** OpenAI-compatible: response_format json_object. Anthropic: no-op (prompts already demand strict JSON). */
  jsonMode?: boolean;
  /** Anthropic output_config.effort / OpenAI-compatible reasoning_effort, where the model supports it. */
  effort?: LlmEffort;
}

export type LlmStopReason = "end" | "max_tokens" | "refusal" | "error";

export type LlmErrorCode =
  | "not_configured" // provider has no key / base URL
  | "auth" // 401 / 403
  | "not_found" // 404 — usually a wrong model id
  | "bad_request" // 400 / 422
  | "rate_limited" // 429
  | "provider_error" // 5xx
  | "timeout" // connect or total timeout
  | "network" // DNS / TLS / connection reset
  | "bad_response" // 2xx but the body wasn't what the API promises
  | "budget_exceeded" // the account is over its monthly cap (src/lib/llm/budget.ts) — no provider was called
  | "budget_unavailable" // the cap could not be verified, so no provider was called
  | "unpriced_model" // a hosted model has no trusted price, so it cannot use the account budget rail
  | "unknown";

export interface LlmUsage {
  input: number;
  output: number;
}

export interface LlmResult {
  text: string;
  stopReason: LlmStopReason;
  usage: LlmUsage;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  /** Present when stopReason is "error". */
  errorCode?: LlmErrorCode;
  /** Short, sanitised (status + provider message head); never carries a key. */
  errorMessage?: string;
}

/** The request a provider adapter receives: the neutral request plus the concrete model id. */
export interface ProviderRequest extends LlmRequest {
  model: string;
}

export interface LlmProvider {
  id: ProviderId;
  complete(req: ProviderRequest): Promise<LlmResult>;
}

export interface CatalogueEntry {
  /** Stable id used in settings, env overrides and telemetry (e.g. "claude-sonnet-5", "gpt-5-mini", "custom"). */
  id: string;
  provider: ProviderId;
  /** The id sent on the wire. */
  model: string;
  tier: ModelTier;
  /** USD per 1M tokens — APPROXIMATE list prices, maintained by hand (see docs/MODELS.md). null = unknown. */
  inputPer1M: number | null;
  outputPer1M: number | null;
  /** Human label for the settings UI. */
  label: string;
  /** false for models that reject output_config.effort / reasoning_effort (Haiku 4.5, most self-hosted). */
  supportsEffort: boolean;
}

export interface ResolvedModel extends CatalogueEntry {
  /** Where the choice came from. "fallback" = the chosen provider wasn't configured; see fallbackFrom. */
  source: "account" | "env" | "default" | "fallback";
  fallbackFrom?: string;
}

export const TASK_LABELS: Record<LlmTask, string> = {
  chat: "Talking with you",
  plan_narrative: "Writing your plan",
  business_scan: "Reading your site",
  self_review: "My weekly self-review",
  routine_decision: "Decisions inside routines",
  routine_produce: "Drafting the work routines hand you",
  memory_extract: "Remembering what you tell me",
  daily_brief: "My morning brief",
  kpi_insight: "Reading your numbers",
  eval_judge: "Grading my own replies (evals)",
  niche_brief: "Reading your market",
};
