/* Plan narrative — Unc writes the prose on onboarding step 6 ("Unc's plan for you").

   The plan itself is deterministic (src/lib/platform/plan.ts decides channels, phase
   order and week spans); this module only writes words around it. SDK-free on purpose:
   the client imports the types + request shape, the API route does the model call.

   Guardrails (enforced here, not just asked for in the prompt):
   - numbers: every number in the output must already exist in the request (or be a
     small count 1–12) — a field that smuggles in a new number falls back to the
     deterministic copy for that field;
   - phase notes: exactly one per phase, ≤ 2 sentences, never carrying a week span
     (the client prepends the deterministic span so weeks/order cannot drift);
   - anything unparseable → the caller keeps the deterministic copy. */

import type { BusinessProfile } from "./scan";

export interface NarrativePhase {
  /** 1-based phase number. */
  n: number;
  /** Deterministic span label, e.g. "Weeks 1–4" or "Weeks 9–12 and beyond". */
  spanLabel: string;
  channel: string;
  /** plan.ts's one-line rationale for this channel. */
  why: string;
  /** The deterministic sentence(s) currently shown for this phase (span included). */
  text: string;
}

export interface NarrativeRequest {
  goal: {
    title: string;
    deadline: string;
    deadlineLabel: string;
    currency: string;
    currencySymbol: string;
    target: number;
    baseline: number;
    gap: number;
    gapLabel: string;
    otherGoals: string[];
  };
  resources: {
    budgetPerMonth: number;
    budgetPerDay: number;
    hoursPerWeek: number;
    strengths: string[];
    platforms: string[];
    postures: string[];
    breadth: string;
    team: { name: string; role: string }[];
  };
  plan: {
    title: string;
    mathLine: string;
    footnote: string;
    weeksTotal: number;
    phases: NarrativePhase[];
  };
  profile: BusinessProfile | null;
}

export interface PlanNarrative {
  title: string;
  mathLine: string;
  /** One per phase, ≤ 2 sentences, no week span (the client prepends it). */
  phaseNotes: string[];
  footnote: string;
}

/** The deterministic footnote (design-reference §A step 6) — kept verbatim as the fallback. */
export const DEFAULT_FOOTNOTE = "I do the work — you bring taste and okays. I’ll scan your site and socials tonight and sharpen this before anything runs.";

/* Sonnet 5 thinks adaptively by default and the thinking tokens count against max_tokens
   (the 4-field JSON itself is ~250 tokens) — a tight cap starves the text block entirely. */
export const NARRATIVE_MAX_TOKENS = 4000;
export const NARRATIVE_EFFORT = "medium" as const;
const MAX_PHASES = 5;
const TITLE_MAX = 110;
const LINE_MAX = 320;
const NOTE_MAX = 320;

/* ------------------------------------------------------------------ */
/* Request validation (route-side)                                     */
/* ------------------------------------------------------------------ */

const s = (v: unknown, max: number, dflt = ""): string => (typeof v === "string" ? v.slice(0, max) : dflt);
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const list = (v: unknown, max = 12, each = 80): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, each)).slice(0, max) : []);

/** Coerce an untrusted body into a NarrativeRequest; null when the plan is unusable. */
export function coerceNarrativeRequest(raw: unknown): NarrativeRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const goal = (r.goal ?? {}) as Record<string, unknown>;
  const res = (r.resources ?? {}) as Record<string, unknown>;
  const plan = (r.plan ?? {}) as Record<string, unknown>;
  const phasesRaw = Array.isArray(plan.phases) ? plan.phases.slice(0, MAX_PHASES) : [];
  const phases: NarrativePhase[] = phasesRaw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p, i) => ({ n: i + 1, spanLabel: s(p.spanLabel, 60), channel: s(p.channel, 40), why: s(p.why, 200), text: s(p.text, 600) }))
    .filter((p) => p.spanLabel && p.channel && p.text);
  if (!phases.length) return null;
  const teamRaw = Array.isArray(res.team) ? res.team.slice(0, 10) : [];
  const profile = r.profile && typeof r.profile === "object" ? (r.profile as BusinessProfile) : null;
  return {
    goal: {
      title: s(goal.title, 120),
      deadline: s(goal.deadline, 10),
      deadlineLabel: s(goal.deadlineLabel, 40),
      currency: s(goal.currency, 3, "NZD"),
      currencySymbol: s(goal.currencySymbol, 4, "NZ$"),
      target: n(goal.target),
      baseline: n(goal.baseline),
      gap: n(goal.gap),
      gapLabel: s(goal.gapLabel, 40),
      otherGoals: list(goal.otherGoals, 6, 120),
    },
    resources: {
      budgetPerMonth: n(res.budgetPerMonth),
      budgetPerDay: n(res.budgetPerDay),
      hoursPerWeek: n(res.hoursPerWeek),
      strengths: list(res.strengths),
      platforms: list(res.platforms),
      postures: list(res.postures, 3, 40),
      breadth: s(res.breadth, 12, "focused"),
      team: teamRaw
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({ name: s(t.name, 60), role: s(t.role, 40) })),
    },
    plan: {
      title: s(plan.title, TITLE_MAX),
      mathLine: s(plan.mathLine, LINE_MAX),
      footnote: s(plan.footnote, LINE_MAX, DEFAULT_FOOTNOTE),
      weeksTotal: n(plan.weeksTotal),
      phases,
    },
    profile,
  };
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

export const NARRATIVE_SYSTEM = `You are Unc, the Junction operator — the marketing department that runs a founder's growth beside them. Register: "In your corner." You are writing the plan card the founder sees at the end of onboarding.

Voice (non-negotiable): first person, present tense, numbers over adjectives. You propose and show your working; you never command. Warm, direct, concrete. No hype, no filler, no exclamation marks, no emojis, no markdown. Never call yourself a "fully autonomous AI employee"; never promise "10x overnight" or "set and forget".

What you are given: a DETERMINISTIC PLAN (channels, phase order, week spans — already decided by the scoring model and NOT yours to change), the founder's GOAL and RESOURCES, and, when available, a BUSINESS PROFILE scanned from their site.

Write these four things, as strict JSON only:
{"title": string, "mathLine": string, "phaseNotes": string[], "footnote": string}

- title: ≤ 10 words. Names the posture blend using the given posture labels, and — if a profile exists — can nod to what the business actually is. No trailing period.
- mathLine: ONE sentence, ≤ 40 words, ending with a colon. It states the gap to the goal by the deadline and what the founder is putting in (money per day, hours per week), then leads into the numbered phases. Use the gapLabel, budgetPerDay and hoursPerWeek figures exactly as given.
- phaseNotes: exactly one per phase, in the given order, each ≤ 2 sentences and ≤ 45 words. DO NOT include the week span or a phase number — the app prepends "Weeks X–Y:" itself. Name the phase's channel. Tie it to the founder's actual strengths, hours or budget, and — when a profile exists — to their actual products, audience or voice phrases (use the brand's words, not generic ones). Keep each phase's channel and the "why" rationale you were given; you may say it better, not differently.
- footnote: ≤ 2 sentences, ≤ 35 words. Keep the first sentence exactly: "I do the work — you bring taste and okays." Second sentence: if a profile exists, say you've read their site (mention one concrete thing you read) and will keep sharpening; if not, keep the promise to scan their site and socials tonight.

Hard rules:
- The ONLY numbers you may write are numbers that appear in the input (goal, resources, plan) — you may not compute new ones. If in doubt, leave the number out.
- Never reorder phases, never change a channel, never state weeks other than the given spans.
- Never invent facts about the business. If the profile is null or a field is null, do not guess — write around it.
- Output the JSON object and nothing else.`;

export function buildNarrativeUserMessage(req: NarrativeRequest): string {
  const { goal, resources, plan, profile } = req;
  const p = profile
    ? {
        name: profile.name,
        oneLiner: profile.oneLiner,
        category: profile.category,
        products: profile.products.slice(0, 8),
        audience: profile.audience,
        voice: profile.voice,
        market: profile.market,
        signals: profile.signals.slice(0, 6),
        confidence: profile.confidence,
        note: profile.note ?? null,
      }
    : null;
  return [
    "GOAL",
    JSON.stringify(goal),
    "",
    "RESOURCES",
    JSON.stringify(resources),
    "",
    "DETERMINISTIC PLAN (fixed — write around it, never change it)",
    JSON.stringify(plan),
    "",
    "BUSINESS PROFILE (scanned from their site; null = not scanned yet or unreachable)",
    JSON.stringify(p),
    "",
    "Write the JSON now.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Output validation                                                   */
/* ------------------------------------------------------------------ */

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const norm = (t: string) => t.replace(/,/g, "");

/** Every number literal in the request (plus small counts 1–12) is fair game; nothing else is. */
export function allowedNumbers(req: NarrativeRequest): Set<string> {
  const set = new Set<string>();
  for (let i = 1; i <= 12; i++) set.add(String(i));
  const scan = (v: unknown) => {
    for (const m of JSON.stringify(v).match(NUM_RE) ?? []) set.add(norm(m));
  };
  scan(req.goal);
  scan(req.resources);
  scan(req.plan);
  if (req.profile) scan({ products: req.profile.products, phrases: req.profile.voice.phrases, oneLiner: req.profile.oneLiner, signals: req.profile.signals });
  return set;
}

export function numbersOk(text: string, allowed: Set<string>): boolean {
  return (text.match(NUM_RE) ?? []).every((m) => allowed.has(norm(m)));
}

const SPAN_PREFIX = /^\s*(?:phase\s*\d+\s*[:.\-–—]\s*)?(?:weeks?\s+\d+(?:\s*[–-]\s*\d+)?(?:\s+and\s+beyond)?\s*[:.\-–—]\s*)/i;
const SENTENCE_SPLIT = /(?<=[.!?…])\s+(?=[A-Z“"'(])/;

function clip(text: string, maxSentences: number, maxChars: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  const parts = t.split(SENTENCE_SPLIT);
  return parts.slice(0, maxSentences).join(" ").slice(0, maxChars).trim();
}

const NO_MARKDOWN = /[*#_`>]|\[[^\]]*\]\(/;

function cleanField(v: unknown, maxSentences: number, maxChars: number): string | null {
  if (typeof v !== "string") return null;
  const t = clip(v, maxSentences, maxChars);
  if (!t || NO_MARKDOWN.test(t) || /[\u{1F300}-\u{1FAFF}]/u.test(t)) return null;
  return t;
}

export function extractJsonObject(text: string): unknown {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

export interface ParsedNarrative {
  narrative: PlanNarrative;
  /** How many of the four fields came from the model (0 = everything fell back). */
  liveFields: number;
}

/** Validate the model output field by field; any field that breaks a rule falls back to the deterministic copy. */
export function parseNarrative(raw: unknown, req: NarrativeRequest): ParsedNarrative | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const allowed = allowedNumbers(req);
  let live = 0;

  const title = (() => {
    const t = cleanField(r.title, 1, TITLE_MAX);
    if (!t || !numbersOk(t, allowed)) return req.plan.title;
    live++;
    return t.replace(/\.$/, "");
  })();

  const mathLine = (() => {
    const t = cleanField(r.mathLine, 1, LINE_MAX);
    if (!t || !numbersOk(t, allowed)) return req.plan.mathLine;
    live++;
    return /[:：]$/.test(t) ? t : `${t.replace(/[.!?]$/, "")}:`;
  })();

  const phaseNotes = (() => {
    const fallback = req.plan.phases.map((p) => p.text.replace(SPAN_PREFIX, "").trim());
    if (!Array.isArray(r.phaseNotes) || r.phaseNotes.length !== req.plan.phases.length) return fallback;
    const notes = r.phaseNotes.map((v, i) => {
      const t = cleanField(v, 2, NOTE_MAX)?.replace(SPAN_PREFIX, "").trim();
      if (!t || !numbersOk(t, allowed)) return null;
      // The channel must still be named; the model can't quietly swap it.
      const ch = req.plan.phases[i].channel.toLowerCase();
      const first = ch.split(/[\s&,]+/)[0];
      if (!t.toLowerCase().includes(first)) return null;
      return t;
    });
    if (notes.some((x) => x === null)) return fallback;
    live++;
    return notes as string[];
  })();

  const footnote = (() => {
    const t = cleanField(r.footnote, 2, LINE_MAX);
    if (!t || !numbersOk(t, allowed) || !/^I do the work\s*[—-]+\s*you bring taste and okays\./i.test(t)) return req.plan.footnote;
    live++;
    return t;
  })();

  return { narrative: { title, mathLine, phaseNotes, footnote }, liveFields: live };
}
