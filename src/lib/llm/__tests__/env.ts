/* Provider-env isolation for tests: the dev shell that runs vitest may carry real keys
   (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY …). Nothing here may reach a network. */

export const LLM_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "LLM_CUSTOM_BASE_URL",
  "LLM_CUSTOM_API_KEY",
  "LLM_CUSTOM_MODEL",
  "LLM_CUSTOM_INPUT_PER_1M",
  "LLM_CUSTOM_OUTPUT_PER_1M",
  "LLM_MODEL_CHAT",
  "LLM_MODEL_PLAN_NARRATIVE",
  "LLM_MODEL_BUSINESS_SCAN",
  "LLM_MODEL_SELF_REVIEW",
  "LLM_MODEL_ROUTINE_DECISION",
  "LLM_MODEL_DAILY_BRIEF",
  "LLM_MODEL_KPI_INSIGHT",
] as const;

let saved: Record<string, string | undefined> = {};

export function clearLlmEnv(set: Partial<Record<(typeof LLM_ENV_KEYS)[number], string>> = {}) {
  saved = Object.fromEntries(LLM_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of LLM_ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(set)) if (v !== undefined) process.env[k] = v;
}

export function restoreLlmEnv() {
  for (const k of LLM_ENV_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
