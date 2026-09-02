"use client";

import React, { useEffect, useRef, useState } from "react";
import type { PlatformVals } from "@/lib/platform/derive";
import { NOTHING_WAITING_COPY } from "@/lib/platform/approvals";
import { BASELINE_NOT_SET_COPY } from "@/lib/platform/goal";
import type { LiveApprovals } from "./useLiveApprovals";
import type { HomeTelemetryState } from "./useHomeTelemetry";
import { barCards, hoursSavedLabel, weekLabel, type BarCardView, type HomeReviewView } from "@/lib/platform/telemetry";
import TodayBrief, { approvalAnchorId } from "./TodayBrief";
import GettingSetUp, { SetupMotionStyles } from "./GettingSetUp";
import type { SetupProgressState } from "@/lib/setup/useSetupProgress";
import type { SetupAnchor } from "@/lib/setup/progress";
import type { TurnOnResult } from "@/lib/setup/routine";
import { automationStrip, cadenceLabel, HOME_COPY, paidInPlan, realPlanTimeline, realProposals } from "@/lib/setup/home";
import { platformName } from "@/lib/setup/channels";
import type { DailyBriefRecord } from "@/lib/brain/brief";

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.13em",
  textTransform: "uppercase",
  color: "var(--cyan-text)",
  fontWeight: 600,
};

const sysTag: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.06em",
  color: "var(--cyan-link)",
  background: "var(--cyan-wash)",
  borderRadius: 5,
  padding: "2px 7px",
};

const userBubble: React.CSSProperties = {
  alignSelf: "flex-end",
  background: "var(--navy)",
  color: "var(--on-navy)",
  borderRadius: "14px 14px 4px 14px",
  padding: "9px 15px",
  fontSize: 12.5,
  fontWeight: 500,
};

const uncReceiptRow: React.CSSProperties = { display: "flex", gap: 10 };
const uncReceiptText: React.CSSProperties = { fontSize: 12.5, color: "var(--muted-2)", lineHeight: 1.5, paddingTop: 5 };
const smallMascot: React.CSSProperties = { width: 26, height: 28, objectFit: "contain", flex: "none" };

/** One approval as a chat-style bubble from Unc + the founder's reply + Unc's receipt. The
    demo cards (derive.ts) and the live ones (useLiveApprovals) both render through here —
    same copy structure: routine tag, title, detail, before → after, expiry. */
export interface ApprovalCardProps {
  sys: string;
  title: string;
  detail: string;
  before: string;
  after: string;
  expiry: string;
  pending: boolean;
  approved: boolean;
  held: boolean;
  showWhy: boolean;
  whyText: string;
  /** Unc's line under "Approved" (the demo passes its receipt id line; live passes the runtime's outcome). */
  approvedText: string;
  heldText: string;
  busy?: boolean;
  approve: () => void;
  hold: () => void;
  why: () => void;
}

export function ApprovalCard(ap: ApprovalCardProps) {
  return (
    <>
      <div style={{ display: "flex", gap: 10 }}>
        <img src="/brand/mascot-small.png" alt="" style={{ ...smallMascot, marginTop: 4 }} />
        <div style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: "4px 14px 14px 14px", padding: "14px 18px", flex: 1, minWidth: 0, maxWidth: 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={sysTag}>{ap.sys}</span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{ap.title}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 5, lineHeight: 1.5 }}>{ap.detail}</div>
          <div style={{ fontSize: 12, marginTop: 7 }}>
            {ap.before} <span style={{ color: "oklch(0.65 0.02 260)" }}>→</span> <span style={{ fontWeight: 600 }}>{ap.after}</span>
            <span style={{ color: "oklch(0.5 0.12 75)", marginLeft: 12 }}>{ap.expiry}</span>
          </div>
          {ap.pending && (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={ap.approve} disabled={ap.busy} className="btn-navy" style={{ padding: "8px 18px", fontSize: 12.5, fontWeight: 600 }}>
                Approve
              </button>
              <button
                onClick={ap.hold}
                disabled={ap.busy}
                className="hov-border-muted"
                style={{ border: "1px solid oklch(0.88 0.015 260)", background: "transparent", color: "var(--muted-2)", borderRadius: 999, padding: "8px 16px", fontSize: 12.5, cursor: "pointer" }}
              >
                Hold
              </button>
              <button onClick={ap.why} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12.5, fontWeight: 500, cursor: "pointer", padding: "8px 6px" }}>
                Why?
              </button>
            </div>
          )}
        </div>
      </div>
      {ap.showWhy && (
        <div style={{ display: "flex", gap: 10 }}>
          <img src="/brand/mascot-small.png" alt="" style={{ ...smallMascot, marginTop: 2 }} />
          <div style={{ background: "var(--cyan-wash)", borderRadius: "4px 14px 14px 14px", padding: "12px 16px", fontSize: 12.5, lineHeight: 1.55, color: "oklch(0.3 0.06 262)", maxWidth: 680 }}>{ap.whyText}</div>
        </div>
      )}
      {ap.approved && (
        <>
          <div style={userBubble}>Approved</div>
          <div style={uncReceiptRow}>
            <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
            <div style={uncReceiptText}>{ap.approvedText}</div>
          </div>
        </>
      )}
      {ap.held && (
        <>
          <div style={userBubble}>Hold for now</div>
          <div style={uncReceiptRow}>
            <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
            <div style={uncReceiptText}>{ap.heldText}</div>
          </div>
        </>
      )}
    </>
  );
}

const HELD_TEXT = "Held. I’ll re-surface it tomorrow with fresh numbers — nothing moves meanwhile.";

/** `live` is null in demo mode (the demo cards render untouched); in accounts mode it is the
    runtime's list — once loaded, the "needs you" list, its count, the drafts and the receipts
    all come from it. `accountMode` (Supabase configured + session) is what keeps the demo
    approval cards off the page while that list is still loading or failed — a real account
    never sees them — and what turns a NULL baseline into Unc's ask instead of demo progress. */
export interface HomeViewProps {
  V: PlatformVals;
  live?: LiveApprovals | null;
  telemetry?: HomeTelemetryState | null;
  accountMode?: boolean;
  /** Accounts mode: the five spine steps (GET /api/setup/progress). */
  setup?: SetupProgressState | null;
  onSetupAction?: (anchor: SetupAnchor) => void;
  /** Accounts mode: enable a routine + dry-run it now ("Setting up next" → Turn on). */
  onTurnOn?: (routineId: string) => Promise<TurnOnResult>;
  /** Accounts mode, server render / tests: today's brief passed in directly (null = none yet). */
  briefInitial?: DailyBriefRecord | null;
}

/** Demo mode renders the prototype's Home verbatim (DemoHome). Accounts mode renders the
    real-only Home (AccountHome): nothing from derive.ts's demo constants can reach it. */
export default function HomeView(props: HomeViewProps) {
  if (props.accountMode) return <AccountHome {...props} />;
  return <DemoHome {...props} />;
}

function DemoHome({ V, live = null, telemetry = null, accountMode = false }: HomeViewProps) {
  const isLive = !!live && live.active;
  /* The three demo cards + "nothing needs you" are demo furniture: only when there is no account. */
  const showDemoCards = !accountMode && !isLive;
  const liveLoading = accountMode && !isLive && !live?.error;
  const needsCount = isLive ? live.pendingCount + (V.klaviyoDown ? 1 : 0) : accountMode ? (V.klaviyoDown ? 1 : 0) : V.needsCount;
  const liveNothingWaiting = isLive && live.pendingCount === 0;
  const baselineMissing = accountMode && V.baselineMissing;
  /* DB mode only (never in demo): the bar from published benchmarks / honest references,
     hours saved from real runs, and Unc's latest self-review. */
  const tele = telemetry && telemetry.active ? telemetry.data : null;
  const review = tele?.review ?? null;
  const liveBar = tele ? barCards(tele) : null;
  const hrsLabel = tele ? hoursSavedLabel(tele) : String(V.gamHrs);
  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "50px 48px 96px" }}>
      <div
        data-buddy="Run rate vs needed — that gap is the whole game. I re-plan it live as the numbers move."
        style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: 20, padding: "30px 34px", boxShadow: "0 8px 30px oklch(0.27 0.055 262 / 0.06)" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <input
              value={V.goalTitle}
              onChange={V.onGoalTitle}
              style={{ display: "block", width: "100%", border: "none", outline: "none", background: "transparent", fontWeight: 700, fontSize: 42, letterSpacing: "-0.025em", color: "var(--ink)", padding: 0 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 13.5, color: "var(--muted)" }}>
              by
              <input
                type="date"
                value={V.deadline}
                onChange={V.onDeadline}
                style={{ border: "none", background: "transparent", fontSize: 13.5, fontWeight: 500, color: "oklch(0.35 0.05 262)", borderBottom: "1px dashed oklch(0.78 0.02 260)", padding: "1px 2px", outline: "none", cursor: "pointer" }}
              />
              <span>· {V.daysLeftLabel} left</span>
            </div>
          </div>
          {baselineMissing ? (
            <span data-testid="baseline-not-set" style={{ flex: "none", marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "var(--amber-text)", background: "var(--amber-wash)", borderRadius: 999, padding: "8px 17px" }}>
              Baseline not set
            </span>
          ) : (
            <span style={{ flex: "none", marginTop: 8, fontSize: 12.5, fontWeight: 700, color: V.statusColor, background: V.statusBg, borderRadius: 999, padding: "8px 17px" }}>{V.statusLabel}</span>
          )}
        </div>
        <div style={{ marginTop: 22, height: 8, background: "var(--track)", borderRadius: 999 }}>
          <div
            style={{
              width: baselineMissing ? "0%" : V.goalPct,
              height: 8,
              background: "linear-gradient(90deg, oklch(0.78 0.13 220), oklch(0.55 0.16 245))",
              borderRadius: 999,
              boxShadow: "0 0 14px oklch(0.78 0.13 220 / 0.5)",
              transition: "width 0.6s",
            }}
          ></div>
        </div>
        {baselineMissing ? (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12 }}>
            <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, color: "oklch(0.4 0.04 262)", lineHeight: 1.5 }}>{BASELINE_NOT_SET_COPY}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
                Where it is now
                <input
                  type="number"
                  aria-label="Where it is now"
                  value={V.obBaselineNum ?? ""}
                  onChange={V.onObBaselineNum}
                  placeholder={V.obIsMoney ? V.obBudgetMin : "0"}
                  style={{ width: 160, padding: "7px 10px", fontSize: 14, fontWeight: 600, border: "1px solid var(--input-border)", borderRadius: 8, background: "white", color: "var(--ink)", outline: "none" }}
                />
              </label>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 14.5, marginTop: 12, color: "oklch(0.4 0.04 262)" }}>{V.homePlain}</div>
        )}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14, paddingTop: 14, borderTop: "1px solid oklch(0.945 0.008 260)" }}>
          {V.homeSetup.map((hs) => (
            <div key={hs.title} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "oklch(0.45 0.03 262)" }}>
              <span style={{ flex: "none", width: 16, height: 16, borderRadius: "50%", background: hs.mBg, color: hs.mFg, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {hs.mark}
              </span>
              <span style={{ fontWeight: 600 }}>{hs.title}</span>
              {hs.hasAction && (
                <button onClick={hs.go} className="hov-underline" style={{ border: "none", background: "transparent", padding: 0, fontSize: 11.5, color: "var(--cyan-link)", fontWeight: 600, cursor: "pointer" }}>
                  {hs.action} →
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <section data-buddy="Only you can clear these. Three taps and the machine keeps moving without you." style={{ marginTop: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <img src="/brand/mascot-small.png" alt="Unc" style={{ width: 34, height: 36, objectFit: "contain", flex: "none" }} />
          <div style={{ background: "white", border: "1px solid var(--card-border-2)", borderRadius: "4px 14px 14px 14px", padding: "10px 16px", fontSize: 13.5, color: "oklch(0.3 0.06 262)" }}>
            I&apos;ve done the work below — review it, tweak it, and give me the okay.{" "}
            <span style={{ fontSize: 11, background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 999, padding: "2px 9px", fontWeight: 600, marginLeft: 4 }}>{needsCount}</span>
          </div>
        </div>
        {/* Unc's daily brief — accounts mode only; the component renders nothing in demo mode. */}
        {accountMode && <TodayBrief accountMode={accountMode} />}
        {review && (
          <div data-testid="unc-self-review" style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <img src="/brand/mascot-small.png" alt="" style={{ ...smallMascot, marginTop: 4 }} />
            <div style={{ background: "white", border: "1px solid var(--card-border-2)", borderRadius: "4px 14px 14px 14px", padding: "14px 18px", flex: 1, minWidth: 0, maxWidth: 760 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={sysTag}>MY REVIEW</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {weekLabel(review.weekStart)}
                  {review.author === "deterministic" ? " · from the numbers, no model" : ""}
                </span>
              </div>
              {review.worked && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>What worked</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 3, color: "oklch(0.3 0.06 262)" }}>{review.worked}</div>
                </div>
              )}
              {review.changing && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>What I&apos;m changing</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 3, color: "oklch(0.3 0.06 262)" }}>{review.changing}</div>
                  {review.changes.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {review.changes.map((c) => (
                        <button
                          key={`${c.action}:${c.routineId}`}
                          onClick={() => V.openRoutineById(c.routineId)}
                          className="hov-bg-cyanwash-deep"
                          title={c.why}
                          style={{ border: "none", background: "var(--cyan-wash)", color: "var(--cyan-text)", borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                        >
                          {c.action.replace("_", " ")} {c.routineId}
                          {c.cadence ? ` → ${c.cadence}` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {review.ask && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>One ask</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 3, fontWeight: 500 }}>{review.ask}</div>
                </div>
              )}
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {liveLoading && (
            <div data-testid="needs-you-loading" style={{ fontSize: 12.5, color: "var(--muted-2)", lineHeight: 1.5, paddingLeft: 36 }}>
              Checking what’s waiting on you…
            </div>
          )}
          {showDemoCards && V.allClear && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "14px 18px" }}>
              <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
              <div style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.5 }}>
                Nothing needs you right now — the machine is running. I’ll surface the next decision here the moment it’s ready.
              </div>
            </div>
          )}
          {liveNothingWaiting && (
            <div data-testid="nothing-waiting" style={{ display: "flex", gap: 10, alignItems: "center", background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "14px 18px" }}>
              <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
              <div style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.5 }}>{NOTHING_WAITING_COPY}</div>
            </div>
          )}
          {showDemoCards &&
            V.approvals.map((ap, i) => (
              <ApprovalCard
                key={i}
                sys={ap.sys}
                title={ap.title}
                detail={ap.detail}
                before={ap.before}
                after={ap.after}
                expiry={ap.expiry}
                pending={ap.pending}
                approved={ap.approved}
                held={ap.held}
                showWhy={ap.showWhy}
                whyText={ap.whyText}
                approvedText={`On it — executing only the approved scope, reading the result back, then receipt ${ap.receipt} lands here.`}
                heldText={HELD_TEXT}
                approve={ap.approve}
                hold={ap.hold}
                why={ap.why}
              />
            ))}
          {isLive &&
            live.approvals.map((ap) => (
              /* the wrapper keeps the card's bubbles in the same column + gap; its id is the brief's needs_you anchor */
              <div key={ap.key} id={approvalAnchorId(ap.key)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ApprovalCard
                  sys={ap.sys}
                  title={ap.title}
                  detail={ap.detail}
                  before={ap.before}
                  after={ap.after}
                  expiry={ap.expiry}
                  pending={ap.pending}
                  approved={ap.approved}
                  held={ap.held}
                  showWhy={ap.showWhy}
                  whyText={ap.whyText}
                  approvedText={ap.outcomeText}
                  heldText={ap.outcomeText || HELD_TEXT}
                  busy={ap.busy}
                  approve={ap.approve}
                  hold={ap.hold}
                  why={ap.why}
                  />
              </div>
            ))}
          {accountMode && live?.error && (
            <div style={{ fontSize: 12.5, color: "var(--amber-text)", lineHeight: 1.5, paddingLeft: 36 }}>Couldn’t reach the runtime just now: {live.error}</div>
          )}
          {V.klaviyoDown && (
            <div style={{ display: "flex", gap: 10 }}>
              <img src="/brand/mascot-small.png" alt="" style={{ ...smallMascot, marginTop: 4 }} />
              <div style={{ background: "white", border: "1px dashed oklch(0.8 0.09 75)", borderRadius: "4px 14px 14px 14px", padding: "14px 18px", flex: 1, minWidth: 0, maxWidth: 760 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "oklch(0.5 0.12 75)", background: "var(--amber-wash)", borderRadius: 5, padding: "2px 7px" }}>BLOCKED</span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Klaviyo token expired — 2 minutes to fix</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 5, lineHeight: 1.5 }}>Winback and welcome are paused until it refreshes. Everything else keeps running.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    onClick={V.fixKlaviyo}
                    style={{ border: "1px solid oklch(0.8 0.09 75)", background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 999, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    Reconnect
                  </button>
                </div>
              </div>
            </div>
          )}
          {V.klaviyoOk && (
            <>
              <div style={userBubble}>Reconnected Klaviyo</div>
              <div style={uncReceiptRow}>
                <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
                <div style={uncReceiptText}>Token verified, freshness green. Winback and welcome resume tonight — I’ll receipt the first runs here.</div>
              </div>
            </>
          )}
        </div>
        {isLive && live.drafts.length > 0 && (
          <div data-testid="what-i-drafted" style={{ marginTop: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>What I drafted</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>— dry runs, zero outward actions; nothing here needs you</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {live.drafts.map((d) => (
                <div key={d.runId} style={{ display: "flex", alignItems: "center", gap: 16, background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "12px 18px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={sysTag}>{d.sys}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{d.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 4, lineHeight: 1.5 }}>{d.line}</div>
                  </div>
                  <button onClick={() => V.openRoutineById(d.sys)} className="hov-underline" style={{ flex: "none", border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                    Inspect the system →
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section data-buddy="Your plan, on one timeline. The phase we're in is lit up." style={{ marginTop: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={sectionLabel}>The plan</span>
          <button onClick={V.goStrategy} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0 }}>
            adjust →
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {V.homePlan.map((hp) => (
            <div key={hp.weeks} style={{ display: "flex", alignItems: "center", gap: 16, background: "white", border: `1.5px solid ${hp.border}`, borderRadius: 13, padding: "14px 18px" }}>
              <span style={{ flex: "none", width: 88, fontSize: 11, fontWeight: 700, color: hp.weekColor }}>{hp.weeks}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{hp.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{hp.focus}</div>
              </div>
              <span style={{ flex: "none", fontSize: 10.5, fontWeight: 600, color: hp.stColor, background: hp.stBg, borderRadius: 999, padding: "4px 11px" }}>{hp.st}</span>
            </div>
          ))}
        </div>
        {V.homeAds && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>{V.homeAdsLine}</div>}
      </section>

      <section data-buddy="This is what winning actually takes — benchmarked from businesses that did it. I set up the work; you keep the bar." style={{ marginTop: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={sectionLabel}>The bar</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>— what getting there actually takes, from businesses that did it</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {!liveBar &&
            V.homeBar.map((hb) => (
              <div key={hb.what} style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{hb.what}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: hb.okColor }}>{hb.status}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, letterSpacing: "-0.01em" }}>{hb.bar}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>{hb.proof}</div>
                {hb.behind && (
                  <button
                    onClick={hb.fix}
                    className="hov-bg-cyanwash-deep"
                    style={{ marginTop: 10, border: "none", background: "var(--cyan-wash)", color: "var(--cyan-text)", borderRadius: 999, padding: "6px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    {hb.fixLabel}
                  </button>
                )}
              </div>
            ))}
          {liveBar &&
            liveBar.map((hb) => (
              <div key={hb.what} data-testid="bar-card" data-source={hb.source} style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{hb.what}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: hb.okColor }}>{hb.status}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, letterSpacing: "-0.01em" }}>{hb.bar}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>{hb.proof}</div>
                {hb.behind && (
                  <button
                    onClick={() => V.openCategory(hb.fixCategory)}
                    className="hov-bg-cyanwash-deep"
                    style={{ marginTop: 10, border: "none", background: "var(--cyan-wash)", color: "var(--cyan-text)", borderRadius: 999, padding: "6px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    {hb.fixLabel}
                  </button>
                )}
              </div>
            ))}
        </div>
      </section>

      <section data-buddy="Every routine you switch on makes the machine more OP — and hands you back hours." style={{ marginTop: 34 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ flex: "none", ...sectionLabel }}>Automation level</span>
          <span style={{ flex: 1, minWidth: 220, fontSize: 12, color: "var(--muted)" }}>
            — {V.gamOnCount} of {V.gamTotal} routines running · saving you ~{hrsLabel} h/week
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 8, background: "var(--track)", borderRadius: 999 }}>
            <div style={{ width: V.gamPct, height: 8, background: "linear-gradient(90deg, oklch(0.78 0.13 220), oklch(0.55 0.16 245))", borderRadius: 999, boxShadow: "0 0 12px oklch(0.78 0.13 220 / 0.5)" }}></div>
          </div>
          <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: "var(--cyan-text)" }}>{V.gamRank}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {V.gamCats.map((gc3) => (
            <button key={gc3.name} onClick={gc3.open} className="hov-border-cyan" style={{ textAlign: "left", background: "white", border: "1px solid var(--card-border)", borderRadius: 12, padding: "13px 14px", cursor: "pointer" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{gc3.name}</div>
              <div style={{ display: "flex", gap: 4, marginTop: 9 }}>
                {gc3.dots.map((dt2, i) => (
                  <span key={i} style={{ flex: 1, height: 5, borderRadius: 999, background: dt2.bg }}></span>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: gc3.subColor, marginTop: 7, fontWeight: 500 }}>{gc3.sub}</div>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>{V.gamHireLine}</div>
      </section>

      <section data-buddy="I queue the next builds myself — the constraint tells me what to set up. Turn one on and I dry-run it tonight. Nothing sends without you." style={{ marginTop: 38 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={sectionLabel}>Setting up next</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>— proposed from the constraint · always dry-run first</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {V.proposals.map((p) => (
            <div key={p.id} style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 20px", display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={sysTag}>{p.id}</span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 5 }}>{p.why}</div>
              </div>
              {p.ready && (
                <button onClick={p.turnOn} className="btn-cyan" style={{ flex: "none", padding: "8px 18px", fontSize: 12.5, fontWeight: 700 }}>
                  Turn on
                </button>
              )}
              {p.building && (
                <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "7px 15px", fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan-link)", animation: "jpulse 1.6s infinite" }}></span>Building · dry run tonight
                </span>
              )}
              {p.blocked && (
                <span style={{ flex: "none", fontSize: 12, color: "var(--amber-text)", background: "var(--amber-wash)", borderRadius: 999, padding: "7px 15px", fontWeight: 600 }}>Needs Klaviyo reconnect</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <div data-buddy="Everything I do leaves a receipt. Check my work anytime." style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 44, marginTop: 44 }}>
        <section>
          <div style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 14, fontWeight: 600 }}>Completed today</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!isLive &&
              V.completed.map((c) => (
                <div key={c.receipt} style={{ display: "flex", gap: 11 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)", marginTop: 5.5, flex: "none" }}></span>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                    {c.text}
                    <br />
                    <a href="#">{c.receipt}</a>
                  </div>
                </div>
              ))}
            {isLive &&
              live.receipts.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 11 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)", marginTop: 5.5, flex: "none" }}></span>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                    {r.text}
                    <br />
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>
                      {r.kind} · receipt {r.handle}
                    </span>
                  </div>
                </div>
              ))}
            {isLive && live.receipts.length === 0 && <div style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.5 }}>No receipts yet — the first run writes one, and it lands here.</div>}
          </div>
        </section>
        <section>
          <div style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 14, fontWeight: 600 }}>Running &amp; next</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)", marginTop: 5.5, flex: "none", animation: "jpulse 1.6s infinite" }}></span>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                Researching 24 new leads against ICP <span style={{ color: "var(--muted)" }}>· running, 60%</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--amber)", marginTop: 5.5, flex: "none" }}></span>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                Winback flow blocked — Klaviyo token expired <span style={{ color: "var(--muted)" }}>· reconnect to resume</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.82 0.02 260)", marginTop: 5.5, flex: "none" }}></span>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>Tomorrow 07:00 — daily paid decisioning across 3 campaigns</div>
            </div>
            <div style={{ display: "flex", gap: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.82 0.02 260)", marginTop: 5.5, flex: "none" }}></span>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>Friday — weekly learning review with 2 candidate rules</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ======================================================================================
   Accounts mode — the real-only Home (docs/PRODUCT-EXPERIENCE.md "Real only").
   Every number, list, count and status below comes from the database or a certified read;
   every empty state uses the copy floor. The demo constants (AP_DATA, SIGNAL_DEFS,
   LEVER_DEFS, COMPLETED_DEFS, the setup strip, the automation gamification, the proposals,
   the bar's demo values, the demo plan timeline) have no render path here.
   ====================================================================================== */

const DRAFTED_ID = "what-i-drafted";
const NEEDS_YOU_ID = "needs-you";
const SETTING_UP_NEXT_ID = "setting-up-next";
const BRIEF_ID = "today-brief";

function ReviewBubble({ review, V }: { review: HomeReviewView; V: PlatformVals }) {
  return (
    <div data-testid="unc-self-review" style={{ display: "flex", gap: 12, marginBottom: 14 }}>
      <img src="/brand/mascot-small.png" alt="" style={{ ...smallMascot, marginTop: 4 }} />
      <div style={{ background: "white", border: "1px solid var(--card-border-2)", borderRadius: "4px 14px 14px 14px", padding: "14px 18px", flex: 1, minWidth: 0, maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={sysTag}>MY REVIEW</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {weekLabel(review.weekStart)}
            {review.author === "deterministic" ? " · from the numbers, no model" : ""}
          </span>
        </div>
        {review.worked && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>What worked</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 3, color: "oklch(0.3 0.06 262)" }}>{review.worked}</div>
          </div>
        )}
        {review.changing && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>What I&apos;m changing</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 3, color: "oklch(0.3 0.06 262)" }}>{review.changing}</div>
            {review.changes.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {review.changes.map((c) => (
                  <button key={`${c.action}:${c.routineId}`} onClick={() => V.openRoutineById(c.routineId)} className="hov-bg-cyanwash-deep" title={c.why} style={{ border: "none", background: "var(--cyan-wash)", color: "var(--cyan-text)", borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                    {c.action.replace("_", " ")} {c.routineId}
                    {c.cadence ? ` → ${c.cadence}` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {review.ask && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>One ask</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 3, fontWeight: 500 }}>{review.ask}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function UncBubble({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <img src="/brand/mascot-small.png" alt="Unc" style={{ width: 34, height: 36, objectFit: "contain", flex: "none" }} />
      <div style={{ background: "white", border: "1px solid var(--card-border-2)", borderRadius: "4px 14px 14px 14px", padding: "10px 16px", fontSize: 13.5, color: "oklch(0.3 0.06 262)", lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function EmptyLine({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} style={{ display: "flex", gap: 10, alignItems: "center", background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "14px 18px" }}>
      <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
      <div style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function BarCard({ hb, onFix }: { hb: BarCardView; onFix: () => void }) {
  return (
    <div data-testid="bar-card" data-source={hb.source} style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{hb.what}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: hb.okColor }}>{hb.status}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, letterSpacing: "-0.01em" }}>{hb.bar}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>{hb.proof}</div>
      {hb.behind && (
        <button onClick={onFix} className="hov-bg-cyanwash-deep" style={{ marginTop: 10, border: "none", background: "var(--cyan-wash)", color: "var(--cyan-text)", borderRadius: 999, padding: "6px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
          {hb.fixLabel}
        </button>
      )}
    </div>
  );
}

const EMPTY_TELEMETRY = { review: null, segment: "all", bar: [], automation: { hoursSavedWk: 0, runsThisWeek: 0, routinesOn: 0 } };

export function AccountHome({ V, live = null, telemetry = null, setup = null, onSetupAction, onTurnOn, briefInitial }: HomeViewProps) {
  const isLive = !!live && live.active;
  const liveLoading = !isLive && !live?.error;
  const pendingCount = isLive ? live.pendingCount : 0;
  const baselineMissing = V.baselineMissing;
  const tele = telemetry && telemetry.active ? telemetry.data : null;
  const review = tele?.review ?? null;
  /* The bar: live benchmark / own value when in hand; until then the honest reference cards
     ("Industry reference — not yet from Junction accounts" · "Not measured yet"). */
  const liveBar = barCards(tele ?? EMPTY_TELEMETRY);
  const progress = setup?.data ?? null;
  const drafts = isLive ? live.drafts : [];
  const anyOn = V.enabledRoutineIds.length > 0;
  const proposals = realProposals(V.realInputs);
  const plan = realPlanTimeline({ ...V.realInputs, deadline: V.deadline, planAgreedAt: V.planAgreedAt });
  const showAds = paidInPlan(V.realInputs);
  const auto = automationStrip({ routineOn: V.realInputs.routineOn }, tele ? tele.automation : null);
  const runsDone = progress?.counts.runsDone ?? 0;
  const showAutomation = runsDone >= 1 || (tele?.automation.runsThisWeek ?? 0) >= 1;

  /* Headline bubble: latest self-review → today's brief → the first-day line. */
  const [briefState, setBriefState] = useState<"loading" | "present" | "absent">(briefInitial === undefined ? "loading" : briefInitial ? "present" : "absent");
  const firstDayLine = anyOn ? HOME_COPY.firstDayRunning : HOME_COPY.firstDay;

  /* Motion 1: the plan card settles into the timeline on the first Home after "Agree the plan →". */
  const [settle] = useState(() => V.settlePlan);
  const clearSettle = V.clearSettlePlan;
  useEffect(() => {
    if (settle) clearSettle();
  }, [settle, clearSettle]);
  /* Motion 2: the first draft slides in — only for the first-run moment (a run this session
     was fired from the guided step / "Setting up next"), not on every mount. */
  const draftsN = drafts.length;
  const [slide, setSlide] = useState(false);
  const firstRunPending = V.firstRunPending;
  const clearFirstRun = V.setFirstRunPending;
  const seenDrafts = useRef(false);
  useEffect(() => {
    if (!isLive) return;
    if (draftsN > 0 && firstRunPending && !seenDrafts.current) {
      setSlide(true);
      clearFirstRun(false);
    }
    seenDrafts.current = draftsN > 0;
  }, [isLive, draftsN, firstRunPending, clearFirstRun]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [turnOnNote, setTurnOnNote] = useState<Record<string, string>>({});
  const turnOn = async (id: string) => {
    if (!onTurnOn) return;
    setBusyId(id);
    try {
      const r = await onTurnOn(id);
      setTurnOnNote((n) => ({ ...n, [id]: r.kind === "ran" ? "On — dry run done, the draft is above." : r.kind === "enabled_only" ? `On — the first run didn’t start (${r.error}); it runs on its cadence.` : r.kind === "error" ? `Couldn’t turn it on: ${r.message}` : "On." }));
    } finally {
      setBusyId(null);
    }
  };

  const go = (anchor: SetupAnchor) => onSetupAction?.(anchor);

  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "50px 48px 96px" }}>
      <SetupMotionStyles />
      {/* ---- goal header (live; the baseline-not-set state) ---- */}
      <div data-buddy="Run rate vs needed — that gap is the whole game. I re-plan it live as the numbers move." style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: 20, padding: "30px 34px", boxShadow: "0 8px 30px oklch(0.27 0.055 262 / 0.06)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <input value={V.goalTitle} onChange={V.onGoalTitle} style={{ display: "block", width: "100%", border: "none", outline: "none", background: "transparent", fontWeight: 700, fontSize: 42, letterSpacing: "-0.025em", color: "var(--ink)", padding: 0 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 13.5, color: "var(--muted)" }}>
              by
              <input type="date" value={V.deadline} onChange={V.onDeadline} style={{ border: "none", background: "transparent", fontSize: 13.5, fontWeight: 500, color: "oklch(0.35 0.05 262)", borderBottom: "1px dashed oklch(0.78 0.02 260)", padding: "1px 2px", outline: "none", cursor: "pointer" }} />
              <span>· {V.daysLeftLabel} left</span>
            </div>
          </div>
          {baselineMissing ? (
            <span data-testid="baseline-not-set" style={{ flex: "none", marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "var(--amber-text)", background: "var(--amber-wash)", borderRadius: 999, padding: "8px 17px" }}>
              Baseline not set
            </span>
          ) : (
            <span style={{ flex: "none", marginTop: 8, fontSize: 12.5, fontWeight: 700, color: V.statusColor, background: V.statusBg, borderRadius: 999, padding: "8px 17px" }}>{V.statusLabel}</span>
          )}
        </div>
        <div style={{ marginTop: 22, height: 8, background: "var(--track)", borderRadius: 999 }}>
          <div style={{ width: baselineMissing ? "0%" : V.goalPct, height: 8, background: "linear-gradient(90deg, oklch(0.78 0.13 220), oklch(0.55 0.16 245))", borderRadius: 999, boxShadow: "0 0 14px oklch(0.78 0.13 220 / 0.5)", transition: "width 0.6s" }}></div>
        </div>
        {baselineMissing ? (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12 }}>
            <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, color: "oklch(0.4 0.04 262)", lineHeight: 1.5 }}>{BASELINE_NOT_SET_COPY}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
                Where it is now
                <input type="number" aria-label="Where it is now" value={V.obBaselineNum ?? ""} onChange={V.onObBaselineNum} placeholder={V.obIsMoney ? V.obBudgetMin : "0"} style={{ width: 160, padding: "7px 10px", fontSize: 14, fontWeight: 600, border: "1px solid var(--input-border)", borderRadius: 8, background: "white", color: "var(--ink)", outline: "none" }} />
              </label>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 14.5, marginTop: 12, color: "oklch(0.4 0.04 262)" }}>{V.homePlain}</div>
        )}
        <GettingSetUp progress={progress} loading={!!setup?.loading} error={setup?.error ?? null} dismissed={V.setupCardDismissed} onDismiss={V.dismissSetupCard} onAction={go} />
      </div>

      {/* ---- needs you ---- */}
      <section id={NEEDS_YOU_ID} data-buddy="Only you can clear these. A tap each and the machine keeps moving without you." style={{ marginTop: 34 }}>
        {review && <ReviewBubble review={review} V={V} />}
        <div id={BRIEF_ID}>
          <TodayBrief accountMode initial={briefInitial} onLoaded={(b) => setBriefState(b ? "present" : "absent")} />
        </div>
        {!review && briefState === "absent" && <UncBubble testId="first-day-line">{firstDayLine}</UncBubble>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {liveLoading && (
            <div data-testid="needs-you-loading" style={{ fontSize: 12.5, color: "var(--muted-2)", lineHeight: 1.5, paddingLeft: 36 }}>
              Checking what’s waiting on you…
            </div>
          )}
          {isLive && pendingCount === 0 && <EmptyLine testId="nothing-waiting">{NOTHING_WAITING_COPY}</EmptyLine>}
          {isLive &&
            live.approvals.map((ap) => (
              <div key={ap.key} id={approvalAnchorId(ap.key)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ApprovalCard sys={ap.sys} title={ap.title} detail={ap.detail} before={ap.before} after={ap.after} expiry={ap.expiry} pending={ap.pending} approved={ap.approved} held={ap.held} showWhy={ap.showWhy} whyText={ap.whyText} approvedText={ap.outcomeText} heldText={ap.outcomeText || HELD_TEXT} busy={ap.busy} approve={ap.approve} hold={ap.hold} why={ap.why} />
              </div>
            ))}
          {live?.error && <div style={{ fontSize: 12.5, color: "var(--amber-text)", lineHeight: 1.5, paddingLeft: 36 }}>Couldn’t reach the runtime just now: {live.error}</div>}
          {V.klaviyoNeedsReconnect && (
            <div data-testid="klaviyo-reconnect" style={{ display: "flex", gap: 10 }}>
              <img src="/brand/mascot-small.png" alt="" style={{ ...smallMascot, marginTop: 4 }} />
              <div style={{ background: "white", border: "1px dashed oklch(0.8 0.09 75)", borderRadius: "4px 14px 14px 14px", padding: "14px 18px", flex: 1, minWidth: 0, maxWidth: 760 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "oklch(0.5 0.12 75)", background: "var(--amber-wash)", borderRadius: 5, padding: "2px 7px" }}>NEEDS RECONNECT</span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Klaviyo needs reconnecting</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 5, lineHeight: 1.5 }}>Its token lapsed, so I can’t read your flows or campaigns until you reconnect it. Everything else keeps running.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={V.goConnectorsView} style={{ border: "1px solid oklch(0.8 0.09 75)", background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 999, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    Reconnect
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ---- what I drafted ---- */}
        <div id={DRAFTED_ID} data-testid="what-i-drafted" style={{ marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>What I drafted</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>— dry runs, zero outward actions; nothing here needs you</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {isLive && drafts.length === 0 && (
              <EmptyLine testId="no-drafts">
                {anyOn ? (
                  HOME_COPY.noDraftsRunning
                ) : (
                  <button onClick={() => go("#setting-up-next")} className="hov-underline" style={{ border: "none", background: "transparent", padding: 0, font: "inherit", color: "var(--cyan-link)", cursor: "pointer", textAlign: "left" }}>
                    {HOME_COPY.noDraftsYet}
                  </button>
                )}
              </EmptyLine>
            )}
            {drafts.map((d, i) => (
              <div key={d.runId} className={slide && i === 0 ? "j-slidein" : undefined} data-testid="draft-card" style={{ display: "flex", alignItems: "center", gap: 16, background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "12px 18px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={sysTag}>{d.sys}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{d.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 4, lineHeight: 1.5 }}>{d.line}</div>
                </div>
                <button onClick={() => V.openRoutineById(d.sys)} className="hov-underline" style={{ flex: "none", border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                  Inspect the system →
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- the plan (from plans: real weeks from agreed_at) ---- */}
      <section id="plan" data-buddy="Your plan, on one timeline. The phase we're in is lit up." style={{ marginTop: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={sectionLabel}>The plan</span>
          {V.planAgreedAt && <span style={{ fontSize: 12, color: "var(--muted)" }}>— agreed {new Date(V.planAgreedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}</span>}
          <button onClick={V.goStrategy} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0 }}>
            adjust →
          </button>
        </div>
        <div className={settle ? "j-settle" : undefined} data-testid="plan-timeline" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {plan.map((hp) => (
            <div key={hp.n} data-testid="plan-phase" data-st={hp.st} style={{ display: "flex", alignItems: "center", gap: 16, background: "white", border: `1.5px solid ${hp.on ? "oklch(0.78 0.13 220 / 0.6)" : "oklch(0.91 0.01 260)"}`, borderRadius: 13, padding: "14px 18px" }}>
              <span style={{ flex: "none", width: 88, fontSize: 11, fontWeight: 700, color: hp.on ? "oklch(0.45 0.1 240)" : "oklch(0.6 0.02 260)" }}>{hp.weeks}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{hp.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{hp.focus}</div>
              </div>
              <span style={{ flex: "none", fontSize: 10.5, fontWeight: 600, color: hp.on ? "oklch(0.45 0.1 240)" : "oklch(0.55 0.03 260)", background: hp.on ? "oklch(0.94 0.03 225)" : "oklch(0.945 0.008 260)", borderRadius: 999, padding: "4px 11px" }}>{hp.st}</span>
            </div>
          ))}
        </div>
        {showAds && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>{V.homeAdsLine}</div>}
      </section>

      {/* ---- the bar ---- */}
      <section data-buddy="This is what winning actually takes — benchmarked from businesses that did it. I set up the work; you keep the bar." style={{ marginTop: 34 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={sectionLabel}>The bar</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>— what getting there actually takes, from businesses that did it</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {liveBar.map((hb) => (
            <BarCard key={hb.what} hb={hb} onFix={() => V.openCategory(hb.fixCategory)} />
          ))}
        </div>
      </section>

      {/* ---- automation (real counts; hidden until the first run) ---- */}
      {showAutomation && (
        <section data-testid="automation-strip" data-buddy="Every routine you switch on hands you back hours — and leaves a receipt." style={{ marginTop: 34 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ flex: "none", ...sectionLabel }}>Automation level</span>
            <span style={{ flex: 1, minWidth: 220, fontSize: 12, color: "var(--muted)" }}>— {auto.line}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 8, background: "var(--track)", borderRadius: 999 }}>
              <div style={{ width: auto.pct, height: 8, background: "linear-gradient(90deg, oklch(0.78 0.13 220), oklch(0.55 0.16 245))", borderRadius: 999, boxShadow: "0 0 12px oklch(0.78 0.13 220 / 0.5)" }}></div>
            </div>
            <span style={{ flex: "none", fontSize: 13, fontWeight: 700, color: "var(--cyan-text)" }}>{auto.pct}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {auto.cats.map((gc) => (
              <button key={gc.name} onClick={() => V.openCategory(gc.name)} className="hov-border-cyan" style={{ textAlign: "left", background: "white", border: "1px solid var(--card-border)", borderRadius: 12, padding: "13px 14px", cursor: "pointer" }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{gc.name}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 9 }}>
                  {gc.dots.map((on, i) => (
                    <span key={i} style={{ flex: 1, height: 5, borderRadius: 999, background: on ? "oklch(0.72 0.17 150)" : "oklch(0.92 0.008 260)" }}></span>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: gc.on === gc.total ? "oklch(0.55 0.15 150)" : "oklch(0.52 0.03 260)", marginTop: 7, fontWeight: 500 }}>{gc.sub}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---- setting up next (phase-1 wave-1 routines not yet on) ---- */}
      <section id={SETTING_UP_NEXT_ID} data-buddy="Turn one on and I dry-run it now — draft only. Nothing sends without you." style={{ marginTop: 38 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={sectionLabel}>Setting up next</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>— from your plan’s first phase · always dry-run first</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {proposals.length === 0 && <EmptyLine testId="proposals-empty">{HOME_COPY.allProposalsOn}</EmptyLine>}
          {proposals.map((p, i) => (
            <div key={p.id} data-testid="proposal" data-routine={p.id} style={{ background: "white", border: `1px solid ${i === 0 ? "oklch(0.78 0.13 220 / 0.6)" : "var(--card-border)"}`, borderRadius: 13, padding: "16px 20px", display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={sysTag}>{p.id}</span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</span>
                  {i === 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "2px 9px" }}>Recommended first</span>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 5 }}>
                  {p.why} Runs {cadenceLabel(p.id)}.
                </div>
                {turnOnNote[p.id] && <div style={{ fontSize: 12.5, color: "var(--cyan-text)", marginTop: 6 }}>{turnOnNote[p.id]}</div>}
              </div>
              {p.ready && !turnOnNote[p.id] && (
                <button onClick={() => void turnOn(p.id)} disabled={busyId === p.id} className="btn-cyan" style={{ flex: "none", padding: "8px 18px", fontSize: 12.5, fontWeight: 700 }}>
                  {busyId === p.id ? "Turning on…" : "Turn on"}
                </button>
              )}
              {p.blocked && (
                <button onClick={V.goConnectorsView} className="hov-underline" style={{ flex: "none", border: "none", fontSize: 12, color: "var(--amber-text)", background: "var(--amber-wash)", borderRadius: 999, padding: "7px 15px", fontWeight: 600, cursor: "pointer" }}>
                  {p.blockedLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---- receipts + running ---- */}
      <div data-buddy="Everything I do leaves a receipt. Check my work anytime." style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 44, marginTop: 44 }}>
        <section>
          <div style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 14, fontWeight: 600 }}>Completed</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {isLive &&
              live.receipts.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 11 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)", marginTop: 5.5, flex: "none" }}></span>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                    {r.text}
                    <br />
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>
                      {r.kind} · receipt {r.handle}
                    </span>
                  </div>
                </div>
              ))}
            {isLive && live.receipts.length === 0 && <div data-testid="no-receipts" style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.5 }}>{HOME_COPY.noReceipts}</div>}
          </div>
        </section>
        <section>
          <div style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 14, fontWeight: 600 }}>Running &amp; next</div>
          <div data-testid="running-next" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {progress?.running.map((r) => (
              <div key={r.runId} style={{ display: "flex", gap: 11 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)", marginTop: 5.5, flex: "none", animation: "jpulse 1.6s infinite" }}></span>
                <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                  {r.name} <span style={{ color: "var(--muted)" }}>· running</span>
                </div>
              </div>
            ))}
            {progress?.platforms
              .filter((p) => p.status === "needs_reconnect" || p.status === "error")
              .map((p) => (
                <div key={p.platform} style={{ display: "flex", gap: 11 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--amber)", marginTop: 5.5, flex: "none" }}></span>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                    {platformName(p.platform)} needs reconnecting <span style={{ color: "var(--muted)" }}>· its reads wait until then</span>
                  </div>
                </div>
              ))}
            {V.enabledRoutineIds.map((id) => (
              <div key={id} style={{ display: "flex", gap: 11 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "oklch(0.82 0.02 260)", marginTop: 5.5, flex: "none" }}></span>
                <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                  {V.routineNameById(id)} <span style={{ color: "var(--muted)" }}>· {cadenceLabel(id)} · dry run</span>
                </div>
              </div>
            ))}
            {V.enabledRoutineIds.length === 0 && !progress?.running.length && <div data-testid="nothing-scheduled" style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.5 }}>{HOME_COPY.nothingScheduled}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
