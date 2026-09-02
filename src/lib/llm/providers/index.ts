/* Provider factory — one place that knows which env vars feed which adapter. */

import { providerApiKey, providerBaseUrl, isProviderConfigured, type Env } from "../registry";
import type { LlmProvider, ProviderId } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAiCompatibleProvider } from "./openaiCompatible";

export type ProviderFactory = (id: ProviderId, env: Env) => LlmProvider | null;

export const defaultProviderFactory: ProviderFactory = (id, env) => {
  if (!isProviderConfigured(id, env)) return null;
  switch (id) {
    case "anthropic":
      return createAnthropicProvider();
    case "openai":
      return createOpenAiCompatibleProvider({ id, baseUrl: providerBaseUrl(id, env)!, apiKey: providerApiKey(id, env), supportsReasoningEffort: true, maxTokensParam: "max_completion_tokens", streamUsage: true });
    case "gemini":
      return createOpenAiCompatibleProvider({ id, baseUrl: providerBaseUrl(id, env)!, apiKey: providerApiKey(id, env), supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true });
    case "openrouter":
      return createOpenAiCompatibleProvider({ id, baseUrl: providerBaseUrl(id, env)!, apiKey: providerApiKey(id, env), supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true, extraHeaders: { "X-Title": "Junction Unc" } });
    case "custom":
      return createOpenAiCompatibleProvider({
        id,
        baseUrl: providerBaseUrl(id, env)!,
        apiKey: providerApiKey(id, env),
        supportsReasoningEffort: (env.LLM_CUSTOM_REASONING_EFFORT ?? "").trim() === "1",
        maxTokensParam: "max_tokens",
        streamUsage: (env.LLM_CUSTOM_STREAM_USAGE ?? "1").trim() !== "0",
      });
  }
};
