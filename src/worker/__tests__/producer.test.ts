/* LlmProducer: the skill check runs before any model call; the reply is validated (numbers
   only from the evidence, banned phrases, empty body); one retry with the reason; then an
   honest waiting_input — never a placeholder; no client → throws (the run fails closed). */

import { describe, expect, it } from "vitest";
import type { ProduceNode, RunContext } from "../../lib/runtime/types";
import { createLogger, memorySink } from "../log";
import { buildProducePrompt, LlmProducer, ProducerUnavailableError, type ProducerContextSource } from "../providers/producer";
import { skillContextFrom } from "../../lib/artifacts/material";
import { SKILL_BY_ID } from "../../lib/runtime/skills";

const PROFILE = { name: "Harbour Physio", oneLiner: "Sports physiotherapy in Auckland", category: "Health services", products: ["ACC physio", "Running assessments"], audience: "Runners", voice: { tone: "plain, warm", phrases: ["get you back out there"] }, market: { region: "Auckland, NZ", competitorsMentioned: [] }, signals: ["Open Saturdays", "Founded 2015"], confidence: "medium" as const, sources: ["https://harbourphysio.test"] };

const node: ProduceNode = { kind: "produce", id: "produce", skill: "D01-W01", maxItems: 3 };

function ctx(over: Partial<RunContext> = {}): RunContext {
  return { runId: "run-1", routineId: "D01-W01", version: 1, mode: "dry_run", startedAt: "2026-09-03T07:00:00.000Z", account: { accountId: "acct-1", currency: "NZD", budgetMonthly: 3000 }, caps: { currency: "NZD", perDay: 100, perMonth: 3000 }, triggeredBy: "schedule", vars: {}, inputs: {}, reads: { questions: { rows: [{ subject: "Do I need a referral?" }], metrics: {}, fetchedAt: "2026-09-03T06:59:00.000Z" } }, checks: {}, ...over };
}

const withProfile: ProducerContextSource = { gather: async () => ({ profile: PROFILE, memories: ["[fact] 40% of clients are runners", "[constraint] Never promise a cure"], goal: { title: "NZ$40,000 MRR", deadline: "2026-12-31", baseline: 28000, currency: "NZD" }, plan: [{ title: "Content first" }], priorArtifacts: [], founderNotes: "Short replies." }) };
const empty: ProducerContextSource = { gather: async () => ({ profile: null, memories: [], goal: null, plan: null, priorArtifacts: [], founderNotes: null }) };

const client = (replies: string[]) => {
  const prompts: { system: string; user: string }[] = [];
  let i = 0;
  return { prompts, async complete(p: { system: string; user: string }) { prompts.push(p); return replies[Math.min(i++, replies.length - 1)]; } };
};

const good = JSON.stringify({ kind: "post_set", title: "3 founder posts: back out there", body: "Drafted from the site profile, 2 memories and 1 customer question.", items: [{ title: "Do I need a referral?", body: "No. Book, come in, we start.", meta: { angle: "question", platform: "linkedin" } }, { title: "Never promise a cure", body: "A rule we run by since 2015.", meta: { angle: "belief", platform: "instagram" } }, { title: "Saturday clinic", body: "Open Saturdays for runners.", meta: { angle: "behind_the_scenes", platform: "x" } }], evidence: [{ source: "site_profile", ref: "Open Saturdays" }, { source: "memory", ref: "40% of clients are runners" }] });

describe("LlmProducer", () => {
  it("runs the skill check before the model: missing material → needs, no call made", async () => {
    const c = client([good]);
    const p = new LlmProducer(c, { context: empty, playbooks: null });
    const out = await p.produce(node, ctx());
    expect("needs" in out && out.needs[0].input).toBe("about_the_business");
    expect(c.prompts).toHaveLength(0);
  });

  it("no model configured → throws (the run fails closed; nothing is asked of the founder)", async () => {
    const p = new LlmProducer(null, { context: withProfile, playbooks: null });
    await expect(p.produce(node, ctx())).rejects.toBeInstanceOf(ProducerUnavailableError);
  });

  it("happy path: the prompt carries the profile, memories, reads, playbooks and the skill's craft; the artifact carries what was used", async () => {
    const c = client([good]);
    const playbooks = { recall: async () => [{ id: "p1", domain: "content" as const, title: "Founder posts that travel", body: "Open on a concrete claim. One idea per post.", tags: ["hooks"], score: 1, via: "keyword" as const }] };
    const { sink, entries } = memorySink();
    const p = new LlmProducer(c, { context: withProfile, playbooks, log: createLogger(sink, {}), now: () => new Date("2026-09-03T07:00:00Z") });
    const out = await p.produce(node, ctx());
    expect("artifact" in out).toBe(true);
    if ("artifact" in out) {
      expect(out.artifact.title).toBe("3 founder posts: back out there");
      expect(out.artifact.items).toHaveLength(3);
      expect(out.artifact.meta).toMatchObject({ skill: "D01-W01", using: ["site profile", "1 customer questions"], attempts: 1, playbooks: true });
      expect(out.artifact.evidence).toHaveLength(2);
    }
    const u = c.prompts[0].user;
    expect(c.prompts[0].system).toContain("Truth rules (absolute)");
    expect(u).toContain("Business: Harbour Physio");
    expect(u).toContain("[fact] 40% of clients are runners");
    expect(u).toContain("FOUNDER'S NOTES ON HOW TO WORK WITH THEM:\nShort replies.");
    expect(u).toContain("GOAL:\nNZ$40,000 MRR by 2026-12-31 (baseline 28000)");
    expect(u).toContain("Do I need a referral?");
    expect(u).toContain("JUNCTION PLAYBOOK NOTES");
    expect(u).toContain("Founder posts that travel");
    expect(u).toContain("CRAFT — founder posts");
    expect(u).toContain('OUTPUT SHAPE (strict JSON): {"kind":"post_set"');
    expect(JSON.stringify(entries)).toContain("produce.ok");
  });

  it("grounds a proposal in the selected deterministic decision and allows its resolved numbers", async () => {
    const decisionOnlyNumber = JSON.stringify({
      kind: "post_set",
      title: "Budget decision review",
      body: "I reviewed the selected scale decision: NZD 87 per day with a 37 percent change, using the resolved ad set.",
      items: [{ title: "Proposed review", body: "Scale the selected ad set by 37 percent to NZD 87 per day, subject to founder approval." }],
      evidence: [{ source: "routine_decision", ref: "scale" }],
    });
    const c = client([decisionOnlyNumber]);
    const p = new LlmProducer(c, { context: withProfile, playbooks: null, now: () => new Date("2026-09-03T07:00:00Z") });
    const out = await p.produce(node, ctx({
      decision: {
        optionId: "scale",
        label: "Scale the winning ad set",
        reasoning: "The reconciled return clears the threshold.",
        spend: { amount: 87, currency: "NZD", period: "day" },
        params: { adsetId: "adset-selected", changePct: 37, apiToken: "do-not-send-12345" },
      },
    }));

    expect("artifact" in out).toBe(true);
    if ("artifact" in out) expect(out.artifact.meta).toMatchObject({ attempts: 1 });
    const prompt = c.prompts[0].user;
    expect(prompt).toContain("SELECTED ROUTINE DECISION (the resolved decision this artifact must review):");
    expect(prompt).toContain('"option":"scale"');
    expect(prompt).toContain('"label":"Scale the winning ad set"');
    expect(prompt).toContain('"reasoning":"The reconciled return clears the threshold."');
    expect(prompt).toContain('"spend":{"amount":87,"currency":"NZD","period":"day"}');
    expect(prompt).toContain('"params":{"adsetId":"adset-selected","changePct":37,"apiToken":"[redacted]"}');
    expect(prompt).not.toContain("do-not-send-12345");
  });

  it("an invented number is rejected, the retry carries the reason, and a second rejection ends in an honest ask — never a placeholder", async () => {
    const invented = JSON.stringify({ kind: "post_set", title: "3 founder posts", body: "We have treated 12,000 runners.", items: [{ title: "a", body: "b" }] });
    const c = client([invented, invented]);
    const p = new LlmProducer(c, { context: withProfile, playbooks: null });
    const out = await p.produce(node, ctx());
    expect(c.prompts).toHaveLength(2);
    expect(c.prompts[1].user).toContain("YOUR PREVIOUS ATTEMPT WAS REJECTED: numbers not in the evidence: 12,000");
    expect("needs" in out).toBe(true);
    if ("needs" in out) {
      expect(out.needs[0].input).toBe("more_detail");
      expect(out.needs[0].why).toContain("I don't have enough to draft this yet: my draft was rejected (numbers not in the evidence: 12,000)");
      expect(out.note).toBe("Nothing was drafted.");
    }
  });

  it("an empty body is rejected; a good second attempt lands with attempts: 2", async () => {
    const emptyBody = JSON.stringify({ kind: "post_set", title: "3 founder posts", body: "", items: [{ title: "a", body: "b" }] });
    const c = client([emptyBody, good]);
    const p = new LlmProducer(c, { context: withProfile, playbooks: null });
    const out = await p.produce(node, ctx());
    expect("artifact" in out && out.artifact.meta?.attempts).toBe(2);
    expect(c.prompts[1].user).toContain("REJECTED: body missing");
  });

  it("a transport failure throws (the run fails closed and retries on schedule)", async () => {
    const p = new LlmProducer({ complete: async () => { throw new Error("llm timeout"); } }, { context: withProfile, playbooks: null });
    await expect(p.produce(node, ctx())).rejects.toThrow("the model call failed (llm timeout)");
  });

  it("buildProducePrompt: the founder's answers and the maxItems cap are stated; unavailable reads are shown as such", () => {
    const c = ctx({ inputs: { about_the_business: "Physio for runners" }, reads: { questions: { rows: [], metrics: {}, fetchedAt: "x", provenance: "unavailable" } } });
    const sctx = skillContextFrom(c, { profile: null, memories: [], goal: null, plan: null, priorArtifacts: [], founderNotes: null });
    const { user } = buildProducePrompt({ skill: SKILL_BY_ID["D01-W01"], sctx, ctx: c, playbookBlock: "", maxItems: 2, using: ["your note about the business"] });
    expect(user).toContain("at most 2 items");
    expect(user).toContain("about the business: Physio for runners");
    expect(user).toContain('"provenance":"unavailable"');
  });
});
