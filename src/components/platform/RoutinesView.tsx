"use client";

import type { PlatformVals } from "@/lib/platform/derive";
import RoutineDetail from "./RoutineDetail";

export default function RoutinesView({ V }: { V: PlatformVals }) {
  return (
    <div style={{ maxWidth: 1020, margin: "0 auto", padding: "50px 48px 96px" }}>
      {V.noSel && (
        <>
          {V.catAll && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <h1 style={{ fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: "-0.015em" }}>Routines</h1>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>pick a role · switch things on and off inside</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 26 }}>
                {V.catCards.map((cc2) => (
                  <button key={cc2.name} onClick={cc2.open} className="hov-card-cyan" style={{ textAlign: "left", background: "white", border: "1px solid var(--card-border)", borderRadius: 16, padding: 22, cursor: "pointer" }}>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{cc2.name}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 5 }}>{cc2.tagline}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--cyan-text)", marginTop: 14 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)" }}></span>
                      {cc2.onLabel}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {V.catOne && (
            <>
              <button onClick={V.backToCats} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: 0 }}>
                ← All roles
              </button>
              <h1 style={{ fontWeight: 600, fontSize: 28, margin: "16px 0 0", letterSpacing: "-0.015em" }}>{V.selCatName}</h1>
              <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 6 }}>{V.selCatTag}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 26, maxWidth: 720 }}>
                {V.channelRows.map((cr) => (
                  <div key={cr.name} style={{ display: "flex", alignItems: "center", gap: 16, background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 20px" }}>
                    <button
                      onClick={cr.toggle}
                      title="On / off"
                      style={{ flex: "none", width: 40, height: 23, borderRadius: 999, border: "none", background: cr.togBg, position: "relative", cursor: "pointer", transition: "background 0.25s" }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: 2.5,
                          left: cr.knobLeft,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "white",
                          transition: "left 0.25s",
                          boxShadow: "0 1px 3px oklch(0.3 0.03 262 / 0.3)",
                        }}
                      ></span>
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600 }}>{cr.benefit}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                        {cr.name} · saves ~{cr.saves} h/wk
                      </div>
                    </div>
                    <button onClick={cr.how} className="hov-underline" style={{ flex: "none", border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
                      Tutorial →
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {V.hasSel && <RoutineDetail V={V} />}
    </div>
  );
}
