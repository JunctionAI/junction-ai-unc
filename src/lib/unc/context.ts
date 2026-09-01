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
      baseline: gm.baseline,
      current: gm.cur,
      deadline: S.deadline,
      daysLeft: gm.daysLeftN,
      pacePerDay: Math.round(gm.pace),
      neededPerDay: Math.round(gm.needed),
      projectedAtDeadline: gm.proj,
      gapAtDeadline: Math.round(gm.gap),
      onTrack: gm.onTrack,
      progress: gm.goalPct,
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
