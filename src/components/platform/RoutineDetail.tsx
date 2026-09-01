"use client";

import React from "react";
import type { PlatformVals } from "@/lib/platform/derive";

const contractCard: React.CSSProperties = { background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "17px 19px" };
const contractLabel: React.CSSProperties = { fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 };

export default function RoutineDetail({ V }: { V: PlatformVals }) {
  return (
    <>
      <button
        data-buddy="Every step here is inspectable. Nothing runs outside these bounds."
        onClick={V.closeSys}
        className="hov-underline"
        style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: 0 }}
      >
        ← All routines
      </button>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginTop: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--cyan-link)" }}>
            {V.selId} · {V.selCat}
          </div>
          <h1 style={{ fontWeight: 600, fontSize: 26, margin: "8px 0 0", letterSpacing: "-0.015em" }}>{V.selName}</h1>
        </div>
        <span style={{ flex: "none", fontSize: 11, fontWeight: 600, color: V.selStateColor, background: V.selStateBg, borderRadius: 6, padding: "5px 11px", marginTop: 6 }}>{V.selState}</span>
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.6, color: "oklch(0.4 0.04 262)", marginTop: 12, maxWidth: 640 }}>{V.selPurpose}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 28 }}>
        <div style={contractCard}>
          <div style={contractLabel}>Trigger &amp; cadence</div>
          <div style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>{V.selCadence}</div>
        </div>
        <div style={contractCard}>
          <div style={contractLabel}>Write mode</div>
          <div style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>{V.selMode}</div>
        </div>
        <div style={contractCard}>
          <div style={contractLabel}>KPI</div>
          <div style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>{V.selKpi}</div>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>Workflow</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>— click a step to inspect and edit it</span>
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: V.wfVerColor, background: V.wfVerBg, borderRadius: 6, padding: "4px 10px" }}>{V.wfVersion}</span>
        </div>
        <div
          style={{
            border: "1px solid var(--card-border)",
            borderRadius: 14,
            padding: "26px 20px",
            overflowX: "auto",
            backgroundColor: "white",
            backgroundImage: "radial-gradient(oklch(0.92 0.008 260) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {V.wfNodes.map((n) => (
              <React.Fragment key={n.tag}>
                <button onClick={n.pick} style={{ flex: "none", width: 128, textAlign: "left", background: "white", border: `1.5px solid ${n.border}`, borderRadius: 11, padding: "11px 12px", cursor: "pointer", boxShadow: n.shadow }}>
                  <div style={{ fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: n.tagColor, fontWeight: 700 }}>{n.tag}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4, color: "var(--ink)" }}>{n.name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>{n.desc}</div>
                </button>
                {n.hasNext && (
                  <div style={{ width: 30, height: 2, background: "oklch(0.8 0.02 260)", position: "relative", flex: "none" }}>
                    <div style={{ position: "absolute", right: -1, top: -3, width: 0, height: 0, borderLeft: "6px solid oklch(0.8 0.02 260)", borderTop: "4px solid transparent", borderBottom: "4px solid transparent" }}></div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 12, background: "white", border: "1px solid var(--card-border)", borderRadius: 14, padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: V.inspColor, fontWeight: 700, border: "1px solid var(--card-border)", borderRadius: 5, padding: "3px 8px" }}>{V.inspTag}</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{V.inspName}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 14 }}>
            {V.inspParams.map((pp) => (
              <label key={pp.k} style={{ display: "block" }}>
                <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>{pp.k}</span>
                <input
                  value={pp.v}
                  onChange={pp.set}
                  style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--card-border-2)", borderRadius: 8, padding: "8px 11px", fontSize: 13, outline: "none", background: "oklch(0.985 0.003 90)", color: "var(--ink)" }}
                />
              </label>
            ))}
          </div>
          {V.wfDraft && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, background: "var(--amber-wash)", borderRadius: 10, padding: "12px 16px", flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, color: "oklch(0.4 0.1 70)", lineHeight: 1.5, flex: 1, minWidth: 260 }}>{V.wfDraftMsg}</div>
              {V.wfCanValidate && (
                <button onClick={V.wfValidate} className="btn-navy" style={{ flex: "none", padding: "8px 17px", fontSize: 12.5, fontWeight: 600 }}>
                  Run dry-run validation
                </button>
              )}
              {V.wfValidated && (
                <button onClick={V.wfPromote} className="btn-cyan" style={{ flex: "none", padding: "8px 17px", fontSize: 12.5, fontWeight: 700 }}>
                  Promote to production
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10, background: "var(--cyan-wash)", borderRadius: 13, padding: "16px 20px" }}>
        <img src="/brand/mascot-small.png" alt="" style={{ width: 38, height: 41, objectFit: "contain", flex: "none" }} />
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "oklch(0.3 0.06 262)" }}>
          Every run writes a receipt: what was read, prepared, changed and learned. Consequential actions wait for your approval until you graduate them.
        </div>
        {V.setupIdle && (
          <button onClick={V.openSetup} className="btn-navy" style={{ flex: "none", marginLeft: "auto", padding: "9px 18px", fontSize: 12.5, fontWeight: 600 }}>
            Set this up
          </button>
        )}
      </div>

      {V.setupOn && (
        <div style={{ marginTop: 14, background: "white", border: "1.5px solid oklch(0.78 0.13 220 / 0.5)", borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--cyan-text)", fontWeight: 600 }}>Set up {V.selName}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>— {V.setupProgress}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
            {V.setupSteps.map((ss) => (
              <div key={ss.title} style={{ display: "flex", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 24, flex: "none" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: ss.cBg, color: ss.cFg, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{ss.mark}</div>
                  {ss.line && <div style={{ width: 2, flex: 1, minHeight: 14, background: "var(--card-border)" }}></div>}
                </div>
                <div style={{ flex: 1, paddingBottom: 18, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: ss.tColor }}>{ss.title}</div>
                  {ss.active && (
                    <>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 9 }}>
                        {ss.items.map((it) => (
                          <span key={it.t} style={{ fontSize: 12, border: `1px solid ${it.border}`, color: it.color, background: it.bg, borderRadius: 999, padding: "5px 12px" }}>
                            {it.t}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 9, lineHeight: 1.5 }}>{ss.note}</div>
                      <button onClick={ss.next} className="btn-navy" style={{ marginTop: 11, padding: "8px 17px", fontSize: 12.5, fontWeight: 600 }}>
                        {ss.cta}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {V.setupDone && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, background: "var(--cyan-wash)", borderRadius: 13, padding: "14px 18px", fontSize: 13, color: "oklch(0.35 0.08 240)", fontWeight: 500 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan-link)", animation: "jpulse 1.6s infinite" }}></span>
          Dry run scheduled tonight — zero outward actions. The result and receipt land in Home tomorrow morning.
        </div>
      )}
    </>
  );
}
