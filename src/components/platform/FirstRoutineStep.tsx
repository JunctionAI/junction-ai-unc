"use client";
/* Guided step 3 — "First routine on" (accounts mode).

   ONE recommended wave-1 routine from the plan's phase-1 channel (src/lib/setup/channels.ts
   recommendedRoutine over src/lib/runtime/catalog-specs.ts), its benefit in one line, and
   "Turn it on": Platform.tsx flips routine_states.enabled and fires an immediate dry run
   (src/lib/setup/routine.ts turnOnRoutine → POST /api/setup/enable + POST /api/routines/run).
   Then: "Running now — your first draft lands in What I drafted" and "Continue to Home".
   Skippable ("Not now"), idempotent on refresh (an already-enabled routine shows as on). */

import React, { useState } from "react";
import type { PlatformVals } from "@/lib/platform/derive";
import type { ChannelKey } from "@/lib/platform/plan";
import { readPlatforms, recommendationPool, requiredPlatform, platformName, routineBenefit, routineName, waveOneRoutines } from "@/lib/setup/channels";
import { businessModelOf, cadenceLabel } from "@/lib/setup/home";
import { AUDIENCE_WORD, hasStore } from "@/lib/unc/businessType";
import { ALL_SYSTEMS } from "@/lib/platform/catalog";

const ALL_CAT: Record<string, string> = Object.fromEntries(ALL_SYSTEMS.map((s) => [s.id, s.cat]));
import { turnOnLine, type TurnOnResult } from "@/lib/setup/routine";
import { GuidedShell, UncLine } from "./ConnectDataStep";

const stepLabel: React.CSSProperties = { fontSize: 10.5, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--cyan-link)", fontWeight: 700 };
const stepH2: React.CSSProperties = { fontWeight: 600, fontSize: 26, margin: "10px 0 0", letterSpacing: "-0.015em" };

export interface FirstRoutineStepProps {
  V: PlatformVals;
  channel: ChannelKey;
  onTurnOn: (routineId: string) => Promise<TurnOnResult>;
  onContinue: () => void;
  onSkip: () => void;
}

export default function FirstRoutineStep({ V, channel, onTurnOn, onContinue, onSkip }: FirstRoutineStepProps) {
  /* Pinned at mount so the card never jumps mid-step: the recommended wave-1 routine for THIS
     business (src/lib/setup/channels.ts recommendedRoutine — fits the business type, reads
     nothing the founder said they lack); a refresh after "Turn it on" shows that same routine
     because it is the one already on. */
  const model = businessModelOf({ scan: V.obScan });
  const [spec] = useState(() => {
    const pool = recommendationPool(channel, { model, knownPlatforms: V.obNarrativeRequest.resources.platforms });
    return pool.find((s) => V.routineOnById(s.id)) ?? pool[0] ?? null;
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TurnOnResult | null>(null);
  const isOn = !!spec && V.routineOnById(spec.id);

  if (!spec) {
    // Nothing draft-only fits this business and channel: say so and move on (never a placeholder card).
    return (
      <GuidedShell active={8}>
        <div style={stepLabel}>Step 8 · First routine</div>
        <h2 style={stepH2}>Nothing to switch on yet</h2>
        <UncLine>Your plan starts with {channel}, and nothing draft-only fits your business in it yet. I&apos;ll propose the first one on Home the moment it is ready.</UncLine>
        <div style={{ textAlign: "center", marginTop: 28 }}>
          <button onClick={onContinue} className="btn-cyan" style={{ padding: "13px 34px", fontSize: 14.5, fontWeight: 700 }}>
            Continue to Home →
          </button>
        </div>
      </GuidedShell>
    );
  }

  const req = requiredPlatform(spec);
  const reqOk = !req || V.connStateByName(platformName(req)) === "ok";
  // a Shopify read is a fallback for a business with no store (research / the site answer it) — not a thing to name
  const reads = readPlatforms(spec).filter((p) => p !== "shopify" || hasStore(model) || !model.businessType).map(platformName);
  /* Copy follows the business: a services firm has clients and enquiries, a creator an audience — "customers" and "orders" only for a store. */
  const who = model.businessType ? AUDIENCE_WORD[model.businessType] : hasStore(model) ? "customers" : "the people you serve";
  /* The pick came from outside the channel: say why — every routine of the channel changes live
     spend (Paid ads), or nothing in it fits this business (an Email plan with no store, no email tool yet). */
  const outsideChannel = (ALL_CAT[spec.id] ?? channel) !== channel;
  const channelHasWaveOne = waveOneRoutines(channel).length > 0;
  const why = !outsideChannel ? " — this one first" : channelHasWaveOne ? ` — nothing in ${channel.toLowerCase()} fits your business yet, so this one first` : ` — every ${channel.toLowerCase()} routine changes live spend and waits for your budget sign-off in wave 2, so this one first`;

  async function turnOn() {
    setBusy(true);
    try {
      setResult(await onTurnOn(spec!.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GuidedShell active={8}>
      <div style={stepLabel}>Step 8 · First routine</div>
      <h2 style={stepH2}>Your first routine</h2>
      <UncLine>
        Your plan starts with <strong>{channel}</strong>{why}. Draft-only: I prepare the work for {who} and hand it to you. Nothing sends without you.
      </UncLine>
      <div data-testid="first-routine-card" data-routine={spec.id} data-on={isOn ? "1" : "0"} style={{ marginTop: 20, background: "white", border: `1.5px solid ${isOn ? "oklch(0.78 0.13 220)" : "var(--card-border-2)"}`, borderRadius: 14, padding: "18px 20px", boxShadow: "0 6px 24px oklch(0.27 0.055 262 / 0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "var(--cyan-link)", background: "var(--cyan-wash)", borderRadius: 5, padding: "2px 7px" }}>{spec.id}</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{routineName(spec.id)}</span>
          {isOn && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "4px 10px" }}>On ✓</span>}
        </div>
        <div style={{ fontSize: 14, color: "oklch(0.35 0.05 262)", marginTop: 8, lineHeight: 1.5 }}>{routineBenefit(spec.id)}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
          Runs {cadenceLabel(spec.id)}
          {reads.length ? ` · reads ${reads.join(", ")}` : ""} · draft-only for now
        </div>
        {!reqOk && req && (
          <div style={{ fontSize: 12.5, color: "var(--amber-text)", background: "var(--amber-wash)", borderRadius: 10, padding: "8px 12px", marginTop: 10, lineHeight: 1.5 }}>
            Needs {platformName(req)} connected for its number — I can still dry-run it now from what I can read.
          </div>
        )}
        {result && (
          <div data-testid="first-routine-result" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, background: "var(--cyan-wash)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "oklch(0.35 0.08 240)", fontWeight: 500 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan-link)", animation: "jpulse 1.6s infinite", flex: "none" }}></span>
            {turnOnLine(result)}
          </div>
        )}
        {!result && isOn && (
          <div data-testid="first-routine-already-on" style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 12, lineHeight: 1.5 }}>
            Already on — its drafts land in What I drafted on Home.
          </div>
        )}
        {!isOn && !result && (
          <button onClick={() => void turnOn()} disabled={busy} data-testid="first-routine-turn-on" className="btn-cyan" style={{ marginTop: 14, padding: "10px 22px", fontSize: 13.5, fontWeight: 700 }}>
            {busy ? "Turning it on…" : "Turn it on"}
          </button>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28 }}>
        {!isOn && !result ? (
          <button onClick={onSkip} data-testid="first-routine-skip" className="hov-fg-ink" style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
            Not now
          </button>
        ) : (
          <span />
        )}
        <button onClick={onContinue} data-testid="first-routine-continue" className={isOn || result ? "btn-cyan" : "btn-navy"} style={{ padding: "11px 26px", fontSize: 13.5, fontWeight: 600 }}>
          Continue to Home →
        </button>
      </div>
    </GuidedShell>
  );
}
