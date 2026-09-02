"use client";

import type { PlatformVals } from "@/lib/platform/derive";
import type { Persistence } from "@/lib/db/useAccountPersistence";
import type { Entitlement } from "@/lib/billing/gate";
import { openPortal } from "@/lib/billing/clientActions";

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

/** Sidebar plan line — only rendered when billing is configured (Phase 6). */
function planLine(e: Entitlement): { text: string; action: string } | null {
  switch (e.state) {
    case "trialing":
      return { text: `Trial · ${e.trialDaysLeft ?? 0} ${e.trialDaysLeft === 1 ? "day" : "days"} left`, action: "manage" };
    case "active":
      return { text: e.cancelAtPeriodEnd && e.periodEnd ? `Plan · ends ${e.periodEnd.slice(0, 10)}` : "Plan · active", action: "manage" };
    case "past_due":
      return { text: "Plan · payment failed", action: "Update card" };
    default:
      return null;
  }
}

/** `account` is null in demo mode (no Supabase env / no session) and the sidebar renders exactly as Phase 1.
    `billing` is null unless billing is configured; then it adds the plan/trial line.
    `onModels` (DB mode only) opens the "Models" settings — which brain for which job. */
export default function Sidebar({ V, account = null, billing = null, onModels }: { V: PlatformVals; account?: Persistence | null; billing?: Entitlement | null; onModels?: () => void }) {
  const plan = billing ? planLine(billing) : null;
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
              {onModels && (
                <>
                  <button type="button" onClick={onModels} className="hov-fg-onnavy" style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10, color: "var(--faint-on-navy)" }}>
                    Models
                  </button>
                  <span>·</span>
                </>
              )}
              <form action="/auth/signout" method="post" style={{ display: "inline" }}>
                <button type="submit" className="hov-fg-onnavy" style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10, color: "var(--faint-on-navy)" }}>
                  Sign out
                </button>
              </form>
            </div>
            {plan && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: billing?.state === "past_due" ? "var(--amber)" : "var(--faint-on-navy)" }}>
                <span>{plan.text}</span>
                <span>·</span>
                <button type="button" onClick={() => void openPortal()} className="hov-fg-onnavy" style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10, color: "inherit" }}>
                  {plan.action}
                </button>
              </div>
            )}
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
