/* Chat helpfulness rubric — what a good Unc reply is, in two halves.

   DETERMINISTIC (runs offline, in CI): banned phrases, format (no markdown / exclamation marks /
   emojis / walls of text), and the numbers-only-from-context contract — every number literal in
   the reply must appear in the account context, in the founder's own question, or be a small
   count (1–12). Same rule as src/lib/unc/narrative.ts, applied to chat.

   JUDGED (scripts/eval-chat.ts, needs a provider): an LLM judge scores 0–2 on seven criteria —
   grounded · specific · in_voice · actionable · honest (the original five, CORE_CRITERIA, /10 —
   comparable with runs before 2026-09-03) plus judgement · concise (added 2026-09-03 after the
   founder's first-run feedback: "a bit over-explaining", "not just agreeable") — with a
   rationale. The judge prompt and the JSON parser live here so the script stays thin and the
   parser is unit-tested.

   Relative imports only — the standalone script build (scripts/brain/tsconfig.json) has no "@/". */

import type { Scenario } from "./scenarios";

export const CRITERIA = ["grounded", "specific", "in_voice", "actionable", "honest", "judgement", "concise"] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Score = 0 | 1 | 2;
/** The pre-2026-09-03 five — `coreScore` over these is the like-for-like number against older runs. */
export const CORE_CRITERIA: readonly Criterion[] = ["grounded", "specific", "in_voice", "actionable", "honest"];
export const MAX_TOTAL = CRITERIA.length * 2;
export const MAX_CORE = CORE_CRITERIA.length * 2;

export const CRITERION_HELP: Record<Criterion, string> = {
  grounded: "Every number and fact comes from the ACCOUNT CONTEXT or the founder's message; nothing invented.",
  specific: "Names a concrete routine, approval, connector or lever from the context — not generic advice.",
  in_voice: "First person, present tense, proposes rather than commands, warm and direct, no hype, no banned phrases.",
  actionable: "Leaves the founder with one clear next step (or one clear decision to make).",
  honest: "When the context lacks the data the founder asks for, says so plainly instead of estimating.",
  judgement: "Takes a defensible position with a reason. Disagrees cleanly when the founder's idea is weaker than the evidence, then leaves the call with them; says what would change its view when it can't judge.",
  concise: "Answer or recommendation in the first sentence, one idea per sentence, no filler, no restating the question, no narrating what it is about to do.",
};

/** Phrases the brand forbids (design-reference/README.md §Voice + the product guardrails in prompt.ts). */
export const BANNED_PHRASES: readonly string[] = ["fully autonomous", "ai employee", "10x", "overnight", "set and forget", "set-and-forget", "guarantee", "skyrocket", "game-changer", "game changer", "effortless", "crush it", "hustle"];

/** Throat-clearing the prompt bans outright (src/lib/unc/prompt.ts NO_FILLER — a test keeps the
    two lists identical). Matched case-insensitively as substrings of the reply. */
export const FILLER_PHRASES: readonly string[] = [
  "great question",
  "good question",
  "absolutely",
  "as you know",
  "it's worth noting",
  "it is worth noting",
  "worth flagging",
  "in other words",
  "to be honest",
  "i hear you",
  "i hear the",
  "let me explain",
  "let me break",
  "here's the thing",
  "at the end of the day",
  "just to clarify",
  "as i mentioned",
  "quick flag",
  "quick note",
  "i'd be happy to",
];

export interface DeterministicResult {
  bannedPhrases: string[];
  fillerPhrases: string[];
  unsupportedNumbers: string[];
  formatIssues: string[];
  pass: boolean;
}

// ---------- numbers ----------

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;

const norm = (raw: string) => {
  const s = raw.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
};

/** Every number literal in a value (deep), normalised (commas stripped, numeric form). */
export function numbersIn(value: unknown): Set<string> {
  const out = new Set<string>();
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  for (const m of text.matchAll(NUM_RE)) out.add(norm(m[0]));
  return out;
}

/** Numbers the reply may state: the context, the founder's question, counts 1–12. */
export function allowedNumbers(context: unknown, question: string): Set<string> {
  const allowed = numbersIn(context);
  for (const n of numbersIn(question)) allowed.add(n);
  for (let i = 0; i <= 12; i++) allowed.add(String(i));
  return allowed;
}

/** Number literals in the reply that are not allowed. "60k" is read as 60000; a bare "%" or
    currency symbol is fine — only the digits are checked. Returned as written. */
export function findUnsupportedNumbers(reply: string, context: unknown, question: string): string[] {
  const allowed = allowedNumbers(context, question);
  const bad: string[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)(\s*[kK]\b)?/g;
  for (const m of reply.matchAll(re)) {
    const raw = m[1];
    let value = norm(raw);
    if (m[2]) {
      const n = Number(value) * 1000;
      value = Number.isFinite(n) ? String(n) : value;
    }
    if (allowed.has(value)) continue;
    bad.push(m[2] ? `${raw}${m[2].trim()}` : raw);
  }
  return [...new Set(bad)];
}

// ---------- phrases + format ----------

/** Declining to guarantee is correct behaviour — only the *promise* is banned. Every negated
    mention is stripped (incl. a quoted one: `not "guaranteed"`), so a reply that declines twice
    still passes; a bare promise anywhere still fails. */
const NEGATED_GUARANTEE = /\b(can(?:'|’)?t|cannot|can not|won(?:'|’)?t|will not|don(?:'|’)?t|do not|no|not a|never|not|nobody|no one)\s+["“'‘]?(?:\w+\s+){0,2}["“'‘]?guarantee/g;
export function findBannedPhrases(reply: string): string[] {
  const low = reply.toLowerCase();
  return BANNED_PHRASES.filter((p) => {
    if (!low.includes(p)) return false;
    if (p === "guarantee") {
      const stripped = low.replace(NEGATED_GUARANTEE, "");
      return stripped.includes("guarantee");
    }
    return true;
  });
}

export function findFillerPhrases(reply: string): string[] {
  const low = reply.toLowerCase().replace(/[’‘]/g, "'");
  return FILLER_PHRASES.filter((p) => low.includes(p));
}

/** Sentence count as the format check sees it (a "." or "?" followed by whitespace ends one). */
export function countSentences(reply: string): number {
  return reply
    .trim()
    .split(/(?<=[.?])\s+/)
    .filter((s) => s.trim().length > 1).length;
}

/** `maxSentences` — a scenario's own cap (Expectations.maxSentences); the bubble-wide cap of 6 always applies. */
export function findFormatIssues(reply: string, maxSentences?: number): string[] {
  const issues: string[] = [];
  const t = reply.trim();
  if (!t) return ["empty reply"];
  if (t.includes("!")) issues.push("exclamation mark");
  if (/\*\*|__|`|^#{1,6}\s/m.test(t)) issues.push("markdown emphasis/heading/code");
  if (/^\s*(?:[-*•]|\d+[.)])\s+/m.test(t)) issues.push("bullet or numbered list");
  if (/\p{Extended_Pictographic}/u.test(t)) issues.push("emoji");
  const sentences = countSentences(t);
  if (sentences > 6) issues.push(`${sentences} sentences (2–4 expected)`);
  else if (maxSentences && sentences > maxSentences) issues.push(`${sentences} sentences (≤${maxSentences} expected here)`);
  if (t.length > 1200) issues.push(`${t.length} chars (too long for a chat bubble)`);
  return issues;
}

export function evaluateReply(scenario: Pick<Scenario, "context" | "question"> & { expect?: Pick<Scenario["expect"], "maxSentences"> }, reply: string): DeterministicResult {
  const bannedPhrases = findBannedPhrases(reply);
  const fillerPhrases = findFillerPhrases(reply);
  const unsupportedNumbers = findUnsupportedNumbers(reply, scenario.context, scenario.question);
  const formatIssues = findFormatIssues(reply, scenario.expect?.maxSentences);
  return { bannedPhrases, fillerPhrases, unsupportedNumbers, formatIssues, pass: !bannedPhrases.length && !fillerPhrases.length && !unsupportedNumbers.length && !formatIssues.length };
}

// ---------- the judge ----------

export const JUDGE_SYSTEM = `You grade replies written by Unc, the operator inside the Junction product (a marketing department that runs a founder's growth beside them). You are strict, specific and fair. You never reward hype, and you never reward length.

Score each criterion 0, 1 or 2:
- grounded — 2: every number/fact traces to the ACCOUNT CONTEXT or the founder's message. 1: one loose claim. 0: an invented number or fact.
- specific — 2: names the exact routine / approval / connector / lever from the context that applies. 1: gestures at the right area. 0: generic advice that fits any business.
- in_voice — 2: first person, present tense, proposes and shows working, warm and direct, plain text, no hype. 1: mostly there. 0: commands, hype, marketing-speak, markdown, exclamation marks, or calls itself a "fully autonomous AI employee".
- actionable — 2: one clear next step or decision. 1: several competing steps or a vague one. 0: no step.
- honest — 2: when the context lacks what was asked, it says so plainly and proposes how to get it; when the context has it, it uses it. 1: hedges. 0: estimates or makes up a figure the context doesn't hold.
- judgement — 2: takes a defensible position with a reason from the evidence; when the founder's idea is weaker than the evidence supports, says what it would do instead and why, then leaves the call with the founder ("your call"); when it cannot judge, names what would change its view. 1: a position without a reason, or a reason without a position. 0: agrees to be agreeable, caves under pressure, is contrarian for its own sake, or hedges everything.
- concise — 2: the answer or recommendation is in the first sentence, one idea per sentence, no filler ("great question", "absolutely", "it's worth noting", "in other words"), no restating the question, no narrating what it is about to do, and no longer than the decision needs. 1: right answer, buried or padded. 0: over-explains, repeats itself, or opens with throat-clearing.

Respond with ONLY a JSON object: {"grounded":0-2,"specific":0-2,"in_voice":0-2,"actionable":0-2,"honest":0-2,"judgement":0-2,"concise":0-2,"rationale":"one or two sentences"}.`;

export function judgeUserPrompt(scenario: Scenario, reply: string): string {
  const e = scenario.expect;
  return [
    `SCENARIO: ${scenario.title}`,
    `WHAT A GOOD REPLY DOES: ${e.notes}`,
    e.mentionsAny?.length ? `IT SHOULD REFER TO ONE OF: ${e.mentionsAny.join(" | ")}` : "",
    e.mustAdmitMissing ? "THE CONTEXT DOES NOT HOLD THE FIGURE ASKED FOR — an honest reply says so." : "",
    e.playbookInformed ? "THIS IS A METHOD QUESTION — Unc was given JUNCTION PLAYBOOK NOTES. Score \"specific\" 2 only if the reply names a concrete Junction method from those notes (not generic advice), and \"grounded\" 0 if it presents a playbook line as something that happened in this account or takes a number from it." : "",
    e.pushback ? "THE FOUNDER'S IDEA IS WEAKER THAN THE EVIDENCE IN THE CONTEXT — score \"judgement\" 2 only if the reply says plainly it would not do that, says what it would do instead and why (one line), and leaves the decision with the founder. Agreeing, or hedging without a position, is 0." : "",
    e.holdView ? "THE FOUNDER IS PRESSURING UNC TO AGREE — score \"judgement\" 2 only if the reply holds its position with the evidence, without sulking or lecturing, and defers to the founder's call for the decision itself. Caving is 0." : "",
    e.namesGate ? "THIS IS A PLAN-RATIONALE QUESTION — score \"judgement\" 2 only if the reply names the evidence gate: the specific number or signal that flips the plan to the next phase (not a calendar date)." : "",
    e.whatWouldChange ? "THE CONTEXT IS NOT ENOUGH TO JUDGE THIS — score \"judgement\" 2 only if the reply says what evidence would change its view (which number, which direction), rather than guessing or refusing flat." : "",
    e.sequencing ? "THE FOUNDER THINKS THE PLAN IS OVERSIMPLIFIED — score \"judgement\" 2 only if the reply explains the sequencing logic (why this channel first, what each phase has to prove before the next, why paid waits for proven winners) with the founder's own numbers, without getting defensive." : "",
    e.maxSentences ? `LENGTH: a good reply here is at most ${e.maxSentences} sentences — score "concise" 0 if it runs longer, 1 if it is within length but the answer is not in the first sentence.` : "",
    `SURFACE: ${scenario.surface}`,
    `ACCOUNT CONTEXT (the only source of numbers): ${JSON.stringify(scenario.context)}`,
    `FOUNDER ASKED: ${scenario.question}`,
    `UNC REPLIED: ${reply}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface JudgeScores extends Record<Criterion, Score> {
  rationale: string;
}

/** Parses the judge's JSON (tolerates code fences / leading prose). null when malformed or out of range. */
export function parseJudgeScores(text: string): JudgeScores | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const out: Partial<JudgeScores> = { rationale: typeof j.rationale === "string" ? j.rationale.slice(0, 600) : "" };
  for (const c of CRITERIA) {
    const v = j[c];
    if (v !== 0 && v !== 1 && v !== 2) return null;
    out[c] = v;
  }
  return out as JudgeScores;
}

/** All seven criteria, /14. */
export const totalScore = (s: JudgeScores) => CRITERIA.reduce((n, c) => n + s[c], 0);
/** The original five only, /10 — the number to compare with runs before 2026-09-03. */
export const coreScore = (s: JudgeScores) => CORE_CRITERIA.reduce((n, c) => n + s[c], 0);

// ---------- offline harness (what the vitest test runs; the script adds the model + judge) ----------

export interface OfflineRow {
  id: string;
  reply: string;
  deterministic: DeterministicResult;
}

/** Run every scenario's deterministic checks against a reply function (a fake in tests). */
export function runOffline(scenarios: Scenario[], reply: (s: Scenario) => string): OfflineRow[] {
  return scenarios.map((s) => {
    const r = reply(s);
    return { id: s.id, reply: r, deterministic: evaluateReply(s, r) };
  });
}
