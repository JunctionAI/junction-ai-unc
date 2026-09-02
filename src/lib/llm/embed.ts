/* Embeddings — the one vector seam the Client Brain uses (memories.embedding, migration 0010).

     isEmbeddingConfigured(env?)          OPENAI_API_KEY present (the only provider whose
                                          OpenAI-compatible /embeddings endpoint returns the
                                          1536-dim text-embedding-3-small the schema is built
                                          around; Gemini's compat endpoint serves 768/3072 dims,
                                          so it is NOT a stand-in)
     embed(texts, ctx?)                   → EmbedResult, never throws; batches of ≤ 96; one
                                          llm_usage row per batch under task "embed"
     embedOne(text, ctx?)                 → number[] | null

   Env: OPENAI_API_KEY (required), OPENAI_BASE_URL (override; default api.openai.com/v1),
   EMBEDDING_MODEL (override; must still return 1536 dims — anything else is rejected as
   bad_response so a wrong vector never lands in the table). When nothing is configured
   every caller degrades to keyword/recency retrieval — see src/lib/brain/retrieve.ts.

   Relative imports only (the worker's standalone build has no "@/" resolver). */

import type { DbClient } from "../db/types";
import { providerApiKey, providerBaseUrl, type Env } from "./registry";
import { defaultLlmLog, recordUsage, usageRecord, type LlmLog } from "./telemetry";
import type { LlmErrorCode, LlmResult } from "./types";

export const EMBEDDING_DIM = 1536;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
/** USD per 1M input tokens — approximate list price, hand-maintained like registry.ts. */
export const EMBEDDING_INPUT_PER_1M = 0.02;
export const EMBED_BATCH_SIZE = 96;
/** Per input; the model's window is 8191 tokens and memories are a sentence or two. */
export const EMBED_MAX_INPUT_CHARS = 8000;
export const EMBED_TIMEOUT_MS = 30_000;

export interface EmbedContext {
  accountId?: string | null;
  /** Ledger client. undefined = none (the record is logged instead); the brain passes its service-role client. */
  db?: DbClient | null;
  log?: LlmLog;
  env?: Env;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface EmbedResult {
  /** One entry per input, in order. null when that input could not be embedded. */
  vectors: (number[] | null)[];
  ok: boolean;
  errorCode?: LlmErrorCode;
  errorMessage?: string;
  usage: { input: number; output: number };
  latencyMs: number;
  model: string;
}

export function embeddingModel(env: Env = process.env): string {
  return (env.EMBEDDING_MODEL ?? "").trim() || DEFAULT_EMBEDDING_MODEL;
}

export function isEmbeddingConfigured(env: Env = process.env): boolean {
  return !!providerApiKey("openai", env) && (env.EMBEDDINGS_DISABLED ?? "").trim() !== "1";
}

const head = (s: string, n = 200) => s.replace(/\s+/g, " ").trim().slice(0, n);

function codeForStatus(status: number): LlmErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "bad_request";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_error";
  return "unknown";
}

interface EmbeddingsBody {
  data?: { index?: number; embedding?: unknown }[];
  usage?: { prompt_tokens?: number; total_tokens?: number };
  error?: { message?: string } | string;
}

function isVector(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === EMBEDDING_DIM && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

async function embedBatch(batch: string[], model: string, baseUrl: string, apiKey: string, fetchImpl: typeof fetch): Promise<{ vectors: (number[] | null)[]; usage: { input: number; output: number }; errorCode?: LlmErrorCode; errorMessage?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  const none = batch.map(() => null);
  try {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: batch, encoding_format: "float" }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return { vectors: none, usage: { input: 0, output: 0 }, errorCode: "timeout", errorMessage: `timeout after ${EMBED_TIMEOUT_MS} ms` };
      return { vectors: none, usage: { input: 0, output: 0 }, errorCode: "network", errorMessage: err instanceof Error ? head(err.message) : "fetch failed" };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = head(text);
      try {
        const j = JSON.parse(text) as EmbeddingsBody;
        const m = typeof j.error === "string" ? j.error : j.error?.message;
        if (m) msg = head(m);
      } catch {
        /* not JSON */
      }
      return { vectors: none, usage: { input: 0, output: 0 }, errorCode: codeForStatus(res.status), errorMessage: `${res.status} ${msg}`.trim() };
    }
    let json: EmbeddingsBody;
    try {
      json = (await res.json()) as EmbeddingsBody;
    } catch {
      return { vectors: none, usage: { input: 0, output: 0 }, errorCode: "bad_response", errorMessage: "response was not JSON" };
    }
    if (json.error) return { vectors: none, usage: { input: 0, output: 0 }, errorCode: "bad_response", errorMessage: head(typeof json.error === "string" ? json.error : json.error.message ?? "error") };
    if (!Array.isArray(json.data)) return { vectors: none, usage: { input: 0, output: 0 }, errorCode: "bad_response", errorMessage: "no data in response" };
    const vectors: (number[] | null)[] = batch.map(() => null);
    json.data.forEach((d, i) => {
      const idx = typeof d.index === "number" ? d.index : i;
      if (idx >= 0 && idx < vectors.length && isVector(d.embedding)) vectors[idx] = d.embedding;
    });
    const usage = { input: json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0, output: 0 };
    if (vectors.some((v) => v === null)) return { vectors, usage, errorCode: "bad_response", errorMessage: `expected ${EMBEDDING_DIM}-dim vectors for every input` };
    return { vectors, usage };
  } finally {
    clearTimeout(timer);
  }
}

/** Embed up to any number of texts (batched ≤ 96). Never throws; not configured ⇒ ok:false,
    every vector null, no network. Empty/whitespace inputs get null without a call. */
export async function embed(texts: string[], ctx: EmbedContext = {}): Promise<EmbedResult> {
  const env = ctx.env ?? process.env;
  const model = embeddingModel(env);
  const t0 = Date.now();
  const base: EmbedResult = { vectors: texts.map(() => null), ok: false, usage: { input: 0, output: 0 }, latencyMs: 0, model };
  if (!isEmbeddingConfigured(env)) return { ...base, errorCode: "not_configured", errorMessage: "OPENAI_API_KEY is not set" };
  const log = ctx.log ?? defaultLlmLog;
  const now = ctx.now ?? (() => new Date());
  const baseUrl = providerBaseUrl("openai", env) ?? "https://api.openai.com/v1";
  const apiKey = providerApiKey("openai", env);
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const db = ctx.db ?? null;

  const idx: number[] = [];
  const inputs: string[] = [];
  texts.forEach((t, i) => {
    const s = (t ?? "").replace(/\s+/g, " ").trim().slice(0, EMBED_MAX_INPUT_CHARS);
    if (s) {
      idx.push(i);
      inputs.push(s);
    }
  });
  if (!inputs.length) return { ...base, ok: true, latencyMs: Date.now() - t0 };

  const vectors = base.vectors.slice();
  let usage = { input: 0, output: 0 };
  let errorCode: LlmErrorCode | undefined;
  let errorMessage: string | undefined;
  for (let start = 0; start < inputs.length; start += EMBED_BATCH_SIZE) {
    const batch = inputs.slice(start, start + EMBED_BATCH_SIZE);
    const b0 = Date.now();
    const r = await embedBatch(batch, model, baseUrl, apiKey, fetchImpl);
    r.vectors.forEach((v, j) => {
      vectors[idx[start + j]] = v;
    });
    usage = { input: usage.input + r.usage.input, output: 0 };
    if (r.errorCode && !errorCode) {
      errorCode = r.errorCode;
      errorMessage = r.errorMessage;
    }
    const result: LlmResult = { text: "", stopReason: r.errorCode ? "error" : "end", errorCode: r.errorCode, errorMessage: r.errorMessage, usage: r.usage, provider: "openai", model, latencyMs: Date.now() - b0 };
    await recordUsage(usageRecord("embed", ctx.accountId ?? null, { provider: "openai", model, inputPer1M: EMBEDDING_INPUT_PER_1M, outputPer1M: 0 }, result, now()), db, log);
    if (r.errorCode) log("llm.error", { task: "embed", provider: "openai", model, code: r.errorCode, message: r.errorMessage });
  }
  return { vectors, ok: !errorCode, errorCode, errorMessage, usage, latencyMs: Date.now() - t0, model };
}

export async function embedOne(text: string, ctx: EmbedContext = {}): Promise<number[] | null> {
  const r = await embed([text], ctx);
  return r.vectors[0] ?? null;
}

/** The injectable shape the brain modules take (tests pass a deterministic fake). */
export type EmbedFn = (texts: string[], ctx?: EmbedContext) => Promise<EmbedResult>;
