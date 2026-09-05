"use client";

import { useEffect, useRef, useState } from "react";
import { derive } from "@/lib/platform/derive";
import { useUncChat } from "@/lib/unc/useUncChat";
import { useAccountPersistence, type Persistence } from "@/lib/db/useAccountPersistence";
import type { PlatformState, Setter } from "@/lib/platform/state";
import { useAccountFacts } from "@/lib/unc/accountFacts";
import { usePlatformState } from "./usePlatformState";
import { useLiveApprovals } from "./useLiveApprovals";
import { useHomeTelemetry } from "./useHomeTelemetry";
import { useOnboardingMemories } from "./useOnboardingMemories";
import { useSetupProgress } from "@/lib/setup/useSetupProgress";
import { recordEmailAnswer, startConnect } from "@/lib/setup/connect";
import { EMAIL_TOOL_LABEL } from "@/lib/setup/channels";
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
import SkillsSettings from "./SkillsSettings";
import WhatUncKnows from "./WhatUncKnows";
import ClientWorkspace from "./ClientWorkspace";
import AgentsView from "./AgentsView";
import ConnectionsWorkspace from "./ConnectionsWorkspace";
import { isOpen } from "@/lib/billing/gate";
import type { BillingProps } from "@/lib/billing/server";

/** `billing` comes from the /app server component (src/lib/billing/server.ts); null or
    configured=false ⇒ demo — no paywall, no plan line, exactly as before Phase 6. */
export default function Platform({ billing = null }: { billing?: BillingProps | null }) {
  const { S, set } = usePlatformState();
  /* Phase 2: a no-op in demo mode (no Supabase env); with an account it hydrates on mount
     and autosaves every change (debounced). */
  const persistence = useAccountPersistence(S, set);

  // A configured account must never fall through to the prototype's demo state when hydration
  // or saving fails. Keep the real/demo application tree unmounted until persistence is known.
  if (persistence.mode === "connecting") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--cream)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 14 }}>
        Fetching your account…
      </div>
    );
  }
  if (persistence.mode === "error" || persistence.error) {
    return <AccountPersistenceFailure kind={persistence.mode === "account" ? "save" : "load"} error={persistence.error} email={persistence.userEmail} onRetry={persistence.retry} />;
  }

  return <PlatformReady S={S} set={set} persistence={persistence} billing={billing} />;
}

/** Blocking, non-demo recovery surface for a signed-in account whose real state could not be
    loaded or saved. POST sign-out remains available even when client-side recovery cannot work. */
export function AccountPersistenceFailure({ kind, error, email, onRetry }: { kind: "load" | "save"; error: string | null; email: string | null; onRetry: () => void }) {
  const saving = kind === "save";
  return (
    <main
      data-testid="account-persistence-error"
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
      <section style={{ width: "100%", maxWidth: 520, background: "white", border: "1px solid var(--line)", borderRadius: 20, padding: "34px 36px", boxShadow: "0 18px 50px oklch(0.27 0.055 262 / 0.1)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--amber-text)" }}>Account paused safely</div>
        <h1 style={{ margin: "10px 0 8px", fontSize: 25, letterSpacing: "-0.025em" }}>{saving ? "I couldn’t save your latest account state." : "I couldn’t load your real account."}</h1>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 14, lineHeight: 1.55 }}>
          {saving ? "I’ve paused the controls so an unsaved view can’t be mistaken for durable account state. No outward action was taken because of this error." : "I’ve stopped here so demo information can’t be mistaken for your business data. Nothing was sent, spent, or changed."}
        </p>
        {error && <p data-testid="account-persistence-error-detail" style={{ margin: "16px 0 0", padding: "10px 12px", borderRadius: 10, background: "var(--amber-wash)", color: "var(--amber-text)", fontSize: 12.5, lineHeight: 1.5 }}>{error}</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22 }}>
          <button type="button" className="btn-navy" onClick={onRetry} style={{ padding: "11px 20px", fontSize: 13.5 }}>Try again</button>
          <form action="/auth/signout" method="post">
            <button type="submit" className="hov-fg-ink" style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>Sign out</button>
          </form>
        </div>
        {email && <div style={{ marginTop: 16, color: "var(--muted)", fontSize: 11.5 }}>{email}</div>}
      </section>
    </main>
  );
}

function PlatformReady({ S, set, persistence, billing }: { S: PlatformState; set: Setter; persistence: Persistence; billing: BillingProps | null }) {
  const gated = billing?.configured ? billing.entitlement : null;
  const uncSend = useUncChat(S, set);
  const inAccount = persistence.mode === "account" && !!persistence.accountId;
  const modernAccount = inAccount && S.onboarded && S.setupFlow === "home";
  /* The account's own rows (receipts, approvals, connector + routine states) — derive reads them in
     accounts mode so nothing a real account never touched can fall back to the catalog's demo defaults. */
  const { facts } = useAccountFacts();
  const V = derive(S, set, undefined, uncSend, { mode: inAccount ? "account" : "demo", facts: inAccount ? facts : null });
  /* Accounts mode: the "needs you" list, receipts and drafts come from the runtime
     (GET /api/approvals). Demo mode: never fetched — the demo cards stay exactly as they are. */
  const live = useLiveApprovals(inAccount && !modernAccount);
  /* Accounts mode: Unc's self-review, "The bar" and hours saved from the improvement loops
     (GET /api/telemetry/home). Demo mode: never fetched — the demo values stay verbatim. */
  const telemetry = useHomeTelemetry(inAccount && !modernAccount);
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
    if (setupData && S.planAgreedAt !== setupData.agreedAt) setPlanAgreedAt(setupData.agreedAt);
  }, [setupData, S.planAgreedAt, setPlanAgreedAt]);
  /* Only a fresh onboarding transition requests agreement. Hydration/reload must
     never re-agree a plan that an operator deliberately cleared during a repair. */
  const previousOnboarded = useRef(S.onboarded);
  const agreementRequested = useRef(false);
  const agreeFired = useRef(false);
  const setupRefresh = setup.refresh;
  const setAccountName = persistence.setAccountName;
  useEffect(() => {
    if (!previousOnboarded.current && S.onboarded) agreementRequested.current = true;
    previousOnboarded.current = S.onboarded;
    if (!agreementRequested.current || S.automationPaused || !inAccount || !S.onboarded || !setupData || setupData.agreedAt || agreeFired.current) return;
    agreeFired.current = true;
    fetch("/api/setup/agree", { method: "POST", headers: { "x-unc-context-generation": String(S.contextGeneration ?? 0) } })
      .then((r) => r.json().catch(() => ({})))
      .then((body: { agreedAt?: string; accountName?: string | null }) => {
        if (typeof body.agreedAt === "string") setPlanAgreedAt(body.agreedAt);
        if (typeof body.accountName === "string" && body.accountName) setAccountName(body.accountName);
        setupRefresh();
      })
      .catch(() => {});
  }, [inAccount, S.onboarded, S.automationPaused, S.contextGeneration, setupData, setPlanAgreedAt, setupRefresh, setAccountName]);
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
    if (S.automationPaused) return { kind: "error" as const, message: "Automation is paused for setup verification." };
    const r = await turnOnRoutine({ routineId, accountId: runTarget.accountId, contextGeneration:S.contextGeneration ?? 0, account: runTarget.account });
    if (r.kind === "selected") V.enableRoutineLocal(routineId);
    if (r.kind === "ran" && r.drafts > 0) V.setFirstRunPending(true);
    setupRefresh();
    liveRefresh();
    return r;
  };
  /* "Models" settings (which brain for which job) — accounts mode only; demo never shows the link. */
  const [modelsOpen, setModelsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
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

  if (gated && !isOpen(gated)) {
    return <Paywall state={gated.state === "canceled" ? "canceled" : "none"} email={persistence.mode === "account" ? persistence.userEmail : null} pricing={billing?.pricing} />;
  }

  if (modernAccount) return <>
    {gated?.state === "past_due" && <BillingBanner />}
    <ClientWorkspace S={S} V={V} account={persistence} send={uncSend} billingEnabled={!!gated}
      onModels={() => setModelsOpen(true)} onSkills={() => setSkillsOpen(true)} onContext={() => setKnowsOpen(true)}
      legacy={<>
        {V.isStrategy && <StrategyView V={V} />}
        {V.isConnectors && <ConnectionsWorkspace V={V} />}
        {V.isSystems && (V.noSel ? <AgentsView key={`${persistence.accountId}:${S.contextGeneration}`} accountId={persistence.accountId!} contextGeneration={S.contextGeneration ?? 0} onInspect={V.openRoutineById} onSaved={V.setRoutineLocal} /> : <RoutinesView V={V} run={runTarget} />)}
        {V.isChannels && <ChannelsSettings context={V.accountId ? { accountId: V.accountId, contextGeneration: V.contextGeneration } : undefined} />}
      </>} />
    {modelsOpen && <ModelSettings onClose={() => setModelsOpen(false)} />}
    {skillsOpen && <SkillsSettings onClose={() => setSkillsOpen(false)} />}
    {knowsOpen && <WhatUncKnows onClose={() => setKnowsOpen(false)} />}
  </>;

  return (
    <div
      className="unc-platform"
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--cream)",
        color: "var(--ink)",
        fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {V.notOnboarding && !showGuided && <Sidebar V={V} account={persistence.mode === "account" ? persistence : null} billing={gated} onModels={inAccount ? () => setModelsOpen(true) : undefined} onSkills={inAccount ? () => setSkillsOpen(true) : undefined} onWhatUncKnows={inAccount ? () => setKnowsOpen(true) : undefined} />}
      <main style={{ flex: 1, minWidth: 0 }}>
        {inAccount && S.automationPaused && <aside role="status" style={{ padding: "12px 16px", background: "var(--amber-wash)", color: "var(--amber-text)", fontSize: 13 }}>Automation paused for setup verification. Your connections are preserved. Account chat is available; routines and briefs will stay paused until the backend is verified.</aside>}
        {process.env.NEXT_PUBLIC_READINESS_PREVIEW === "true" && <aside role="note" style={{ padding: "12px 16px", background: "#082B45", color: "white", fontSize: 13 }}>Demo-only preview — sample data and replies. No AVGAR connections, real workflow execution, or Apple Messages delivery.</aside>}
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
            onEmailAnswer={(answer) => {
              // known_platforms (autosaved) + a founder memory — one answer replaces any earlier one
              V.addKnownPlatform(EMAIL_TOOL_LABEL[answer], Object.values(EMAIL_TOOL_LABEL));
              void recordEmailAnswer(answer, { contextGeneration: S.contextGeneration });
              setupRefresh();
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
        {V.isChannels && !showGuided && inAccount && <ChannelsSettings context={V.accountId ? { accountId: V.accountId, contextGeneration: V.contextGeneration } : undefined} />}
      </main>
      {V.showBuddy && !showGuided && <CornerBuddy V={V} />}
      {inAccount && modelsOpen && <ModelSettings onClose={() => setModelsOpen(false)} />}
      {inAccount && skillsOpen && <SkillsSettings onClose={() => setSkillsOpen(false)} />}
      {inAccount && knowsOpen && <WhatUncKnows onClose={() => setKnowsOpen(false)} />}
    </div>
  );
}
