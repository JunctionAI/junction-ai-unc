"use client";

import type { PlatformVals } from "@/lib/platform/derive";
import type { Persistence } from "@/lib/db/useAccountPersistence";

const navBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  border: "none",
  borderRadius: 9,
  fontSize: 13.5,
  fontWeight: 500,
  color: "var(--on-navy)",
  cursor: "pointer",
  textAlign: "left",
};

const dot = (bg: string): React.CSSProperties => ({ width: 7, height: 7, borderRadius: "50%", background: bg });

const SAVE_LABEL: Record<Persistence["autosave"], string> = { idle: "Saved", pending: "Saving…", saving: "Saving…", saved: "Saved", error: "Not saved — retrying" };

/** `account` is null in demo mode (no Supabase env / no session) and the sidebar renders exactly as Phase 1. */
export default function Sidebar({ V, account = null }: { V: PlatformVals; account?: Persistence | null }) {
  return (
    <aside
      style={{
        width: 236,
        flex: "none",
        background: "var(--navy)",
        color: "var(--on-navy)",
        display: "flex",
        flexDirection: "column",
        padding: "24px 16px 20px",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 8px" }}>
        <img src="/brand/mascot-small.png" alt="Junction" style={{ width: 42, height: 45, objectFit: "contain" }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "0.01em" }}>Junction</div>
          <div style={{ fontSize: 10, color: "var(--on-navy-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Growth agent</div>
        </div>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 32 }}>
        <button onClick={V.goToday} className="hov-bg-navylift" style={{ ...navBtn, background: V.todayBg }}>
          <span style={dot(V.todayDot)}></span>Home
        </button>
        <button onClick={V.goStrategy} className="hov-bg-navylift" style={{ ...navBtn, background: V.strategyBg }}>
          <span style={dot(V.strategyDot)}></span>Strategy
        </button>
        <button onClick={V.goSystems} className="hov-bg-navylift" style={{ ...navBtn, background: V.systemsBg }}>
          <span style={dot(V.systemsDot)}></span>Routines <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--on-navy-dim)" }}>{V.libTotal}</span>
        </button>
        <button onClick={V.goConnectors} className="hov-bg-navylift" style={{ ...navBtn, background: V.connectorsBg }}>
          <span style={dot(V.connectorsDot)}></span>Connectors
        </button>
      </nav>
      <div style={{ flex: 1 }}></div>
      <div style={{ padding: "0 8px" }}>
        <button
          onClick={V.goConnectors}
          className="hov-fg-onnavy"
          style={{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 12, color: "oklch(0.82 0.03 250)", lineHeight: 1.6 }}
        >
          {V.connSummary} →
        </button>
        {account ? (
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid oklch(0.34 0.05 262)", fontSize: 10, lineHeight: 1.6, color: "var(--faint-on-navy)" }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.userEmail ?? "Signed in"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: account.autosave === "error" ? "var(--amber)" : "var(--faint-on-navy)" }}>{SAVE_LABEL[account.autosave]}</span>
              <span>·</span>
              <form action="/auth/signout" method="post" style={{ display: "inline" }}>
                <button type="submit" className="hov-fg-onnavy" style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10, color: "var(--faint-on-navy)" }}>
                  Sign out
                </button>
              </form>
            </div>
            <div style={{ marginTop: 6 }}>No live connectors or outward actions.</div>
          </div>
        ) : (
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid oklch(0.34 0.05 262)", fontSize: 10, lineHeight: 1.6, color: "var(--faint-on-navy)" }}>
            Demonstration data.
            <br />
            No live connectors or outward actions.
          </div>
        )}
      </div>
    </aside>
  );
}
