/* Model catalogue + provider configuration.

   Prices are USD per 1M tokens and APPROXIMATE — hand-maintained list prices at the time
   of writing (2026-09), no cache/batch discounts, no long-context surcharges. They exist so
   the settings UI and the llm_usage ledger can show relative cost; they are not a bill.

   Ad-hoc ids: anything of the form "<provider>:<model>" (e.g. "openrouter:deepseek/deepseek-chat",
   "anthropic:claude-sonnet-4-6") resolves to that provider with tier "balanced" and unknown cost,
   so a founder or an env override can name a model the catalogue doesn't list. */

import { PROVIDER_IDS, type CatalogueEntry, type ModelTier, type ProviderId } from "./types";

export const CATALOGUE: readonly CatalogueEntry[] = [
  { id: "claude-haiku-4-5", provider: "anthropic", model: "claude-haiku-4-5", tier: "fast", inputPer1M: 1, outputPer1M: 5, label: "Claude Haiku 4.5", supportsEffort: false },
  { id: "claude-sonnet-5", provider: "anthropic", model: "claude-sonnet-5", tier: "balanced", inputPer1M: 2, outputPer1M: 10, label: "Claude Sonnet 5", supportsEffort: true },
  { id: "claude-opus-5", provider: "anthropic", model: "claude-opus-5", tier: "best", inputPer1M: 5, outputPer1M: 25, label: "Claude Opus 5", supportsEffort: true },
  { id: "gpt-5-nano", provider: "openai", model: "gpt-5-nano", tier: "fast", inputPer1M: 0.05, outputPer1M: 0.4, label: "GPT-5 nano", supportsEffort: true },
  { id: "gpt-5-mini", provider: "openai", model: "gpt-5-mini", tier: "fast", inputPer1M: 0.25, outputPer1M: 2, label: "GPT-5 mini", supportsEffort: true },
  { id: "gpt-5", provider: "openai", model: "gpt-5", tier: "balanced", inputPer1M: 1.25, outputPer1M: 10, label: "GPT-5", supportsEffort: true },
  { id: "gemini-2.5-flash", provider: "gemini", model: "gemini-2.5-flash", tier: "fast", inputPer1M: 0.3, outputPer1M: 2.5, label: "Gemini 2.5 Flash", supportsEffort: true },
  { id: "gemini-2.5-pro", provider: "gemini", model: "gemini-2.5-pro", tier: "best", inputPer1M: 1.25, outputPer1M: 10, label: "Gemini 2.5 Pro", supportsEffort: true },
  { id: "custom", provider: "custom", model: "custom", tier: "balanced", inputPer1M: null, outputPer1M: null, label: "Self-hosted (LLM_CUSTOM_BASE_URL)", supportsEffort: false },
];

/** Per provider, the catalogue id that stands in for each tier when a request has to move providers. */
export const TIER_EQUIVALENTS: Record<ProviderId, Record<ModelTier, string>> = {
  anthropic: { fast: "claude-haiku-4-5", balanced: "claude-sonnet-5", best: "claude-opus-5" },
  openai: { fast: "gpt-5-mini", balanced: "gpt-5", best: "gpt-5" },
  gemini: { fast: "gemini-2.5-flash", balanced: "gemini-2.5-pro", best: "gemini-2.5-pro" },
  // OpenRouter mirrors upstream slugs; costs are the upstream list prices (OpenRouter adds a small margin).
  openrouter: { fast: "openrouter:openai/gpt-5-mini", balanced: "openrouter:openai/gpt-5", best: "openrouter:openai/gpt-5" },
  custom: { fast: "custom", balanced: "custom", best: "custom" },
};

/** The order a fallback walks when the chosen provider isn't configured. */
export const PROVIDER_FALLBACK_ORDER: readonly ProviderId[] = ["anthropic", "openai", "gemini", "openrouter", "custom"];

export type Env = Record<string, string | undefined>;

const trim = (v: string | undefined) => (v ?? "").trim();

export const PROVIDER_ENV: Record<ProviderId, { key: string; baseUrl?: string; defaultBaseUrl?: string }> = {
  anthropic: { key: "ANTHROPIC_API_KEY" },
  openai: { key: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL", defaultBaseUrl: "https://api.openai.com/v1" },
  gemini: { key: "GEMINI_API_KEY", baseUrl: "GEMINI_BASE_URL", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  openrouter: { key: "OPENROUTER_API_KEY", baseUrl: "OPENROUTER_BASE_URL", defaultBaseUrl: "https://openrouter.ai/api/v1" },
  custom: { key: "LLM_CUSTOM_API_KEY", baseUrl: "LLM_CUSTOM_BASE_URL" },
};

/** True when the provider can be called: a key for the hosted ones, a base URL for `custom` (key optional). */
export function isProviderConfigured(provider: ProviderId, env: Env = process.env): boolean {
  const spec = PROVIDER_ENV[provider];
  if (provider === "custom") return !!trim(env[spec.baseUrl!]);
  return !!trim(env[spec.key]);
}

export function configuredProviders(env: Env = process.env): ProviderId[] {
  return PROVIDER_FALLBACK_ORDER.filter((p) => isProviderConfigured(p, env));
}

export function providerBaseUrl(provider: ProviderId, env: Env = process.env): string | null {
  const spec = PROVIDER_ENV[provider];
  if (!spec.baseUrl) return null;
  const v = trim(env[spec.baseUrl]) || spec.defaultBaseUrl || "";
  return v ? v.replace(/\/+$/, "") : null;
}

export function providerApiKey(provider: ProviderId, env: Env = process.env): string {
  return trim(env[PROVIDER_ENV[provider].key]);
}

function isProviderId(s: string): s is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(s);
}

const num = (v: string | undefined): number | null => {
  const n = Number(trim(v));
  return trim(v) && Number.isFinite(n) && n >= 0 ? n : null;
};

/** output_config.effort exists from the 4.6 generation on; 4.5 and older reject it. */
export function anthropicSupportsEffort(model: string): boolean {
  const m = /^claude-(?:[a-z]+-)?(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return true;
  const major = Number(m[1]);
  const minor = m[2] === undefined ? 0 : Number(m[2]);
  return major > 4 || (major === 4 && minor >= 6);
}

/** Catalogue lookup, then the "<provider>:<model>" ad-hoc form. null when the id can't be resolved. */
export function parseModelId(id: string | null | undefined, env: Env = process.env): CatalogueEntry | null {
  const s = trim(id ?? undefined);
  if (!s) return null;
  const hit = CATALOGUE.find((e) => e.id === s);
  if (hit) {
    if (hit.provider !== "custom") return hit;
    return { ...hit, model: trim(env.LLM_CUSTOM_MODEL) || "default", inputPer1M: num(env.LLM_CUSTOM_INPUT_PER_1M), outputPer1M: num(env.LLM_CUSTOM_OUTPUT_PER_1M) };
  }
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const provider = s.slice(0, i);
  const model = s.slice(i + 1).trim();
  if (!isProviderId(provider) || !model || model.length > 200) return null;
  const supportsEffort = provider === "custom" ? false : provider === "anthropic" ? anthropicSupportsEffort(model) : true;
  return { id: s, provider, model, tier: "balanced", inputPer1M: null, outputPer1M: null, label: `${provider}: ${model}`, supportsEffort };
}

/** USD, 6 dp; null when the model's price is unknown. */
export function estimateCostUsd(entry: Pick<CatalogueEntry, "inputPer1M" | "outputPer1M">, usage: { input: number; output: number }): number | null {
  if (entry.inputPer1M === null || entry.outputPer1M === null) return null;
  const usd = (usage.input / 1_000_000) * entry.inputPer1M + (usage.output / 1_000_000) * entry.outputPer1M;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Short "$in / $out per 1M" for the UI. */
export function formatCost(entry: Pick<CatalogueEntry, "inputPer1M" | "outputPer1M">): string {
  if (entry.inputPer1M === null || entry.outputPer1M === null) return "cost unknown";
  const f = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`);
  return `${f(entry.inputPer1M)} in / ${f(entry.outputPer1M)} out per 1M tokens`;
}
