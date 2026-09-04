import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { complete, completeModel, createTextClient, describeLlm, resolveModel, setLlmDbForTests, setProviderFactoryForTests } from "../router";
import type { LlmProvider, LlmResult, ProviderId, ProviderRequest } from "../types";
import { clearLlmEnv, restoreLlmEnv } from "./env";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const ALL = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", GEMINI_API_KEY: "g", OPENROUTER_API_KEY: "r", LLM_CUSTOM_BASE_URL: "http://box/v1" };

describe("resolveModel — precedence + fallback chains", () => {
  it("defaults: sonnet for chat/narrative/self-review, fast tier for scan + routine decisions", () => {
    expect(resolveModel("chat", { env: ALL })).toMatchObject({ id: "claude-sonnet-5", source: "default" });
    expect(resolveModel("plan_narrative", { env: ALL })).toMatchObject({ id: "claude-sonnet-5", source: "default" });
    expect(resolveModel("self_review", { env: ALL })).toMatchObject({ id: "claude-sonnet-5", source: "default" });
    expect(resolveModel("business_scan", { env: ALL })).toMatchObject({ id: "claude-haiku-4-5", tier: "fast", source: "default" });
    expect(resolveModel("routine_decision", { env: ALL })).toMatchObject({ id: "claude-haiku-4-5", tier: "fast", source: "default" });
  });

  it("account setting beats env, env beats default", () => {
    const env = { ...ALL, LLM_MODEL_CHAT: "gpt-5" };
    expect(resolveModel("chat", { env })).toMatchObject({ id: "gpt-5", source: "env" });
    expect(resolveModel("chat", { env, accountOverride: "gemini-2.5-pro" })).toMatchObject({ id: "gemini-2.5-pro", source: "account" });
    expect(resolveModel("chat", { env, envOverride: null })).toMatchObject({ id: "claude-sonnet-5", source: "default" });
    expect(resolveModel("chat", { env, envOverride: "openrouter:deepseek/deepseek-chat" })).toMatchObject({ provider: "openrouter", model: "deepseek/deepseek-chat", source: "env" });
  });

  it("an unknown id is skipped, not fatal", () => {
    expect(resolveModel("chat", { env: { ...ALL, LLM_MODEL_CHAT: "gpt-99-ultra" }, accountOverride: "typo" })).toMatchObject({ id: "claude-sonnet-5", source: "default" });
  });

  it("chosen provider not configured → same tier on the first configured provider, and the origin is kept", () => {
    expect(resolveModel("chat", { env: { OPENAI_API_KEY: "o" } })).toMatchObject({ id: "gpt-5", tier: "balanced", source: "fallback", fallbackFrom: "claude-sonnet-5" });
    expect(resolveModel("chat", { env: { GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" }, accountOverride: "claude-opus-5" })).toMatchObject({ id: "gpt-5", tier: "best", source: "fallback", fallbackFrom: "claude-opus-5" }); // gpt-5 stands in for the best tier
    expect(resolveModel("business_scan", { env: { GEMINI_API_KEY: "g" } })).toMatchObject({ id: "gemini-2.5-flash", tier: "fast", source: "default" });
    expect(resolveModel("routine_decision", { env: { OPENROUTER_API_KEY: "r" } })).toMatchObject({ id: "openrouter:openai/gpt-5-mini", tier: "fast" });
    expect(resolveModel("chat", { env: { LLM_CUSTOM_BASE_URL: "http://box/v1", LLM_CUSTOM_MODEL: "llama" } })).toMatchObject({ provider: "custom", model: "llama", source: "fallback" });
  });

  it("nothing configured → null (call sites keep their canned fallbacks)", () => {
    expect(resolveModel("chat", { env: {} })).toBeNull();
    expect(resolveModel("business_scan", { env: {}, accountOverride: "gpt-5" })).toBeNull();
    expect(describeLlm({})).toBe("none (fallback decisions)");
    expect(describeLlm({ OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" })).toBe("router (anthropic, openai)");
  });
});

type Fake = LlmProvider & { calls: ProviderRequest[] };
function fakeProvider(id: ProviderId, reply: Partial<LlmResult> = {}): Fake {
  const calls: ProviderRequest[] = [];
  return {
    id,
    calls,
    async complete(req) {
      calls.push(req);
      return { text: "hello", stopReason: "end", usage: { input: 100, output: 50 }, provider: id, model: req.model, latencyMs: 7, ...reply };
    },
  };
}

describe("complete — resolve + call + ledger", () => {
  let db: FakeSupabase;
  let anthropic: Fake;
  let openai: Fake;
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const log = (event: string, fields: Record<string, unknown>) => void logs.push({ event, fields });

  beforeEach(() => {
    clearLlmEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" });
    db = new FakeSupabase();
    db.now = () => "2026-09-02T09:00:00.000Z";
    db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
    anthropic = fakeProvider("anthropic");
    openai = fakeProvider("openai");
    logs.length = 0;
    setProviderFactoryForTests((id) => (id === "anthropic" ? anthropic : id === "openai" ? openai : null));
    setLlmDbForTests(() => db);
  });
  afterEach(() => {
    restoreLlmEnv();
    setProviderFactoryForTests(undefined);
    setLlmDbForTests(undefined);
  });

  const req = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 2000, effort: "low" as const };

  it("calls the resolved model, writes an llm_usage row with the estimated cost, keeps the effort", async () => {
    const r = await complete("chat", req, { accountId: ACCT, db, log });
    expect(r).toMatchObject({ text: "hello", stopReason: "end", provider: "anthropic", model: "claude-sonnet-5" });
    expect(anthropic.calls[0]).toMatchObject({ model: "claude-sonnet-5", maxTokens: 2000, effort: "low", system: "sys" });
    const rows = db.rows("llm_usage");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ account_id: ACCT, task: "chat", provider: "anthropic", model: "claude-sonnet-5", input_tokens: 100, output_tokens: 50, est_cost_usd: 0.0007, latency_ms: 7, stop_reason: "end" });
    expect(db.rows("llm_spend_reservations")).toHaveLength(0);
  });

  it("holds a conservative durable reservation during the hosted call and releases it after the usage row is durable", async () => {
    let providerStarted!: () => void;
    let finishProvider!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const finish = new Promise<void>((resolve) => { finishProvider = resolve; });
    anthropic = {
      id: "anthropic",
      calls: [],
      async complete(providerReq) {
        this.calls.push(providerReq);
        providerStarted();
        await finish;
        return { text: "hello", stopReason: "end", usage: { input: 100, output: 50 }, provider: "anthropic", model: providerReq.model, latencyMs: 7 };
      },
    };
    setProviderFactoryForTests((id) => (id === "anthropic" ? anthropic : openai));

    const pending = complete("chat", req, { accountId: ACCT, db, log });
    await started;
    expect(db.rows("llm_usage")).toHaveLength(0);
    expect(db.rows("llm_spend_reservations")).toHaveLength(1);
    expect(Number(db.rows("llm_spend_reservations")[0].ceiling_usd)).toBeGreaterThan(0.0007);
    finishProvider();

    await expect(pending).resolves.toMatchObject({ stopReason: "end" });
    expect(db.rows("llm_usage")).toHaveLength(1);
    expect(db.rows("llm_spend_reservations")).toHaveLength(0);
  });

  it("fails closed before the provider when atomic reservation is unavailable", async () => {
    db.rpcs.reserve_llm_spend = () => {
      throw new Error("database unavailable");
    };
    const result = await complete("chat", req, { accountId: ACCT, db, log });
    expect(result).toMatchObject({ stopReason: "error", errorCode: "budget_unavailable" });
    expect(anthropic.calls).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
    expect(logs.some((entry) => entry.event === "llm.budget_reservation_failed")).toBe(true);
  });

  it("fails an account-scoped call closed when no service-role database is available", async () => {
    const result = await complete("chat", req, { accountId: ACCT, db: null, log });
    expect(result).toMatchObject({ stopReason: "error", errorCode: "budget_unavailable" });
    expect(anthropic.calls).toHaveLength(0);
    expect(logs).toContainEqual(expect.objectContaining({ event: "llm.budget_reservation_failed", fields: expect.objectContaining({ reason: "database_unavailable" }) }));
  });

  it("retains the reservation to expire when the provider returned but the usage ledger write failed", async () => {
    const originalFrom = db.from.bind(db);
    db.from = ((table: string) => {
      const query = originalFrom(table);
      if (table === "llm_usage") {
        query.insert = (() => Promise.resolve({ data: null, error: { message: "ledger unavailable" } })) as unknown as typeof query.insert;
      }
      return query;
    }) as typeof db.from;

    await expect(complete("chat", req, { accountId: ACCT, db, log })).resolves.toMatchObject({ stopReason: "end" });
    expect(db.rows("llm_usage")).toHaveLength(0);
    expect(db.rows("llm_spend_reservations")).toHaveLength(1);
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ event: "llm.usage_write_failed" }), expect.objectContaining({ event: "llm.budget_reservation_retained", fields: expect.objectContaining({ reason: "usage_not_durable" }) })]));
  });

  it("honours the account's model setting from account_model_prefs", async () => {
    db.seed("account_model_prefs", [{ account_id: ACCT, task: "chat", model_id: "gpt-5-mini", updated_at: "2026-09-01T00:00:00.000Z" }]);
    const r = await complete("chat", req, { accountId: ACCT, db, log });
    expect(r).toMatchObject({ provider: "openai", model: "gpt-5-mini" });
    expect(openai.calls).toHaveLength(1);
    expect(anthropic.calls).toHaveLength(0);
    expect(db.rows("llm_usage")[0]).toMatchObject({ provider: "openai", model: "gpt-5-mini", est_cost_usd: 0.000125 });
  });

  it("blocks an unpriced hosted model before a provider call", async () => {
    db.seed("account_model_prefs", [{ account_id: ACCT, task: "chat", model_id: "openai:future-model", updated_at: "2026-09-01T00:00:00.000Z" }]);
    const r = await complete("chat", req, { accountId: ACCT, db, log });
    expect(r).toMatchObject({ stopReason: "error", errorCode: "unpriced_model", provider: "openai", model: "future-model" });
    expect(openai.calls).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
  });

  it("atomically reserves a positively priced custom endpoint instead of treating it as free self-hosting", async () => {
    const custom = fakeProvider("custom");
    setProviderFactoryForTests((id) => (id === "custom" ? custom : null));
    let reservations = 0;
    const reserve = db.rpcs.reserve_llm_spend;
    db.rpcs.reserve_llm_spend = (args) => {
      reservations += 1;
      return reserve(args);
    };
    const env = {
      LLM_CUSTOM_BASE_URL: "http://owned-model.internal/v1",
      LLM_CUSTOM_MODEL: "qwen",
      LLM_CUSTOM_INPUT_PER_1M: "0.5",
      LLM_CUSTOM_OUTPUT_PER_1M: "1",
      LLM_MODEL_CHAT: "custom",
    };
    const r = await complete("chat", req, { accountId: ACCT, db, log, env });
    expect(r).toMatchObject({ stopReason: "end", provider: "custom", model: "qwen" });
    expect(reservations).toBe(1);
    expect(custom.calls).toHaveLength(1);
    expect(db.rows("llm_spend_reservations")).toHaveLength(0);
    expect(db.rows("llm_usage")[0]).toMatchObject({ provider: "custom", model: "qwen", est_cost_usd: 0.0001 });
  });

  it("blocks a partially priced custom endpoint instead of silently treating it as free", async () => {
    const custom = fakeProvider("custom");
    setProviderFactoryForTests((id) => (id === "custom" ? custom : null));
    const r = await complete("chat", req, {
      accountId: ACCT,
      db,
      log,
      env: { LLM_CUSTOM_BASE_URL: "http://owned-model.internal/v1", LLM_CUSTOM_MODEL: "qwen", LLM_CUSTOM_INPUT_PER_1M: "0.5", LLM_MODEL_CHAT: "custom" },
    });
    expect(r).toMatchObject({ stopReason: "error", errorCode: "unpriced_model", provider: "custom" });
    expect(custom.calls).toHaveLength(0);
  });

  it("strips effort for models that reject it (Haiku 4.5) and logs JSON when there is no database", async () => {
    const r = await complete("business_scan", req, { accountId: null, db: null, log });
    expect(r).toMatchObject({ model: "claude-haiku-4-5" });
    expect(anthropic.calls[0].effort).toBeUndefined();
    expect(logs.find((l) => l.event === "llm.usage")?.fields).toMatchObject({ account_id: null, task: "business_scan", model: "claude-haiku-4-5", est_cost_usd: 0.00035 });
  });

  it("a provider error never throws — it is a result with a code, still ledgered", async () => {
    anthropic = fakeProvider("anthropic", { text: "", stopReason: "error", errorCode: "auth", errorMessage: "401 invalid x-api-key", usage: { input: 0, output: 0 } });
    setProviderFactoryForTests((id) => (id === "anthropic" ? anthropic : openai));
    const r = await complete("chat", req, { accountId: ACCT, db, log });
    expect(r).toMatchObject({ stopReason: "error", errorCode: "auth" });
    expect(db.rows("llm_usage")[0]).toMatchObject({ stop_reason: "error:auth", est_cost_usd: 0 });
    expect(db.rows("llm_spend_reservations")).toHaveLength(1);
    expect(logs).toContainEqual(expect.objectContaining({ event: "llm.budget_reservation_retained", fields: expect.objectContaining({ reason: "provider_usage_unconfirmed" }) }));
    expect(logs.some((l) => l.event === "llm.error")).toBe(true);
    expect(logs.find((l) => l.event === "llm.error")?.fields).not.toHaveProperty("message");
  });

  it("retains the ceiling when a nominally successful provider response omits usage", async () => {
    anthropic = fakeProvider("anthropic", { text: "hello", stopReason: "end", usage: { input: 0, output: 0 } });
    setProviderFactoryForTests((id) => (id === "anthropic" ? anthropic : openai));

    await expect(complete("chat", req, { accountId: ACCT, db, log })).resolves.toMatchObject({ stopReason: "end" });

    expect(db.rows("llm_usage")).toHaveLength(1);
    expect(db.rows("llm_spend_reservations")).toHaveLength(1);
    expect(logs).toContainEqual(expect.objectContaining({ event: "llm.budget_reservation_retained", fields: expect.objectContaining({ reason: "provider_usage_unconfirmed" }) }));
  });

  it("returns null when nothing is configured, and a broken prefs read falls through to the default", async () => {
    clearLlmEnv();
    expect(await complete("chat", req, { accountId: ACCT, db, log })).toBeNull();
    clearLlmEnv({ ANTHROPIC_API_KEY: "a" });
    const broken = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }) }), rpc: db.rpc.bind(db) } as unknown as FakeSupabase;
    const r = await complete("chat", req, { accountId: ACCT, db: broken, log });
    expect(r).toMatchObject({ model: "claude-sonnet-5" });
    expect(logs.some((l) => l.event === "llm.pref_read_failed")).toBe(true);
  });

  it("completeModel calls a named id directly (ping) and reports not_configured providers as an error result", async () => {
    expect(await completeModel("gpt-5", req, { db, log })).toMatchObject({ provider: "openai", model: "gpt-5" });
    expect(db.rows("llm_usage")[0]).toMatchObject({ task: "ping", account_id: null });
    expect(await completeModel("gemini-2.5-flash", req, { db, log })).toMatchObject({ stopReason: "error", errorCode: "not_configured" });
    expect(await completeModel("bogus", req, { db, log })).toBeNull();
  });

  it("createTextClient: the {system,user} → string shape; throws on refusal/error; null when nothing is configured; per-prompt accountId honours prefs", async () => {
    db.seed("account_model_prefs", [{ account_id: ACCT, task: "routine_decision", model_id: "gpt-5", updated_at: "2026-09-01T00:00:00.000Z" }]);
    const c = createTextClient("routine_decision", { maxTokens: 4000, effort: "low", jsonMode: true }, { db, log })!;
    expect(await c.complete({ system: "s", user: "u", accountId: ACCT })).toBe("hello");
    expect(openai.calls[0]).toMatchObject({ model: "gpt-5", maxTokens: 4000, jsonMode: true });
    expect(await c.complete({ system: "s", user: "u" })).toBe("hello");
    expect(anthropic.calls[0]).toMatchObject({ model: "claude-haiku-4-5" });

    anthropic = fakeProvider("anthropic", { stopReason: "refusal", text: "" });
    setProviderFactoryForTests(() => anthropic);
    await expect(c.complete({ system: "s", user: "u" })).rejects.toThrow("refusal");
    anthropic = fakeProvider("anthropic", { stopReason: "error", errorCode: "timeout", text: "" });
    setProviderFactoryForTests(() => anthropic);
    await expect(c.complete({ system: "s", user: "u" })).rejects.toThrow("llm timeout");

    clearLlmEnv();
    expect(createTextClient("routine_decision", { maxTokens: 10 }, { db })).toBeNull();
  });
});
