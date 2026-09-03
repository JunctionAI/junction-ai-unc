import { describe, expect, it, vi } from "vitest";
import { defaultProviderFactory } from "../providers";
import { buildChatBody, createOpenAiCompatibleProvider, readSse } from "../providers/openaiCompatible";

const sse = (lines: unknown[]) => new Response(lines.map((l) => `data: ${typeof l === "string" ? l : JSON.stringify(l)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });

const req = { model: "gpt-5-mini", system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 500, effort: "low" as const };

function capture(res: Response | (() => Promise<Response>)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return typeof res === "function" ? res() : res;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, body: () => JSON.parse(calls[0].init.body as string) as Record<string, unknown>, headers: () => calls[0].init.headers as Record<string, string> };
}

describe("openaiCompatible — request shaping", () => {
  it("OpenAI: /chat/completions under the base URL, bearer key, max_completion_tokens, reasoning_effort, stream + usage", async () => {
    const c = capture(sse([{ choices: [{ delta: { content: "pong" }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } }, "[DONE]"]));
    const p = createOpenAiCompatibleProvider({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", supportsReasoningEffort: true, maxTokensParam: "max_completion_tokens", streamUsage: true, fetchImpl: c.fetchImpl });
    const r = await p.complete(req);
    expect(c.calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(c.headers().authorization).toBe("Bearer sk-test");
    expect(c.body()).toMatchObject({ model: "gpt-5-mini", stream: true, max_completion_tokens: 500, reasoning_effort: "low", stream_options: { include_usage: true }, messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] });
    expect(c.body()).not.toHaveProperty("max_tokens");
    expect(c.body()).not.toHaveProperty("temperature");
    expect(c.body()).not.toHaveProperty("response_format");
    expect(r).toMatchObject({ provider: "openai", model: "gpt-5-mini", text: "pong", stopReason: "end", usage: { input: 12, output: 3 } });
  });

  it("Gemini: the documented OpenAI-compatible base URL, max_tokens, JSON mode via response_format", async () => {
    const c = capture(sse([{ choices: [{ delta: { content: '{"a":1}' }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 4 } }, "[DONE]"]));
    const p = createOpenAiCompatibleProvider({ id: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: "g", supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true, fetchImpl: c.fetchImpl });
    const r = await p.complete({ ...req, model: "gemini-2.5-flash", jsonMode: true, temperature: 0.2 });
    expect(c.calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(c.body()).toMatchObject({ model: "gemini-2.5-flash", max_tokens: 500, response_format: { type: "json_object" }, temperature: 0.2, reasoning_effort: "low" });
    expect(r).toMatchObject({ provider: "gemini", text: '{"a":1}', stopReason: "end", usage: { input: 5, output: 4 } });
  });

  it("OpenRouter: base URL + X-Title header; a custom endpoint without effort support drops reasoning_effort", async () => {
    const c = capture(sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }, "[DONE]"]));
    const p = createOpenAiCompatibleProvider({ id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "r", supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true, extraHeaders: { "X-Title": "Junction Unc" }, fetchImpl: c.fetchImpl });
    await p.complete({ ...req, model: "deepseek/deepseek-chat" });
    expect(c.calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(c.headers()["X-Title"]).toBe("Junction Unc");
    expect(buildChatBody({ supportsReasoningEffort: false, maxTokensParam: "max_tokens", streamUsage: false }, req)).not.toHaveProperty("reasoning_effort");
    expect(buildChatBody({ supportsReasoningEffort: false, maxTokensParam: "max_tokens", streamUsage: false }, req)).not.toHaveProperty("stream_options");
  });

  it("the factory wires each provider from env (keys never leak into the result)", () => {
    const env = { OPENAI_API_KEY: "o", GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "r", LLM_CUSTOM_BASE_URL: "http://box/v1", ANTHROPIC_API_KEY: "a" };
    for (const id of ["anthropic", "openai", "gemini", "openrouter", "custom"] as const) expect(defaultProviderFactory(id, env)?.id).toBe(id);
    expect(defaultProviderFactory("openai", {})).toBeNull();
  });
});

describe("openaiCompatible — responses + failures", () => {
  it("finish_reason length → max_tokens; content_filter / refusal delta → refusal; in-stream error → error", async () => {
    const mk = (lines: unknown[]) => createOpenAiCompatibleProvider({ id: "openai", baseUrl: "https://x/v1", apiKey: "k", supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true, fetchImpl: capture(sse(lines)).fetchImpl });
    expect(await mk([{ choices: [{ delta: { content: "partial" }, finish_reason: "length" }] }, "[DONE]"]).complete(req)).toMatchObject({ text: "partial", stopReason: "max_tokens" });
    expect(await mk([{ choices: [{ delta: {}, finish_reason: "content_filter" }] }, "[DONE]"]).complete(req)).toMatchObject({ stopReason: "refusal" });
    expect(await mk([{ choices: [{ delta: { refusal: "no" }, finish_reason: "stop" }] }, "[DONE]"]).complete(req)).toMatchObject({ stopReason: "refusal" });
    expect(await mk([{ error: { message: "Provider returned error", code: 502 } }]).complete(req)).toMatchObject({ stopReason: "error", errorCode: "bad_response", errorMessage: "Provider returned error" });
  });

  it("a server that answers plain JSON instead of SSE is still parsed", async () => {
    const c = capture(new Response(JSON.stringify({ choices: [{ message: { content: "json ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 } }), { status: 200, headers: { "content-type": "application/json" } }));
    const p = createOpenAiCompatibleProvider({ id: "custom", baseUrl: "http://box/v1", apiKey: "", supportsReasoningEffort: false, maxTokensParam: "max_tokens", streamUsage: false, fetchImpl: c.fetchImpl });
    expect(await p.complete(req)).toMatchObject({ text: "json ok", stopReason: "end", usage: { input: 1, output: 2 } });
    expect(c.headers().authorization).toBeUndefined();
  });

  it("HTTP failures map to codes with the provider's message head (401 auth, 404 not_found, 429, 5xx) — never a throw", async () => {
    const mk = (status: number, body: unknown) => createOpenAiCompatibleProvider({ id: "openai", baseUrl: "https://x/v1", apiKey: "k", supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true, fetchImpl: capture(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })).fetchImpl });
    const auth = await mk(401, { error: { message: "Incorrect API key provided: sk-abcdef123456" } }).complete(req);
    expect(auth).toMatchObject({ stopReason: "error", errorCode: "auth", errorMessage: "401 Incorrect API key provided: [redacted]" });
    expect(auth.errorMessage).not.toContain("sk-abcdef123456");
    expect(await mk(404, { error: { message: "The model `gpt-99` does not exist" } }).complete(req)).toMatchObject({ errorCode: "not_found" });
    expect(await mk(429, { error: { message: "slow down" } }).complete(req)).toMatchObject({ errorCode: "rate_limited" });
    expect(await mk(503, "upstream down").complete(req)).toMatchObject({ errorCode: "provider_error", errorMessage: '503 "upstream down"' });
    expect(await mk(400, { error: { message: "Unsupported parameter" } }).complete(req)).toMatchObject({ errorCode: "bad_request" });
  });

  it("network errors → network; a hung connect → timeout after the connect budget; a hung stream → timeout after the total budget", async () => {
    const net = createOpenAiCompatibleProvider({ id: "openai", baseUrl: "https://x/v1", apiKey: "k", supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true, fetchImpl: (async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as unknown as typeof fetch });
    expect(await net.complete(req)).toMatchObject({ stopReason: "error", errorCode: "network", errorMessage: "fetch failed: ECONNREFUSED" });

    const hangFetch = (async (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const slow = createOpenAiCompatibleProvider({ id: "openai", baseUrl: "https://x/v1", apiKey: "k", supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true, fetchImpl: hangFetch, connectTimeoutMs: 20, totalTimeoutMs: 1000 });
    expect(await slow.complete(req)).toMatchObject({ errorCode: "timeout", errorMessage: "connect timeout after 20 ms" });

    const hungStream = (async (_url: unknown, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"par"}}]}\n\n'));
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const stuck = createOpenAiCompatibleProvider({ id: "openai", baseUrl: "https://x/v1", apiKey: "k", supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true, fetchImpl: hungStream, connectTimeoutMs: 1000, totalTimeoutMs: 30 });
    expect(await stuck.complete(req)).toMatchObject({ errorCode: "timeout", errorMessage: "total timeout after 30 ms", text: "par" });
  });

  it("readSse tolerates CRLF, blank lines and split chunks", async () => {
    const parts = ['data: {"choices":[{"delta":{"content":"he"}}]}\r\n\r\ndata: {"choi', 'ces":[{"delta":{"content":"llo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\r\n\r\ndata: [DONE]\r\n'];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    });
    expect(await readSse(stream)).toEqual({ text: "hello", finish: "stop", refused: false, usage: { input: 2, output: 1 } });
  });

  it("uses global fetch when none is injected", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(sse([{ choices: [{ delta: { content: "g" }, finish_reason: "stop" }] }, "[DONE]"]));
    try {
      const p = createOpenAiCompatibleProvider({ id: "openai", baseUrl: "https://x/v1", apiKey: "k", supportsReasoningEffort: true, maxTokensParam: "max_tokens", streamUsage: true });
      expect(await p.complete(req)).toMatchObject({ text: "g" });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
