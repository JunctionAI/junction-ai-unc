"use client";

import type { PlatformVals } from "@/lib/platform/derive";

export default function ConnectorsView({ V }: { V: PlatformVals }) {
  return (
    <div
      data-buddy="Least privilege, always — I list every scope before you approve it. Each connection unlocks more of the library."
      style={{ maxWidth: 940, margin: "0 auto", padding: "50px 48px 96px" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: "-0.015em" }}>Connectors</h1>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{V.connSummary}</div>
      </div>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8, maxWidth: 560, lineHeight: 1.55 }}>
        Exact, least-privilege connections to the systems that hold your source truth. Junction reads what each workflow needs — nothing more — and every credential lives in the secret store.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 26 }}>
        {V.connectors.map((cn) => (
          <div key={cn.name} style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 19px", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{cn.name}</span>
                <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{cn.cat}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {cn.note} · unlocks {cn.unlocks} routines
              </div>
            </div>
            {cn.ok && (
              <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--cyan-text)", fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan)" }}></span>Connected
              </span>
            )}
            {cn.expired && (
              <button
                onClick={cn.connect}
                style={{ flex: "none", border: "1px solid oklch(0.8 0.09 75)", background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 999, padding: "7px 15px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Reconnect
              </button>
            )}
            {cn.off && (
              <button onClick={cn.connect} className="btn-navy" style={{ flex: "none", padding: "7px 16px", fontSize: 12, fontWeight: 600 }}>
                Connect
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
