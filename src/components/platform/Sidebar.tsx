"use client";

import { useEffect } from "react";
import type { PlatformVals } from "@/lib/platform/derive";
import type { Persistence } from "@/lib/db/useAccountPersistence";
import type { Entitlement } from "@/lib/billing/gate";
import { openPortal } from "@/lib/billing/clientActions";
import { connectorSummary, enabledCount, publishPersistence, useAccountFacts } from "@/lib/unc/accountFacts";
import DemoBanner from "./DemoBanner";

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

/** Accounts-mode copy under the nav: real connector state, or the honest empty line while the facts load. */
export function accountConnectorLine(facts: Parameters<typeof connectorSummary>[0], loading: boolean): string {
  if (!facts && loading) return "Reading your connections…";
  return connectorSummary(facts);
}

/** `account` is null in demo mode (no Supabase env / no session) and the sidebar renders exactly as Phase 1,
    plus the demo banner over the whole app. In accounts mode the connector line and the routines count
    come from the account's own rows (src/lib/unc/accountFacts.ts) — never the catalog's demo defaults.
    `billing` is null unless billing is configured; then it adds the plan/trial line.
    `onModels` (DB mode only) opens the "Models" settings — which brain for which job.
    `onWhatUncKnows` (DB mode only) opens "What Unc knows" — the founder's view of his memory. */
export default function Sidebar({ V, account = null, billing = null, onModels, onWhatUncKnows }: { V: PlatformVals; account?: Persistence | null; billing?: Entitlement | null; onModels?: () => void; onWhatUncKnows?: () => void }) {
  const plan = billing ? planLine(billing) : null;
  const accountMode = account?.mode ?? null;
  const accountId = account?.accountId ?? null;
  useEffect(() => {
    publishPersistence(accountMode ? { mode: accountMode, accountId } : null);
  }, [accountMode, accountId]);
  const factsState = useAccountFacts();
  const inAccount = !!account || factsState.mode === "account";
  const demo = !account && factsState.mode === "demo";
  const facts = inAccount ? factsState.facts : null;
  const routinesCount = inAccount ? `${enabledCount(facts)} on` : String(V.libTotal);
  const connLine = inAccount ? accountConnectorLine(facts, factsState.loading) : V.connSummary;
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
        top: "var(--demo-banner-h, 0px)",
        height: "calc(100vh - var(--demo-banner-h, 0px))",
      }}
    >
      {demo && <DemoBanner />}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 8px" }}>
        <img src="/brand/mascot-small.png" alt="Junction" style={{ width: 42, height: 45, objectFit: "contain" }} />
        <div style={{ minWidth: 0 }}>
          <div data-testid="sidebar-account-name" style={{ fontWeight: 700, fontSize: 16, letterSpacing: "0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={account?.accountName || undefined}>
            {account?.accountName?.trim() || "Junction"}
          </div>
          <div style={{ fontSize: 10, color: "var(--on-navy-dim)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{account?.accountName?.trim() ? "Junction · Growth agent" : "Growth agent"}</div>
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
          <span style={dot(V.systemsDot)}></span>Routines <span data-testid="sidebar-routines-count" style={{ marginLeft: "auto", fontSize: 11, color: "var(--on-navy-dim)" }}>{routinesCount}</span>
        </button>
        <button onClick={V.goConnectors} className="hov-bg-navylift" style={{ ...navBtn, background: V.connectorsBg }}>
          <span style={dot(V.connectorsDot)}></span>Connectors
        </button>
        {inAccount && (
          <button onClick={V.goChannels} data-testid="sidebar-channels" className="hov-bg-navylift" style={{ ...navBtn, background: V.channelsBg }}>
            <span style={dot(V.channelsDot)}></span>Channels
          </button>
        )}
      </nav>
      <div style={{ flex: 1 }}></div>
      <div style={{ padding: "0 8px" }}>
        <button
          onClick={V.goConnectors}
          className="hov-fg-onnavy"
          data-testid="sidebar-connector-line"
          style={{ border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 12, color: "oklch(0.82 0.03 250)", lineHeight: 1.6 }}
        >
          {connLine} →
        </button>
        {account ? (
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid oklch(0.34 0.05 262)", fontSize: 10, lineHeight: 1.6, color: "var(--faint-on-navy)" }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.userEmail ?? "Signed in"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: account.autosave === "error" ? "var(--amber)" : "var(--faint-on-navy)" }}>{SAVE_LABEL[account.autosave]}</span>
              <span>·</span>
              {onWhatUncKnows && (
                <>
                  <button type="button" onClick={onWhatUncKnows} className="hov-fg-onnavy" style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 10, color: "var(--faint-on-navy)" }}>
                    What Unc knows
                  </button>
                  <span>·</span>
                </>
              )}
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
            <div style={{ marginTop: 6 }}>Nothing sends or spends without your okay.</div>
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
