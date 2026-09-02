"use client";
/* Guided step 2 — "Connect your data" (accounts mode, right after "Agree the plan →").

   Same centred-card grammar as onboarding, with the progress dots continuing (steps 7 and 8
   of 9). Cards for the FOUNDER'S OWN platforms only (src/lib/setup/channels.ts suggestPlatforms):
   what they picked in onboarding (known_platforms) first, then what the scan spotted on their
   site ("I spotted this on your site") — never a card because a table said so, never Shopify for
   a business with no store. When phase 1 is Email and nothing says how email is sent, one honest
   question ("Which tool sends your email?") — the answer becomes a memory + known_platforms, and
   "none yet" is a fine answer. Each card's real state comes from connState (the connectors
   table's projection); "Connect" delegates to the connectors module's start path through
   `onConnect` (Platform.tsx → src/lib/setup/connect.ts). When the platform isn't switched on yet
   the card says so and offers "Connect with a token", a link into the Connectors view. "I'll do
   this later" records an honest later state. Idempotent on refresh: the step re-renders from
   persisted state, nothing replays. */

import React, { useState } from "react";
import type { PlatformVals } from "@/lib/platform/derive";
import { CONNECT_STEP_COPY, type ConnectStart } from "@/lib/setup/connect";
import { EMAIL_QUESTION, EMAIL_TOOL_LABEL, emailQuestionNeeded, emailToolFrom, platformName, suggestPlatforms, SUGGESTION_COPY, type EmailToolAnswer } from "@/lib/setup/channels";
import { CONNECTOR_PLATFORMS } from "@/lib/db/mapping";
import type { ChannelKey } from "@/lib/platform/plan";

export const GUIDED_DOTS = 9; // 7 onboarding steps + connect + routine

const stepLabel: React.CSSProperties = { fontSize: 10.5, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--cyan-link)", fontWeight: 700 };
const stepH2: React.CSSProperties = { fontWeight: 600, fontSize: 26, margin: "10px 0 0", letterSpacing: "-0.015em" };
const textInput: React.CSSProperties = { border: "1px solid var(--input-border)", borderRadius: 10, padding: "9px 12px", fontSize: 13, outline: "none", background: "white", color: "var(--ink)" };
const chip: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", background: "oklch(0.96 0.01 260)", borderRadius: 999, padding: "3px 8px" };

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

export const CONNECT_DATA_COPY = {
  /** No picks, nothing spotted: Unc asks rather than guessing. */
  nothingToOffer: "You haven't named a tool yet and I didn't spot one on your site — so there's nothing to connect. I'll draft from your site and what you tell me; add a tool on Connectors whenever you like.",
  emailNone: "No email tool yet — fine. I'll start with the routines that earn a list, and the email ones wait until there is one.",
  emailMailchimp: "Mailchimp isn't a connector I can read yet. I'll draft your email from your site and what you tell me, and say the moment I can read it.",
  readOnly: "Read-only. I list every scope before you approve.",
} as const;

export const EMAIL_OPTIONS: EmailToolAnswer[] = ["klaviyo", "mailchimp", "none"];

export interface ConnectDataStepProps {
  V: PlatformVals;
  channel: ChannelKey;
  /** Starts the platform's connect flow; the browser leaves on "redirect". */
  onConnect: (platform: string, shop?: string) => Promise<ConnectStart>;
  onContinue: () => void;
  onLater: () => void;
  /** "Connect with a token" → the Connectors view (leaves the guided flow; the Home card carries on). */
  onTokenLink: (platform: string) => void;
  /** The email question's answer → known_platforms + a memory (Platform.tsx). */
  onEmailAnswer?: (answer: EmailToolAnswer) => void | Promise<void>;
}

export default function ConnectDataStep({ V, channel, onConnect, onContinue, onLater, onTokenLink, onEmailAnswer }: ConnectDataStepProps) {
  const knownPlatforms = V.obNarrativeRequest.resources.platforms;
  const spotted = V.obScan.profile?.platformsSpotted ?? [];
  const connectedSlugs = Object.entries(CONNECTOR_PLATFORMS)
    .filter(([name]) => V.connStateByName(name) === "ok")
    .map(([, slug]) => slug);
  const suggestions = suggestPlatforms({ channel, knownPlatforms, spotted });
  const askEmail = emailQuestionNeeded({ channel, knownPlatforms, spotted, connected: connectedSlugs });
  const emailAnswer = emailToolFrom(knownPlatforms);
  const [notes, setNotes] = useState<Record<string, { text: string; token?: boolean }>>({});
  const [shopFor, setShopFor] = useState<string | null>(null);
  const [shop, setShop] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const status = (platform: string) => V.connStateByName(platformName(platform));
  const connectedN = suggestions.filter((s) => status(s.platform) === "ok").length;
  const canContinue = connectedN > 0 || suggestions.length === 0;

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

  const intro = (() => {
    const picked = suggestions.filter((s) => s.source === "picked").length;
    const found = suggestions.length - picked;
    if (!suggestions.length) return "";
    const what = picked && found ? "the tools you told me about, plus what I spotted on your site" : picked ? (picked === 1 ? "the tool you told me you use" : "the tools you told me you use") : found === 1 ? "the one tool I spotted on your site" : "the tools I spotted on your site";
    return `These are ${what} — nothing else until the plan asks. I read, I never write.`;
  })();

  return (
    <GuidedShell active={7}>
      <div style={stepLabel}>Step 7 · Your data</div>
      <h2 style={stepH2}>Connect your data</h2>
      <UncLine>
        Your plan starts with <strong>{channel}</strong>. {intro || CONNECT_DATA_COPY.nothingToOffer}
      </UncLine>
      {askEmail && (
        <div data-testid="email-question" style={{ marginTop: 18, background: "white", border: "1.5px solid var(--card-border-2)", borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{EMAIL_QUESTION}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 4, lineHeight: 1.5 }}>Phase 1 is email, and nothing on your site told me. One honest answer — none yet is fine.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {EMAIL_OPTIONS.map((opt) => (
              <button key={opt} data-testid={`email-answer-${opt}`} onClick={() => void onEmailAnswer?.(opt)} className="hov-border-cyan" style={{ border: "1.5px solid oklch(0.87 0.015 260)", background: "white", color: "oklch(0.4 0.04 262)", borderRadius: 999, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                {EMAIL_TOOL_LABEL[opt]}
              </button>
            ))}
          </div>
        </div>
      )}
      {!askEmail && emailAnswer === "none" && channel === "Email & SMS" && (
        <div data-testid="email-answer-line" style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 12, lineHeight: 1.5 }}>
          {CONNECT_DATA_COPY.emailNone}
        </div>
      )}
      {!askEmail && emailAnswer === "mailchimp" && channel === "Email & SMS" && (
        <div data-testid="email-answer-line" style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 12, lineHeight: 1.5 }}>
          {CONNECT_DATA_COPY.emailMailchimp}
        </div>
      )}
      <div data-testid="connect-cards" style={{ display: "grid", gridTemplateColumns: suggestions.length > 1 ? "1fr 1fr" : "1fr", gap: 12, marginTop: 20 }}>
        {suggestions.map(({ platform, source, evidence }) => {
          const st = status(platform);
          const ok = st === "ok";
          const expired = st === "expired";
          const note = notes[platform];
          return (
            <div key={platform} data-testid={`connect-card-${platform}`} data-status={st} data-source={source} style={{ background: "white", border: `1.5px solid ${ok ? "oklch(0.78 0.13 220)" : "var(--card-border-2)"}`, borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{platformName(platform)}</span>
                {ok && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "4px 10px" }}>Connected ✓</span>}
                {expired && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--amber-text)", background: "var(--amber-wash)", borderRadius: 999, padding: "4px 10px" }}>Needs reconnect</span>}
              </div>
              <div style={{ marginTop: 6 }}>
                <span data-testid={`connect-source-${platform}`} title={evidence} style={chip}>
                  {source === "spotted" ? SUGGESTION_COPY.spotted : SUGGESTION_COPY.picked}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 6, lineHeight: 1.5 }}>
                {ok ? CONNECT_STEP_COPY.connected : note ? note.text : source === "spotted" && evidence ? `${evidence[0].toUpperCase()}${evidence.slice(1)}. ${CONNECT_DATA_COPY.readOnly}` : CONNECT_DATA_COPY.readOnly}
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
        {suggestions.length ? (
          <button onClick={onLater} data-testid="connect-later" className="hov-fg-ink" style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
            {CONNECT_STEP_COPY.later}
          </button>
        ) : (
          <button onClick={() => onTokenLink("")} data-testid="connect-add-tool" className="hov-fg-ink" style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
            Add a tool on Connectors →
          </button>
        )}
        <button onClick={onContinue} disabled={!canContinue} data-testid="connect-continue" className="btn-navy" style={{ padding: "11px 26px", fontSize: 13.5, fontWeight: 600, opacity: canContinue ? 1 : 0.45 }}>
          Continue →
        </button>
      </div>
    </GuidedShell>
  );
}
