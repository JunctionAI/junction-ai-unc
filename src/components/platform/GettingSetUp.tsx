"use client";
/* "Getting set up" — the Home card (accounts mode only) that replaces the demo
   "Platforms connected 5 of 16 · History imported · …" strip with the five spine steps of
   docs/PRODUCT-EXPERIENCE.md, each with its REAL state from GET /api/setup/progress.

   Rows: a cyan check when done, a quiet dot otherwise; one line in Unc's voice; the next
   action as a navy pill on exactly one row (that row alone carries amber — a decision waits).
   All five done → one quiet line ("Set up ✓ — running on your plan.") with a dismiss; once
   dismissed (persisted in client_state) the card is gone for good. Demo mode never renders it. */

import React from "react";
import { HOME_COPY } from "@/lib/setup/home";
import type { SetupAnchor, SetupProgress, SetupStepView } from "@/lib/setup/progress";

export const GETTING_SET_UP_ID = "getting-set-up";

/** The two first-run motions (CSS only; both honour prefers-reduced-motion on top of the
    global rule): the plan card settling into its timeline, the first draft sliding in. */
export function SetupMotionStyles() {
  return (
    <style>{`
@keyframes jsettle { 0% { opacity: 0; transform: translateY(-8px) scale(0.985); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes jslidein { 0% { opacity: 0; transform: translateX(-14px); } 100% { opacity: 1; transform: translateX(0); } }
.j-settle { animation: jsettle 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.j-slidein { animation: jslidein 300ms ease both; }
@media (prefers-reduced-motion: reduce) { .j-settle, .j-slidein { animation: none; } }
`}</style>
  );
}

const check: React.CSSProperties = { flex: "none", width: 18, height: 18, borderRadius: "50%", background: "var(--cyan)", color: "oklch(0.22 0.05 262)", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 };
const dot = (amber: boolean): React.CSSProperties => ({ flex: "none", width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${amber ? "var(--amber)" : "oklch(0.85 0.012 260)"}`, background: amber ? "var(--amber-wash)" : "transparent", marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center" });
const dotInner = (amber: boolean): React.CSSProperties => ({ width: 5, height: 5, borderRadius: "50%", background: amber ? "var(--amber)" : "oklch(0.8 0.012 260)" });

export interface GettingSetUpProps {
  progress: SetupProgress | null;
  loading?: boolean;
  error?: string | null;
  dismissed: boolean;
  onDismiss: () => void;
  onAction: (anchor: SetupAnchor) => void;
}

export function stepMark(step: SetupStepView, isNext: boolean) {
  if (step.done) return <span data-testid="setup-check" style={check}>✓</span>;
  return (
    <span data-testid={isNext ? "setup-next-dot" : "setup-dot"} style={dot(isNext)}>
      <span style={dotInner(isNext)}></span>
    </span>
  );
}

export default function GettingSetUp({ progress, loading = false, error = null, dismissed, onDismiss, onAction }: GettingSetUpProps) {
  if (dismissed) return null;
  if (!progress) {
    if (error) return null; // Home's needs-you line already says the runtime is unreachable; no second alarm
    return loading ? (
      <div data-testid="getting-set-up-loading" style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 14 }}>
        Checking where we’re up to…
      </div>
    ) : null;
  }

  if (progress.allDone) {
    return (
      <div id={GETTING_SET_UP_ID} data-testid="getting-set-up-done" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--hairline)", fontSize: 12.5, color: "var(--muted-2)" }}>
        <span style={check}>✓</span>
        <span style={{ flex: 1 }}>{HOME_COPY.setupDone}</span>
        <button onClick={onDismiss} className="hov-underline" style={{ border: "none", background: "transparent", padding: 0, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
          Hide
        </button>
      </div>
    );
  }

  const next = progress.nextAction;
  return (
    <div id={GETTING_SET_UP_ID} data-testid="getting-set-up" style={{ marginTop: 18, background: "var(--cream)", border: "1px solid var(--card-border)", borderRadius: 14, padding: "4px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 0 8px", borderBottom: "1px solid var(--hairline)" }}>
        <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--cyan-text)", fontWeight: 600 }}>Getting set up</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>— {progress.done} of {progress.steps.length} done</span>
      </div>
      {progress.steps.map((step, i) => {
        const isNext = !!next && next.step === step.key;
        return (
          <div key={step.key} data-testid={`setup-row-${step.key}`} data-done={step.done ? "1" : "0"} data-next={isNext ? "1" : "0"} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 0", borderBottom: i < progress.steps.length - 1 ? "1px solid var(--hairline)" : "none" }}>
            {stepMark(step, isNext)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: step.done ? "var(--ink)" : "oklch(0.35 0.04 262)" }}>
                {step.title}
                {step.later && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: "var(--muted)", background: "oklch(0.945 0.008 260)", borderRadius: 999, padding: "2px 8px" }}>later</span>}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 2, lineHeight: 1.5 }}>{step.status}</div>
            </div>
            {isNext && (
              <button onClick={() => onAction(next!.anchor)} className="btn-navy" data-testid="setup-next-action" style={{ flex: "none", padding: "7px 15px", fontSize: 12, fontWeight: 600, marginTop: 2 }}>
                {next!.label} →
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
