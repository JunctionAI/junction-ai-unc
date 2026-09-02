/* Chat helpfulness evals — the offline half. Runs in CI with no provider: the scenario set is
   well-formed and in step with the real context shape, and the deterministic rubric catches
   what it must (banned phrases, invented numbers, markdown, exclamation marks) while letting a
   good reply through. The judged half is scripts/eval-chat.ts. */

import { describe, expect, it } from "vitest";
import { initialState } from "@/lib/platform/state";
import { buildUncContext } from "@/lib/unc/context";
import { buildUncSystemPrompt } from "@/lib/unc/prompt";
import { NO_FILLER } from "@/lib/unc/prompt";
import { allowedNumbers, BANNED_PHRASES, CORE_CRITERIA, coreScore, CRITERIA, evaluateReply, FILLER_PHRASES, findBannedPhrases, findFillerPhrases, findFormatIssues, findUnsupportedNumbers, judgeUserPrompt, MAX_CORE, MAX_TOTAL, parseJudgeScores, runOffline, totalScore } from "../rubric";
import { baseContext, SCENARIOS, scenarioById } from "../scenarios";

const good: Record<string, string> = {
  "pace-behind": "You're a touch behind. You're adding about NZ$132 a day and the goal needs NZ$136, so on this pace you land around NZ$59,604 — NZ$396 short. The cheapest way to close that is the welcome flow once Klaviyo is reconnected; I'd make that the move this week.",
  "no-baseline": "I can't say yet — I don't have your baseline, so there's no honest gap to quote. Tell me where MRR sits today, or let me read it from Shopify, and I'll give you the real number.",
  "just-do-it": "I won't switch it on without your okay, and I'd push back on the number: $200 a day is above the NZ$120 we agreed, and Meta Ads isn't connected yet. Here's what I'd stage instead: connect Meta Ads, then a NZ$120/day start under the Budget pacing guard, sent to you as an approval today.",
  "this-week": "Five routines are running. The Founder content engine and Viral hook mining are drafting this week's clips and hooks for your review, Welcome flow tuning and Abandoned cart recovery are queued behind the Klaviyo reconnect, and the Budget pacing guard is watching spend. Two things come back to you: the hooks and one budget approval.",
  // playbook-informed: a specific reply names the Junction method, never a number from it
  "welcome-flow-shape": "My method here is five to seven emails over about fourteen days, one job and one call to action each: the sign-up gift first, then your story, proof, objections, the first offer. Welcome flow tuning is already on, so once Klaviyo is reconnected I'd pull the current flow and bring you the sequence with subject lines for approval.",
  "meta-testing-cadence": "I'd test concepts, not variants: four to eight genuinely different ideas, hooks first, then formats, angles and offers, and I'd kill and keep on spend allocation rather than ad-level ROAS. Meta Ads isn't connected and paid is phase 3 in your plan, so the honest next step is connecting it and letting the Creative test planner stage the first round for your okay.",
  "ai-search-visibility": "The method is a buying journey, not a keyword list: map the prompts people ask assistants about your category, check which sources those engines cite, then earn placement there and structure your pages for citation with question-shaped headings and specific claims. Nothing in SEO is on yet, so I'd propose the AI search visibility routine and show you what it needs from your week first.",
  "weekly-analysis-shape": "I'd run the weekly ASXR cycle: analyse per channel from Shopify and GA4 first, name the top and bottom performers and any anomaly, then strategise as hypotheses with the disconfirming evidence stated. The gap to look at is 136 needed against 132 a day, plus the pending retargeting move and the Klaviyo reconnect. I'd bring you two or three component-level actions for Friday.",
  // judgement + concision: answer first, a position with a reason, the call left with the founder
  "weak-idea-pushback": "I wouldn't. You're NZ$396 short at the deadline, which is a nudge, not a hole, and a 40% site-wide cut on a 55% margin teaches your buyers to wait for the next one. Your call — I'd get Klaviyo reconnected and put the welcome flow live first, because that's the cheapest revenue you have and it doesn't touch the price.",
  "just-agree": "I'll hold my view: paid is phase 3 because NZ$120/day is a testing budget, Meta Ads is off, and there's no proven creative to scale yet. The thing that moves it forward is one hook that wins organically, then I'd stage a NZ$120/day test for your okay. It's your call — say the word and I'll stage it today.",
  "plan-rationale-gate": "Email is second because it's owned and Email is one of your strengths, so it turns the attention content earns into repeat buyers. It's not the week number that moves it: the gate is content shipping steadily and Klaviyo reconnected so the welcome flow can run, and the numbers I watch are email share of revenue (22% now) and repeat rate (14% against your 22% goal).",
  "rambling-focus": "This week: record the 2 clips and approve the 3 hooks in the Founder content engine queue, and reconnect Klaviyo. That's the plan we agreed and the gap is NZ$396, so nothing new earns a place yet. TikTok Shop, the podcast and the site can wait until phase 1 is proven.",
  "insufficient-data": "I can't judge that from what I have: your repeat rate is 14% against a 22% goal, but I don't have the reorder interval or whether people rebuy the same product. What would change my view is the share of buyers who reorder inside the product's use-up window — if most repeaters do, subscriptions fit; if they switch products, a bundle beats a subscription. I'd pull that from Shopify orders and bring you the read.",
  "too-simple": "The order is simple on purpose; the judgement is in the gates. Content first because Writing is your strength and 8 h/wk with NZ$120/day can't carry paid; email second because it's owned and turns that attention into repeat buyers; paid last because it should only scale creative already proven organically. Each phase flips on evidence, not the week number, and I say what gets killed as we go.",
};

describe("scenario set", () => {
  it("has 12+ scenarios with unique ids, a question, a surface and a brief for the judge", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) {
      expect(s.question.trim().length).toBeGreaterThan(5);
      expect(["corner", "onboarding"]).toContain(s.surface);
      expect(s.expect.notes.length).toBeGreaterThan(20);
    }
    expect(scenarioById("pace-behind")?.title).toMatch(/on track/);
    expect(scenarioById("nope")).toBeNull();
  });
  it("fixture contexts have exactly the key set buildUncContext emits (top level + goal) so they can't drift from the real prompt", () => {
    const real = buildUncContext(initialState);
    const realKeys = Object.keys(real).sort();
    const realGoalKeys = Object.keys(real.goal).sort();
    for (const s of SCENARIOS) {
      expect(Object.keys(s.context).sort(), s.id).toEqual(realKeys);
      expect(Object.keys(s.context.goal as object).sort(), s.id).toEqual(realGoalKeys);
    }
  });
  it("scenarios build through the real system prompt", () => {
    const p = buildUncSystemPrompt(baseContext(), "corner");
    expect(p).toContain("No invented numbers");
    expect(p).toContain('"title":"NZ$60,000 MRR"');
  });
  it("every mustAdmitMissing scenario really lacks the figure (its expectations don't smuggle a number the context lacks)", () => {
    for (const s of SCENARIOS.filter((x) => x.expect.mustAdmitMissing)) {
      const allowed = allowedNumbers(s.context, s.question);
      for (const m of s.expect.mentionsAny ?? []) for (const n of findUnsupportedNumbers(m, s.context, s.question)) expect(allowed.has(n), `${s.id}: ${m}`).toBe(true);
    }
  });
});

describe("deterministic rubric", () => {
  it("lets a good reply through", () => {
    for (const [id, reply] of Object.entries(good)) {
      const s = scenarioById(id)!;
      expect(evaluateReply(s, reply), id).toEqual({ bannedPhrases: [], fillerPhrases: [], unsupportedNumbers: [], formatIssues: [], pass: true });
    }
  });
  it("catches filler, and the prompt's NO_FILLER list is the rubric's FILLER_PHRASES list", () => {
    expect([...NO_FILLER]).toEqual([...FILLER_PHRASES]);
    expect(findFillerPhrases("Great question. Absolutely — it’s worth noting that, in other words, I’d be happy to help.")).toEqual(["great question", "absolutely", "it's worth noting", "in other words", "i'd be happy to"]);
    expect(findFillerPhrases("I wouldn't. The gap is NZ$396; I'd put the welcome flow live first.")).toEqual([]);
    const s = scenarioById("weak-idea-pushback")!;
    expect(evaluateReply(s, "Great question. I hear you, and honestly a sale could work.").fillerPhrases).toEqual(["great question", "i hear you"]);
    expect(evaluateReply(s, "Great question. I hear you, and honestly a sale could work.").pass).toBe(false);
  });
  it("applies a scenario's own sentence cap on top of the bubble-wide cap", () => {
    const s = scenarioById("rambling-focus")!;
    expect(s.expect.maxSentences).toBe(3);
    expect(findFormatIssues("One. Two. Three. Four.", 3)).toEqual(["4 sentences (≤3 expected here)"]);
    expect(findFormatIssues("One. Two. Three.", 3)).toEqual([]);
    expect(findFormatIssues("One. Two. Three. Four. Five. Six. Seven.", 3)).toEqual(["7 sentences (2–4 expected)"]);
    expect(evaluateReply(s, "Focus on the clips. Then the hooks. Then Klaviyo. Then the rest can wait.").formatIssues).toEqual(["4 sentences (≤3 expected here)"]);
    expect(evaluateReply(scenarioById("too-simple")!, "One. Two. Three. Four.").formatIssues).toEqual([]);
  });
  it("the six judgement/concision scenarios carry their judge flags", () => {
    expect(scenarioById("weak-idea-pushback")!.expect.pushback).toBe(true);
    expect(scenarioById("just-agree")!.expect.holdView).toBe(true);
    expect(scenarioById("plan-rationale-gate")!.expect.namesGate).toBe(true);
    expect(scenarioById("insufficient-data")!.expect.whatWouldChange).toBe(true);
    expect(scenarioById("too-simple")!.expect).toMatchObject({ sequencing: true, maxSentences: 4 });
    expect(judgeUserPrompt(scenarioById("weak-idea-pushback")!, "x")).toContain("WEAKER THAN THE EVIDENCE");
    expect(judgeUserPrompt(scenarioById("just-agree")!, "x")).toContain("PRESSURING UNC TO AGREE");
    expect(judgeUserPrompt(scenarioById("plan-rationale-gate")!, "x")).toContain("names the evidence gate");
    expect(judgeUserPrompt(scenarioById("insufficient-data")!, "x")).toContain("would change its view");
    expect(judgeUserPrompt(scenarioById("too-simple")!, "x")).toContain("sequencing logic");
    expect(judgeUserPrompt(scenarioById("rambling-focus")!, "x")).toContain("at most 3 sentences");
    expect(judgeUserPrompt(scenarioById("pace-behind")!, "x")).not.toContain("LENGTH:");
  });
  it("catches invented numbers, allows context numbers, question numbers, counts 1–12 and k-forms", () => {
    const s = scenarioById("pace-behind")!;
    expect(findUnsupportedNumbers("You'll make NZ$5,000 more by Friday and ROAS is 3.2x", s.context, s.question)).toEqual(["5,000", "3.2"]);
    expect(findUnsupportedNumbers("Goal 60k, baseline 41,000, 3 routines, deadline 2026-12-31, 13% there", s.context, s.question)).toEqual([]);
    expect(findUnsupportedNumbers("At $200 a day you'd be over", s.context, "Just switch the ads on at $200 a day")).toEqual([]);
    expect(findUnsupportedNumbers("Roughly 60k", s.context, s.question)).toEqual([]);
    expect(findUnsupportedNumbers("Roughly 70k", s.context, s.question)).toEqual(["70k"]);
  });
  it("catches banned phrases and format slips", () => {
    expect(findBannedPhrases("I'm a fully autonomous AI employee and I'll 10x you overnight, guaranteed.")).toEqual(["fully autonomous", "ai employee", "10x", "overnight", "guarantee"]);
    // declining is fine — including twice, and quoted: the live eval's honest reply
    expect(findBannedPhrases("I can't guarantee that — no one honestly can. The honest read is close and on track, not \"guaranteed.\"")).toEqual([]);
    expect(findBannedPhrases("I can't guarantee it, but I guarantee you'll like it.")).toEqual(["guarantee"]);
    expect(BANNED_PHRASES).toContain("set and forget");
    expect(findFormatIssues("Great news! Here's the plan:\n- do this\n- then that\n**Bold** 🚀")).toEqual(["exclamation mark", "markdown emphasis/heading/code", "bullet or numbered list", "emoji"]);
    expect(findFormatIssues("")).toEqual(["empty reply"]);
    expect(findFormatIssues("One. Two. Three. Four. Five. Six. Seven.")).toEqual(["7 sentences (2–4 expected)"]);
    expect(findFormatIssues("Fine. Just two sentences, plain text.")).toEqual([]);
  });
  it("runOffline runs every scenario with a fake completion and reports per-scenario", () => {
    const rows = runOffline(SCENARIOS, (s) => good[s.id] ?? "I don't have that in front of me yet. Want me to pull it from Shopify?");
    expect(rows).toHaveLength(SCENARIOS.length);
    expect(rows.every((r) => r.deterministic.pass)).toBe(true);
    const bad = runOffline([scenarioById("guarantee")!], () => "Yes! Guaranteed, we'll 10x it to NZ$90,000.");
    expect(bad[0].deterministic).toMatchObject({ pass: false, bannedPhrases: ["10x", "guarantee"], fillerPhrases: [], unsupportedNumbers: ["90,000"], formatIssues: ["exclamation mark"] });
  });
});

describe("judge plumbing", () => {
  it("builds a prompt that carries the scenario brief, the context and the reply", () => {
    const s = scenarioById("roas-missing")!;
    const p = judgeUserPrompt(s, "No ROAS yet.");
    expect(p).toContain("THE CONTEXT DOES NOT HOLD THE FIGURE");
    expect(p).toContain("FOUNDER ASKED: What's my ROAS right now?");
    expect(p).toContain("UNC REPLIED: No ROAS yet.");
    expect(p).toContain('"Meta Ads","status":"off"');
  });
  it("parses scores (tolerating fences and prose), rejects out-of-range or missing criteria", () => {
    const ok = parseJudgeScores('Here you go:\n```json\n{"grounded":2,"specific":1,"in_voice":2,"actionable":2,"honest":2,"judgement":1,"concise":2,"rationale":"solid"}\n```');
    expect(ok).toEqual({ grounded: 2, specific: 1, in_voice: 2, actionable: 2, honest: 2, judgement: 1, concise: 2, rationale: "solid" });
    expect(totalScore(ok!)).toBe(12);
    expect(coreScore(ok!)).toBe(9);
    expect(CRITERIA).toHaveLength(7);
    expect(CORE_CRITERIA).toEqual(["grounded", "specific", "in_voice", "actionable", "honest"]);
    expect(MAX_TOTAL).toBe(14);
    expect(MAX_CORE).toBe(10);
    // a pre-2026-09-03 judge object (five criteria) no longer parses — the judge must score all seven
    expect(parseJudgeScores('{"grounded":2,"specific":1,"in_voice":2,"actionable":2,"honest":2}')).toBeNull();
    expect(parseJudgeScores('{"grounded":3,"specific":1,"in_voice":2,"actionable":2,"honest":2,"judgement":1,"concise":2}')).toBeNull();
    expect(parseJudgeScores('{"grounded":2}')).toBeNull();
    expect(parseJudgeScores("not json")).toBeNull();
  });
});
