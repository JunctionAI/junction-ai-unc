"use client";
/* "What I drafted" — the real artifacts routines produced (GET /api/artifacts), newest first,
   each a DraftCard. Accounts mode only fetches; a server render (tests) passes `initial`.
   With no artifacts yet: the older receipt-based rows (`fallback`, the gate previews of runs
   that produced nothing storable) and then the copy floor. */

import React, { useEffect, useState } from "react";
import type { ArtifactView } from "@/lib/artifacts/handlers";
import type { DraftRow } from "@/lib/platform/approvals";
import { HOME_COPY } from "@/lib/setup/home";
import DraftCard from "./DraftCard";

const sysTag: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "var(--cyan-link)", background: "var(--cyan-wash)", borderRadius: 5, padding: "2px 7px" };
const smallMascot: React.CSSProperties = { width: 26, height: 28, objectFit: "contain", flex: "none" };

export interface DraftsProps {
  accountMode: boolean;
  /** Server render / tests: the listing in hand (null = none yet; undefined = fetch). */
  initial?: ArtifactView[] | null;
  initialChannels?: string[];
  /** The receipt-based draft rows (gate previews) shown when no artifact exists yet. */
  fallback?: DraftRow[];
  /** Bump to refetch (a run just finished). */
  refreshKey?: number;
  anyOn: boolean;
  paused?: boolean;
  onOpenRoutine: (routineId: string) => void;
  onNoDrafts?: () => void;
  /** First-run moment: the newest card slides in. */
  slideFirst?: boolean;
  persisted?: boolean;
}

type Listing = { artifacts?: ArtifactView[]; channels?: string[]; fallback?: boolean; error?: string };

export default function Drafts({ accountMode, initial, initialChannels = [], fallback = [], refreshKey = 0, anyOn, paused = false, onOpenRoutine, onNoDrafts, slideFirst = false, persisted = true }: DraftsProps) {
  const [artifacts, setArtifacts] = useState<ArtifactView[] | null>(initial === undefined ? null : initial);
  const [channels, setChannels] = useState<string[]>(initialChannels);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(initial !== undefined);

  useEffect(() => {
    if (!accountMode) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/artifacts", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as Listing;
        if (cancelled) return;
        if (!res.ok || data.fallback || !Array.isArray(data.artifacts)) setError(data.error ?? (data.fallback ? null : `couldn’t load drafts (${res.status})`));
        else {
          setArtifacts(data.artifacts);
          setChannels(Array.isArray(data.channels) ? data.channels : []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountMode, refreshKey]);

  const list = artifacts ?? [];
  /* The receipt previews are real rows already in hand: show them whenever no artifact is. */
  const showFallback = list.length === 0 && fallback.length > 0;
  const showEmpty = loaded && list.length === 0 && fallback.length === 0;

  return (
    <div data-testid="what-i-drafted" style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>What I drafted</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>— real work, waiting for your okay; nothing goes out until you use it</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!loaded && !error && accountMode && list.length === 0 && fallback.length === 0 && <div data-testid="drafts-loading" style={{ fontSize: 12.5, color: "var(--muted-2)", paddingLeft: 36 }}>Reading what I drafted…</div>}
        {error && <div style={{ fontSize: 12.5, color: "var(--amber-text)", paddingLeft: 36 }}>Couldn’t load the drafts just now: {error}</div>}
        {list.map((a, i) => (
          <div key={a.id} className={slideFirst && i === 0 ? "j-slidein" : undefined}>
            <DraftCard artifact={a} channels={channels} onOpenRoutine={onOpenRoutine} persisted={persisted} />
          </div>
        ))}
        {showFallback &&
          fallback.map((d) => (
            <div key={d.runId} data-testid="draft-row" style={{ display: "flex", alignItems: "center", gap: 16, background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "12px 18px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={sysTag}>{d.sys}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{d.title}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 4, lineHeight: 1.5 }}>{d.line}</div>
              </div>
              <button onClick={() => onOpenRoutine(d.sys)} className="hov-underline" style={{ flex: "none", border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                Inspect the system →
              </button>
            </div>
          ))}
        {showEmpty && (
          <div data-testid="no-drafts" style={{ display: "flex", gap: 10, alignItems: "center", background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "14px 18px" }}>
            <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
            <div style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.5 }}>
              {paused ? HOME_COPY.paused : anyOn ? (
                HOME_COPY.noDraftsRunning
              ) : (
                <button onClick={onNoDrafts} className="hov-underline" style={{ border: "none", background: "transparent", padding: 0, font: "inherit", color: "var(--cyan-link)", cursor: "pointer", textAlign: "left" }}>
                  {HOME_COPY.noDraftsYet}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
