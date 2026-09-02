/* Serializes the client-side platform state into the compact JSON context Unc
   reasons over. Everything here is data the UI already shows the founder —
   functions and styling are stripped, lists are capped. This is the ONLY
   source of numbers Unc is allowed to use in replies. */

import { ALL_SYSTEMS, CATEGORIES, CONNECTOR_DEFS } from "@/lib/platform/catalog";
import { AP_DATA, AP_WHY_TEXTS, COMPLETED_DEFS, LEVER_DEFS, SIGNAL_DEFS, postureDefs } from "@/lib/platform/derive";
import { DEMO_TODAY, goalMath } from "@/lib/platform/goal";
import { scoreChannels, span, weekSplit } from "@/lib/platform/plan";
import type { PlatformState } from "@/lib/platform/state";

const LIST_CAP = 10;

export function buildUncContext(S: PlatformState) {
  const gm = goalMath({ goalTitle: S.goalTitle, baselineNum: S.baselineNum, deadline: S.deadline, currency: S.currency });
  const baselineSet = S.baselineNum !== null;

  const approvals = AP_DATA.slice(0, LIST_CAP).map((a, i) => ({
    routine: a.sys,
    title: a.title,
    detail: a.detail,
    before: a.before,
    after: a.after,
    expiry: a.expiry,
    status: S.apStatus[i] ?? "pending",
    reasoning: AP_WHY_TEXTS[i],
  }));

  const pd = postureDefs[S.posture];
  const phases = pd.phases.map((ph, pi) => ({
    phase: ph.n,
    name: ph.name,
    status: ph.st,
    routines: S.routineEdits[`${S.posture}.${pi}`] ?? ph.routines,
    founderPart: ph.you,
  }));

  const isOn = (n: string) => S.routineOn[n] ?? ALL_SYSTEMS.find((x) => x.name === n)?.state === "Active";
  const routinesOn = ALL_SYSTEMS.filter((s) => isOn(s.name)).map((s) => s.name);

  const connectors = CONNECTOR_DEFS.map((d) => ({ name: d.name, status: S.connState[d.name] || d.st, reads: d.note }));

  const chans = scoreChannels(S.posture, S.obStrengths || [], S.budgetMo);
  const { weeksLeft, w1, w2end } = weekSplit(S.deadline);

  return {
    today: DEMO_TODAY.slice(0, 10),
    goal: {
      title: S.goalTitle,
      currency: S.currency,
      target: gm.target,
      // baseline NULL in the account → these are unknown, not the demo 28,400 (Unc must ask, not invent)
      baseline: baselineSet ? gm.baseline : null,
      current: baselineSet ? gm.cur : null,
      deadline: S.deadline,
      daysLeft: gm.daysLeftN,
      pacePerDay: baselineSet ? Math.round(gm.pace) : null,
      neededPerDay: baselineSet ? Math.round(gm.needed) : null,
      projectedAtDeadline: baselineSet ? gm.proj : null,
      gapAtDeadline: baselineSet ? Math.round(gm.gap) : null,
      onTrack: baselineSet ? gm.onTrack : null,
      progress: baselineSet ? gm.goalPct : null,
      otherGoals: S.obCats.slice(1).map((k) => S.goalTexts[k]).filter(Boolean),
    },
    founder: {
      profile: { budget: S.profile.budget, time: S.profile.time, strength: S.profile.strength, belief: S.profile.belief },
      strengths: S.obStrengths,
      platforms: S.obPlatforms,
      hoursPerWeek: S.hoursWk,
      adBudgetPerMonth: S.budgetMo,
      adBudgetPerDay: Math.round(S.budgetMo / 30),
      marginPct: S.marginPct,
      reinvest: S.reinvest,
      breadth: S.obBreadth,
      pace: S.obPace,
      team: S.team.slice(0, LIST_CAP).map((p) => ({ name: p.name, role: p.role, approvalAreas: p.areas })),
    },
    strategy: {
      posture: S.posture,
      postureLabel: pd.label,
      thesis: pd.thesis,
      why: pd.why,
      phases,
      channelRanking: chans.map((c) => ({ channel: c.k, why: c.why })),
      rolloutWeeks: { total: weeksLeft, phase1: span(1, w1), phase2: span(w1 + 1, w2end), phase3: `${span(w2end + 1, weeksLeft)}+` },
    },
    approvalsPending: approvals.filter((a) => a.status === "pending"),
    approvalsRecent: approvals.filter((a) => a.status !== "pending").slice(0, LIST_CAP),
    routines: {
      active: routinesOn.slice(0, 40),
      activeCount: routinesOn.length,
      libraryTotal: ALL_SYSTEMS.length,
      categories: CATEGORIES.map((c) => ({ name: c.name, on: c.systems.filter(isOn).length, total: c.systems.length })),
    },
    connectors,
    signals: SIGNAL_DEFS.map((s) => ({ label: s.label, value: s.value, note: s.delta })),
    levers: LEVER_DEFS.map((l) => ({ name: l.name, impact: l.impact, cost: l.cost, status: l.conf })),
    recentReceipts: COMPLETED_DEFS.slice(0, LIST_CAP),
    onboarded: S.onboarded,
  };
}

export type UncContext = ReturnType<typeof buildUncContext>;

/* ---------- Client Brain (server-side only) ----------
   The browser builds the context above from its own state; the chat route then attaches what
   Unc remembers about this founder (src/lib/brain/retrieve.ts recallForContext, keyed on the
   latest founder message) and how they like to work (src/lib/brain/profile.ts). Both are
   rendered by buildUncSystemPrompt as their own sections, never as raw JSON. Anything the
   client sent under these keys is dropped first — the brain is server truth. */

export const BRAIN_CONTEXT_KEYS = ["memories", "profile"] as const;

export interface BrainContext {
  /** "[kind] text" lines from recallForContext — the founder's stated truth, compact. */
  memories: string[];
  /** renderProfileForPrompt output; "" when the profile is empty. */
  profile: string;
}

export type UncContextWithBrain = UncContext & Partial<BrainContext>;

export function attachBrain(context: unknown, brain: BrainContext | null): Record<string, unknown> {
  const base = context && typeof context === "object" && !Array.isArray(context) ? { ...(context as Record<string, unknown>) } : {};
  for (const k of BRAIN_CONTEXT_KEYS) delete base[k];
  if (!brain) return base;
  return { ...base, memories: brain.memories.filter((m) => typeof m === "string" && m.trim()), profile: brain.profile ?? "" };
}

/** Pull the brain sections back out of a context object (the prompt renders them separately). */
export function splitBrain(context: unknown): { context: Record<string, unknown>; brain: BrainContext | null } {
  const base = context && typeof context === "object" && !Array.isArray(context) ? { ...(context as Record<string, unknown>) } : {};
  const memories = Array.isArray(base.memories) ? base.memories.filter((m): m is string => typeof m === "string" && !!m.trim()) : [];
  const profile = typeof base.profile === "string" ? base.profile : "";
  for (const k of BRAIN_CONTEXT_KEYS) delete base[k];
  return { context: base, brain: memories.length || profile.trim() ? { memories, profile } : null };
}
