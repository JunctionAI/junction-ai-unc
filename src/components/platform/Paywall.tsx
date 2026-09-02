"use client";
/* The paywall — shown instead of the control centre when billing is configured and the
   account has no live subscription ('none' / 'canceled'). Same card language as /login;
   pricing copy verbatim from the landing page (src/lib/billing/plan.ts). */

import { useState } from "react";
import { startCheckout } from "@/lib/billing/clientActions";
import { PLAN_COPY } from "@/lib/billing/plan";

const HEADLINE: Record<"none" | "canceled", { title: string; sub: string }> = {
  none: { title: "Ready when you are.", sub: "Start the trial and I get to work on your goal today. A card gets things moving — nothing is charged for 14 days." },
  canceled: { title: "Your plan ended.", sub: "Everything you agreed with me is still here. Start again and I pick up where we left off." },
};

export default function Paywall({ state, email = null }: { state: "none" | "canceled"; email?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const h = HEADLINE[state];

  const go = async () => {
    setBusy(true);
    setError(null);
    const err = await startCheckout();
    if (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--cream)",
        color: "var(--ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22, padding: "0 6px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mascot-small.png" alt="Unc" style={{ width: 52, height: 56, objectFit: "contain" }} />
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>{h.title}</h1>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--ink-soft)", margin: "4px 0 0" }}>{h.sub}</p>
          </div>
        </div>

        <div
          style={{
            background: "white",
            border: "1.5px solid oklch(0.78 0.13 220 / 0.5)",
            borderRadius: 22,
            padding: "40px 44px",
            textAlign: "center",
            boxShadow: "0 18px 50px oklch(0.27 0.055 262 / 0.1)",
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--cyan-text)", fontWeight: 600 }}>{PLAN_COPY.label}</div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 6, marginTop: 16 }}>
            <span style={{ fontSize: 54, fontWeight: 700, letterSpacing: "-0.03em" }}>{PLAN_COPY.price}</span>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>{PLAN_COPY.priceSuffix}</span>
          </div>
          <div style={{ display: "inline-block", fontSize: 12.5, fontWeight: 700, color: "oklch(0.22 0.05 262)", background: "var(--cyan)", borderRadius: 999, padding: "6px 16px", marginTop: 12 }}>
            {PLAN_COPY.trialBadge}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 24, fontSize: 13.5, color: "oklch(0.4 0.04 262)", textAlign: "left", maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
            {PLAN_COPY.checklist.map((t) => (
              <div key={t} style={{ display: "flex", gap: 9 }}>
                <span style={{ color: "var(--cyan-link)", fontWeight: 700 }}>✓</span>
                {t}
              </div>
            ))}
          </div>
          <button className="btn-navy" onClick={go} disabled={busy} style={{ marginTop: 28, padding: "13px 32px", fontSize: 14.5, opacity: busy ? 0.7 : 1 }}>
            {busy ? "Opening secure checkout…" : PLAN_COPY.cta}
          </button>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12 }}>{PLAN_COPY.cancel}</div>
          {error && (
            <div style={{ background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.5, marginTop: 16, textAlign: "left" }}>{error}</div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 18, fontSize: 11.5, color: "var(--muted)" }}>
          {email && <span>{email}</span>}
          {email && <span>·</span>}
          <form action="/auth/signout" method="post" style={{ display: "inline" }}>
            <button type="submit" className="hov-fg-ink" style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 11.5, color: "var(--muted)" }}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
