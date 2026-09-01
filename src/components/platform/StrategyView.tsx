"use client";

import type { PlatformVals } from "@/lib/platform/derive";

export default function StrategyView({ V }: { V: PlatformVals }) {
  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "50px 48px 96px" }}>
      <div
        data-buddy="We agree the strategy once — then the routines carry it. Your job becomes clearing agreed work, not remembering it."
        style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}
      >
        <h1 style={{ fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: "-0.015em" }}>Strategy</h1>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>agreed 12 Aug · reviewed monthly · persists until superseded</div>
      </div>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8, maxWidth: 600, lineHeight: 1.55 }}>
        The macro play, shaped around how you add the most value. Junction holds it, derives every routine from it, and comes to you with agreed work — never a daily scramble.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 26 }}>
        {V.postures.map((po) => (
          <button
            key={po.label}
            onClick={po.pick}
            className="hov-border-cyan"
            style={{ textAlign: "left", background: "white", border: `1.5px solid ${po.border}`, borderRadius: 14, padding: "18px 19px", cursor: "pointer", boxShadow: po.shadow }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--cyan-link)", fontWeight: 700 }}>{po.tag}</span>
              {po.selected && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 5, padding: "2px 7px" }}>YOURS</span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8, color: "var(--ink)" }}>{po.label}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 5, lineHeight: 1.5 }}>{po.thesis}</div>
            <div style={{ fontSize: 11.5, color: "var(--cyan-text)", marginTop: 8, fontWeight: 500 }}>{po.fit}</div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 14, background: "var(--navy)", color: "var(--on-navy)", borderRadius: 16, padding: "22px 26px", display: "flex", gap: 20, alignItems: "flex-start" }}>
        <img src="/brand/mascot-small.png" alt="" style={{ width: 56, height: 60, objectFit: "contain", flex: "none" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--on-navy-dim)", fontWeight: 600 }}>Why this is yours</div>
          <div style={{ fontSize: 14.5, lineHeight: 1.6, marginTop: 9, color: "oklch(0.93 0.012 250)" }}>{V.postureWhy}</div>
          <div style={{ fontSize: 12, color: "var(--faint-on-navy)", marginTop: 12 }}>Shaped by your budget, hours and strengths from onboarding — tell me when they change.</div>
        </div>
      </div>
      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>The build-out</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>— unlocks on evidence, not optimism</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {V.phases.map((ph) => (
            <div key={ph.n} style={{ background: "white", border: `1px solid ${ph.border}`, borderRadius: 14, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: ph.nBg, color: ph.nFg, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  {ph.n}
                </span>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{ph.name}</span>
                <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 600, color: ph.stColor, background: ph.stBg, borderRadius: 5, padding: "3px 8px" }}>{ph.st}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--cyan-link)", fontWeight: 500, marginTop: 11 }}>
                {ph.count} routines ·{" "}
                <button
                  onClick={ph.goRoutines}
                  style={{ border: "none", background: "transparent", padding: 0, color: "var(--cyan-link)", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
                >
                  manage
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 11, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, color: "oklch(0.4 0.04 262)" }}>From you:</span> {ph.you}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 28, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: 640 }}>
        Over time the build-out grows past routines: specialist agents under Junction, then people where judgement and relationships win. Same strategy, same receipts, bigger organization.
      </div>
    </div>
  );
}
