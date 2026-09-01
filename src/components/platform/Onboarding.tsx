"use client";

import React from "react";
import type { PlatformVals } from "@/lib/platform/derive";
import TypingDots from "./TypingDots";

const stepLabel: React.CSSProperties = {
  fontSize: 10.5,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: "var(--cyan-link)",
  fontWeight: 700,
};

const stepH2: React.CSSProperties = { fontWeight: 600, fontSize: 26, margin: "10px 0 0", letterSpacing: "-0.015em" };

const microLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--muted)",
  fontWeight: 700,
};

const cardLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--muted)",
  fontWeight: 600,
};

const chipStyle = (c: { border: string; bg: string; color: string }): React.CSSProperties => ({
  border: `1.5px solid ${c.border}`,
  background: c.bg,
  color: c.color,
  borderRadius: 999,
  padding: "9px 17px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
});

const textInput: React.CSSProperties = {
  border: "1px solid var(--input-border)",
  borderRadius: 10,
  padding: "11px 13px",
  fontSize: 13.5,
  outline: "none",
  background: "white",
  color: "var(--ink)",
};

export default function Onboarding({ V }: { V: PlatformVals }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px", position: "relative" }}>
      <div style={{ width: 680, maxWidth: "100%" }}>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 34 }}>
          {V.obDots.map((d, i) => (
            <span key={i} style={{ width: d.w, height: 6, borderRadius: 999, background: d.bg, transition: "all 0.3s" }}></span>
          ))}
        </div>

        {V.ob0 && (
          <div style={{ textAlign: "center", position: "relative" }}>
            <img src="/brand/mascot.png" alt="Junction" style={{ width: 170, height: 182, objectFit: "contain", animation: "jfloat 5s ease-in-out infinite" }} />
            <h1 style={{ fontWeight: 600, fontSize: 32, margin: "14px 0 0", letterSpacing: "-0.02em" }}>Hey! I&apos;m Unc.</h1>
            <div style={{ fontSize: 15, color: "oklch(0.45 0.03 262)", marginTop: 12, lineHeight: 1.65, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>
              My number one goal is to help you grow your business. Let&apos;s get started.
            </div>
            <button onClick={V.obNext} className="btn-navy" style={{ marginTop: 26, padding: "13px 34px", fontSize: 14.5, fontWeight: 600 }}>
              Let’s go →
            </button>
            <div style={{ marginTop: 16 }}>
              <button onClick={V.obFinish} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12.5, cursor: "pointer" }}>
                Skip — explore with demo data
              </button>
            </div>
          </div>
        )}

        {V.ob1 && (
          <>
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", top: -26, right: 0, display: "flex", alignItems: "flex-end", gap: 8 }}>
                <div
                  style={{
                    background: "white",
                    border: "1px solid var(--card-border-2)",
                    borderRadius: "14px 14px 4px 14px",
                    padding: "9px 14px",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "oklch(0.3 0.06 262)",
                    boxShadow: "0 6px 20px oklch(0.27 0.055 262 / 0.12)",
                    maxWidth: 250,
                  }}
                >
                  One clear goal beats five vague ones — and we can always change it later!
                </div>
                <img src="/brand/mascot-small.png" alt="Unc" style={{ width: 44, height: 47, objectFit: "contain", flex: "none", animation: "jfloat 5s ease-in-out infinite" }} />
              </div>
            </div>
            <div style={stepLabel}>Step 1 · The goal</div>
            <h2 style={stepH2}>What are you trying to grow?</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 22 }}>
              {V.obGoalCats.map((gc) => (
                <button
                  key={gc.label}
                  onClick={gc.toggle}
                  className="hov-border-cyan"
                  style={{ textAlign: "left", border: `1.5px solid ${gc.border}`, background: gc.bg, borderRadius: 13, padding: "13px 15px", cursor: "pointer" }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{gc.label}</div>
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 22, maxWidth: 560 }}>
              <label style={{ display: "block" }}>
                <span style={microLabel}>{V.obMetricLabel}</span>
                <input
                  type="number"
                  value={V.obTargetNum}
                  onChange={V.onObTargetNum}
                  style={{ display: "block", width: "100%", marginTop: 6, ...textInput, fontSize: 16, fontWeight: 600 }}
                />
              </label>
              <label style={{ display: "block" }}>
                <span style={microLabel}>Where it is now</span>
                <input
                  type="number"
                  value={V.obBaselineNum}
                  onChange={V.onObBaselineNum}
                  style={{ display: "block", width: "100%", marginTop: 6, ...textInput, fontSize: 16, fontWeight: 600, color: "var(--muted)" }}
                />
              </label>
              <label style={{ display: "block" }}>
                <span style={microLabel}>By when</span>
                <input
                  type="date"
                  value={V.deadline}
                  onChange={V.onDeadline}
                  style={{ display: "block", width: "100%", marginTop: 6, ...textInput, fontSize: 14, fontWeight: 500, fontFamily: "'Space Grotesk', sans-serif" }}
                />
              </label>
            </div>
            {V.obIsMoney && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
                <span style={microLabel}>Currency</span>
                {V.obCurrencies.map((cu) => (
                  <button
                    key={cu.code}
                    onClick={cu.pick}
                    className="hov-border-cyan"
                    style={{ border: `1.5px solid ${cu.border}`, background: cu.bg, color: cu.color, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    {cu.code}
                  </button>
                ))}
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>— sets your account currency</span>
              </div>
            )}
          </>
        )}

        {V.ob2 && (
          <>
            <div style={stepLabel}>Step 2 · Your data</div>
            <h2 style={stepH2}>What platforms do you currently use?</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 22 }}>
              {V.obConns.map((oc) => (
                <button key={oc.label} onClick={oc.toggle} className="hov-border-cyan" style={chipStyle(oc)}>
                  {oc.label}
                </button>
              ))}
            </div>
          </>
        )}

        {V.ob3 && (
          <>
            <div style={stepLabel}>Step 3 · Your resources</div>
            <h2 style={stepH2}>What can you put into growth?</h2>
            <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
              Just what you’d spend on new growth — ads, content, tools, extra hands. Not your existing team or running costs.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 22 }}>
              <div style={{ border: "1px solid var(--card-border-2)", borderRadius: 13, padding: "16px 18px", background: "white" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={cardLabel}>Budget for growth</span>
                  <span style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)" }}>{V.obBudgetLabel}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20000}
                  step={250}
                  value={V.obBudgetMo}
                  onChange={V.onObBudget}
                  style={{ display: "block", width: "100%", marginTop: 16, accentColor: "var(--cyan-link)", cursor: "pointer" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "oklch(0.6 0.02 260)", marginTop: 4 }}>
                  <span>{V.obBudgetMin}</span>
                  <span>{V.obBudgetMax}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>≈ {V.obBudgetDay}/day — becomes the hard spend guardrail</div>
              </div>
              <div style={{ border: "1px solid var(--card-border-2)", borderRadius: 13, padding: "16px 18px", background: "white" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={cardLabel}>Your hours into growth per week</span>
                  <span style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)" }}>{V.obHoursLabel}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={V.obHoursWk}
                  onChange={V.onObHours}
                  style={{ display: "block", width: "100%", marginTop: 16, accentColor: "var(--cyan-link)", cursor: "pointer" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "oklch(0.6 0.02 260)", marginTop: 4 }}>
                  <span>0</span>
                  <span>100 h</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>{V.obHoursNote}</div>
              </div>
            </div>
            <button
              onClick={V.obToggleMoney}
              className="hov-underline"
              style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, border: "none", background: "transparent", padding: 0, fontSize: 13, fontWeight: 600, color: "var(--cyan-link)", cursor: "pointer" }}
            >
              {V.obMoneyChevron} Fine-tune the money side <span style={{ fontWeight: 400, color: "oklch(0.55 0.03 260)" }}>optional</span>
            </button>
            {V.obMoneyOpen && (
              <div style={{ marginTop: 14, border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 18px", background: "white" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={cardLabel}>What you keep from each dollar (net margin)</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{V.obMarginLabel}</span>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    step={1}
                    value={V.obMargin}
                    onChange={V.onObMargin}
                    style={{ flex: 1, minWidth: 180, maxWidth: 320, accentColor: "var(--cyan-link)", cursor: "pointer" }}
                  />
                </div>
                <span style={{ display: "block", marginTop: 16, ...cardLabel }}>As growth brings in new profit, how much goes back in?</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 8 }}>
                  {V.obReinvest.map((rv) => (
                    <button
                      key={rv.label}
                      onClick={rv.pick}
                      className="hov-border-cyan"
                      style={{ textAlign: "left", border: `1.5px solid ${rv.border}`, background: rv.bg, borderRadius: 13, padding: "13px 15px", cursor: "pointer" }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{rv.label}</div>
                      <div style={{ fontSize: 11.5, color: "oklch(0.55 0.03 260)", marginTop: 3 }}>{rv.pct} of new profit</div>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>{V.obReinvestNote}</div>
              </div>
            )}
            <button
              onClick={V.obToggleTeam}
              className="hov-underline"
              style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, border: "none", background: "transparent", padding: 0, fontSize: 13, fontWeight: 600, color: "var(--cyan-link)", cursor: "pointer" }}
            >
              {V.obTeamChevron} Add your team <span style={{ fontWeight: 400, color: "oklch(0.55 0.03 260)" }}>optional — solo works great</span>
            </button>
            {V.obTeamOpen && (
              <div style={{ marginTop: 14, border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 18px", background: "white" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {V.obTeam.map((tm, i) => (
                    <React.Fragment key={i}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input value={tm.name} onChange={tm.setName} placeholder="Name" style={{ flex: 1, ...textInput, padding: "10px 13px" }} />
                        <select
                          value={tm.role}
                          onChange={tm.setRole}
                          style={{ flex: 1, border: "1px solid var(--input-border)", borderRadius: 10, padding: "10px 11px", fontSize: 13.5, outline: "none", background: "white", color: "var(--ink)", fontFamily: "'Space Grotesk', sans-serif" }}
                        >
                          <option>Founder</option>
                          <option>Marketing</option>
                          <option>Sales</option>
                          <option>Content creator</option>
                          <option>Designer</option>
                          <option>Developer</option>
                          <option>Ops &amp; support</option>
                          <option>Agency / contractor</option>
                        </select>
                        <button
                          onClick={tm.remove}
                          title="Remove"
                          className="hov-fg-warn"
                          style={{ flex: "none", border: "none", background: "transparent", color: "oklch(0.6 0.02 260)", fontSize: 15, cursor: "pointer", padding: "4px 6px", lineHeight: 1 }}
                        >
                          ×
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "2px 0 6px" }}>
                        <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "oklch(0.6 0.02 260)", fontWeight: 600 }}>Is responsible for approving</span>
                        {tm.areas.map((ar) => (
                          <button
                            key={ar.t}
                            onClick={ar.toggle}
                            className="hov-border-cyan"
                            style={{ border: `1.5px solid ${ar.border}`, background: ar.bg, color: ar.color, borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}
                          >
                            {ar.t}
                          </button>
                        ))}
                      </div>
                    </React.Fragment>
                  ))}
                  <button
                    onClick={V.obAddPerson}
                    className="hov-border-cyanlink"
                    style={{ alignSelf: "flex-start", fontSize: 12.5, border: "1px dashed oklch(0.8 0.02 260)", borderRadius: 999, padding: "7px 15px", background: "transparent", color: "var(--cyan-link)", cursor: "pointer", fontWeight: 500 }}
                  >
                    + Add person
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {V.ob4 && (
          <>
            <div style={stepLabel}>Step 4 · Your strengths</div>
            <h2 style={stepH2}>Where are you genuinely good?</h2>
            <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
              Your constraint is tied to your strengths. I’ll build the plan around where you add value no agent can — and carry the rest.
            </div>
            <div style={{ ...cardLabel, marginTop: 22 }}>Skills</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {V.obStrengthChips.map((sc2) => (
                <button key={sc2.t} onClick={sc2.toggle} className="hov-border-cyan" style={chipStyle(sc2)}>
                  {sc2.t}
                </button>
              ))}
            </div>
            <div style={{ ...cardLabel, marginTop: 20 }}>Platforms you know</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {V.obPlatformChips.map((pc) => (
                <button key={pc.t} onClick={pc.toggle} className="hov-border-cyan" style={chipStyle(pc)}>
                  {pc.t}
                </button>
              ))}
            </div>
            <div style={{ ...cardLabel, marginTop: 20 }}>Where can I learn about your business?</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10, maxWidth: 560 }}>
              <input value={V.obWebsite} onChange={V.onObWebsite} placeholder="yourwebsite.com" style={textInput} />
              <input value={V.obSocials} onChange={V.onObSocials} placeholder="@instagram, @tiktok, linkedin…" style={textInput} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>I’ll scan these to understand your business, voice and market — it makes the plan much sharper.</div>
          </>
        )}

        {V.ob5 && (
          <>
            <div style={stepLabel}>Step 5 · Your way</div>
            <h2 style={stepH2}>How do you believe you should grow?</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 22 }}>
              {V.postures.map((po) => (
                <button
                  key={po.label}
                  onClick={po.pick}
                  className="hov-border-cyan"
                  style={{ textAlign: "left", background: "white", border: `1.5px solid ${po.border}`, borderRadius: 13, padding: "15px 16px", cursor: "pointer" }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{po.label}</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 10 }}>
                    {po.skillChips.map((k) => (
                      <span key={k.t} style={{ fontSize: 10.5, borderRadius: 999, padding: "3px 9px", background: k.bg, color: k.color }}>
                        {k.t}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                    {po.platChips.map((k) => (
                      <span key={k.t} style={{ fontSize: 10.5, borderRadius: 999, padding: "3px 9px", background: k.bg, color: k.color }}>
                        {k.t}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--cyan-text)", marginTop: 9, fontWeight: 600 }}>{po.match}</div>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Breadth:</span>
              <button
                onClick={V.obFocused}
                style={{ border: `1.5px solid ${V.focBorder}`, background: V.focBg, color: V.focColor, borderRadius: 999, padding: "8px 16px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
              >
                Focused — few channels, deep
              </button>
              <button
                onClick={V.obBroad}
                style={{ border: `1.5px solid ${V.broBorder}`, background: V.broBg, color: V.broColor, borderRadius: 999, padding: "8px 16px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
              >
                Broad — as many channels running as possible
              </button>
            </div>
          </>
        )}

        {V.ob6 && (
          <>
            <div style={stepLabel}>Step 6 · Agree the plan</div>
            <h2 style={stepH2}>Unc’s plan for you</h2>
            <div style={{ marginTop: 18, display: "flex", gap: 14 }}>
              <img src="/brand/mascot-small.png" alt="Unc" style={{ width: 44, height: 47, objectFit: "contain", flex: "none", marginTop: 4 }} />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "white",
                  border: "1px solid var(--card-border-2)",
                  borderRadius: "4px 18px 18px 18px",
                  padding: "20px 24px",
                  boxShadow: "0 6px 24px oklch(0.27 0.055 262 / 0.08)",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>{V.obSummaryTitle}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "oklch(0.4 0.04 262)", marginTop: 8 }}>{V.obPlanShort}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14, fontSize: 13, color: "oklch(0.35 0.05 262)" }}>
                  <div style={{ display: "flex", gap: 9 }}>
                    <span style={{ color: "var(--cyan-link)", fontWeight: 700 }}>1</span>
                    {V.obPlanStep1}
                  </div>
                  <div style={{ display: "flex", gap: 9 }}>
                    <span style={{ color: "var(--cyan-link)", fontWeight: 700 }}>2</span>
                    {V.obPlanStep2}
                  </div>
                  <div style={{ display: "flex", gap: 9 }}>
                    <span style={{ color: "var(--cyan-link)", fontWeight: 700 }}>3</span>
                    {V.obPlanStep3}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 14, lineHeight: 1.6 }}>
                  I do the work — you bring taste and okays. I’ll scan your site and socials tonight and sharpen this before anything runs.
                </div>
              </div>
            </div>
            {V.obThreadMsgs.map((om, i) => (
              <React.Fragment key={i}>
                {om.fromUser && (
                  <div
                    style={{
                      marginTop: 10,
                      marginLeft: "auto",
                      maxWidth: "70%",
                      width: "fit-content",
                      background: "var(--navy)",
                      borderRadius: "14px 14px 4px 14px",
                      padding: "9px 14px",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: "var(--on-navy)",
                    }}
                  >
                    {om.text}
                  </div>
                )}
                {om.fromJ && (
                  <div style={{ marginTop: 10, display: "flex", gap: 10, maxWidth: "86%" }}>
                    <img src="/brand/mascot-small.png" alt="" style={{ width: 26, height: 28, objectFit: "contain", flex: "none", marginTop: 2 }} />
                    <div style={{ background: "white", border: "1px solid var(--card-border-2)", borderRadius: "4px 14px 14px 14px", padding: "9px 14px", fontSize: 12.5, lineHeight: 1.55, color: "oklch(0.35 0.05 262)" }}>
                      {om.typing ? <TypingDots /> : om.text}
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 14, background: "white", border: "1px solid var(--card-border-2)", borderRadius: 999, padding: "5px 5px 5px 18px" }}>
              <input
                value={V.obDraft}
                onChange={V.onObDraft}
                onKeyDown={V.onObKey}
                placeholder="Push back or ask why — we agree it together…"
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13, color: "var(--ink)" }}
              />
              <button onClick={V.obSend} className="btn-navy" style={{ padding: "9px 18px", fontSize: 12.5, fontWeight: 600 }}>
                Send
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <button onClick={V.obFinish} className="btn-cyan" style={{ padding: "13px 34px", fontSize: 14.5, fontWeight: 700 }}>
                Agree the plan →
              </button>
            </div>
          </>
        )}

        {V.obMid && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32 }}>
            <button onClick={V.obBack} className="hov-fg-ink" style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
              ← Back
            </button>
            <button onClick={V.obNext} className="btn-navy" style={{ padding: "11px 26px", fontSize: 13.5, fontWeight: 600 }}>
              Continue →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
