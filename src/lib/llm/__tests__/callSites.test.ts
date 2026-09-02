/* The five call sites through the router seam. `complete` / `resolveModel` are mocked at
   the router (never the SDK), so these lock: which task each site asks for, the token
   budget + effort it keeps, and that refusal / error / nothing-configured all land on the
   exact fallback each site had before the provider layer existed. */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { LlmResult } from "../types";

const routerMock = vi.hoisted(() => ({ complete: vi.fn(), resolveModel: vi.fn() }));
vi.mock("@/lib/llm/router", async (importOriginal) => ({ ...(await importOriginal<typeof import("../router")>()), complete: routerMock.complete, resolveModel: routerMock.resolveModel }));
vi.mock("@/lib/llm/accountContext", () => ({ optionalAccountContext: async () => ({ accountId: "acct-1", db: null }) }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { POST as chat } from "@/app/api/unc/chat/route";
import { POST as narrative } from "@/app/api/unc/narrative/route";
import { POST as scanRoute } from "@/app/api/unc/scan/route";
import { scanBusiness } from "@/lib/unc/scan";
import { createLlmClient, LlmDecisionProvider, LLM_MAX_TOKENS } from "@/worker/providers/llmDecision";
import { setLlmDbForTests, setProviderFactoryForTests } from "@/lib/llm/router";
import { clearLlmEnv, restoreLlmEnv } from "./env";

const ok = (text: string, over: Partial<LlmResult> = {}): LlmResult => ({ text, stopReason: "end", usage: { input: 10, output: 5 }, provider: "anthropic", model: "claude-sonnet-5", latencyMs: 3, ...over });
const post = (fn: (r: Request) => Promise<Response>, body: unknown) => fn(new Request("http://unc.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const resolved = { id: "claude-sonnet-5", provider: "anthropic", model: "claude-sonnet-5", tier: "balanced", inputPer1M: 2, outputPer1M: 10, label: "Claude Sonnet 5", supportsEffort: true, source: "default" as const };

beforeEach(() => {
  routerMock.complete.mockReset();
  routerMock.resolveModel.mockReset().mockReturnValue(resolved);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/unc/chat", () => {
  const body = { messages: [{ role: "user", content: "hi" }], context: {}, surface: "corner" };
  it("asks the chat task with the 2000-token / low-effort budget and returns the reply", async () => {
    routerMock.complete.mockResolvedValue(ok("  In your corner.  "));
    expect(await (await post(chat, body)).json()).toEqual({ reply: "In your corner." });
    const [task, req, ctx] = routerMock.complete.mock.calls[0];
    expect(task).toBe("chat");
    expect(req).toMatchObject({ maxTokens: 2000, effort: "low", messages: [{ role: "user", content: "hi" }] });
    expect(typeof req.system).toBe("string");
    expect(ctx).toMatchObject({ accountId: "acct-1" });
  });
  it("nothing configured / refusal / error / empty text → { fallback: true }; bad bodies → 400", async () => {
    routerMock.resolveModel.mockReturnValue(null);
    expect(await (await post(chat, body)).json()).toEqual({ fallback: true });
    expect(routerMock.complete).not.toHaveBeenCalled();
    routerMock.resolveModel.mockReturnValue(resolved);
    for (const r of [ok("", { stopReason: "refusal" }), ok("", { stopReason: "error", errorCode: "auth" }), ok("   "), null]) {
      routerMock.complete.mockResolvedValueOnce(r);
      expect(await (await post(chat, body)).json()).toEqual({ fallback: true });
    }
    routerMock.complete.mockRejectedValueOnce(new Error("boom"));
    expect(await (await post(chat, body)).json()).toEqual({ fallback: true });
    expect((await post(chat, "{nope")).status).toBe(400);
    expect((await post(chat, { messages: [{ role: "assistant", content: "x" }] })).status).toBe(400);
  });
});

describe("POST /api/unc/narrative", () => {
  const body = {
    goal: { title: "NZ$40k MRR", deadline: "2026-12-31", deadlineLabel: "by Dec 31", currency: "NZD", currencySymbol: "NZ$", target: 40000, baseline: 28400, gap: 11600, gapLabel: "NZ$11,600", otherGoals: [] },
    resources: { budgetPerMonth: 1500, budgetPerDay: 50, hoursPerWeek: 4, strengths: ["product"], platforms: ["instagram"], postures: ["Steady"], breadth: "focused", team: [] },
    plan: { title: "Steady plan", mathLine: "Gap NZ$11,600 by Dec 31, NZ$50 a day and 4 hours a week:", footnote: "I do the work — you bring taste and okays. I’ll scan your site and socials tonight and sharpen this before anything runs.", weeksTotal: 12, phases: [{ spanLabel: "Weeks 1–4", channel: "Email", why: "owned", text: "Weeks 1–4: Email first." }] },
    profile: null,
  };
  it("asks the plan_narrative task with 4000 tokens / medium effort / JSON mode, validates, and reports live fields", async () => {
    routerMock.complete.mockResolvedValue(ok(JSON.stringify({ title: "Steady, email-led", mathLine: "Gap NZ$11,600 by Dec 31 with NZ$50 a day and 4 hours a week:", phaseNotes: ["Email first, using your product strength."], footnote: "I do the work — you bring taste and okays. I’ll scan your site tonight." })));
    const out = await (await post(narrative, body)).json();
    expect(out).toMatchObject({ title: "Steady, email-led", live: 4 });
    expect(routerMock.complete.mock.calls[0][0]).toBe("plan_narrative");
    expect(routerMock.complete.mock.calls[0][1]).toMatchObject({ maxTokens: 4000, effort: "medium", jsonMode: true });
  });
  it("refusal / error / unparseable / all-fields-rejected → { fallback: true }; nothing configured never calls", async () => {
    for (const r of [ok("", { stopReason: "refusal" }), ok("", { stopReason: "error" }), ok("not json"), ok(JSON.stringify({ title: "Made-up 999 figure" }))]) {
      routerMock.complete.mockResolvedValueOnce(r);
      expect(await (await post(narrative, body)).json()).toEqual({ fallback: true });
    }
    expect((await post(narrative, { plan: {} })).status).toBe(400);
    routerMock.resolveModel.mockReturnValue(null);
    expect(await (await post(narrative, body)).json()).toEqual({ fallback: true });
    expect(routerMock.complete).toHaveBeenCalledTimes(4);
  });
});

describe("business scan", () => {
  const html = "<html><head><title>Acme Candles</title><meta name='description' content='Hand-poured soy candles'></head><body><h1>Acme Candles</h1><p>Hand-poured soy candles made in Wellington for people who like a quiet evening. Shop the Winter range.</p></body></html>";
  beforeEach(() => {
    (lookup as Mock).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as LookupAddress[]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => (String(input).endsWith("/") || String(input).endsWith("acme.example") ? new Response(html, { status: 200, headers: { "content-type": "text/html" } }) : new Response("nope", { status: 404 })));
  });
  it("asks the business_scan task (4000 tokens, low effort, JSON) and returns the coerced profile with the account attached", async () => {
    routerMock.complete.mockResolvedValue(ok(JSON.stringify({ name: "Acme Candles", oneLiner: "Hand-poured soy candles", category: "candles", products: ["Winter range"], audience: null, voice: { tone: "quiet", phrases: ["quiet evening"] }, market: { region: "Wellington", competitorsMentioned: [] }, signals: [], confidence: "medium" })));
    const profile = await scanBusiness({ website: "acme.example", socials: "", accountId: "acct-1" });
    expect(profile).toMatchObject({ name: "Acme Candles", confidence: "medium", products: ["Winter range"] });
    expect(profile.sources[0]).toMatch(/^https:\/\/acme\.example/);
    const [task, req, ctx] = routerMock.complete.mock.calls[0];
    expect(task).toBe("business_scan");
    expect(req).toMatchObject({ maxTokens: 4000, effort: "low", jsonMode: true });
    expect(req.messages[0].content).toContain("Acme Candles");
    expect(ctx).toEqual({ accountId: "acct-1" });
  });
  it("refusal / error / unparseable → the heuristic profile with the 'couldn't finish analysing' note; nothing configured → the 'couldn't analyse yet' note", async () => {
    for (const r of [ok("", { stopReason: "refusal" }), ok("", { stopReason: "error" }), ok("{{{"), null]) {
      routerMock.complete.mockResolvedValueOnce(r);
      const p = await scanBusiness({ website: "acme.example", socials: "" });
      expect(p.confidence).toBe("low");
      expect(p.name).toBe("Acme Candles");
      expect(p.note).toContain("couldn't finish analysing");
    }
    routerMock.resolveModel.mockReturnValue(null);
    const p = await scanBusiness({ website: "acme.example", socials: "" });
    expect(p.note).toContain("couldn't analyse it yet");
    expect(routerMock.complete).toHaveBeenCalledTimes(4);
  });
  it("the route gates on the task's model, guards the URL, and passes the account through", async () => {
    routerMock.complete.mockResolvedValue(ok(JSON.stringify({ name: "Acme Candles", confidence: "high" })));
    const out = await (await post(scanRoute, { website: "acme.example", socials: "" })).json();
    expect(out.profile).toMatchObject({ name: "Acme Candles" });
    expect(routerMock.complete.mock.calls[0][2]).toEqual({ accountId: "acct-1" });
    expect((await post(scanRoute, { website: "http://127.0.0.1/", socials: "" })).status).toBe(400);
    routerMock.resolveModel.mockReturnValue(null);
    expect(await (await post(scanRoute, { website: "acme.example", socials: "" })).json()).toEqual({ fallback: true });
  });
});

describe("worker routine decisions (real router, fake provider — createTextClient binds the router internally)", () => {
  const calls: { model: string; maxTokens: number; effort?: string; jsonMode?: boolean; system: string; user: string; accountId: string | null }[] = [];
  let reply: LlmResult;
  beforeEach(() => {
    calls.length = 0;
    reply = ok('{"optionId":"hold","reasoning":"Spend is 420 against a 3000 cap; I hold."}', { model: "claude-haiku-4-5" });
    clearLlmEnv({ ANTHROPIC_API_KEY: "fake" });
    setLlmDbForTests(() => null);
    setProviderFactoryForTests((id) => ({
      id,
      async complete(req) {
        return { ...reply, model: req.model };
      },
    }));
    routerMock.complete.mockImplementation(async (task: string, req: { model?: string; maxTokens: number; effort?: string; jsonMode?: boolean; system: string; messages: { content: string }[] }, ctx: { accountId?: string | null }) => {
      calls.push({ model: task, maxTokens: req.maxTokens, effort: req.effort, jsonMode: req.jsonMode, system: req.system, user: req.messages[0].content, accountId: ctx.accountId ?? null });
      return reply;
    });
  });
  afterEach(() => {
    restoreLlmEnv();
    setLlmDbForTests(undefined);
    setProviderFactoryForTests(undefined);
  });

  it("createLlmClient is null when nothing is configured, else a routine_decision text client (4000 tokens, low effort, JSON) on the fast tier", async () => {
    clearLlmEnv();
    expect(createLlmClient()).toBeNull();
    clearLlmEnv({ ANTHROPIC_API_KEY: "fake" });
    const log = vi.fn();
    const client = createLlmClient({ log })!;
    expect(await client.complete({ system: "s", user: "u", accountId: "acct-9" })).toContain("hold");
    // the router resolved the fast tier (Haiku) and stripped effort for it; the ledger line went to the log (no db)
    const usage = log.mock.calls.find((c) => c[0] === "llm.usage")?.[1] as Record<string, unknown>;
    expect(usage).toMatchObject({ task: "routine_decision", provider: "anthropic", model: "claude-haiku-4-5", account_id: "acct-9", input_tokens: 10, output_tokens: 5 });
    expect(LLM_MAX_TOKENS).toBe(4000);
  });
  it("the provider passes the run's account id and a refusal takes the declared fallback", async () => {
    reply = ok("", { stopReason: "refusal" });
    const log = vi.fn();
    const provider = new LlmDecisionProvider(createLlmClient({ log })!);
    const node = { kind: "decide" as const, id: "d", question: "Scale or hold?", options: [{ id: "scale", label: "Scale" }, { id: "hold", label: "Hold", terminal: true }], rule: { kind: "llm" as const, prompt: "", fallback: "hold" } };
    const ctx = { runId: "r", routineId: "D02-W01", version: 1, mode: "dry_run" as const, startedAt: "2026-09-02T07:00:00.000Z", account: { accountId: "acct-7", currency: "NZD", budgetMonthly: 3000 }, caps: { currency: "NZD", perDay: 100, perMonth: 3000 }, triggeredBy: "schedule" as const, vars: {}, reads: {}, checks: {} };
    const d = await provider.decide(node, ctx);
    expect(d.optionId).toBe("hold");
    expect(d.reasoning).toContain("deterministic fallback");
    expect((log.mock.calls.find((c) => c[0] === "llm.usage")?.[1] as Record<string, unknown>)).toMatchObject({ account_id: "acct-7", stop_reason: "refusal" });
  });
});
