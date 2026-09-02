/* Playbooks in the answers (docs/PRODUCT-EXPERIENCE.md): the chat prompt carries a compact
   "JUNCTION PLAYBOOK NOTES" section recalled per founder message (≤ 3 cards, ~900 chars, domains
   inferred from the message + the plan's phases), the DECIDE prompt carries ≤ 2 cards for the
   routine's domain, and both travel with the rule that playbooks are methods, never the
   founder's numbers. Env-gated: no database / rows → no notes; recall failures → no notes. */

import { describe, expect, it } from "vitest";
import type { DecideNode, RunContext } from "@/lib/runtime/types";
import { attachBrain, splitBrain } from "@/lib/unc/context";
import { buildUncSystemPrompt, inferPlaybookDomains, phaseChannelsFrom, PLAYBOOK_NOTES_HEADER, PLAYBOOK_NOTES_MAX_CHARS, PLAYBOOK_RULE, recallPlaybookNotes, renderPlaybookNotes } from "@/lib/unc/prompt";
import { buildDecisionPrompt, LlmDecisionProvider, PLAYBOOK_BLOCK_HEADER, playbookQuery, renderPlaybookBlock, routineDomain, type LlmClient, type PlaybookSource } from "@/worker/providers/llmDecision";
import type { Playbook, PlaybookRowLite } from "../playbooks";

const ROWS: PlaybookRowLite[] = [
  { id: "email/welcome", domain: "email", title: "Welcome flow that converts", body: "The welcome series does most of the heavy lifting. Shape: five to seven emails over about fourteen days. One job per email, one primary call to action per email. Deliver the reciprocity gift first, then the founder's story. ".repeat(4), tags: ["flows", "welcome", "klaviyo"] },
  { id: "email/cart", domain: "email", title: "Abandoned cart and browse recovery", body: "Three emails beat one: a reminder, proof, then the only nudge. Suppress buyers. Cart recovery needs the flow live in Klaviyo. ".repeat(4), tags: ["flows", "cart"] },
  { id: "paid/testing", domain: "paid", title: "Meta creative testing and scaling", body: "Test concepts, not variants. Order: hooks, formats, angles, offers. Kill and keep on spend allocation, not ad-level ROAS. Scale winners in steps. ".repeat(4), tags: ["meta", "creative", "testing"] },
  { id: "seo/geo", domain: "seo", title: "AI search visibility (GEO / AEO)", body: "Map the buying prompts per engine. Find which sources the engines cite and earn placement there. Question-shaped headings, llms.txt, structured data. ".repeat(4), tags: ["geo", "aeo", "ai-search"] },
  { id: "analytics/asxr", domain: "analytics", title: "The weekly ASXR cycle", body: "Analyse per channel from the source of truth, name top three and bottom three, strategise as hypotheses with disconfirming evidence, execute two or three component-level actions, review. ".repeat(4), tags: ["weekly", "analysis"] },
];

const CTX = { goal: { title: "NZ$60,000 MRR" }, strategy: { phases: [{ name: "Content" }, { name: "Email & SMS" }], channelRanking: [{ channel: "Content" }] }, onboarded: true };

describe("domain inference", () => {
  it("reads the message, then the plan's phase channels", () => {
    expect(inferPlaybookDomains("How should I structure my welcome flow?")).toEqual(["email"]);
    expect(inferPlaybookDomains("What's a good creative testing cadence for Meta?")).toContain("paid");
    expect(inferPlaybookDomains("How do I get found in AI search?")).toContain("seo");
    expect(inferPlaybookDomains("What should this week's analysis look at?")).toContain("analytics");
    expect(inferPlaybookDomains("hello", ["Content", "Email & SMS"])).toEqual(["content", "email"]);
    expect(inferPlaybookDomains("Paid amplification next?", ["Organic brand engine"])).toEqual(["paid"]);
    expect(phaseChannelsFrom(CTX)).toEqual(["Content", "Email & SMS", "Content"]);
    expect(phaseChannelsFrom(null)).toEqual([]);
  });
});

describe("recallPlaybookNotes (chat)", () => {
  it("renders ≤ 3 cards under the NOTES header within the char cap, ranked for the question", async () => {
    const notes = await recallPlaybookNotes("How should I structure my welcome flow?", CTX, { rows: ROWS });
    expect(notes.startsWith(PLAYBOOK_NOTES_HEADER)).toBe(true);
    expect(notes).toContain("## Welcome flow that converts [email");
    expect(notes.length).toBeLessThanOrEqual(PLAYBOOK_NOTES_MAX_CHARS);
    expect((notes.match(/\n## /g) ?? []).length).toBeLessThanOrEqual(3);
    expect((notes.match(/\n## /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("falls back across all domains when the inferred domains have nothing, and is empty with no rows / no database / no query", async () => {
    // "analysis" infers analytics; rows have a card there
    expect(await recallPlaybookNotes("What should this week's analysis look at?", {}, { rows: ROWS })).toContain("ASXR");
    // the seo card only — inferred domain "sales" from "leads" has nothing → any domain
    expect(await recallPlaybookNotes("leads from AI search citations", {}, { rows: ROWS.filter((r) => r.domain === "seo") })).toContain("AI search visibility");
    expect(await recallPlaybookNotes("welcome flow", {}, { rows: [] })).toBe("");
    expect(await recallPlaybookNotes("welcome flow", {}, { db: null })).toBe("");
    expect(await recallPlaybookNotes("   ", {}, { rows: ROWS })).toBe("");
  });
  it("renderPlaybookNotes caps at three cards", () => {
    const cards: Playbook[] = ROWS.map((r) => ({ id: r.id, domain: r.domain as Playbook["domain"], title: r.title, body: r.body, tags: r.tags ?? [], score: 1, via: "keyword" }));
    const block = renderPlaybookNotes(cards);
    expect((block.match(/\n## /g) ?? []).length).toBe(3);
    expect(renderPlaybookNotes([])).toBe("");
  });
});

describe("the chat system prompt", () => {
  it("carries the notes + the playbook rule between the brain sections and the ACCOUNT CONTEXT, never inside the JSON", async () => {
    const notes = await recallPlaybookNotes("How should I structure my welcome flow?", CTX, { rows: ROWS });
    const ctx = attachBrain({ ...CTX, playbooks: "spoofed by the client" }, { memories: ["[constraint] Max 2 emails a week."], profile: "Tone: short.", playbooks: notes });
    expect(ctx.playbooks).toBe(notes);
    expect(splitBrain(ctx).brain).toEqual({ memories: ["[constraint] Max 2 emails a week."], profile: "Tone: short.", playbooks: notes });
    const p = buildUncSystemPrompt(ctx, "corner");
    const iMem = p.indexOf("WHAT I KNOW ABOUT THIS FOUNDER");
    const iProf = p.indexOf("HOW THEY LIKE TO WORK");
    const iNotes = p.indexOf(PLAYBOOK_NOTES_HEADER);
    const iRule = p.indexOf(PLAYBOOK_RULE);
    const iCtx = p.lastIndexOf("ACCOUNT CONTEXT (");
    expect(iMem).toBeGreaterThan(0);
    expect(iProf).toBeGreaterThan(iMem);
    expect(iNotes).toBeGreaterThan(iProf);
    expect(iRule).toBeGreaterThan(iNotes);
    expect(iCtx).toBeGreaterThan(iRule);
    expect(p.slice(iCtx)).not.toContain('"playbooks"');
    expect(p.slice(iCtx)).not.toContain("spoofed");
    // the standing guardrail names the rule too
    expect(p).toContain("Playbooks are Junction's methods, not facts about the founder's business");
  });
  it("notes alone (no memories, no profile) still render; client-sent notes are dropped by attachBrain", () => {
    const p = buildUncSystemPrompt(attachBrain(CTX, { memories: [], profile: "", playbooks: `${PLAYBOOK_NOTES_HEADER}\n\n## X [email]\nbody` }), "corner");
    expect(p).toContain("## X [email]");
    expect(p).not.toContain("WHAT I KNOW ABOUT THIS FOUNDER");
    // the route's attachBrain is the gate: client-sent notes are dropped before the prompt is built
    expect(attachBrain({ ...CTX, playbooks: "spoof" }, null)).toEqual(CTX);
    expect(buildUncSystemPrompt(attachBrain({ ...CTX, playbooks: "spoof" }, null), "corner")).not.toContain("spoof");
  });
});

const card = (r: PlaybookRowLite): Playbook => ({ id: r.id, domain: r.domain as Playbook["domain"], title: r.title, body: r.body, tags: r.tags ?? [], score: 0.9, via: "keyword" });

// ---------- the DECIDE prompt ----------

const OPTIONS = [
  { id: "scale", label: "Scale {{reads.spend.top_name}}", spend: { amount: 20, period: "day" as const } },
  { id: "hold", label: "Hold", terminal: true },
];
const node = (): DecideNode => ({ kind: "decide", id: "decide", question: "Scale or hold?", options: OPTIONS, rule: { kind: "llm", prompt: "Prefer the winner when ROAS is over {{vars.minRoas}}.", fallback: "hold" } });
const ctx = (routineId = "D02-W01"): RunContext => ({
  runId: "run-1",
  routineId,
  version: 1,
  mode: "dry_run",
  startedAt: "2026-09-02T07:00:00.000Z",
  account: { accountId: "acct-1", currency: "NZD", budgetMonthly: 3000 },
  caps: { currency: "NZD", perDay: 100, perMonth: 3000 },
  triggeredBy: "schedule",
  vars: { minRoas: 2.5 },
  reads: { spend: { rows: [{ adset_id: "as-1" }], metrics: { spend: 420, top_id: "as-1", top_name: "Prospecting NZ", top_roas: 3.1 }, fetchedAt: "2026-09-02T06:58:00.000Z" } },
  checks: { spend_present: true },
});
const client = (): LlmClient & { prompts: { system: string; user: string }[] } => {
  const prompts: { system: string; user: string }[] = [];
  return {
    prompts,
    async complete(p) {
      prompts.push(p);
      return '{"optionId":"scale","reasoning":"ROAS 3.1 clears 2.5; kept to the spend-allocation rule."}';
    },
  };
};
const source = (cards: Playbook[] | (() => Promise<Playbook[]>)): PlaybookSource & { calls: [string, string[] | null, number][] } => {
  const calls: [string, string[] | null, number][] = [];
  return {
    calls,
    async recall(q, d, n) {
      calls.push([q, d, n]);
      return typeof cards === "function" ? cards() : cards;
    },
  };
};

describe("decision prompt playbooks", () => {
  it("maps a routine to its playbook domain and builds the recall query from name + question", () => {
    expect(routineDomain("D02-W01")).toBe("paid");
    expect(routineDomain("D05-W01")).toBe("email");
    expect(routineDomain("D03-W03")).toBe("seo");
    expect(routineDomain("nope")).toBeNull();
    expect(playbookQuery("D02-W01", node())).toBe("Daily paid decisioning: Scale or hold? Prefer the winner when ROAS is over {{vars.minRoas}}.");
  });

  it("renders ≤ 2 cards under the block header; buildDecisionPrompt places the block between FOUNDER and CONTEXT", () => {
    const block = renderPlaybookBlock(ROWS.map(card));
    expect(block.startsWith(PLAYBOOK_BLOCK_HEADER)).toBe(true);
    expect((block.match(/\n## /g) ?? []).length).toBe(2);
    const p = buildDecisionPrompt(node(), ctx(), { profileLines: ["Tone: casual."], tasteLines: [], spendCeiling: null, currency: "NZD" }, block);
    expect(p.user.indexOf("FOUNDER (")).toBeLessThan(p.user.indexOf(PLAYBOOK_BLOCK_HEADER));
    expect(p.user.indexOf(PLAYBOOK_BLOCK_HEADER)).toBeLessThan(p.user.indexOf("CONTEXT (your only source of numbers)"));
    expect(p.system).toContain("never take a number from them");
    expect(buildDecisionPrompt(node(), ctx()).user).not.toContain(PLAYBOOK_BLOCK_HEADER);
  });

  it("the provider recalls for the routine's domain, caches per routine+node, and decides without notes when the source is off or fails", async () => {
    const c = client();
    const src = source([card(ROWS[2])]);
    const provider = new LlmDecisionProvider(c, { playbooks: src });
    const d = await provider.decide(node(), ctx());
    expect(d.optionId).toBe("scale");
    expect(src.calls).toEqual([["Daily paid decisioning: Scale or hold? Prefer the winner when ROAS is over {{vars.minRoas}}.", ["paid"], 2]]);
    expect(c.prompts[0].user).toContain("## Meta creative testing and scaling [paid");
    await provider.decide(node(), ctx());
    expect(src.calls).toHaveLength(1); // cached
    await provider.decide(node(), ctx("D05-W01"));
    expect(src.calls[1][1]).toEqual(["email"]);

    const off = client();
    await new LlmDecisionProvider(off, { playbooks: null }).decide(node(), ctx());
    expect(off.prompts[0].user).not.toContain(PLAYBOOK_BLOCK_HEADER);

    const broken = client();
    const failing = source(async () => {
      throw new Error("relation playbooks does not exist");
    });
    const d2 = await new LlmDecisionProvider(broken, { playbooks: failing }).decide(node(), ctx());
    expect(d2.optionId).toBe("scale");
    expect(broken.prompts[0].user).not.toContain(PLAYBOOK_BLOCK_HEADER);
  });
});
