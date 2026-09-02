"use client";
/* Guided step 2 — "Connect your data" (accounts mode, right after "Agree the plan →").

   Same centred-card grammar as onboarding, with the progress dots continuing (steps 7 and 8
   of 9). Cards for ONLY the platforms the plan's phase-1 channel reads. Each card's real state
   comes from connState (the connectors table's projection); "Connect" delegates to the
   connectors module's start path through `onConnect` (Platform.tsx → src/lib/setup/connect.ts).
   When the platform isn't switched on yet the card says so and offers "Connect with a token",
   a link into the Connectors view. "I'll do this later" records an honest later state.
   Idempotent on refresh: the step re-renders from persisted state, nothing replays. */

import React, { useState } from "react";
import type { PlatformVals } from "@/lib/platform/derive";
import { CONNECT_STEP_COPY, type ConnectStart } from "@/lib/setup/connect";
import { phaseOnePlatforms, platformName } from "@/lib/setup/channels";
import type { ChannelKey } from "@/lib/platform/plan";

export const GUIDED_DOTS = 9; // 7 onboarding steps + connect + routine

const stepLabel: React.CSSProperties = { fontSize: 10.5, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--cyan-link)", fontWeight: 700 };
const stepH2: React.CSSProperties = { fontWeight: 600, fontSize: 26, margin: "10px 0 0", letterSpacing: "-0.015em" };
const textInput: React.CSSProperties = { border: "1px solid var(--input-border)", borderRadius: 10, padding: "9px 12px", fontSize: 13, outline: "none", background: "white", color: "var(--ink)" };

/** The onboarding card frame with the dots carried on (index 7 = connect, 8 = routine). */
export function GuidedShell({ active, children }: { active: number; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px", position: "relative" }}>
      <div style={{ width: 680, maxWidth: "100%" }}>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 34 }}>
          {Array.from({ length: GUIDED_DOTS }, (_, i) => (
            <span key={i} style={{ width: i === active ? "26px" : "10px", height: 6, borderRadius: 999, background: i <= active ? "oklch(0.78 0.13 220)" : "oklch(0.88 0.015 260)", transition: "all 0.3s" }}></span>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

export function UncLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
      <img src="/brand/mascot-small.png" alt="Unc" style={{ width: 34, height: 36, objectFit: "contain", flex: "none" }} />
      <div style={{ background: "white", border: "1px solid var(--card-border-2)", borderRadius: "4px 14px 14px 14px", padding: "10px 16px", fontSize: 13.5, lineHeight: 1.55, color: "oklch(0.3 0.06 262)" }}>{children}</div>
    </div>
  );
}

export interface ConnectDataStepProps {
  V: PlatformVals;
  channel: ChannelKey;
  /** Starts the platform's connect flow; the browser leaves on "redirect". */
  onConnect: (platform: string, shop?: string) => Promise<ConnectStart>;
  onContinue: () => void;
  onLater: () => void;
  /** "Connect with a token" → the Connectors view (leaves the guided flow; the Home card carries on). */
  onTokenLink: (platform: string) => void;
}

export default function ConnectDataStep({ V, channel, onConnect, onContinue, onLater, onTokenLink }: ConnectDataStepProps) {
  const platforms = phaseOnePlatforms(channel);
  const [notes, setNotes] = useState<Record<string, { text: string; token?: boolean }>>({});
  const [shopFor, setShopFor] = useState<string | null>(null);
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const status = (platform: string) => V.connStateByName(platformName(platform));
  const connectedN = platforms.filter((p) => status(p) === "ok").length;

  async function connect(platform: string, shopDomain?: string) {
    if (platform === "shopify" && !shopDomain) {
      setShopFor(platform);
      return;
    }
    setBusy(platform);
    try {
      const r = await onConnect(platform, shopDomain);
      if (r.kind === "redirect") {
        setNotes((n) => ({ ...n, [platform]: { text: "Taking you to their sign-in…" } }));
        return; // the browser is leaving
      }
      if (r.kind === "fallback") setNotes((n) => ({ ...n, [platform]: { text: CONNECT_STEP_COPY.notSwitchedOn, token: true } }));
      else if (r.kind === "signIn") setNotes((n) => ({ ...n, [platform]: { text: CONNECT_STEP_COPY.signIn } }));
      else if (r.kind === "shop") setShopFor(platform);
      else setNotes((n) => ({ ...n, [platform]: { text: `${CONNECT_STEP_COPY.failed} (${r.message})` } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <GuidedShell active={7}>
      <div style={stepLabel}>Step 7 · Your data</div>
      <h2 style={stepH2}>Connect your data</h2>
      <UncLine>
        Your plan starts with <strong>{channel}</strong>. {platforms.length === 1 ? "This is the only thing" : "These are the only things"} I need to read for it — nothing else until the plan asks. I read, I never write.
      </UncLine>
      <div data-testid="connect-cards" style={{ display: "grid", gridTemplateColumns: platforms.length > 1 ? "1fr 1fr" : "1fr", gap: 12, marginTop: 20 }}>
        {platforms.map((platform) => {
          const st = status(platform);
          const ok = st === "ok";
          const expired = st === "expired";
          const note = notes[platform];
          return (
            <div key={platform} data-testid={`connect-card-${platform}`} data-status={st} style={{ background: "white", border: `1.5px solid ${ok ? "oklch(0.78 0.13 220)" : "var(--card-border-2)"}`, borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{platformName(platform)}</span>
                {ok && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "4px 10px" }}>Connected ✓</span>}
                {expired && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--amber-text)", background: "var(--amber-wash)", borderRadius: 999, padding: "4px 10px" }}>Needs reconnect</span>}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 6, lineHeight: 1.5 }}>
                {ok ? CONNECT_STEP_COPY.connected : note ? note.text : "Read-only. I list every scope before you approve."}
              </div>
              {!ok && shopFor === platform && (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <input value={shop} onChange={(e) => setShop(e.target.value)} placeholder={CONNECT_STEP_COPY.shopPrompt} aria-label="Shop domain" style={{ ...textInput, flex: 1 }} />
                  <button onClick={() => void connect(platform, shop.trim())} disabled={busy === platform || !shop.trim()} className="btn-navy" style={{ padding: "8px 16px", fontSize: 12.5 }}>
                    Connect
                  </button>
                </div>
              )}
              {!ok && shopFor !== platform && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                  {!note?.token && (
                    <button onClick={() => void connect(platform)} disabled={busy === platform} className="btn-navy" style={{ padding: "8px 18px", fontSize: 12.5 }}>
                      {busy === platform ? "Starting…" : expired ? "Reconnect" : "Connect"}
                    </button>
                  )}
                  {note?.token && (
                    <button onClick={() => onTokenLink(platform)} className="hov-underline" data-testid={`token-link-${platform}`} style={{ border: "none", background: "transparent", padding: 0, fontSize: 12.5, fontWeight: 600, color: "var(--cyan-link)", cursor: "pointer" }}>
                      {CONNECT_STEP_COPY.withToken} →
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28 }}>
        <button onClick={onLater} data-testid="connect-later" className="hov-fg-ink" style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
          {CONNECT_STEP_COPY.later}
        </button>
        <button onClick={onContinue} disabled={connectedN === 0} data-testid="connect-continue" className="btn-navy" style={{ padding: "11px 26px", fontSize: 13.5, fontWeight: 600, opacity: connectedN === 0 ? 0.45 : 1 }}>
          Continue →
        </button>
      </div>
    </GuidedShell>
  );
}
