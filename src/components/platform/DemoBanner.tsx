"use client";
/* The demo banner — the one honest line over the demo sandbox (docs/PRODUCT-EXPERIENCE.md
   §Non-negotiables): "Demo data — nothing here is yours. Sign in to start for real."

   Mounted by Sidebar.tsx when the app is in demo mode (no Supabase env / no session) and
   portalled to document.body as a full-width fixed bar, so it sits above the sidebar and the
   main column alike. Accounts mode never mounts it. While mounted it reserves its own height
   on <body> (padding-top) and publishes --demo-banner-h so sticky chrome can sit under it. */

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export const DEMO_BANNER_COPY = "Demo data — nothing here is yours. Sign in to start for real.";
export const DEMO_BANNER_HEIGHT = 44;

const noSubscribe = () => () => {};
/** true once on the client (false during server render / hydration) — no state, no cascading render. */
const useMounted = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

export default function DemoBanner() {
  const mounted = useMounted();

  useEffect(() => {
    const body = document.body;
    const root = document.documentElement;
    const prevPadding = body.style.paddingTop;
    body.style.paddingTop = `${DEMO_BANNER_HEIGHT}px`;
    root.style.setProperty("--demo-banner-h", `${DEMO_BANNER_HEIGHT}px`);
    return () => {
      body.style.paddingTop = prevPadding;
      root.style.removeProperty("--demo-banner-h");
    };
  }, []);

  if (!mounted) return null;
  return createPortal(
    <div
      role="status"
      data-testid="demo-banner"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: DEMO_BANNER_HEIGHT,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 18px",
        background: "var(--cream)",
        borderBottom: "1px solid var(--card-border-2)",
        color: "var(--ink)",
        fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
        fontSize: 13,
        boxSizing: "border-box",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mascot-small.png" alt="" style={{ width: 24, height: 26, objectFit: "contain", flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{DEMO_BANNER_COPY}</span>
      <a href="/login" className="btn-navy" style={{ padding: "6px 14px", fontSize: 12.5, textDecoration: "none", color: "white", flex: "none" }}>
        Sign in
      </a>
    </div>,
    document.body,
  );
}
