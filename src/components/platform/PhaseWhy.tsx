"use client";

import type { PhaseReasoning } from "@/lib/platform/plan";

/* The judgement under a plan phase (plan.ts §Reasoning), rendered collapsed:
   "Why this order · What flips it · The risk" (+ what Unc does weekly). Shared by StrategyView
   (the agreed plan) and Onboarding step 6 (the draft plan card) so the two read the same. */
export default function PhaseWhy({ r, testId }: { r: PhaseReasoning; testId: string }) {
  const row = (label: string, text: string) => (
    <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
      <span style={{ flex: "none", width: 92, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, color: "oklch(0.4 0.04 262)", paddingTop: 1 }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
  return (
    <details data-testid={testId} style={{ marginTop: 12, borderTop: "1px solid var(--hairline)", paddingTop: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--cyan-link)", listStyle: "none" }}>Why this order · What flips it · The risk</summary>
      {row("Why this order", r.whyThisOrder)}
      {row("What flips it", r.evidenceGate)}
      {row("The risk", r.risk)}
      {row("Weekly, from me", r.whatIDoWeekly)}
    </details>
  );
}
