/* Code-enforced concision (src/lib/unc/concision.ts): the sentence count the cap uses (decimals
   never end a sentence), the depth words that lift the cap, what a shorter reply must pass to
   stand in for the first one, and enforceConcision's one re-ask — plus respond.ts wiring: the
   re-ask carries the thread, the model's own reply and the retry line; the first reply stands
   whole when the shorter one fails; never a truncation. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmResult } from "@/lib/llm/types";
import { asksForDepth, CONCISION_RETRY, countSentences, enforceConcision, needsConcision, shorterProblems, splitSentences } from "../concision";
import { APPROVAL_ASK, APPROVAL_ASK_RULE, buildUncSystemPrompt } from "../prompt";

const routerMock = vi.hoisted(() => ({ complete: vi.fn(), resolveModel: vi.fn() }));
const playbooksMock = vi.hoisted(() => ({ recallPlaybooks: vi.fn() }));
vi.mock("@/lib/llm/router", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/llm/router")>()), complete: routerMock.complete, resolveModel: routerMock.resolveModel }));
vi.mock("@/lib/brain/playbooks", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/brain/playbooks")>()), recallPlaybooks: playbooksMock.recallPlaybooks }));

import { respondAsUnc } from "../respond";

const CTX = { goal: { title: "NZ$60,000 MRR", target: 60000, baseline: 41200 }, approvals: [{ title: "Shift NZ$40/day from Retargeting to Prospecting", hoursLeft: 18 }], onboarded: true };
const LONG = "The pending one: shift NZ$40/day from Retargeting to Prospecting, 18 hours left. Retargeting has hit the same audience 4.1 times. Prospecting is buying cheaper clicks this week. I'd approve it. Your call.";
const SHORT = "Approve the NZ$40/day shift from Retargeting to Prospecting — retargeting is saturated at 4.1 and prospecting is cheaper this week. 18 hours left. Approve, hold, or want the numbers?";

describe("sentences", () => {
  it("splits on . ! ? followed by whitespace or the end; a decimal never ends a sentence", () => {
    expect(splitSentences("NZ$1.2M is the gap. Frequency sits at 4.1! Ready?")).toEqual(["NZ$1.2M is the gap.", "Frequency sits at 4.1!", "Ready?"]);
    expect(countSentences("One. Two. Three.")).toBe(3);
    expect(countSentences("Nothing waiting on you right now — I'll bring the next decision here.")).toBe(1);
    expect(countSentences("  ")).toBe(0);
    expect(countSentences(LONG)).toBe(5);
    expect(countSentences(SHORT)).toBe(3);
  });

  it("depth words lift the cap: why · explain · walk me through · detail(s) · plan · strategy · options · compare", () => {
    for (const q of ["Why content before paid?", "Explain the approval", "walk me through it", "give me the details", "what's the plan", "our strategy?", "what are my options", "compare the two"]) expect(asksForDepth(q), q).toBe(true);
    for (const q of ["Am I on track?", "What's this approval waiting on me?", "How many drafts this week?"]) expect(asksForDepth(q), q).toBe(false);
    expect(needsConcision("Am I on track?", LONG)).toBe(true);
    expect(needsConcision("Why is this waiting?", LONG)).toBe(false);
    expect(needsConcision("Am I on track?", SHORT)).toBe(false);
  });
});

describe("shorterProblems — what a shorter reply must pass", () => {
  const check = { question: "What's this approval waiting on me?", context: CTX, original: LONG };
  it("accepts a valid shorter reply; rejects empty, over-cap, filler, banned, format and an invented number", () => {
    expect(shorterProblems(SHORT, check)).toEqual([]);
    expect(shorterProblems("", check)).toEqual(["empty"]);
    expect(shorterProblems(LONG, check)).toEqual(["5 sentences (cap 3)"]);
    expect(shorterProblems("Great question. Approve it. 18 hours left.", check)).toEqual(["filler: great question"]);
    expect(shorterProblems("I guarantee it works. Approve.", check)[0]).toMatch(/^banned: guarantee/);
    expect(shorterProblems("- Approve it now", check)).toEqual(["format: bullet or numbered list"]);
    expect(shorterProblems("Approve it — ROAS is 2.7 this week.", check)).toEqual(["number not in the evidence or the first reply: 2.7"]);
    // a number from the first reply (the model's own arithmetic) is allowed in the shorter one
    expect(shorterProblems("Retargeting is at 4.1 — approve the shift.", check)).toEqual([]);
  });
});

describe("enforceConcision", () => {
  it("does nothing when the cap does not apply", async () => {
    const reask = vi.fn();
    expect(await enforceConcision({ question: "Why?", reply: LONG, context: CTX, reask })).toEqual({ reply: LONG, attempted: false, shortened: false });
    expect(await enforceConcision({ question: "On track?", reply: SHORT, context: CTX, reask })).toEqual({ reply: SHORT, attempted: false, shortened: false });
    expect(reask).not.toHaveBeenCalled();
  });

  it("re-asks once with the retry line and uses the shorter reply when it validates", async () => {
    const reask = vi.fn().mockResolvedValue(SHORT);
    expect(await enforceConcision({ question: "On track?", reply: LONG, context: CTX, reask })).toEqual({ reply: SHORT, attempted: true, shortened: true });
    expect(reask).toHaveBeenCalledTimes(1);
    expect(reask).toHaveBeenCalledWith(CONCISION_RETRY);
  });

  it("keeps the first reply whole when the shorter one fails, is null, or the re-ask throws — never a truncation", async () => {
    const still = await enforceConcision({ question: "On track?", reply: LONG, context: CTX, reask: async () => LONG + " And one more." });
    expect(still.reply).toBe(LONG);
    expect(still.shortened).toBe(false);
    expect(still.rejected?.[0]).toMatch(/sentences/);
    expect((await enforceConcision({ question: "On track?", reply: LONG, context: CTX, reask: async () => null })).reply).toBe(LONG);
    expect((await enforceConcision({ question: "On track?", reply: LONG, context: CTX, reask: async () => { throw new Error("boom"); } })).reply).toBe(LONG);
    expect((await enforceConcision({ question: "On track?", reply: LONG, context: CTX, reask: async () => "Approve it — ROAS is 2.7 now." })).rejected).toEqual(["number not in the evidence or the first reply: 2.7"]);
  });
});

describe("respondAsUnc — the cap in the live pipeline", () => {
  const ok = (text: string): LlmResult => ({ text, stopReason: "end", usage: { input: 10, output: 5 }, provider: "anthropic", model: "claude-sonnet-5", latencyMs: 3 });
  const resolved = { id: "claude-sonnet-5", provider: "anthropic", model: "claude-sonnet-5", tier: "balanced", inputPer1M: 2, outputPer1M: 10, label: "Claude Sonnet 5", supportsEffort: true, source: "default" as const };
  beforeEach(() => {
    routerMock.resolveModel.mockReset().mockReturnValue(resolved);
    playbooksMock.recallPlaybooks.mockReset().mockResolvedValue([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("a long reply to a plain question is re-asked once — same system prompt, the thread + its own reply + the retry line — and the shorter answer is returned", async () => {
    routerMock.complete.mockReset().mockResolvedValueOnce(ok(LONG)).mockResolvedValueOnce(ok(SHORT));
    const res = await respondAsUnc({ history: [{ role: "user", content: "What's this approval waiting on me?" }], context: CTX, surface: "corner", account: null });
    expect(res).toEqual({ ok: true, reply: SHORT });
    expect(routerMock.complete).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = routerMock.complete.mock.calls;
    expect(secondCall[0]).toBe("chat");
    expect(secondCall[1].system).toBe(firstCall[1].system);
    expect(secondCall[1].messages).toEqual([{ role: "user", content: "What's this approval waiting on me?" }, { role: "assistant", content: LONG }, { role: "user", content: CONCISION_RETRY }]);
  });

  it("the first reply stands when the second one fails validation or errors; a founder asking why is never re-asked", async () => {
    routerMock.complete.mockReset().mockResolvedValueOnce(ok(LONG)).mockResolvedValueOnce(ok("Approve it — ROAS is 2.7 now."));
    expect(await respondAsUnc({ history: [{ role: "user", content: "On track?" }], context: CTX, surface: "corner", account: null })).toEqual({ ok: true, reply: LONG });
    routerMock.complete.mockReset().mockResolvedValueOnce(ok(LONG)).mockResolvedValueOnce({ ...ok(""), stopReason: "error" });
    expect(await respondAsUnc({ history: [{ role: "user", content: "On track?" }], context: CTX, surface: "corner", account: null })).toEqual({ ok: true, reply: LONG });
    routerMock.complete.mockReset().mockResolvedValue(ok(LONG));
    expect(await respondAsUnc({ history: [{ role: "user", content: "Why is this one waiting on me?" }], context: CTX, surface: "corner", account: null })).toEqual({ ok: true, reply: LONG });
    expect(routerMock.complete).toHaveBeenCalledTimes(1);
  });

  it("the prompt carries the approval decision ask, verbatim", () => {
    const system = buildUncSystemPrompt(CTX, "corner");
    expect(system).toContain(APPROVAL_ASK_RULE);
    expect(system).toContain(APPROVAL_ASK);
  });
});
