import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createAnthropicProvider, mapAnthropicError, type AnthropicMessagesClient } from "../providers/anthropic";

const message = (over: Partial<Anthropic.Message> = {}): Anthropic.Message =>
  ({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5", content: [{ type: "text", text: "hello", citations: null }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 4 }, ...over }) as Anthropic.Message;

function fake(reply: Anthropic.Message | (() => Promise<Anthropic.Message>)) {
  const params: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: AnthropicMessagesClient = { messages: { create: async (p) => (params.push(p), typeof reply === "function" ? reply() : reply) } };
  return { params, client };
}

const req = { model: "claude-sonnet-5", system: "sys", messages: [{ role: "user" as const, content: "hi" }, { role: "assistant" as const, content: "yo" }, { role: "user" as const, content: "more" }], maxTokens: 4000, effort: "low" as const };

describe("anthropic adapter", () => {
  it("maps the request exactly as the call sites did: model, max_tokens, output_config.effort, system, messages; no sampling params", async () => {
    const f = fake(message());
    const r = await createAnthropicProvider({ client: f.client, now: () => 1000 }).complete(req);
    expect(f.params[0]).toEqual({ model: "claude-sonnet-5", max_tokens: 4000, output_config: { effort: "low" }, system: "sys", messages: req.messages });
    expect(r).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5", text: "hello", stopReason: "end", usage: { input: 10, output: 4 } });
  });

  it("omits output_config when the router stripped effort (Haiku 4.5); passes temperature only when set", async () => {
    const f = fake(message());
    await createAnthropicProvider({ client: f.client }).complete({ ...req, model: "claude-haiku-4-5", effort: undefined, temperature: 0 });
    expect(f.params[0]).not.toHaveProperty("output_config");
    expect(f.params[0].temperature).toBe(0);
  });

  it("refusal → refusal, max_tokens → max_tokens, only text blocks are joined", async () => {
    expect(await createAnthropicProvider({ client: fake(message({ stop_reason: "refusal", content: [] })).client }).complete(req)).toMatchObject({ stopReason: "refusal", text: "" });
    const thinking = [{ type: "thinking", thinking: "", signature: "" }, { type: "text", text: "a", citations: null }, { type: "text", text: "b", citations: null }] as unknown as Anthropic.ContentBlock[];
    expect(await createAnthropicProvider({ client: fake(message({ stop_reason: "max_tokens", content: thinking })).client }).complete(req)).toMatchObject({ stopReason: "max_tokens", text: "ab" });
  });

  it("SDK errors become error results with codes — never thrown, never carrying a key", async () => {
    const throwing = (err: unknown) => createAnthropicProvider({ client: fake(async () => { throw err; }).client }).complete(req);
    expect(await throwing(new Anthropic.AuthenticationError(401, { error: { message: "invalid x-api-key sk-ant-api03-secretsecret" } }, "invalid x-api-key sk-ant-api03-secretsecret", new Headers()))).toMatchObject({ stopReason: "error", errorCode: "auth", errorMessage: expect.stringContaining("sk-ant-…") });
    expect(await throwing(new Anthropic.NotFoundError(404, {}, "model: claude-99", new Headers()))).toMatchObject({ errorCode: "not_found", errorMessage: expect.stringMatching(/^404 /) });
    expect(await throwing(new Anthropic.RateLimitError(429, {}, "rate", new Headers()))).toMatchObject({ errorCode: "rate_limited" });
    expect(await throwing(new Anthropic.InternalServerError(529, {}, "overloaded", new Headers()))).toMatchObject({ errorCode: "provider_error" });
    expect(await throwing(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ errorCode: "timeout" });
    expect(await throwing(new Anthropic.APIConnectionError({ message: "ECONNRESET" }))).toMatchObject({ errorCode: "network" });
    expect(await throwing(new Error("weird"))).toMatchObject({ errorCode: "unknown", errorMessage: "weird" });
    expect(mapAnthropicError("string")).toEqual({ code: "unknown", message: "unknown error" });
  });
});
