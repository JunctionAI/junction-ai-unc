"use client";

import { useEffect, useRef, useState } from "react";
import { derive } from "@/lib/platform/derive";
import { useUncChat } from "@/lib/unc/useUncChat";
import { useAccountPersistence } from "@/lib/db/useAccountPersistence";
import { useAccountFacts } from "@/lib/unc/accountFacts";
import { usePlatformState } from "./usePlatformState";
import { useLiveApprovals } from "./useLiveApprovals";
import { useHomeTelemetry } from "./useHomeTelemetry";
import { useOnboardingMemories } from "./useOnboardingMemories";
import { useSetupProgress } from "@/lib/setup/useSetupProgress";
import { startConnect } from "@/lib/setup/connect";
import { turnOnRoutine } from "@/lib/setup/routine";
import { phaseChannels } from "@/lib/setup/home";
import type { SetupAnchor } from "@/lib/setup/progress";
import Sidebar from "./Sidebar";
import ConnectDataStep from "./ConnectDataStep";
import FirstRoutineStep from "./FirstRoutineStep";
import ConnectChannelStep from "./ConnectChannelStep";
import Onboarding from "./Onboarding";
import HomeView from "./HomeView";
import StrategyView from "./StrategyView";
import RoutinesView from "./RoutinesView";
import ConnectorsView from "./ConnectorsView";
import ChannelsSettings from "./ChannelsSettings";
import CornerBuddy from "./CornerBuddy";
import Paywall from "./Paywall";
import BillingBanner from "./BillingBanner";
import ModelSettings from "./ModelSettings";
import WhatUncKnows from "./WhatUncKnows";
import { isOpen } from "@/lib/billing/gate";
import type { BillingProps } from "@/lib/billing/server";

/** `billing` comes from the /app server component (src/lib/billing/server.ts); null or
    configured=false ⇒ demo — no paywall, no plan line, exactly as before Phase 6. */
export default function Platform({ billing = null }: { billing?: BillingProps | null }) {
  const { S, set } = usePlatformState();
  const gated = billing?.configured ? billing.entitlement : null;
  const uncSend = useUncChat(S, set);
  /* Phase 2: a no-op in demo mode (no Supabase env); with an account it hydrates on mount
     and autosaves every change (debounced). */
  const persistence = useAccountPersistence(S, set);
  const inAccount = persistence.mode === "account" && !!persistence.accountId;
  /* The account's own rows (receipts, approvals, connector + routine states) — derive reads them in
     accounts mode so nothing a real account never touched can fall back to the catalog's demo defaults. */
  const { facts } = useAccountFacts();
  const V = derive(S, set, undefined, uncSend, { mode: inAccount ? "account" : "demo", facts: inAccount ? facts : null });
  /* Accounts mode: the "needs you" list, receipts and drafts come from the runtime
     (GET /api/approvals). Demo mode: never fetched — the demo cards stay exactly as they are. */
  const live = useLiveApprovals(inAccount);
  /* Accounts mode: Unc's self-review, "The bar" and hours saved from the improvement loops
     (GET /api/telemetry/home). Demo mode: never fetched — the demo values stay verbatim. */
  const telemetry = useHomeTelemetry(inAccount);
  /* Client Brain: "Agree the plan" persists the onboarding answers as memories (accounts mode only). */
  useOnboardingMemories(S, inAccount);
  const runTarget = { accountId: inAccount ? persistence.accountId! : "demo", account: { currency: S.currency, budgetMonthly: S.budgetMo }, persisted: inAccount };
  /* Guided first run (docs/PRODUCT-EXPERIENCE.md): the five spine steps with real states
     (GET /api/setup/progress) feed Home's "Getting set up" card and the two guided steps that
     follow "Agree the plan →" in accounts mode. Demo mode never fetches and lands on Home. */
  const setup = useSetupProgress(inAccount);
  const setupData = setup.data;
  const setPlanAgreedAt = V.setPlanAgreedAt;
  useEffect(() => {
    if (setupData) setPlanAgreedAt(setupData.agreedAt);
  }, [setupData, setPlanAgreedAt]);
  /* "Agree the plan →" for real: plans.agreed_at. Fires once per session when an onboarded
     account has no agreed_at yet — the fresh agreement, or a backfill for an account that
     agreed before the column was written. */
  const agreeFired = useRef(false);
  const setupRefresh = setup.refresh;
  useEffect(() => {
    if (!inAccount || !S.onboarded || !setupData || setupData.agreedAt || agreeFired.current) return;
    agreeFired.current = true;
    fetch("/api/setup/agree", { method: "POST" })
      .then((r) => r.json().catch(() => ({})))
      .then((body: { agreedAt?: string }) => {
        if (typeof body.agreedAt === "string") setPlanAgreedAt(body.agreedAt);
        setupRefresh();
      })
      .catch(() => {});
  }, [inAccount, S.onboarded, setupData, setPlanAgreedAt, setupRefresh]);
  const showGuided = inAccount && S.onboarded && S.setupFlow !== "home";
  const phaseOne = phaseChannels(S)[0];
  const liveRefresh = live.refresh;
  const onSetupAction = (anchor: SetupAnchor) => {
    if (anchor.startsWith("view:")) {
      const v = anchor.slice(5);
      if (v === "connectors") V.goConnectors();
      else if (v === "systems") V.goSystems();
      else if (v === "strategy") V.goStrategy();
      return;
    }
    if (anchor === "step:connect" || anchor === "step:routine") {
      V.setSetupFlow(anchor.slice(5) as "connect" | "routine" | "channel");
      return;
    }
    const el = document.getElementById(anchor.slice(1));
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" });
  };
  const onTurnOn = async (routineId: string) => {
    V.enableRoutineLocal(routineId);
    V.setFirstRunPending(true);
    const r = await turnOnRoutine({ routineId, accountId: runTarget.accountId, account: runTarget.account });
    setupRefresh();
    liveRefresh();
    return r;
  };
  /* "Models" settings (which brain for which job) — accounts mode only; demo never shows the link. */
  const [modelsOpen, setModelsOpen] = useState(false);
  /* "What Unc knows" (his memory of this founder, correctable) — accounts mode only. */
  const [knowsOpen, setKnowsOpen] = useState(false);

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
    return <Paywall state={gated.state === "canceled" ? "canceled" : "none"} email={persistence.mode === "account" ? persistence.userEmail : null} pricing={billing?.pricing} />;
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
      {V.notOnboarding && !showGuided && <Sidebar V={V} account={persistence.mode === "account" ? persistence : null} billing={gated} onModels={inAccount ? () => setModelsOpen(true) : undefined} onWhatUncKnows={inAccount ? () => setKnowsOpen(true) : undefined} />}
      <main style={{ flex: 1, minWidth: 0 }}>
        {gated?.state === "past_due" && <BillingBanner />}
        {V.isOnboarding && <Onboarding V={V} />}
        {showGuided && S.setupFlow === "connect" && (
          <ConnectDataStep
            V={V}
            channel={phaseOne}
            onConnect={async (platform, shop) => {
              const r = await startConnect(platform, { shop });
              if (r.kind === "redirect") window.location.assign(r.url);
              return r;
            }}
            onContinue={() => V.setSetupFlow("routine")}
            onLater={V.markConnectLater}
            onTokenLink={() => {
              V.setSetupFlow("home");
              V.goConnectors();
            }}
          />
        )}
        {showGuided && S.setupFlow === "routine" && <FirstRoutineStep V={V} channel={phaseOne} onTurnOn={onTurnOn} onContinue={() => V.setSetupFlow("channel")} onSkip={() => V.setSetupFlow("channel")} />}
        {showGuided && S.setupFlow === "channel" && (
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
            <ConnectChannelStep onDone={() => V.setSetupFlow("home")} />
          </div>
        )}
        {V.isToday && !showGuided && <HomeView V={V} live={inAccount ? live : null} telemetry={inAccount ? telemetry : null} accountMode={inAccount} setup={inAccount ? setup : null} onSetupAction={onSetupAction} onTurnOn={onTurnOn} />}
        {V.isStrategy && !showGuided && <StrategyView V={V} />}
        {V.isConnectors && !showGuided && <ConnectorsView V={V} />}
        {V.isSystems && !showGuided && <RoutinesView V={V} run={runTarget} />}
        {/* Channels (docs/CHANNELS.md): accounts mode only — the view fetches /api/channels/links, which demo mode cannot answer. */}
        {V.isChannels && !showGuided && inAccount && <ChannelsSettings />}
      </main>
      {V.showBuddy && !showGuided && <CornerBuddy V={V} />}
      {inAccount && modelsOpen && <ModelSettings onClose={() => setModelsOpen(false)} />}
      {inAccount && knowsOpen && <WhatUncKnows onClose={() => setKnowsOpen(false)} />}
    </div>
  );
}
