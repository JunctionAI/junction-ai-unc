/* OpenAI-compatible adapter over fetch — OpenAI, Gemini's OpenAI endpoint, OpenRouter and
   any self-hosted /chat/completions server. No SDK.

   Streaming on purpose: a non-streaming completion sends no bytes until the whole answer
   is generated, so "10 s connect" could only be measured on a stream. We ask for SSE,
   treat the 10 s budget as "headers must arrive" (connect + accept) and 60 s as the total,
   then assemble the deltas. A server that ignores `stream` and answers with JSON is
   handled too. Usage comes from the final chunk (stream_options.include_usage) when the
   server supports it; otherwise 0/0 and the ledger says so via a null cost.

   Never throws: every failure is an LlmResult with stopReason "error" + a code. The key
   only ever lands in the Authorization header. */

import { sanitiseProviderError } from "../errors";
import type { LlmErrorCode, LlmProvider, LlmResult, ProviderId, ProviderRequest } from "../types";

export interface OpenAiCompatibleOptions {
  id: ProviderId;
  baseUrl: string;
  apiKey: string;
  /** Send `reasoning_effort` (OpenAI gpt-5 family, Gemini 2.5, OpenRouter pass-through). */
  supportsReasoningEffort: boolean;
  /** OpenAI's reasoning models reject `max_tokens`; everyone else still speaks it. */
  maxTokensParam: "max_completion_tokens" | "max_tokens";
  /** Ask for the usage chunk at the end of the stream. */
  streamUsage: boolean;
  extraHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  now?: () => number;
}

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;

interface Chunk {
  error?: { message?: string; code?: unknown };
  choices?: { delta?: { content?: string | null; refusal?: string | null }; message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export function codeForStatus(status: number): LlmErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "bad_request";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_error";
  return "unknown";
}

const head = (s: string, n = 200) => sanitiseProviderError(s, n);

function errorMessageFromBody(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === "string" ? j.error : j.error?.message ?? j.message;
    if (m) return `${status} ${head(m)}`;
  } catch {
    /* not JSON */
  }
  return `${status} ${head(body)}`.trim();
}

/** Build the chat/completions body (exported for tests). */
export function buildChatBody(opts: Pick<OpenAiCompatibleOptions, "supportsReasoningEffort" | "maxTokensParam" | "streamUsage">, req: ProviderRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: [{ role: "system", content: req.system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
    stream: true,
    [opts.maxTokensParam]: req.maxTokens,
  };
  if (opts.streamUsage) body.stream_options = { include_usage: true };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.jsonMode) body.response_format = { type: "json_object" };
  if (req.effort && opts.supportsReasoningEffort) body.reasoning_effort = req.effort;
  return body;
}

function finishToStop(finish: string | null | undefined, refused: boolean): LlmResult["stopReason"] {
  if (refused || finish === "content_filter") return "refusal";
  if (finish === "length") return "max_tokens";
  return "end";
}

/** Parse an SSE body into text/usage/finish. Exported for tests. */
export async function readSse(body: ReadableStream<Uint8Array>): Promise<{ text: string; finish: string | null; refused: boolean; usage: { input: number; output: number }; error?: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let finish: string | null = null;
  let refused = false;
  let usage = { input: 0, output: 0 };
  const handle = (line: string): boolean => {
    if (!line.startsWith("data:")) return false;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return data === "[DONE]";
    let chunk: Chunk;
    try {
      chunk = JSON.parse(data) as Chunk;
    } catch {
      return false;
    }
    if (chunk.error) throw new Error(head(chunk.error.message ?? "stream error"));
    const c = chunk.choices?.[0];
    if (c?.delta?.content) text += c.delta.content;
    if (c?.delta?.refusal) refused = true;
    if (c?.finish_reason) finish = c.finish_reason;
    if (chunk.usage) usage = { input: chunk.usage.prompt_tokens ?? usage.input, output: chunk.usage.completion_tokens ?? usage.output };
    return false;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (handle(line)) return { text, finish, refused, usage };
      }
    }
    if (buf.trim()) handle(buf.trim());
    return { text, finish, refused, usage };
  } catch (err) {
    return { text, finish, refused, usage, error: err instanceof Error ? err.message : "stream error" };
  } finally {
    reader.releaseLock();
  }
}

export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): LlmProvider {
  const now = opts.now ?? (() => Date.now());
  const fetchImpl = opts.fetchImpl ?? fetch;
  const connectMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const totalMs = opts.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    id: opts.id,
    async complete(req: ProviderRequest): Promise<LlmResult> {
      const t0 = now();
      const base = { provider: opts.id, model: req.model };
      const fail = (errorCode: LlmErrorCode, errorMessage: string, text = ""): LlmResult => ({ ...base, text, stopReason: "error", errorCode, errorMessage, usage: { input: 0, output: 0 }, latencyMs: now() - t0 });
      if (!opts.baseUrl) return fail("not_configured", "no base URL");

      const controller = new AbortController();
      let timedOut: "connect" | "total" | null = null;
      const connectTimer = setTimeout(() => {
        timedOut = "connect";
        controller.abort();
      }, connectMs);
      const totalTimer = setTimeout(() => {
        timedOut = "total";
        controller.abort();
      }, totalMs);

      try {
        const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream, application/json", ...(opts.extraHeaders ?? {}) };
        if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
        let res: Response;
        try {
          res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(buildChatBody(opts, req)), signal: controller.signal });
        } catch (err) {
          if (timedOut) return fail("timeout", `${timedOut} timeout after ${timedOut === "connect" ? connectMs : totalMs} ms`);
          return fail("network", err instanceof Error ? head(err.message) : "fetch failed");
        }
        clearTimeout(connectTimer); // headers are in — only the total budget applies now

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return fail(codeForStatus(res.status), errorMessageFromBody(res.status, body));
        }

        const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
        let text = "";
        let finish: string | null = null;
        let refused = false;
        let usage = { input: 0, output: 0 };
        if (ctype.includes("text/event-stream") && res.body) {
          const r = await readSse(res.body);
          if (r.error) return fail(timedOut ? "timeout" : "bad_response", timedOut ? `total timeout after ${totalMs} ms` : r.error, r.text);
          ({ text, finish, refused, usage } = r);
        } else {
          let json: Chunk;
          try {
            json = (await res.json()) as Chunk;
          } catch {
            return fail("bad_response", "response was neither SSE nor JSON");
          }
          if (json.error) return fail("bad_response", head(json.error.message ?? "error"));
          const c = json.choices?.[0];
          if (!c) return fail("bad_response", "no choices in response");
          text = c.message?.content ?? c.delta?.content ?? "";
          refused = !!(c.message?.refusal || c.delta?.refusal);
          finish = c.finish_reason ?? null;
          if (json.usage) usage = { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 };
        }
        return { ...base, text, stopReason: finishToStop(finish, refused), usage, latencyMs: now() - t0 };
      } catch (err) {
        if (timedOut) return fail("timeout", `${timedOut} timeout`);
        return fail("unknown", err instanceof Error ? head(err.message) : "unknown error");
      } finally {
        clearTimeout(connectTimer);
        clearTimeout(totalTimer);
      }
    },
  };
}
