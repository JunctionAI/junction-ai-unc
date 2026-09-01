"use client";

import { useEffect, useRef } from "react";
import { derive } from "@/lib/platform/derive";
import { useUncChat } from "@/lib/unc/useUncChat";
import { usePlatformState } from "./usePlatformState";
import Sidebar from "./Sidebar";
import Onboarding from "./Onboarding";
import HomeView from "./HomeView";
import StrategyView from "./StrategyView";
import RoutinesView from "./RoutinesView";
import ConnectorsView from "./ConnectorsView";
import CornerBuddy from "./CornerBuddy";

export default function Platform() {
  const { S, set } = usePlatformState();
  const uncSend = useUncChat(S, set);
  const V = derive(S, set, undefined, uncSend);

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
      {V.notOnboarding && <Sidebar V={V} />}
      <main style={{ flex: 1, minWidth: 0 }}>
        {V.isOnboarding && <Onboarding V={V} />}
        {V.isToday && <HomeView V={V} />}
        {V.isStrategy && <StrategyView V={V} />}
        {V.isConnectors && <ConnectorsView V={V} />}
        {V.isSystems && <RoutinesView V={V} />}
      </main>
      {V.showBuddy && <CornerBuddy V={V} />}
    </div>
  );
}
