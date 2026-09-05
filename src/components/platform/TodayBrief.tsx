"use client";
import { useAccountRequest } from "@/components/platform/AccountScope";
/* "Morning. Here's today:" — Unc's daily brief, a bubble at the top of Home in accounts mode.

   Demo mode renders NOTHING (the component returns null before any hook does work), so the
   demo Home stays byte-identical. In accounts mode it fetches GET /api/unc/brief on mount;
   with no brief yet it shows a quiet "Generate today's brief" ghost pill (POST); items render
   as short lines with a chip per kind — needs_you links to the approval card on the page,
   reminder shows the date. `initial` lets a server render / test pass a brief in directly. */

import React, { useEffect, useRef, useState } from "react";
import type { BriefItem, BriefItemKind, DailyBriefRecord } from "@/lib/brain/brief";

export const BRIEF_GREETING = "Morning. Here’s today:";
export const GENERATE_LABEL = "Generate today’s brief";

const CHIP: Record<BriefItemKind, { label: string; fg: string; bg: string }> = {
  happened: { label: "DONE", fg: "var(--cyan-text)", bg: "var(--cyan-wash)" },
  needs_you: { label: "NEEDS YOU", fg: "var(--amber-text)", bg: "var(--amber-wash)" },
  noticed: { label: "NOTICED", fg: "oklch(0.35 0.05 262)", bg: "oklch(0.95 0.01 262)" },
  reminder: { label: "REMINDER", fg: "oklch(0.4 0.1 300)", bg: "oklch(0.95 0.03 300)" },
};

const smallMascot: React.CSSProperties = { width: 26, height: 28, objectFit: "contain", flex: "none" };
const bubble: React.CSSProperties = { background: "white", border: "1px solid var(--card-border-2)", borderRadius: "4px 14px 14px 14px", padding: "14px 18px", flex: 1, minWidth: 0, maxWidth: 760 };

/** The DOM id HomeView gives each live approval card, so a needs_you line can jump to it. */
export const approvalAnchorId = (approvalId: string) => `approval-${approvalId}`;

export function reminderDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "short" }).format(d);
}

function ItemLine({ item }: { item: BriefItem }) {
  const chip = CHIP[item.kind] ?? CHIP.happened;
  const when = item.kind === "reminder" ? reminderDate(item.at) : "";
  return (
    <li data-testid="brief-item" data-kind={item.kind} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, lineHeight: 1.5, color: "oklch(0.3 0.06 262)" }}>
      <span style={{ flex: "none", marginTop: 3, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: chip.fg, background: chip.bg, borderRadius: 5, padding: "2px 7px" }}>{chip.label}</span>
      <span style={{ minWidth: 0 }}>
        {item.kind === "needs_you" && item.ref ? (
          <a href={`#${approvalAnchorId(item.ref)}`} className="hov-underline" style={{ color: "inherit", textDecoration: "none" }}>
            {item.text}
          </a>
        ) : (
          item.text
        )}
        {when ? <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 12 }}>{when}</span> : null}
      </span>
    </li>
  );
}

/** Pure presentational card (also what the tests render). */
export function TodayBriefCard({ brief }: { brief: DailyBriefRecord }) {
  return (
    <div data-testid="today-brief" style={{ display: "flex", gap: 12, marginBottom: 14 }}>
      <img src="/brand/mascot-small.png" alt="" style={{ ...smallMascot, marginTop: 4 }} />
      <div style={bubble}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{BRIEF_GREETING}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{brief.day}</span>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 6, color: "oklch(0.3 0.06 262)" }}>{brief.body}</div>
        {brief.items.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
            {brief.items.map((it, i) => (
              <ItemLine key={`${it.kind}:${it.ref ?? i}`} item={it} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type Fetched = { brief: DailyBriefRecord | null } | { fallback: true } | { error: string };

interface TodayBriefProps {
  accountMode: boolean;
  accountId?: string | null;
  contextGeneration?: number;
  paused?: boolean;
  initial?: DailyBriefRecord | null;
  onLoaded?: (brief: DailyBriefRecord | null) => void;
}

export default function TodayBrief(props: TodayBriefProps) {
  const accountId = props.accountId ?? props.initial?.accountId ?? null;
  const contextGeneration = props.contextGeneration ?? 0;
  const initial = props.initial && (props.initial.accountId !== accountId || props.initial.contextGeneration !== contextGeneration) ? undefined : props.initial;
  // Keyed lifetime: a same-account generation reset also discards state and
  // aborts pending GET/POST work. No old card or callback enters the new context.
  return <ScopedTodayBrief key={`${accountId}:${contextGeneration}`} {...props} accountId={accountId} contextGeneration={contextGeneration} initial={initial} />;
}

function ScopedTodayBrief({ accountMode, accountId, contextGeneration, paused = false, initial, onLoaded }: TodayBriefProps) {
  const accountRequest = useAccountRequest();
  const [state, setState] = useState<{ loaded: boolean; brief: DailyBriefRecord | null; error: string | null }>({ loaded: initial !== undefined, brief: initial ?? null, error: null });
  const [busy, setBusy] = useState(false);
  const work = useRef(new Set<AbortController>());
  useEffect(() => {
    const pending = work.current;
    return () => { for (const controller of pending) controller.abort(); pending.clear(); };
  }, []);
  /* Home reads whether a brief exists (its headline bubble falls back to the first-day line without one). */
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });
  useEffect(() => {
    if (state.loaded) onLoadedRef.current?.(state.brief);
  }, [state.loaded, state.brief]);

  useEffect(() => {
    if (!accountMode || !accountId || initial !== undefined) return;
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await accountRequest("/api/unc/brief", { cache: "no-store", signal: controller.signal, headers: { "x-unc-context-generation": String(contextGeneration) } });
        const body = (await res.json().catch(() => ({}))) as Fetched;
        if (cancelled) return;
        if (!res.ok || "fallback" in body) setState({ loaded: true, brief: null, error: "error" in body ? body.error : null });
        else if ("brief" in body && (!body.brief || (body.brief.accountId === accountId && body.brief.contextGeneration === contextGeneration))) setState({ loaded: true, brief: body.brief, error: null });
        else setState({ loaded: true, brief: null, error: "Your business context changed. Reload Unc." });
      } catch (e) {
        if (!cancelled) setState({ loaded: true, brief: null, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accountMode, accountId, contextGeneration, initial, accountRequest]);

  if (!accountMode) return null;
  if (!state.loaded) return null;
  if (state.brief) return <TodayBriefCard brief={state.brief} />;

  const generate = async () => {
    if (paused || !accountId) return;
    const controller = new AbortController();
    work.current.add(controller);
    setBusy(true);
    try {
      const res = await accountRequest("/api/unc/brief", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "x-unc-context-generation": String(contextGeneration) }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as Fetched;
      if (controller.signal.aborted) return;
      if (!res.ok || "fallback" in body) setState((s) => ({ ...s, error: "error" in body ? body.error : `couldn’t write the brief (${res.status})` }));
      else if ("brief" in body && (!body.brief || (body.brief.accountId === accountId && body.brief.contextGeneration === contextGeneration))) setState({ loaded: true, brief: body.brief, error: null });
      else setState({ loaded: true, brief: null, error: "Your business context changed. Reload Unc." });
    } catch (e) {
      if (!controller.signal.aborted) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      work.current.delete(controller);
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <div data-testid="today-brief-empty" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingLeft: 36 }}>
      <button
        onClick={generate}
        disabled={paused || busy || !accountId}
        className="hov-border-muted"
        style={{ border: "1px solid oklch(0.88 0.015 260)", background: "transparent", color: "var(--muted-2)", borderRadius: 999, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}
      >
        {paused ? "Briefs paused for setup verification" : busy ? "Writing it…" : GENERATE_LABEL}
      </button>
      {state.error && <span style={{ fontSize: 12, color: "var(--amber-text)" }}>{state.error}</span>}
    </div>
  );
}
