"use client";
import { useAccountRequest } from "@/components/platform/AccountScope";
/* "How I read your market" — the niche brief on Home, accounts mode only (docs/PRESETS.md).

   Reads GET /api/unc/niche-brief once; renders nothing until a brief exists and never blocks
   anything. Open the first time the founder sees it, collapsed after that (a per-browser flag),
   with a one-click reopen. `initial` lets a server render / test start with the brief in hand. */

import { useEffect, useState } from "react";
import type { NicheBrief } from "@/lib/brain/nicheBrief";

export const MARKET_READ_TITLE = "How I read your market";
const SEEN_KEY = "unc.marketRead.seen";

function seenBefore(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode / blocked storage — the card just stays open */
  }
}

const sectionLabel: React.CSSProperties = { fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 };
const groupLabel: React.CSSProperties = { fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 };

function Group({ title, items, testId }: { title: string; items: string[]; testId: string }) {
  if (!items.length) return null;
  return (
    <div data-testid={testId} style={{ marginTop: 10 }}>
      <div style={groupLabel}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
        {items.map((t) => (
          <div key={t} style={{ fontSize: 13, lineHeight: 1.5, color: "oklch(0.3 0.06 262)" }}>
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MarketRead({ initial }: { initial?: NicheBrief | null }) {
  const accountRequest = useAccountRequest();
  const [brief, setBrief] = useState<NicheBrief | null | undefined>(initial);
  const [open, setOpen] = useState<boolean>(() => !seenBefore());

  useEffect(() => {
    if (initial !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await accountRequest("/api/unc/niche-brief", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { brief?: NicheBrief | null; fallback?: boolean };
        if (!cancelled) setBrief(res.ok && !body.fallback && body.brief ? body.brief : null);
      } catch {
        if (!cancelled) setBrief(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountRequest, initial]);

  useEffect(() => {
    if (brief && open) markSeen();
  }, [brief, open]);

  if (!brief || !brief.summary) return null;
  const bench = brief.benchmarks ?? [];
  return (
    <section data-testid="market-read" data-buddy="This is the market I'm planning inside — correct me and every routine adjusts." style={{ marginTop: 34 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={sectionLabel}>{MARKET_READ_TITLE}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>— from your site and the playbooks; it sets the defaults every routine starts on</span>
        <button data-testid="market-read-toggle" onClick={() => setOpen((o) => !o)} className="hov-underline" style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0 }}>
          {open ? "collapse" : "read it again"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <img src="/brand/mascot-small.png" alt="" style={{ width: 28, height: 30, objectFit: "contain", flex: "none", marginTop: 4 }} />
        <div style={{ background: "white", border: "1px solid var(--card-border-2)", borderRadius: "4px 14px 14px 14px", padding: "14px 18px", flex: 1, minWidth: 0, maxWidth: 760 }}>
          <div data-testid="market-read-summary" style={{ fontSize: 13.5, lineHeight: 1.55, color: "oklch(0.3 0.06 262)" }}>
            {brief.summary}
          </div>
          {brief.categoryBand && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
              Band: {brief.categoryBand.replace(/_/g, " ")} — {brief.bandWhy}
            </div>
          )}
          {open && (
            <div data-testid="market-read-detail">
              <Group title="What makes people buy" items={brief.buyingTriggers} testId="market-read-triggers" />
              <Group title="When demand moves" items={brief.seasonality} testId="market-read-seasonality" />
              <Group title="Channels that work here" items={brief.channelsThatWork} testId="market-read-channels" />
              {bench.length > 0 && <Group title="Benchmarks I trust (from the playbooks)" items={bench.map((b) => `${b.metric}: ${b.low !== null && b.high !== null && b.low !== b.high ? `${b.low}–${b.high}` : String(b.low ?? b.high)}${b.unit ? ` ${b.unit}` : ""} — ${b.source}`)} testId="market-read-benchmarks" />}
              {bench.length === 0 && (
                <div data-testid="market-read-no-benchmarks" style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
                  No benchmark numbers for this market in my playbooks yet — I won’t invent any. Your own numbers become the bar as they land.
                </div>
              )}
              <Group title="What I’ll avoid" items={brief.avoid} testId="market-read-avoid" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
