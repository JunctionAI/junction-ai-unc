/* Chat helpfulness rubric — what a good Unc reply is, in two halves.

   DETERMINISTIC (runs offline, in CI): banned phrases, format (no markdown / exclamation marks /
   emojis / walls of text), and the numbers-only-from-context contract — every number literal in
   the reply must appear in the account context, in the founder's own question, or be a small
   count (1–12). Same rule as src/lib/unc/narrative.ts, applied to chat.

   JUDGED (scripts/eval-chat.ts, needs a provider): an LLM judge scores 0–2 on five criteria —
   grounded · specific · in_voice · actionable · honest — with a rationale. The judge prompt and
   the JSON parser live here so the script stays thin and the parser is unit-tested.

   Relative imports only — the standalone script build (scripts/brain/tsconfig.json) has no "@/". */

import type { Scenario } from "./scenarios";

export const CRITERIA = ["grounded", "specific", "in_voice", "actionable", "honest"] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Score = 0 | 1 | 2;

export const CRITERION_HELP: Record<Criterion, string> = {
  grounded: "Every number and fact comes from the ACCOUNT CONTEXT or the founder's message; nothing invented.",
  specific: "Names a concrete routine, approval, connector or lever from the context — not generic advice.",
  in_voice: "First person, present tense, proposes rather than commands, warm and direct, no hype, no banned phrases.",
  actionable: "Leaves the founder with one clear next step (or one clear decision to make).",
  honest: "When the context lacks the data the founder asks for, says so plainly instead of estimating.",
};

/** Phrases the brand forbids (design-reference/README.md §Voice + the product guardrails in prompt.ts). */
export const BANNED_PHRASES: readonly string[] = ["fully autonomous", "ai employee", "10x", "overnight", "set and forget", "set-and-forget", "guarantee", "skyrocket", "game-changer", "game changer", "effortless", "crush it", "hustle"];

export interface DeterministicResult {
  bannedPhrases: string[];
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

export function findFormatIssues(reply: string): string[] {
  const issues: string[] = [];
  const t = reply.trim();
  if (!t) return ["empty reply"];
  if (t.includes("!")) issues.push("exclamation mark");
  if (/\*\*|__|`|^#{1,6}\s/m.test(t)) issues.push("markdown emphasis/heading/code");
  if (/^\s*(?:[-*•]|\d+[.)])\s+/m.test(t)) issues.push("bullet or numbered list");
  if (/\p{Extended_Pictographic}/u.test(t)) issues.push("emoji");
  const sentences = t.split(/(?<=[.?])\s+/).filter((s) => s.trim().length > 1).length;
  if (sentences > 6) issues.push(`${sentences} sentences (2–4 expected)`);
  if (t.length > 1200) issues.push(`${t.length} chars (too long for a chat bubble)`);
  return issues;
}

export function evaluateReply(scenario: Pick<Scenario, "context" | "question">, reply: string): DeterministicResult {
  const bannedPhrases = findBannedPhrases(reply);
  const unsupportedNumbers = findUnsupportedNumbers(reply, scenario.context, scenario.question);
  const formatIssues = findFormatIssues(reply);
  return { bannedPhrases, unsupportedNumbers, formatIssues, pass: !bannedPhrases.length && !unsupportedNumbers.length && !formatIssues.length };
}

// ---------- the judge ----------

export const JUDGE_SYSTEM = `You grade replies written by Unc, the operator inside the Junction product (a marketing department that runs a founder's growth beside them). You are strict, specific and fair. You never reward hype.

Score each criterion 0, 1 or 2:
- grounded — 2: every number/fact traces to the ACCOUNT CONTEXT or the founder's message. 1: one loose claim. 0: an invented number or fact.
- specific — 2: names the exact routine / approval / connector / lever from the context that applies. 1: gestures at the right area. 0: generic advice that fits any business.
- in_voice — 2: first person, present tense, proposes and shows working, warm and direct, plain text, no hype. 1: mostly there. 0: commands, hype, marketing-speak, markdown, exclamation marks, or calls itself a "fully autonomous AI employee".
- actionable — 2: one clear next step or decision. 1: several competing steps or a vague one. 0: no step.
- honest — 2: when the context lacks what was asked, it says so plainly and proposes how to get it; when the context has it, it uses it. 1: hedges. 0: estimates or makes up a figure the context doesn't hold.

Respond with ONLY a JSON object: {"grounded":0-2,"specific":0-2,"in_voice":0-2,"actionable":0-2,"honest":0-2,"rationale":"one or two sentences"}.`;

export function judgeUserPrompt(scenario: Scenario, reply: string): string {
  return [
    `SCENARIO: ${scenario.title}`,
    `WHAT A GOOD REPLY DOES: ${scenario.expect.notes}`,
    scenario.expect.mentionsAny?.length ? `IT SHOULD REFER TO ONE OF: ${scenario.expect.mentionsAny.join(" | ")}` : "",
    scenario.expect.mustAdmitMissing ? "THE CONTEXT DOES NOT HOLD THE FIGURE ASKED FOR — an honest reply says so." : "",
    scenario.expect.playbookInformed ? "THIS IS A METHOD QUESTION — Unc was given JUNCTION PLAYBOOK NOTES. Score \"specific\" 2 only if the reply names a concrete Junction method from those notes (not generic advice), and \"grounded\" 0 if it presents a playbook line as something that happened in this account or takes a number from it." : "",
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

export const totalScore = (s: JudgeScores) => CRITERIA.reduce((n, c) => n + s[c], 0);

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
