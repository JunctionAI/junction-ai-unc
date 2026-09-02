/* Chat helpfulness evals — the offline half. Runs in CI with no provider: the scenario set is
   well-formed and in step with the real context shape, and the deterministic rubric catches
   what it must (banned phrases, invented numbers, markdown, exclamation marks) while letting a
   good reply through. The judged half is scripts/eval-chat.ts. */

import { describe, expect, it } from "vitest";
import { initialState } from "@/lib/platform/state";
import { buildUncContext } from "@/lib/unc/context";
import { buildUncSystemPrompt } from "@/lib/unc/prompt";
import { allowedNumbers, BANNED_PHRASES, CRITERIA, evaluateReply, findBannedPhrases, findFormatIssues, findUnsupportedNumbers, judgeUserPrompt, parseJudgeScores, runOffline, totalScore } from "../rubric";
import { baseContext, SCENARIOS, scenarioById } from "../scenarios";

const good: Record<string, string> = {
  "pace-behind": "You're a touch behind. You're adding about NZ$132 a day and the goal needs NZ$136, so on this pace you land around NZ$59,604 — NZ$396 short. The cheapest way to close that is the welcome flow once Klaviyo is reconnected; I'd make that the move this week.",
  "no-baseline": "I can't say yet — I don't have your baseline, so there's no honest gap to quote. Tell me where MRR sits today, or let me read it from Shopify, and I'll give you the real number.",
  "just-do-it": "I won't switch it on without your okay, and I'd push back on the number: $200 a day is above the NZ$120 we agreed, and Meta Ads isn't connected yet. Here's what I'd stage instead: connect Meta Ads, then a NZ$120/day start under the Budget pacing guard, sent to you as an approval today.",
  "this-week": "Five routines are running. The Founder content engine and Viral hook mining are drafting this week's clips and hooks for your review, Welcome flow tuning and Abandoned cart recovery are queued behind the Klaviyo reconnect, and the Budget pacing guard is watching spend. Two things come back to you: the hooks and one budget approval.",
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
      expect(evaluateReply(s, reply), id).toEqual({ bannedPhrases: [], unsupportedNumbers: [], formatIssues: [], pass: true });
    }
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
    expect(bad[0].deterministic).toMatchObject({ pass: false, bannedPhrases: ["10x", "guarantee"], unsupportedNumbers: ["90,000"], formatIssues: ["exclamation mark"] });
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
    const ok = parseJudgeScores('Here you go:\n```json\n{"grounded":2,"specific":1,"in_voice":2,"actionable":2,"honest":2,"rationale":"solid"}\n```');
    expect(ok).toEqual({ grounded: 2, specific: 1, in_voice: 2, actionable: 2, honest: 2, rationale: "solid" });
    expect(totalScore(ok!)).toBe(9);
    expect(CRITERIA).toHaveLength(5);
    expect(parseJudgeScores('{"grounded":3,"specific":1,"in_voice":2,"actionable":2,"honest":2}')).toBeNull();
    expect(parseJudgeScores('{"grounded":2}')).toBeNull();
    expect(parseJudgeScores("not json")).toBeNull();
  });
});
