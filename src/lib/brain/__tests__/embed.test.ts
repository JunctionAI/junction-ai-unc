/* src/lib/llm/embed.ts over a fetch fake: configuration gate, batching at 96, index
   re-ordering, dimension check, error codes, and the llm_usage ledger row (task "embed"). */

import { describe, expect, it } from "vitest";
import { EMBED_BATCH_SIZE, EMBEDDING_DIM, embed, embedOne, embeddingInputPricePer1M, embeddingModel, isEmbeddingConfigured } from "@/lib/llm/embed";
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
    expect(embeddingInputPricePer1M({})).toBe(0.02);
    expect(embeddingInputPricePer1M({ EMBEDDING_MODEL: "custom-embed", EMBEDDING_INPUT_PER_1M: "0.4" })).toBe(0.4);
    for (const price of [undefined, "", "0", "-1", "NaN", "Infinity"]) {
      expect(embeddingInputPricePer1M({ EMBEDDING_MODEL: "custom-embed", EMBEDDING_INPUT_PER_1M: price })).toBeNull();
    }
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

  it("blocks an unpriced non-default embedding model before reservation or network", async () => {
    const db = brainDb();
    const f = fetchFake(() => ({ body: { data: [{ index: 0, embedding: vec(0) }] } }));
    const r = await embed(["private memory"], { env: { ...ENV, EMBEDDING_MODEL: "custom-embed" }, fetchImpl: f.fn, db, accountId: ACCT });

    expect(r).toMatchObject({ ok: false, errorCode: "unpriced_model", model: "custom-embed", vectors: [null] });
    expect(f.calls).toHaveLength(0);
    expect(db.rows("llm_spend_reservations")).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
  });

  it("uses an explicitly priced non-default embedding model for both reservation and ledger", async () => {
    const db = brainDb();
    let reservedCeiling: unknown;
    const reserve = db.rpcs.reserve_llm_spend;
    db.rpcs.reserve_llm_spend = (args) => {
      reservedCeiling = args.p_ceiling_usd;
      return reserve(args);
    };
    const f = fetchFake(() => ({ body: { data: [{ index: 0, embedding: vec(0) }], usage: { prompt_tokens: 4 } } }));
    const r = await embed(["four"], { env: { ...ENV, EMBEDDING_MODEL: "custom-embed", EMBEDDING_INPUT_PER_1M: "2" }, fetchImpl: f.fn, db, accountId: ACCT });

    expect(r).toMatchObject({ ok: true, model: "custom-embed" });
    expect(f.calls[0].body.model).toBe("custom-embed");
    expect(reservedCeiling).toBe(0.000008);
    expect(db.rows("llm_usage")[0]).toMatchObject({ model: "custom-embed", input_tokens: 4, est_cost_usd: 0.000008 });
    expect(db.rows("llm_spend_reservations")).toHaveLength(0);
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
    expect(db.rows("llm_spend_reservations")).toHaveLength(0);
    expect(logs).toEqual([]);
  });

  it("holds an atomic reservation during an account-scoped request, then releases it after the ledger write", async () => {
    const db = brainDb();
    let markStarted!: () => void;
    let finishRequest!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const finish = new Promise<void>((resolve) => { finishRequest = resolve; });
    const fetchImpl = (async () => {
      markStarted();
      await finish;
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: vec(0) }], usage: { prompt_tokens: 4 } }));
    }) as unknown as typeof fetch;

    const pending = embed(["private memory"], { env: ENV, fetchImpl, db, accountId: ACCT });
    await started;
    expect(db.rows("llm_usage")).toHaveLength(0);
    expect(db.rows("llm_spend_reservations")).toHaveLength(1);
    finishRequest();

    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(db.rows("llm_usage")).toHaveLength(1);
    expect(db.rows("llm_spend_reservations")).toHaveLength(0);
  });

  it("fails closed before the embedding request when reservation admission is unavailable", async () => {
    const db = brainDb();
    db.rpcs.reserve_llm_spend = () => { throw new Error("database unavailable"); };
    const f = fetchFake(() => ({ body: { data: [{ index: 0, embedding: vec(0) }] } }));
    const logs: { event: string; fields: Record<string, unknown> }[] = [];

    const r = await embed(["private memory"], { env: ENV, fetchImpl: f.fn, db, accountId: ACCT, log: (event, fields) => logs.push({ event, fields }) });

    expect(r).toMatchObject({ ok: false, errorCode: "budget_unavailable", vectors: [null] });
    expect(f.calls).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
    expect(logs).toEqual([expect.objectContaining({ event: "llm.embed_budget_blocked", fields: expect.objectContaining({ code: "budget_unavailable" }) })]);
  });

  it("fails an account-scoped embedding closed when no service-role database is available", async () => {
    const f = fetchFake(() => ({ body: { data: [{ index: 0, embedding: vec(0) }] } }));
    const r = await embed(["private memory"], { env: ENV, fetchImpl: f.fn, db: null, accountId: ACCT, log: () => {} });

    expect(r).toMatchObject({ ok: false, errorCode: "budget_unavailable", vectors: [null] });
    expect(f.calls).toHaveLength(0);
  });

  it("retains the embedding reservation when the usage ledger write fails", async () => {
    const db = brainDb();
    const originalFrom = db.from.bind(db);
    db.from = ((table: string) => {
      const query = originalFrom(table);
      if (table === "llm_usage") query.insert = (() => Promise.resolve({ data: null, error: { message: "ledger unavailable" } })) as unknown as typeof query.insert;
      return query;
    }) as typeof db.from;
    const f = fetchFake(() => ({ body: { data: [{ index: 0, embedding: vec(0) }], usage: { prompt_tokens: 4 } } }));
    const logs: { event: string; fields: Record<string, unknown> }[] = [];

    await expect(embed(["private memory"], { env: ENV, fetchImpl: f.fn, db, accountId: ACCT, log: (event, fields) => logs.push({ event, fields }) })).resolves.toMatchObject({ ok: true });

    expect(db.rows("llm_usage")).toHaveLength(0);
    expect(db.rows("llm_spend_reservations")).toHaveLength(1);
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ event: "llm.usage_write_failed" }), expect.objectContaining({ event: "llm.budget_reservation_retained", fields: expect.objectContaining({ reason: "usage_not_durable" }) })]));
  });

  it("retains the embedding ceiling after a potentially billed error or usage-free response", async () => {
    for (const response of [
      () => ({ status: 401, body: { error: { message: "invalid key" } } }),
      (req: { body: { input: string[] } }) => ({ body: { data: req.body.input.map((_, i) => ({ index: i, embedding: vec(i) })) } }),
    ]) {
      const db = brainDb();
      const f = fetchFake(response);
      const logs: { event: string; fields: Record<string, unknown> }[] = [];

      await embed(["private memory"], { env: ENV, fetchImpl: f.fn, db, accountId: ACCT, log: (event, fields) => logs.push({ event, fields }) });

      expect(db.rows("llm_usage")).toHaveLength(1);
      expect(db.rows("llm_spend_reservations")).toHaveLength(1);
      expect(logs).toContainEqual(expect.objectContaining({ event: "llm.budget_reservation_retained", fields: expect.objectContaining({ reason: "provider_usage_unconfirmed" }) }));
    }
  });

  it("batches at 96 and merges usage across batches", async () => {
    const f = fetchFake((req) => ({ body: { data: req.body.input.map((_, i) => ({ index: i, embedding: vec(i) })), usage: { prompt_tokens: req.body.input.length } } }));
    const texts = Array.from({ length: 100 }, (_, i) => `t${i}`);
    const r = await embed(texts, { env: ENV, fetchImpl: f.fn, db: null });
    expect(f.calls.map((c) => c.body.input.length)).toEqual([EMBED_BATCH_SIZE, 4]);
    expect(r.vectors.every((v) => v && v.length === EMBEDDING_DIM)).toBe(true);
    expect(r.usage.input).toBe(100);
  });

  it("an account at its model cap makes no embedding request", async () => {
    const db = brainDb();
    db.rows("accounts")[0].monthly_llm_cap_usd = 0;
    const f = fetchFake(() => ({ body: { data: [{ index: 0, embedding: vec(0) }] } }));
    const r = await embed(["private account memory"], { env: ENV, fetchImpl: f.fn, db, accountId: ACCT });
    expect(r).toMatchObject({ ok: false, errorCode: "budget_exceeded", vectors: [null] });
    expect(f.calls).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
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
