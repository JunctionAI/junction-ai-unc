/* Anthropic adapter — wraps the SDK usage the five call sites had inline.

   Kept exactly: maxRetries 1 (one retry on 429/5xx/connection, then the call site falls
   back), output_config.effort (the router strips `effort` for models that reject it —
   Haiku 4.5 and older), generous max_tokens because Sonnet 5 / Opus 5 think adaptively
   and those tokens count against the cap, stop_reason "refusal" → "refusal". The SDK reads
   ANTHROPIC_API_KEY itself; this module never touches or logs the value. */

import Anthropic from "@anthropic-ai/sdk";
import { sanitiseProviderError } from "../errors";
import type { LlmErrorCode, LlmProvider, LlmResult, ProviderRequest } from "../types";

/** The slice of the SDK the adapter uses — tests inject a fake. */
export interface AnthropicMessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export interface AnthropicProviderOptions {
  client?: AnthropicMessagesClient;
  now?: () => number;
}

const sanitise = (s: string) => sanitiseProviderError(s);

export function mapAnthropicError(err: unknown): { code: LlmErrorCode; message: string } {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { code: "timeout", message: "request timed out" };
  if (err instanceof Anthropic.APIConnectionError) return { code: "network", message: sanitise(err.message) };
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    const raw = sanitise(err.message);
    const message = status !== undefined && raw.startsWith(`${status} `) ? raw : `${status ?? "?"} ${raw}`.trim();
    if (status === 401 || status === 403) return { code: "auth", message };
    if (status === 404) return { code: "not_found", message };
    if (status === 400 || status === 422) return { code: "bad_request", message };
    if (status === 429) return { code: "rate_limited", message };
    if (status !== undefined && status >= 500) return { code: "provider_error", message };
    return { code: "unknown", message };
  }
  return { code: "unknown", message: err instanceof Error ? sanitise(err.message) : "unknown error" };
}

export function createAnthropicProvider(opts: AnthropicProviderOptions = {}): LlmProvider {
  const now = opts.now ?? (() => Date.now());
  let client: AnthropicMessagesClient | null = opts.client ?? null;
  return {
    id: "anthropic",
    async complete(req: ProviderRequest): Promise<LlmResult> {
      const t0 = now();
      const base = { provider: "anthropic" as const, model: req.model };
      try {
        client ??= new Anthropic({ maxRetries: 1 });
        const params: Anthropic.MessageCreateParamsNonStreaming = {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        };
        if (req.effort) params.output_config = { effort: req.effort };
        if (req.temperature !== undefined) params.temperature = req.temperature;
        const response = await client.messages.create(params);
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        const stopReason: LlmResult["stopReason"] = response.stop_reason === "refusal" ? "refusal" : response.stop_reason === "max_tokens" ? "max_tokens" : "end";
        return { ...base, text, stopReason, usage: { input: response.usage?.input_tokens ?? 0, output: response.usage?.output_tokens ?? 0 }, latencyMs: now() - t0 };
      } catch (err) {
        const { code, message } = mapAnthropicError(err);
        return { ...base, text: "", stopReason: "error", errorCode: code, errorMessage: message, usage: { input: 0, output: 0 }, latencyMs: now() - t0 };
      }
    },
  };
}
