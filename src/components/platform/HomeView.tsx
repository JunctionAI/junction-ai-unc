"use client";

import React from "react";
import type { PlatformVals } from "@/lib/platform/derive";

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

export default function HomeView({ V }: { V: PlatformVals }) {
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
          <span style={{ flex: "none", marginTop: 8, fontSize: 12.5, fontWeight: 700, color: V.statusColor, background: V.statusBg, borderRadius: 999, padding: "8px 17px" }}>{V.statusLabel}</span>
        </div>
        <div style={{ marginTop: 22, height: 8, background: "var(--track)", borderRadius: 999 }}>
          <div
            style={{
              width: V.goalPct,
              height: 8,
              background: "linear-gradient(90deg, oklch(0.78 0.13 220), oklch(0.55 0.16 245))",
              borderRadius: 999,
              boxShadow: "0 0 14px oklch(0.78 0.13 220 / 0.5)",
              transition: "width 0.6s",
            }}
          ></div>
        </div>
        <div style={{ fontSize: 14.5, marginTop: 12, color: "oklch(0.4 0.04 262)" }}>{V.homePlain}</div>
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
            <span style={{ fontSize: 11, background: "var(--amber-wash)", color: "var(--amber-text)", borderRadius: 999, padding: "2px 9px", fontWeight: 600, marginLeft: 4 }}>{V.needsCount}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {V.allClear && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "14px 18px" }}>
              <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
              <div style={{ fontSize: 13, color: "var(--muted-2)", lineHeight: 1.5 }}>
                Nothing needs you right now — the machine is running. I’ll surface the next decision here the moment it’s ready.
              </div>
            </div>
          )}
          {V.approvals.map((ap, i) => (
            <React.Fragment key={i}>
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
                      <button onClick={ap.approve} className="btn-navy" style={{ padding: "8px 18px", fontSize: 12.5, fontWeight: 600 }}>
                        Approve
                      </button>
                      <button
                        onClick={ap.hold}
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
                    <div style={uncReceiptText}>On it — executing only the approved scope, reading the result back, then receipt {ap.receipt} lands here.</div>
                  </div>
                </>
              )}
              {ap.held && (
                <>
                  <div style={userBubble}>Hold for now</div>
                  <div style={uncReceiptRow}>
                    <img src="/brand/mascot-small.png" alt="" style={smallMascot} />
                    <div style={uncReceiptText}>Held. I’ll re-surface it tomorrow with fresh numbers — nothing moves meanwhile.</div>
                  </div>
                </>
              )}
            </React.Fragment>
          ))}
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
          {V.homeBar.map((hb) => (
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
        </div>
      </section>

      <section data-buddy="Every routine you switch on makes the machine more OP — and hands you back hours." style={{ marginTop: 34 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ flex: "none", ...sectionLabel }}>Automation level</span>
          <span style={{ flex: 1, minWidth: 220, fontSize: 12, color: "var(--muted)" }}>
            — {V.gamOnCount} of {V.gamTotal} routines running · saving you ~{V.gamHrs} h/week
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
            {V.completed.map((c) => (
              <div key={c.receipt} style={{ display: "flex", gap: 11 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)", marginTop: 5.5, flex: "none" }}></span>
                <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                  {c.text}
                  <br />
                  <a href="#">{c.receipt}</a>
                </div>
              </div>
            ))}
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
