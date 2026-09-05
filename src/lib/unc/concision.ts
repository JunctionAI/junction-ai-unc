/* Code-enforced concision for the `chat` task (docs/UNC-VOICE-AND-JUDGEMENT.md §1).

   The prompt asks for at most three sentences; the judge kept scoring replies as "answer
   present but padded". So after a reply is produced: if the founder did not ask for depth and
   the reply runs past CONCISION_CAP sentences, the model is asked ONCE more — the whole thread
   plus its own reply plus CONCISION_RETRY — and the shorter answer is used only when it
   validates: non-empty, within the cap, no banned or filler phrase, no bullet/markdown/emoji,
   and every number in it is either allowed by the account context / the question or was
   already in the first reply (the model's own arithmetic survives; a new number does not).
   Otherwise the first reply stands, whole. Nothing is ever truncated mid-thought.

   Shared by src/lib/unc/respond.ts (the live route + channels) and scripts/eval-chat.ts (so
   the evals measure what the product does). Pure apart from the `reask` callback. */

import { findBannedPhrases, findFillerPhrases, findFormatIssues, findUnsupportedNumbers, numbersIn } from "../eval/chat-evals/rubric";
import { RuntimeContextError } from "../runtime/contextFence";

export const CONCISION_CAP = 3;
export const CONCISION_RETRY = "Same answer in at most three sentences, answer first.";

/** Words that mean the founder wants depth — the cap does not apply. */
export const DEPTH_WORDS = ["why", "explain", "walk me through", "detail", "plan", "strategy", "options", "compare"] as const;
const DEPTH_RE = new RegExp(`\\b(?:${DEPTH_WORDS.map((w) => w.replace(/\s+/g, "\\s+")).join("|")})\\w*`, "i");

export function asksForDepth(message: string): boolean {
  return DEPTH_RE.test(message);
}

/** Sentences: a run of text ended by . ! or ? that is followed by whitespace or the end. A
    full stop inside a number ("NZ$1.2M", "4.1") never ends a sentence. */
export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])(?:\s+|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export const countSentences = (text: string): number => splitSentences(text).length;

/** True when the cap applies and the reply runs past it. */
export function needsConcision(question: string, reply: string, cap = CONCISION_CAP): boolean {
  return !asksForDepth(question) && countSentences(reply) > cap;
}

export interface ShorterCheck {
  question: string;
  context: unknown;
  /** The first reply — its numbers are allowed in the shorter one (the model's own arithmetic). */
  original: string;
  cap?: number;
}

/** Why a shorter reply cannot stand in for the first one; empty when it can. */
export function shorterProblems(shorter: string, check: ShorterCheck): string[] {
  const t = shorter.trim();
  if (!t) return ["empty"];
  const cap = check.cap ?? CONCISION_CAP;
  const problems: string[] = [];
  const n = countSentences(t);
  if (n > cap) problems.push(`${n} sentences (cap ${cap})`);
  for (const p of findBannedPhrases(t)) problems.push(`banned: ${p}`);
  for (const p of findFillerPhrases(t)) problems.push(`filler: ${p}`);
  for (const f of findFormatIssues(t)) if (!/sentences/.test(f)) problems.push(`format: ${f}`);
  const inOriginal = numbersIn(check.original);
  for (const num of findUnsupportedNumbers(t, check.context, check.question)) if (!inOriginal.has(num)) problems.push(`number not in the evidence or the first reply: ${num}`);
  return problems;
}

export interface ConcisionResult {
  reply: string;
  /** The cap applied and the model was re-asked. */
  attempted: boolean;
  /** The shorter reply passed and replaced the first. */
  shortened: boolean;
  /** Why the shorter reply was rejected (when attempted and not shortened). */
  rejected?: string[];
}

export interface ConcisionInput {
  question: string;
  reply: string;
  context: unknown;
  /** Ask the model once more — the thread so far, its reply, then `instruction`. null on any failure. */
  reask: (instruction: string) => Promise<string | null>;
  cap?: number;
}

export async function enforceConcision(input: ConcisionInput): Promise<ConcisionResult> {
  const cap = input.cap ?? CONCISION_CAP;
  if (!needsConcision(input.question, input.reply, cap)) return { reply: input.reply, attempted: false, shortened: false };
  let shorter: string | null = null;
  try {
    shorter = await input.reask(CONCISION_RETRY);
  } catch (error) {
    // Identity failure is not an optional wording failure. Never revive the first answer
    // if a later identity check happens to recover from a transient unavailable state.
    if (error instanceof RuntimeContextError) throw error;
    shorter = null;
  }
  if (shorter === null) return { reply: input.reply, attempted: true, shortened: false, rejected: ["no second reply"] };
  const problems = shorterProblems(shorter, { question: input.question, context: input.context, original: input.reply, cap });
  if (problems.length) return { reply: input.reply, attempted: true, shortened: false, rejected: problems };
  return { reply: shorter.trim(), attempted: true, shortened: true };
}
