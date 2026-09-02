"use client";

import { useEffect, useRef } from "react";
import { derive } from "@/lib/platform/derive";
import { useUncChat } from "@/lib/unc/useUncChat";
import { useAccountPersistence } from "@/lib/db/useAccountPersistence";
import { usePlatformState } from "./usePlatformState";
import { useLiveApprovals } from "./useLiveApprovals";
import { useHomeTelemetry } from "./useHomeTelemetry";
import Sidebar from "./Sidebar";
import Onboarding from "./Onboarding";
import HomeView from "./HomeView";
import StrategyView from "./StrategyView";
import RoutinesView from "./RoutinesView";
import ConnectorsView from "./ConnectorsView";
import CornerBuddy from "./CornerBuddy";
import Paywall from "./Paywall";
import BillingBanner from "./BillingBanner";
import { isOpen } from "@/lib/billing/gate";
import type { BillingProps } from "@/lib/billing/server";

/** `billing` comes from the /app server component (src/lib/billing/server.ts); null or
    configured=false ⇒ demo — no paywall, no plan line, exactly as before Phase 6. */
export default function Platform({ billing = null }: { billing?: BillingProps | null }) {
  const { S, set } = usePlatformState();
  const gated = billing?.configured ? billing.entitlement : null;
  const uncSend = useUncChat(S, set);
  const V = derive(S, set, undefined, uncSend);
  /* Phase 2: a no-op in demo mode (no Supabase env); with an account it hydrates on mount
     and autosaves every change (debounced). */
  const persistence = useAccountPersistence(S, set);
  /* Accounts mode: the "needs you" list, receipts and drafts come from the runtime
     (GET /api/approvals). Demo mode: never fetched — the demo cards stay exactly as they are. */
  const inAccount = persistence.mode === "account" && !!persistence.accountId;
  const live = useLiveApprovals(inAccount);
  /* Accounts mode: Unc's self-review, "The bar" and hours saved from the improvement loops
     (GET /api/telemetry/home). Demo mode: never fetched — the demo values stay verbatim. */
  const telemetry = useHomeTelemetry(inAccount);
  const runTarget = { accountId: inAccount ? persistence.accountId! : "demo", account: { currency: S.currency, budgetMonthly: S.budgetMo }, persisted: inAccount };

  /* Corner-buddy scroll-spy — port of the prototype's _buddyTick/_buddyScroll:
     the topmost [data-buddy] section whose rect crosses 55% viewport height wins. */
  const rafRef = useRef(0);
  useEffect(() => {
    const tick = () => {
      const els = Array.from(document.querySelectorAll("[data-buddy]"));
      let txt = "";
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.55 && r.bottom > 80) txt = el.getAttribute("data-buddy") || "";
      }
      set((s) => (txt !== s.buddyText ? { buddyText: txt } : {}));
    };
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        tick();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const t0 = setTimeout(tick, 400);
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimeout(t0);
    };
  }, [set]);

  /* Re-run the spy shortly after a view change (new [data-buddy] sections mount). */
  const viewKey = `${S.view}|${S.sel ? S.sel.id : ""}|${S.onboarded ? 1 : 0}`;
  useEffect(() => {
    const t = setTimeout(() => {
      const els = Array.from(document.querySelectorAll("[data-buddy]"));
      let txt = "";
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.55 && r.bottom > 80) txt = el.getAttribute("data-buddy") || "";
      }
      set((s) => (txt !== s.buddyText ? { buddyText: txt } : {}));
    }, 150);
    return () => clearTimeout(t);
  }, [viewKey, set]);

  /* Autoscroll chat threads when a message lands ([data-autoscroll] containers). */
  const msgN = S.messages.length + S.humanThread.length + S.obThread.length;
  useEffect(() => {
    const t = setTimeout(() => {
      document.querySelectorAll("[data-autoscroll]").forEach((el) => {
        el.scrollTop = el.scrollHeight;
      });
    }, 60);
    return () => clearTimeout(t);
  }, [msgN, S.chatOpen, S.chatMode]);

  if (persistence.mode === "connecting") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--cream)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 14 }}>
        Fetching your account…
      </div>
    );
  }

  if (gated && !isOpen(gated)) {
    return <Paywall state={gated.state === "canceled" ? "canceled" : "none"} email={persistence.mode === "account" ? persistence.userEmail : null} />;
  }

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--cream)",
        color: "var(--ink)",
        fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {V.notOnboarding && <Sidebar V={V} account={persistence.mode === "account" ? persistence : null} billing={gated} />}
      <main style={{ flex: 1, minWidth: 0 }}>
        {gated?.state === "past_due" && <BillingBanner />}
        {V.isOnboarding && <Onboarding V={V} />}
        {V.isToday && <HomeView V={V} live={inAccount ? live : null} telemetry={inAccount ? telemetry : null} />}
        {V.isStrategy && <StrategyView V={V} />}
        {V.isConnectors && <ConnectorsView V={V} />}
        {V.isSystems && <RoutinesView V={V} run={runTarget} />}
      </main>
      {V.showBuddy && <CornerBuddy V={V} />}
    </div>
  );
}
