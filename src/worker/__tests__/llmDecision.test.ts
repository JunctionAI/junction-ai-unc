import { describe, expect, it } from "vitest";
import type { DecideNode, DecisionOption, RunContext } from "../../lib/runtime/types";
import { memorySink, createLogger } from "../log";
import { buildDecisionPrompt, LlmDecisionProvider, MAX_REASONING_CHARS, parseLlmDecision, renderFounderBlock, StorePersonalisation, type LlmClient, type Personalisation, type PersonalisationSource } from "../providers/llmDecision";
import { MemoryStore } from "../../lib/runtime/store/memory";
import { FakeSupabase } from "../../lib/db/__tests__/fakeSupabase";

const OPTIONS: DecisionOption[] = [
  { id: "scale", label: "Scale {{reads.spend.top_name}}", spend: { amount: 20, period: "day" }, params: { adsetId: "{{reads.spend.top_id}}" } },
  { id: "hold", label: "Hold", terminal: true },
];

const llmNode = (fallback?: string): DecideNode => ({ kind: "decide", id: "decide", question: "Scale or hold?", options: OPTIONS, rule: { kind: "llm", prompt: "Prefer the winner when ROAS is over {{vars.minRoas}}.", fallback } });

function ctx(): RunContext {
  return {
    runId: "run-1",
    routineId: "D02-W01",
    version: 1,
    mode: "dry_run",
    startedAt: "2026-09-02T07:00:00.000Z",
    account: { accountId: "acct-1", currency: "NZD", budgetMonthly: 3000 },
    caps: { currency: "NZD", perDay: 100, perMonth: 3000 },
    triggeredBy: "schedule",
    vars: { minRoas: 2.5 },
    reads: { spend: { rows: [{ adset_id: "as-1" }], metrics: { spend: 420, top_id: "as-1", top_name: "Prospecting NZ", top_roas: 3.1 }, fetchedAt: "2026-09-02T06:58:00.000Z" } },
    checks: { spend_present: true },
  };
}

const client = (reply: string | (() => Promise<string>)): LlmClient & { prompts: { system: string; user: string }[] } => {
  const prompts: { system: string; user: string }[] = [];
  return {
    prompts,
    async complete(p) {
      prompts.push(p);
      return typeof reply === "string" ? reply : reply();
    },
  };
};

describe("parseLlmDecision", () => {
  it("accepts a clean JSON object naming an offered option", () => {
    expect(parseLlmDecision('{"optionId":"scale","reasoning":"ROAS is 3.1 on NZD 420, above your 2.5 floor."}', OPTIONS)).toEqual({ ok: true, optionId: "scale", reasoning: "ROAS is 3.1 on NZD 420, above your 2.5 floor." });
  });

  it("tolerates a code fence and surrounding prose", () => {
    expect(parseLlmDecision('```json\n{"optionId": "hold", "reasoning": "Nothing beats 2.5 yet."}\n```', OPTIONS)).toMatchObject({ ok: true, optionId: "hold" });
    expect(parseLlmDecision('Here is my answer: {"optionId":"hold","reasoning":"x"} thanks', OPTIONS)).toMatchObject({ ok: true, optionId: "hold" });
  });

  it("rejects everything that is not a valid, offered decision", () => {
    expect(parseLlmDecision("", OPTIONS)).toEqual({ ok: false, reason: "empty reply" });
    expect(parseLlmDecision("scale", OPTIONS)).toEqual({ ok: false, reason: "reply is not a JSON object" });
    expect(parseLlmDecision("{optionId: scale}", OPTIONS)).toEqual({ ok: false, reason: "reply is not valid JSON" });
    expect(parseLlmDecision('["scale"]', OPTIONS)).toMatchObject({ ok: false });
    expect(parseLlmDecision('{"reasoning":"no id"}', OPTIONS)).toEqual({ ok: false, reason: "optionId missing" });
    expect(parseLlmDecision('{"optionId":"buy_everything","reasoning":"x"}', OPTIONS)).toEqual({ ok: false, reason: 'optionId "buy_everything" is not an offered option' });
    expect(parseLlmDecision('{"optionId":"scale"}', OPTIONS)).toEqual({ ok: false, reason: "reasoning missing" });
    expect(parseLlmDecision('{"optionId":"scale","reasoning":"   "}', OPTIONS)).toEqual({ ok: false, reason: "reasoning missing" });
    expect(parseLlmDecision('{"optionId":42,"reasoning":"x"}', OPTIONS)).toEqual({ ok: false, reason: "optionId missing" });
  });

  it("collapses whitespace and caps reasoning length", () => {
    const long = "a ".repeat(2000);
    const res = parseLlmDecision(JSON.stringify({ optionId: "scale", reasoning: `first\n\n  line ${long}` }), OPTIONS);
    expect(res.ok && res.reasoning.startsWith("first line a a")).toBe(true);
    expect(res.ok && res.reasoning.length).toBe(MAX_REASONING_CHARS);
  });
});

describe("buildDecisionPrompt", () => {
  it("offers rendered options and a compact context, in Unc's register", () => {
    const p = buildDecisionPrompt(llmNode(), ctx());
    expect(p.system).toContain("You are Unc");
    expect(p.system).toContain("No invented numbers");
    expect(p.system).toContain('{"optionId"');
    expect(p.user).toContain("QUESTION: Scale or hold?");
    expect(p.user).toContain("GUIDANCE: Prefer the winner when ROAS is over 2.50.");
    expect(p.user).toContain('"label":"Scale Prospecting NZ"');
    expect(p.user).toContain('"spend":{"amount":20,"currency":"NZD","period":"day"}');
    expect(p.user).toContain('"top_roas":3.1');
    expect(p.user).not.toContain("accessToken");
  });
});

describe("LlmDecisionProvider", () => {
  it("delegates non-llm rules to the deterministic provider", async () => {
    const c = client("should not be called");
    const node: DecideNode = { ...llmNode(), rule: { kind: "threshold", metric: "reads.spend.top_roas", op: "gte", value: 2.5, ifTrue: "scale", ifFalse: "hold" } };
    const d = await new LlmDecisionProvider(c).decide(node, ctx());
    expect(d.optionId).toBe("scale");
    expect(c.prompts).toHaveLength(0);
  });

  it("uses the model's choice and reasoning, with option spend/params resolved", async () => {
    const c = client('{"optionId":"scale","reasoning":"I would move NZD 20/day to Prospecting NZ: ROAS 3.1 clears your 2.5 floor."}');
    const d = await new LlmDecisionProvider(c).decide(llmNode("hold"), ctx());
    expect(d).toMatchObject({ optionId: "scale", label: "Scale Prospecting NZ", reasoning: "I would move NZD 20/day to Prospecting NZ: ROAS 3.1 clears your 2.5 floor.", spend: { amount: 20, currency: "NZD", period: "day" }, params: { adsetId: "as-1" } });
    expect(c.prompts).toHaveLength(1);
  });

  it("falls back to the declared fallback when there is no client", async () => {
    const d = await new LlmDecisionProvider(null).decide(llmNode("hold"), ctx());
    expect(d.optionId).toBe("hold");
    expect(d.terminal).toBe(true);
    expect(d.reasoning).toBe("No LLM decision provider configured; deterministic fallback → Hold.");
  });

  it("falls back to the first option when no fallback is declared", async () => {
    const d = await new LlmDecisionProvider(client("garbage")).decide(llmNode(), ctx());
    expect(d.optionId).toBe("scale");
    expect(d.reasoning).toContain("LLM reply rejected (reply is not a JSON object); deterministic fallback → Scale Prospecting NZ.");
  });

  it("never lets the model pick an option that was not offered", async () => {
    const { sink, entries } = memorySink();
    const d = await new LlmDecisionProvider(client('{"optionId":"spend_it_all","reasoning":"trust me"}'), { log: createLogger(sink) }).decide(llmNode("hold"), ctx());
    expect(d.optionId).toBe("hold");
    expect(d.reasoning).toContain("not an offered option");
    expect(entries.map((e) => e.event)).toEqual(["decision.llm_rejected"]);
  });

  it("falls back when the call throws, logging only the error class", async () => {
    const { sink, entries } = memorySink();
    const c = client(async () => {
      throw new Error("401 invalid x-api-key sk-ant-SHOULD-NOT-APPEAR");
    });
    const d = await new LlmDecisionProvider(c, { log: createLogger(sink) }).decide(llmNode("hold"), ctx());
    expect(d.optionId).toBe("hold");
    expect(d.reasoning).toBe("LLM decision unavailable (request failed); deterministic fallback → Hold.");
    expect(JSON.stringify(entries)).not.toContain("sk-ant");
    expect(entries[0]).toMatchObject({ event: "decision.llm_failed", error: "Error" });
  });
});

describe("personalisation — the FOUNDER block and the spend ceiling", () => {
  const personal: Personalisation = {
    profileLines: ["Tone: formality casual.", "Decision style: risk appetite measured, approves 57% of proposals."],
    tasteLines: ["This founder has decided 7 proposals in the last 90 days: approved 4, held 3, typically within 3 h.", "They have held 3 of 3 budget shifts above NZ$10/day — propose within that ceiling or explain why not."],
    spendCeiling: 10,
    currency: "NZD",
  };
  const source = (p: Personalisation | null | (() => Promise<Personalisation | null>)): PersonalisationSource & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      async forAccount(accountId) {
        asked.push(accountId);
        return typeof p === "function" ? p() : p;
      },
    };
  };

  it("the prompt carries the taste block between the options and the context; none when nothing is known", () => {
    const p = buildDecisionPrompt(llmNode(), ctx(), personal);
    expect(p.user).toContain("FOUNDER (how they like to work; what they have approved or held):");
    expect(p.user).toContain("- They have held 3 of 3 budget shifts above NZ$10/day — propose within that ceiling or explain why not.");
    expect(p.user).toContain("- Tone: formality casual.");
    expect(p.user.indexOf("OFFERED OPTIONS")).toBeLessThan(p.user.indexOf("FOUNDER ("));
    expect(p.user.indexOf("FOUNDER (")).toBeLessThan(p.user.indexOf("CONTEXT (your only source of numbers)"));
    expect(p.system).toContain("kept under your usual NZ$50/day");
    expect(buildDecisionPrompt(llmNode(), ctx()).user).not.toContain("FOUNDER");
    expect(renderFounderBlock({ profileLines: [], tasteLines: [], spendCeiling: null, currency: "NZD" })).toBe("");
  });

  it("shrinks the model's proposal to the ceiling and says so in the reasoning — the same for a deterministic rule; never expands", async () => {
    const c = client('{"optionId":"scale","reasoning":"ROAS 3.1 clears your 2.5 floor."}');
    const src = source(personal);
    const d = await new LlmDecisionProvider(c, { personalisation: src }).decide(llmNode("hold"), ctx());
    expect(d.spend).toEqual({ amount: 10, currency: "NZD", period: "day" });
    expect(d.reasoning).toBe("ROAS 3.1 clears your 2.5 floor. Kept under your usual NZ$10/day (you have held the larger shifts).");
    expect(src.asked).toEqual(["acct-1"]);
    expect(c.prompts[0].user).toContain("FOUNDER (");

    const node: DecideNode = { ...llmNode(), rule: { kind: "threshold", metric: "reads.spend.top_roas", op: "gte", value: 2.5, ifTrue: "scale", ifFalse: "hold" } };
    const det = await new LlmDecisionProvider(null, { personalisation: src }).decide(node, ctx());
    expect(det.spend?.amount).toBe(10);
    expect(det.reasoning).toContain("Kept under your usual NZ$10/day");

    const roomy = await new LlmDecisionProvider(c, { personalisation: source({ ...personal, spendCeiling: 50 }) }).decide(llmNode("hold"), ctx());
    expect(roomy.spend).toEqual({ amount: 20, currency: "NZD", period: "day" });
    expect(roomy.reasoning).not.toContain("Kept under");
    const none = await new LlmDecisionProvider(c, { personalisation: source(null) }).decide(llmNode("hold"), ctx());
    expect(none.spend?.amount).toBe(20);
  });

  it("a failing personalisation lookup is a warning; the decision proceeds impersonally", async () => {
    const { sink, entries } = memorySink();
    const c = client('{"optionId":"scale","reasoning":"ROAS 3.1 clears your 2.5 floor."}');
    const d = await new LlmDecisionProvider(c, { log: createLogger(sink), personalisation: source(async () => { throw new Error("db down"); }) }).decide(llmNode("hold"), ctx());
    expect(d.spend?.amount).toBe(20);
    expect(entries.map((e) => e.event)).toEqual(["decision.personalisation_failed", "decision.llm_ok"]);
    expect(c.prompts[0].user).not.toContain("FOUNDER");
  });

  it("StorePersonalisation: nothing known → null (no block); with a profile → profile lines; cached per account", async () => {
    const store = new MemoryStore();
    const empty = new StorePersonalisation(store, null, { now: () => new Date("2026-09-02T07:00:00.000Z") });
    expect(await empty.forAccount("acct-1", "NZD")).toBeNull();
    const db = new FakeSupabase();
    db.seed("account_profiles", [{ account_id: "acct-1", tone: { formality: "casual" }, founder_notes: "Be brief." }]);
    let t = new Date("2026-09-02T07:00:00.000Z").getTime();
    const src = new StorePersonalisation(store, db, { now: () => new Date(t) });
    const first = await src.forAccount("acct-1", "NZD");
    expect(first).toEqual({ profileLines: ["Tone: formality casual.", "Founder's note on working with them: Be brief."], tasteLines: [], spendCeiling: null, currency: "NZD" });
    const reads = db.callsFor("account_profiles", "select").length;
    t += 60_000;
    await src.forAccount("acct-1", "NZD");
    expect(db.callsFor("account_profiles", "select")).toHaveLength(reads); // cached
    t += 11 * 60_000;
    await src.forAccount("acct-1", "NZD");
    expect(db.callsFor("account_profiles", "select")).toHaveLength(reads + 1); // ttl elapsed
  });
});
