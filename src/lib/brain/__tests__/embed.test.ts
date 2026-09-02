/* src/lib/llm/embed.ts over a fetch fake: configuration gate, batching at 96, index
   re-ordering, dimension check, error codes, and the llm_usage ledger row (task "embed"). */

import { describe, expect, it } from "vitest";
import { EMBED_BATCH_SIZE, EMBEDDING_DIM, embed, embedOne, embeddingModel, isEmbeddingConfigured } from "@/lib/llm/embed";
import { brainDb, ACCT } from "./helpers";

const ENV = { OPENAI_API_KEY: "sk-test" };

type Req = { url: string; body: { model: string; input: string[] }; auth: string | null };

function fetchFake(handler: (req: Req) => { status?: number; body: unknown; contentType?: string }) {
  const calls: Req[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    const req: Req = { url: String(url), body: JSON.parse(String(init?.body)), auth: headers?.authorization ?? null };
    calls.push(req);
    const out = handler(req);
    return new Response(typeof out.body === "string" ? out.body : JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": out.contentType ?? "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const vec = (seed: number) => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === seed % EMBEDDING_DIM ? 1 : 0));

describe("isEmbeddingConfigured / embeddingModel", () => {
  it("needs OPENAI_API_KEY and honours EMBEDDINGS_DISABLED + EMBEDDING_MODEL", () => {
    expect(isEmbeddingConfigured({})).toBe(false);
    expect(isEmbeddingConfigured({ GEMINI_API_KEY: "g" })).toBe(false); // Gemini's compat endpoint isn't 1536-dim — not a stand-in
    expect(isEmbeddingConfigured(ENV)).toBe(true);
    expect(isEmbeddingConfigured({ ...ENV, EMBEDDINGS_DISABLED: "1" })).toBe(false);
    expect(embeddingModel({})).toBe("text-embedding-3-small");
    expect(embeddingModel({ EMBEDDING_MODEL: " custom-embed " })).toBe("custom-embed");
  });
});

describe("embed", () => {
  it("not configured → every vector null, ok:false, no network, no ledger write", async () => {
    const db = brainDb();
    const f = fetchFake(() => ({ body: {} }));
    const r = await embed(["a", "b"], { env: {}, fetchImpl: f.fn, db });
    expect(r).toMatchObject({ ok: false, errorCode: "not_configured", vectors: [null, null] });
    expect(f.calls).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
  });

  it("calls <base>/embeddings with the bearer key, returns vectors in input order, skips blanks, writes the ledger", async () => {
    const db = brainDb();
    const f = fetchFake((req) => ({ body: { data: req.body.input.map((_, i) => ({ index: req.body.input.length - 1 - i, embedding: vec(req.body.input.length - 1 - i) })), usage: { prompt_tokens: 9 } } }));
    const logs: string[] = [];
    const r = await embed(["first", "   ", "third"], { env: { ...ENV, OPENAI_BASE_URL: "https://proxy.test/v1/" }, fetchImpl: f.fn, db, accountId: ACCT, log: (e) => logs.push(e), now: () => new Date("2026-09-02T00:00:00.000Z") });
    expect(r.ok).toBe(true);
    expect(r.vectors[1]).toBeNull();
    expect(r.vectors[0]).toEqual(vec(0)); // index 0 in the response, even though it came back last
    expect(r.vectors[2]).toEqual(vec(1));
    expect(f.calls[0]).toMatchObject({ url: "https://proxy.test/v1/embeddings", auth: "Bearer sk-test", body: { model: "text-embedding-3-small", input: ["first", "third"] } });
    expect(r.usage).toEqual({ input: 9, output: 0 });
    expect(db.rows("llm_usage")).toHaveLength(1);
    expect(db.rows("llm_usage")[0]).toMatchObject({ account_id: ACCT, task: "embed", provider: "openai", model: "text-embedding-3-small", input_tokens: 9, output_tokens: 0, stop_reason: "end", est_cost_usd: 0 });
    expect(logs).toEqual([]);
  });

  it("batches at 96 and merges usage across batches", async () => {
    const f = fetchFake((req) => ({ body: { data: req.body.input.map((_, i) => ({ index: i, embedding: vec(i) })), usage: { prompt_tokens: req.body.input.length } } }));
    const texts = Array.from({ length: 100 }, (_, i) => `t${i}`);
    const r = await embed(texts, { env: ENV, fetchImpl: f.fn, db: null });
    expect(f.calls.map((c) => c.body.input.length)).toEqual([EMBED_BATCH_SIZE, 4]);
    expect(r.vectors.every((v) => v && v.length === EMBEDDING_DIM)).toBe(true);
    expect(r.usage.input).toBe(100);
  });

  it("wrong dimensions → bad_response with null vectors (a wrong vector never lands); HTTP errors map to codes; bad JSON handled", async () => {
    const short = fetchFake((req) => ({ body: { data: req.body.input.map((_, i) => ({ index: i, embedding: [1, 2, 3] })) } }));
    const r1 = await embed(["x"], { env: ENV, fetchImpl: short.fn, db: null });
    expect(r1).toMatchObject({ ok: false, errorCode: "bad_response", vectors: [null] });
    const unauth = fetchFake(() => ({ status: 401, body: { error: { message: "Incorrect API key provided: sk-test…" } } }));
    const r2 = await embed(["x"], { env: ENV, fetchImpl: unauth.fn, db: null });
    expect(r2).toMatchObject({ ok: false, errorCode: "auth" });
    expect(r2.errorMessage).toMatch(/^401 /);
    const limited = fetchFake(() => ({ status: 429, body: "slow down" }));
    expect((await embed(["x"], { env: ENV, fetchImpl: limited.fn, db: null })).errorCode).toBe("rate_limited");
    const junk = fetchFake(() => ({ body: "<html>", contentType: "text/html" }));
    expect((await embed(["x"], { env: ENV, fetchImpl: junk.fn, db: null })).errorCode).toBe("bad_response");
    const down = (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    const r3 = await embed(["x"], { env: ENV, fetchImpl: down, db: null });
    expect(r3).toMatchObject({ ok: false, errorCode: "network" });
    // the ledger still records the failed call
    const db = brainDb();
    await embed(["x"], { env: ENV, fetchImpl: unauth.fn, db });
    expect(db.rows("llm_usage")[0]).toMatchObject({ task: "embed", stop_reason: "error:auth" });
  });

  it("embedOne", async () => {
    const f = fetchFake(() => ({ body: { data: [{ index: 0, embedding: vec(3) }] } }));
    expect(await embedOne("hello", { env: ENV, fetchImpl: f.fn, db: null })).toEqual(vec(3));
    expect(await embedOne("hello", { env: {}, db: null })).toBeNull();
    expect(await embedOne("", { env: ENV, fetchImpl: f.fn, db: null })).toBeNull();
  });
});
