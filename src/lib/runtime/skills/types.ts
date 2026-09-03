/* Skills — one card per wave-1 routine: what it can use, the minimum it honestly needs, the
   craft rules Unc writes by, and the artifact kind it produces.

   A skill is data + one pure `check` over a SkillContext (the material the producer gathered:
   site profile, memories, reads, founder inputs). It never does I/O; the worker's LlmProducer
   gathers the context, runs the check, and only then builds the prompt. The `minimum` block
   is also copied onto the catalog spec (RoutineSpec.minimum) so availability and the UI can
   say "Needs: X" from data. */

import type { ArtifactKind, Platform, ProduceNeed, ReadResult, SpecMinimum } from "../types";

/** The scanned business profile as the producer sees it (business_profiles.profile). */
export interface SkillProfile {
  name?: string | null;
  oneLiner?: string | null;
  category?: string | null;
  products?: string[];
  audience?: string | null;
  voice?: { tone?: string | null; phrases?: string[] };
  market?: { region?: string | null; competitorsMentioned?: string[] };
  signals?: string[];
  confidence?: "low" | "medium" | "high";
  sources?: string[];
}

export interface SkillGoal {
  title: string | null;
  deadline: string | null;
  baseline: number | null;
  currency: string | null;
}

export interface PriorArtifact {
  id: string;
  kind: ArtifactKind;
  routineId: string;
  title: string;
  body: string;
  createdAt: string;
  status: string;
}

export interface SkillContext {
  routineId: string;
  accountId: string;
  profile: SkillProfile | null;
  /** Recalled memory lines ("[fact] …"). */
  memories: string[];
  reads: Record<string, ReadResult>;
  inputs: Record<string, string>;
  vars: Record<string, unknown>;
  goal: SkillGoal | null;
  /** Plan phases as stored (plans.phases): [{ weeks, title, focus, from_you, channel }] (or the
      older { name, routines } shape). */
  plan: { title?: string; name?: string; channel?: string; focus?: string; weeks?: unknown; routines?: string[] }[] | null;
  priorArtifacts: PriorArtifact[];
  founderNotes: string | null;
  currency: string;
  today: string;
}

export type SkillCheck = { ok: true; using: string[] } | { ok: false; needs: ProduceNeed[]; note?: string };

export interface SkillExample {
  when: string;
  does: string;
}

/** Graphed-style skill file: what this routine is allowed to own, read, decide, write and never do.
    Rendered in the inspector. `apply` is the graduate line — Unc keeps asking until agreement unlocks it. */
export interface SkillFile {
  goal: string;
  owns: string[];
  reads: string[];
  decides: string[];
  writes: string[];
  never: string[];
  apply: string;
  examples: SkillExample[];
}

export interface Skill {
  id: string;
  routineId: string;
  name: string;
  kind: ArtifactKind;
  maxItems: number;
  /** One line: what this routine makes and why. Doubles as the memory recall query. */
  purpose: string;
  /** What the skill can draw on, in plain words (UI + docs). */
  inputs: string[];
  file: SkillFile;
  minimum: SpecMinimum;
  /** The playbook domain to recall method cards from. */
  domain: "email" | "paid" | "seo" | "content" | "sales" | "strategy" | "analytics";
  /** The craft rules, in Unc's voice, appended to the producer's system prompt. */
  prompt: string;
  /** The JSON shape the model must return (items + meta fields), stated in the prompt. */
  outputSpec: string;
  check(ctx: SkillContext): SkillCheck;
}

// ---------- shared checks ----------

export function rows(ctx: SkillContext, alias: string): Record<string, unknown>[] {
  return ctx.reads[alias]?.rows ?? [];
}

export function readAnswered(ctx: SkillContext, alias: string): boolean {
  const r = ctx.reads[alias];
  return !!r && r.provenance !== "unavailable";
}

/** A profile with something to write from: a name plus a one-liner, products or a category. */
export function profileHasSubstance(p: SkillProfile | null): boolean {
  if (!p) return false;
  const named = !!(p.name && p.name.trim());
  const substance = !!(p.oneLiner && p.oneLiner.trim()) || (p.products?.length ?? 0) > 0 || !!(p.category && p.category.trim());
  return named && substance;
}

/** Memories that describe the business itself (facts, preferences, constraints — not chat summaries). */
export function businessMemories(ctx: SkillContext): string[] {
  return ctx.memories.filter((m) => /^\[(fact|preference|constraint|decision|lesson)/.test(m));
}

export function knowsTheBusiness(ctx: SkillContext): { ok: boolean; using: string[] } {
  const using: string[] = [];
  if (profileHasSubstance(ctx.profile)) using.push("site profile");
  const mem = businessMemories(ctx);
  if (mem.length >= 3) using.push(`${mem.length} memories`);
  return { ok: using.length > 0, using };
}

export const need = {
  platform: (platform: Platform, why: string): ProduceNeed => ({ platform, why }),
  input: (input: string, why: string): ProduceNeed => ({ input, why }),
};

export const NEED_BUSINESS: ProduceNeed = need.input("about_the_business", "tell me what you sell, who buys it and what makes it different (or scan your site in Strategy)");

export function minimum(summary: string, platforms: Platform[], inputs: string[], helpful: Platform[] = []): SpecMinimum {
  return { summary, platforms, inputs, helpful };
}

/** Site sections / product text the scan captured — the "FAQ / product text" fallback. */
export function siteText(p: SkillProfile | null): string[] {
  if (!p) return [];
  return [...(p.products ?? []), ...(p.signals ?? []), ...(p.voice?.phrases ?? [])].filter((s) => typeof s === "string" && s.trim());
}
