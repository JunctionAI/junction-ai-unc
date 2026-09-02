/* Client Brain — the onboarding answers as memories (source "onboarding").

   onboardingMemories(answers) is pure: the founder's own answers become facts, constraints,
   a decision (the agreed posture) and relationships (the team). Nothing is inferred and
   unknowns yield nothing (a null baseline is not a memory). persistOnboarding() writes them
   under one source_ref per account so a second "Agree the plan" merges instead of duplicating.

   The client posts these from Platform (useOnboardingMemories) to POST /api/unc/onboarding
   when — and only when — the app is in accounts mode. Relative imports only. */

import type { DbClient } from "../db/types";
import { addMemories, type AddMemoryResult, type BrainOptions, type NewMemory } from "./memory";

export interface OnboardingAnswers {
  goalTitle: string;
  deadline: string;
  currency: string;
  /** null = not set (never 0). */
  baselineNum: number | null;
  targetNum?: number | null;
  otherGoals?: string[];
  budgetMo: number;
  hoursWk: number;
  reinvest?: string;
  marginPct?: number | null;
  strengths: string[];
  platforms: string[];
  posture: string;
  postureLabel?: string;
  postureSet?: string[];
  breadth?: string;
  pace?: string;
  team?: { name: string; role: string; areas?: string[] }[];
  website?: string;
  socials?: string;
}

const SYMBOL: Record<string, string> = { NZD: "NZ$", AUD: "A$", USD: "US$", GBP: "£", EUR: "€" };
const money = (currency: string, n: number) => `${SYMBOL[currency] ?? `${currency} `}${Math.round(n).toLocaleString("en-US")}`;
const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();

export const onboardingSourceRef = (accountId: string) => `onboarding:${accountId}`;

export function onboardingMemories(accountId: string, a: OnboardingAnswers): NewMemory[] {
  const ref = onboardingSourceRef(accountId);
  const base = { accountId, source: "onboarding" as const, sourceRef: ref, confidence: 0.95 };
  const out: NewMemory[] = [];
  const goal = clean(a.goalTitle);
  const deadline = clean(a.deadline);
  if (goal) out.push({ ...base, kind: "fact", text: `Governing goal: ${goal}${deadline ? ` by ${deadline}` : ""}.`, importance: 5, tags: ["goal"] });
  const others = (a.otherGoals ?? []).map(clean).filter(Boolean);
  if (others.length) out.push({ ...base, kind: "fact", text: `Checkpoint goals (never sacrificed for the governing goal): ${others.join("; ")}.`, importance: 4, tags: ["goal", "checkpoint"] });
  if (typeof a.baselineNum === "number" && Number.isFinite(a.baselineNum)) out.push({ ...base, kind: "fact", text: `Baseline when we started (${deadline ? `stated at onboarding` : "onboarding"}): ${money(a.currency, a.baselineNum)}.`, importance: 4, tags: ["baseline"] });
  if (Number.isFinite(a.budgetMo)) out.push({ ...base, kind: "constraint", text: `Ad spend is capped at ${money(a.currency, a.budgetMo)} per month (about ${money(a.currency, a.budgetMo / 30)} a day).`, importance: 5, tags: ["budget", "guardrail"] });
  if (Number.isFinite(a.hoursWk)) out.push({ ...base, kind: "constraint", text: `The founder has ${a.hoursWk} hours a week for marketing — plan their part inside that.`, importance: 5, tags: ["time", "guardrail"] });
  const rein = clean(a.reinvest);
  if (rein) out.push({ ...base, kind: "preference", text: `Reinvestment stance: ${rein}.`, importance: 3, tags: ["budget"] });
  if (typeof a.marginPct === "number" && Number.isFinite(a.marginPct)) out.push({ ...base, kind: "fact", text: `Gross margin is about ${a.marginPct}%.`, importance: 4, tags: ["margin"] });
  const strengths = a.strengths.map(clean).filter(Boolean);
  if (strengths.length) out.push({ ...base, kind: "fact", text: `Founder strengths: ${strengths.join(", ")}.`, importance: 4, tags: ["strengths"] });
  const platforms = a.platforms.map(clean).filter(Boolean);
  if (platforms.length) out.push({ ...base, kind: "fact", text: `Platforms already in use: ${platforms.join(", ")}.`, importance: 3, tags: ["platforms"] });
  const posture = clean(a.postureLabel) || clean(a.posture);
  if (posture) {
    const extras = [a.postureSet?.length ? `beliefs: ${a.postureSet.map(clean).filter(Boolean).join(" + ")}` : "", a.breadth ? `${clean(a.breadth)} breadth` : "", a.pace ? `pace ${clean(a.pace)}` : ""].filter(Boolean);
    out.push({ ...base, kind: "decision", text: `Agreed the plan at onboarding: ${posture}${extras.length ? ` (${extras.join("; ")})` : ""}.`, importance: 4, tags: ["plan", "posture"] });
  }
  for (const t of (a.team ?? []).slice(0, 10)) {
    const name = clean(t.name);
    if (!name) continue;
    const areas = (t.areas ?? []).map(clean).filter(Boolean);
    out.push({ ...base, kind: "relationship", text: `${name} — ${clean(t.role) || "team"}${areas.length ? `; approves ${areas.join(", ")}` : ""}.`, importance: 3, tags: ["team"] });
  }
  const site = clean(a.website);
  if (site) out.push({ ...base, kind: "fact", text: `Website: ${site}.`, importance: 3, tags: ["website"] });
  const socials = clean(a.socials);
  if (socials) out.push({ ...base, kind: "fact", text: `Social handles: ${socials.slice(0, 200)}.`, importance: 2, tags: ["socials"] });
  return out;
}

export async function persistOnboarding(db: DbClient, accountId: string, answers: OnboardingAnswers, opts: BrainOptions = {}): Promise<{ results: AddMemoryResult[]; failed: number }> {
  const { results, failed } = await addMemories(db, onboardingMemories(accountId, answers), opts);
  return { results, failed: failed.length };
}

/** Reads the answers off a PlatformState-shaped object (client + route share the wire shape). */
export function coerceOnboardingAnswers(raw: unknown): OnboardingAnswers | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 400) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : []);
  const goalTitle = str(r.goalTitle);
  if (!goalTitle) return null;
  const team = Array.isArray(r.team)
    ? r.team
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({ name: str(t.name), role: str(t.role), areas: strs(t.areas) }))
        .slice(0, 10)
    : [];
  return {
    goalTitle,
    deadline: str(r.deadline),
    currency: str(r.currency) || "NZD",
    baselineNum: numOrNull(r.baselineNum),
    targetNum: numOrNull(r.targetNum),
    otherGoals: strs(r.otherGoals),
    budgetMo: num(r.budgetMo),
    hoursWk: num(r.hoursWk),
    reinvest: str(r.reinvest),
    marginPct: numOrNull(r.marginPct),
    strengths: strs(r.strengths),
    platforms: strs(r.platforms),
    posture: str(r.posture),
    postureLabel: str(r.postureLabel),
    postureSet: strs(r.postureSet),
    breadth: str(r.breadth),
    pace: str(r.pace),
    team,
    website: str(r.website),
    socials: str(r.socials),
  };
}
