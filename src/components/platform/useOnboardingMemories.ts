"use client";

/* Client Brain — when the founder clicks "Agree the plan" (derive.ts obFinish flips
   `onboarded`), post the onboarding answers to /api/unc/onboarding so they become memories.
   Accounts mode only, and only for a transition observed while already in accounts mode —
   hydrating an already-onboarded account never fires it. The route dedupes anyway. */

import { useEffect, useRef } from "react";
import type { OnboardingAnswers } from "@/lib/brain/onboarding";
import { postureDefs } from "@/lib/platform/derive";
import type { PlatformState } from "@/lib/platform/state";

const BELIEF: Record<string, string> = { brand: "Brand before sales", sales: "Sales conversations first", paid: "Buy learning fast" };

export function onboardingAnswersFromState(S: PlatformState): OnboardingAnswers {
  return {
    goalTitle: S.goalTitle,
    deadline: S.deadline,
    currency: S.currency,
    baselineNum: S.baselineNum,
    targetNum: S.targetNum,
    otherGoals: S.obCats.slice(1).map((k) => S.goalTexts[k]).filter(Boolean),
    budgetMo: S.budgetMo,
    hoursWk: S.hoursWk,
    reinvest: S.reinvest,
    marginPct: S.marginPct,
    strengths: S.obStrengths,
    platforms: S.obPlatforms,
    posture: S.posture,
    postureLabel: postureDefs[S.posture]?.label ?? S.posture,
    postureSet: S.obPostureSet.map((k) => BELIEF[k] ?? k),
    breadth: S.obBreadth,
    pace: S.obPace,
    team: S.team.filter((t) => t.name.trim()).map((t) => ({ name: t.name, role: t.role, areas: t.areas })),
    website: S.website,
    socials: S.socials,
  };
}

export function useOnboardingMemories(S: PlatformState, enabled: boolean): void {
  const stateRef = useRef(S);
  useEffect(() => {
    stateRef.current = S;
  }, [S]);
  const prev = useRef({ onboarded: S.onboarded, enabled });
  useEffect(() => {
    const was = prev.current;
    prev.current = { onboarded: S.onboarded, enabled };
    if (!enabled || !was.enabled || was.onboarded || !S.onboarded) return;
    fetch("/api/unc/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: onboardingAnswersFromState(stateRef.current) }),
    }).catch(() => {});
  }, [S.onboarded, enabled]);
}
