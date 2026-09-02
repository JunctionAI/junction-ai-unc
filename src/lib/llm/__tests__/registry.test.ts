import { describe, expect, it } from "vitest";
import { CATALOGUE, TIER_EQUIVALENTS, configuredProviders, estimateCostUsd, formatCost, isProviderConfigured, parseModelId, providerBaseUrl } from "../registry";

describe("registry", () => {
  it("ships the catalogue the brief asks for, every tier equivalent resolves, and prices are per-1M USD", () => {
    for (const id of ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5", "gpt-5-mini", "gpt-5", "gemini-2.5-flash", "gemini-2.5-pro", "custom"]) expect(CATALOGUE.some((e) => e.id === id)).toBe(true);
    for (const perProvider of Object.values(TIER_EQUIVALENTS)) for (const id of Object.values(perProvider)) expect(parseModelId(id, {})).not.toBeNull();
    expect(CATALOGUE.find((e) => e.id === "claude-haiku-4-5")!.supportsEffort).toBe(false); // Haiku 4.5 rejects output_config.effort
    expect(CATALOGUE.find((e) => e.id === "claude-sonnet-5")).toMatchObject({ provider: "anthropic", tier: "balanced", inputPer1M: 2, outputPer1M: 10, supportsEffort: true });
  });

  it("isProviderConfigured keys off the env (custom needs a base URL, key optional)", () => {
    expect(isProviderConfigured("anthropic", {})).toBe(false);
    expect(isProviderConfigured("anthropic", { ANTHROPIC_API_KEY: "  " })).toBe(false);
    expect(isProviderConfigured("anthropic", { ANTHROPIC_API_KEY: "k" })).toBe(true);
    expect(isProviderConfigured("openai", { OPENAI_API_KEY: "k" })).toBe(true);
    expect(isProviderConfigured("gemini", { GEMINI_API_KEY: "k" })).toBe(true);
    expect(isProviderConfigured("openrouter", { OPENROUTER_API_KEY: "k" })).toBe(true);
    expect(isProviderConfigured("custom", { LLM_CUSTOM_API_KEY: "k" })).toBe(false);
    expect(isProviderConfigured("custom", { LLM_CUSTOM_BASE_URL: "http://localhost:11434/v1" })).toBe(true);
    expect(configuredProviders({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toEqual(["anthropic", "gemini"]);
  });

  it("base URLs: documented defaults, env override, trailing slash trimmed", () => {
    expect(providerBaseUrl("openai", {})).toBe("https://api.openai.com/v1");
    expect(providerBaseUrl("gemini", {})).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(providerBaseUrl("openrouter", {})).toBe("https://openrouter.ai/api/v1");
    expect(providerBaseUrl("custom", { LLM_CUSTOM_BASE_URL: "http://box:8000/v1/" })).toBe("http://box:8000/v1");
    expect(providerBaseUrl("anthropic", {})).toBeNull();
  });

  it("parseModelId: catalogue ids, custom from env, ad-hoc provider:model, garbage → null", () => {
    expect(parseModelId("gpt-5-mini", {})).toMatchObject({ provider: "openai", model: "gpt-5-mini", tier: "fast" });
    expect(parseModelId("custom", { LLM_CUSTOM_MODEL: "llama-3.3-70b", LLM_CUSTOM_INPUT_PER_1M: "0.1", LLM_CUSTOM_OUTPUT_PER_1M: "0.2" })).toMatchObject({ provider: "custom", model: "llama-3.3-70b", inputPer1M: 0.1, outputPer1M: 0.2 });
    expect(parseModelId("custom", {})).toMatchObject({ provider: "custom", model: "default", inputPer1M: null });
    expect(parseModelId("openrouter:deepseek/deepseek-chat", {})).toMatchObject({ provider: "openrouter", model: "deepseek/deepseek-chat", tier: "balanced", inputPer1M: null, supportsEffort: true });
    expect(parseModelId("anthropic:claude-sonnet-4-6", {})).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6", supportsEffort: true });
    expect(parseModelId("anthropic:claude-haiku-4-5", {})).toMatchObject({ supportsEffort: false });
    expect(parseModelId("anthropic:claude-3-5-haiku-20241022", {})).toMatchObject({ supportsEffort: false });
    expect(parseModelId("custom:my-model", {})).toMatchObject({ provider: "custom", supportsEffort: false });
    for (const bad of ["", "  ", "nope", "mystery:model", ":x", "openai:", null, undefined]) expect(parseModelId(bad, {})).toBeNull();
  });

  it("cost estimation is tokens/1M × price, 6 dp, null when the price is unknown", () => {
    expect(estimateCostUsd({ inputPer1M: 2, outputPer1M: 10 }, { input: 1_000_000, output: 100_000 })).toBe(3);
    expect(estimateCostUsd({ inputPer1M: 0.25, outputPer1M: 2 }, { input: 1234, output: 567 })).toBe(0.001443);
    expect(estimateCostUsd({ inputPer1M: null, outputPer1M: 2 }, { input: 1, output: 1 })).toBeNull();
    expect(formatCost({ inputPer1M: 2, outputPer1M: 10 })).toBe("$2 in / $10 out per 1M tokens");
    expect(formatCost({ inputPer1M: 0.25, outputPer1M: 2 })).toBe("$0.25 in / $2 out per 1M tokens");
    expect(formatCost({ inputPer1M: null, outputPer1M: null })).toBe("cost unknown");
  });
});
