"use client";

import { useState } from "react";
import Link from "next/link";

/* Landing page — pixel port of design-reference/Junction Landing.dc.html.
   Copy is verbatim by handoff rule; do not "improve" strings. */

const label: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: "var(--cyan-text)",
  fontWeight: 600,
};

const stepCard: React.CSSProperties = {
  flex: 1,
  background: "var(--navy-raised)",
  borderRadius: 16,
  padding: "24px 26px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

const stepLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.13em",
  textTransform: "uppercase",
  color: "var(--cyan)",
  fontWeight: 700,
};

const arrowJoint = (
  <div style={{ flex: "none", display: "flex", alignItems: "center", padding: "0 6px" }}>
    <div style={{ width: 34, height: 2, background: "oklch(0.5 0.08 240)", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          right: -1,
          top: -4,
          width: 0,
          height: 0,
          borderLeft: "7px solid oklch(0.5 0.08 240)",
          borderTop: "5px solid transparent",
          borderBottom: "5px solid transparent",
        }}
      />
    </div>
  </div>
);

function RoutineCategoryCard(props: {
  icon: React.ReactNode;
  category: string;
  count: string;
  title: string;
  desc: string;
  chip: string;
  also: string;
}) {
  return (
    <div
      style={{
        background: "var(--cream)",
        border: "1px solid var(--card-border)",
        borderRadius: 14,
        padding: "18px 19px",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: "var(--navy)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {props.icon}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 12 }}>
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.13em",
            textTransform: "uppercase",
            color: "var(--cyan-text)",
            fontWeight: 700,
          }}
        >
          {props.category}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "oklch(0.35 0.08 240)",
            background: "var(--cyan-wash)",
            borderRadius: 999,
            padding: "2px 8px",
          }}
        >
          {props.count}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 9 }}>{props.title}</div>
      <div style={{ fontSize: 12, color: "var(--muted-2)", lineHeight: 1.55, marginTop: 5 }}>
        {props.desc}
      </div>
      <div
        style={{
          display: "inline-block",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--cyan-text)",
          background: "var(--cyan-wash)",
          borderRadius: 999,
          padding: "4px 10px",
          marginTop: 10,
        }}
      >
        {props.chip}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "oklch(0.55 0.03 260)",
          lineHeight: 1.55,
          marginTop: 10,
          borderTop: "1px solid var(--hairline)",
          paddingTop: 9,
        }}
      >
        {props.also}
      </div>
    </div>
  );
}

export default function Landing() {
  const [lm, setLm] = useState<"ai" | "human">("ai");
  const ai = lm === "ai";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--cream)",
        color: "var(--ink)",
        position: "relative",
      }}
    >
      <nav
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "22px 40px",
          display: "flex",
          alignItems: "center",
          gap: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mascot-small.png" alt="Unc" style={{ width: 34, height: 36, objectFit: "contain" }} />
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>Junction</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 13.5, fontWeight: 500 }}>
          <Link href="/app">
            <button className="btn-navy" style={{ padding: "10px 20px", fontSize: 13 }}>
              Meet Unc
            </button>
          </Link>
        </div>
      </nav>

      <header
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "64px 40px 80px",
          display: "flex",
          alignItems: "center",
          gap: 56,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: "-0.035em",
              lineHeight: 1.04,
              margin: "20px 0 0",
            }}
          >
            Meet Unc: He&apos;ll help you grow your business
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.65,
              color: "var(--ink-soft)",
              margin: "20px 0 0",
              maxWidth: 520,
            }}
          >
            To get started, set a goal, and get to work together.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 30, alignItems: "center" }}>
            <Link href="/app">
              <button
                className="btn-cyan-strong"
                style={{
                  padding: "14px 30px",
                  fontSize: 15,
                  boxShadow: "0 8px 28px oklch(0.55 0.16 245 / 0.35)",
                }}
              >
                Agree your first goal →
              </button>
            </Link>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              5 quick questions and you&rsquo;re away&nbsp;🚀
            </span>
          </div>
          {/* prototype's (empty) stats row — kept for identical vertical centering of the hero column */}
          <div style={{ display: "flex", gap: 26, marginTop: 36 }}>
            <div />
            <div />
            <div />
          </div>
        </div>
        <div style={{ flex: "none", position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: "20% 10%",
              background: "radial-gradient(closest-side, oklch(0.78 0.13 220 / 0.28), transparent 70%)",
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/mascot.png"
            alt="Unc, the growth agent"
            style={{
              width: 340,
              height: 363,
              objectFit: "contain",
              position: "relative",
              animation: "jfloat 5.5s ease-in-out infinite",
              filter: "drop-shadow(0 24px 48px oklch(0.27 0.055 262 / 0.25))",
            }}
          />
        </div>
      </header>

      <section style={{ background: "var(--navy)", color: "var(--on-navy)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "72px 40px" }}>
          <h2
            style={{
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "14px 0 0",
              maxWidth: 640,
              lineHeight: 1.2,
            }}
          >
            Growing your business is actually simple.
          </h2>
          <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginTop: 64 }}>
            <div style={stepCard}>
              <div style={stepLabel}>01 · Set a goal</div>
            </div>
            {arrowJoint}
            <div style={stepCard}>
              <div style={stepLabel}>02 · Hit an obstacle</div>
            </div>
            {arrowJoint}
            <div
              style={{
                ...stepCard,
                flex: 1.2,
                border: "1.5px solid oklch(0.78 0.13 220 / 0.6)",
                position: "relative",
              }}
            >
              <div style={stepLabel}>03 · Solve it, repeatably</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/mascot-small.png"
                alt="Junction"
                style={{
                  position: "absolute",
                  top: -42,
                  right: 14,
                  width: 52,
                  height: 56,
                  objectFit: "contain",
                  animation: "jfloat 4.5s ease-in-out infinite",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: -50,
                  right: 74,
                  background: "white",
                  color: "oklch(0.3 0.06 262)",
                  borderRadius: "12px 12px 4px 12px",
                  padding: "7px 12px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  boxShadow: "0 8px 20px oklch(0.15 0.04 262 / 0.4)",
                  whiteSpace: "nowrap",
                }}
              >
                I&rsquo;ll help you with this!
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22, marginLeft: "8%" }}>
            <div
              style={{
                flex: "none",
                width: 0,
                height: 0,
                borderRight: "7px solid oklch(0.5 0.08 240)",
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
              }}
            />
            <div
              style={{
                flex: 1,
                height: 2,
                background:
                  "repeating-linear-gradient(90deg, oklch(0.5 0.08 240) 0 8px, transparent 8px 15px)",
                marginRight: "8%",
              }}
            />
          </div>
        </div>
      </section>

      <section
        id="routines"
        style={{
          background: "white",
          borderTop: "1px solid var(--hairline)",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "80px 40px",
            display: "flex",
            gap: 56,
            alignItems: "center",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={label}>The routines</div>
            <h2 style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em", margin: "14px 0 0" }}>
              &ldquo;Here&rsquo;s how I repeatably solve your growth problems!&rdquo;
            </h2>
            <div style={{ display: "flex", gap: 20, alignItems: "flex-end", marginTop: 24 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/mascot.png"
                alt="Junction"
                style={{
                  flex: "none",
                  width: 128,
                  height: 137,
                  objectFit: "contain",
                  animation: "jfloat 5s ease-in-out infinite",
                  filter: "drop-shadow(0 12px 24px oklch(0.27 0.055 262 / 0.2))",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 380 }}>
                <div
                  style={{
                    background: "white",
                    border: "1.5px solid oklch(0.78 0.13 220 / 0.5)",
                    borderRadius: "14px 14px 14px 4px",
                    padding: "12px 16px",
                    fontSize: 14.5,
                    lineHeight: 1.6,
                    boxShadow: "0 6px 18px oklch(0.27 0.055 262 / 0.08)",
                  }}
                >
                  Every day or week, at a time we agree, <b>I do the task!</b> Then I send it to you to
                  apply your taste and approve.
                </div>
                <div
                  style={{
                    background: "white",
                    border: "1.5px solid oklch(0.78 0.13 220 / 0.5)",
                    borderRadius: "14px 14px 14px 4px",
                    padding: "12px 16px",
                    fontSize: 14.5,
                    lineHeight: 1.6,
                    boxShadow: "0 6px 18px oklch(0.27 0.055 262 / 0.08)",
                  }}
                >
                  Or your team member can — even more efficient!
                </div>
                <div
                  style={{
                    background: "var(--navy)",
                    color: "var(--on-navy)",
                    borderRadius: "14px 14px 14px 4px",
                    padding: "12px 16px",
                    fontSize: 14.5,
                    lineHeight: 1.6,
                  }}
                >
                  I have routines for so many things! They&rsquo;ve helped other businesses generate
                  millions of dollars, <b style={{ color: "var(--cyan)" }}>and you can be next!</b>
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              flex: "none",
              width: 400,
              background: "var(--cream)",
              border: "1px solid var(--card-border)",
              borderRadius: 18,
              padding: 22,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: "var(--cyan-link)",
                  background: "var(--cyan-wash)",
                  borderRadius: 5,
                  padding: "3px 8px",
                }}
              >
                D01-W01
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "var(--cyan-text)",
                  background: "var(--cyan-wash)",
                  borderRadius: 5,
                  padding: "3px 8px",
                }}
              >
                Active
              </span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 12 }}>Viral content creator</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-2)", lineHeight: 1.55, marginTop: 6 }}>
              Scans your niche for viral content, applies the hooks and scripts to your business, and
              briefs you to make them each morning.
            </div>
            <div style={{ display: "flex", alignItems: "center", marginTop: 18 }}>
              {(
                [
                  ["SCAN", "niche, nightly", "1.5px solid oklch(0.78 0.13 220)"],
                  ["ADAPT", "hooks + script", "1px solid var(--card-border-2)"],
                  ["BRIEF YOU", "morning", "1px solid oklch(0.8 0.09 75)"],
                  ["YOU FILM", "posts + learns", "1px solid var(--card-border-2)"],
                ] as const
              ).map(([t, s, border], i) => (
                <div key={t} style={{ display: "contents" }}>
                  {i > 0 && <div style={{ width: 9, height: 2, background: "oklch(0.8 0.02 260)", flex: "none" }} />}
                  <div
                    style={{
                      flex: "none",
                      background: "white",
                      border,
                      borderRadius: 9,
                      padding: "6px 7px",
                      fontSize: 9,
                      fontWeight: 600,
                    }}
                  >
                    {t}
                    <br />
                    <span style={{ fontWeight: 400, color: "var(--muted-2)" }}>{s}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 14 }}>
              Every routine: an inspectable pipeline you can open, question and edit.
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 40px 80px" }}>
          <div style={label}>The realm of routines</div>
          <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", margin: "10px 0 0" }}>
            35 routines across five channels — one example each, the rest waiting inside.
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginTop: 24 }}>
            <RoutineCategoryCard
              icon={
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path d="M6 4.5 L13.5 9 L6 13.5 Z" fill="oklch(0.78 0.13 220)" />
                </svg>
              }
              category="Content"
              count="4 routines"
              title="Founder content engine"
              desc="Turns real customer questions into posts in your voice."
              chip="“3 reel briefs waiting — hooks pre-written”"
              also="Also: Customer-question mining · Social repurposing · Performance learning"
            />
            <RoutineCategoryCard
              icon={
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <rect x="3" y="10" width="3" height="5" rx="1" fill="oklch(0.78 0.13 220)" />
                  <rect x="7.5" y="7" width="3" height="8" rx="1" fill="oklch(0.78 0.13 220)" />
                  <rect x="12" y="3.5" width="3" height="11.5" rx="1" fill="oklch(0.78 0.13 220)" />
                </svg>
              }
              category="Paid ads"
              count="4 routines"
              title="Daily paid decisioning"
              desc="Checks every ad each morning and moves budget to what’s working."
              chip="“shift NZ$40/day to the 3.1× winner”"
              also="Also: Creative test planner · Budget pacing guard · Organic-to-paid"
            />
            <RoutineCategoryCard
              icon={
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <circle cx="7.5" cy="7.5" r="4.5" fill="none" stroke="oklch(0.78 0.13 220)" strokeWidth="2" />
                  <path d="M11 11 L15 15" stroke="oklch(0.78 0.13 220)" strokeWidth="2" strokeLinecap="round" />
                </svg>
              }
              category="SEO"
              count="4 routines"
              title="Keyword opportunity scan"
              desc="Finds searches you can win before you write a word."
              chip="“12 keywords you could rank for this month”"
              also="Also: Content gap analysis · On-page fixes · SERP position watch"
            />
            <RoutineCategoryCard
              icon={
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <circle cx="9" cy="9" r="6.5" fill="none" stroke="oklch(0.78 0.13 220)" strokeWidth="2" />
                  <circle cx="9" cy="9" r="2" fill="oklch(0.78 0.13 220)" />
                </svg>
              }
              category="Sales"
              count="4 routines"
              title="Lead research & scoring"
              desc="Researches leads overnight so you only talk to the right ones."
              chip="“6 qualified leads briefed before your coffee”"
              also="Also: Supervised outbound drafts · Follow-up cadence · Pipeline hygiene"
            />
            <RoutineCategoryCard
              icon={
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <rect x="2.5" y="4" width="13" height="10" rx="2" fill="none" stroke="oklch(0.78 0.13 220)" strokeWidth="2" />
                  <path d="M3.5 5.5 L9 10 L14.5 5.5" fill="none" stroke="oklch(0.78 0.13 220)" strokeWidth="2" strokeLinecap="round" />
                </svg>
              }
              category="Email & SMS"
              count="5 routines"
              title="Abandoned cart recovery"
              desc="Politely brings back the ones who almost bought."
              chip="“NZ$1,900/mo recovered on autopilot”"
              also="Also: Welcome flow · Winback · Review timing · Campaign calendar"
            />
          </div>
        </div>
      </section>

      <section
        id="corner"
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "80px 40px",
          display: "flex",
          gap: 56,
          alignItems: "center",
        }}
      >
        <div style={{ flex: "none", width: 420 }}>
          <div
            style={{
              background: "white",
              border: "1px solid var(--card-border-2)",
              borderRadius: 18,
              boxShadow: "0 18px 50px oklch(0.27 0.055 262 / 0.14)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "12px 14px 10px", background: "var(--navy)", color: "var(--on-navy)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/mascot-small.png" alt="" style={{ width: 28, height: 30, objectFit: "contain" }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Unc</div>
                  <div style={{ fontSize: 10, color: "var(--on-navy-dim)" }}>
                    In your corner · knows your numbers
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: 10,
                  background: "var(--navy-deep)",
                  borderRadius: 999,
                  padding: 3,
                }}
              >
                <button
                  onClick={() => setLm("ai")}
                  style={{
                    flex: 1,
                    border: "none",
                    textAlign: "center",
                    borderRadius: 999,
                    padding: "5px 0",
                    fontSize: 11,
                    fontWeight: 600,
                    background: ai ? "var(--cyan)" : "transparent",
                    color: ai ? "oklch(0.22 0.05 262)" : "var(--on-navy-dim)",
                    cursor: "pointer",
                    transition: "background 0.25s, color 0.25s",
                  }}
                >
                  Junction AI
                </button>
                <button
                  onClick={() => setLm("human")}
                  style={{
                    flex: 1,
                    border: "none",
                    textAlign: "center",
                    borderRadius: 999,
                    padding: "5px 0",
                    fontSize: 11,
                    fontWeight: 600,
                    background: !ai ? "var(--cyan)" : "transparent",
                    color: !ai ? "oklch(0.22 0.05 262)" : "var(--on-navy-dim)",
                    cursor: "pointer",
                    transition: "background 0.25s, color 0.25s",
                  }}
                >
                  Human support
                </button>
              </div>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 196 }}>
              {ai ? (
                <>
                  <div
                    style={{
                      background: "var(--cream-dim)",
                      border: "1px solid var(--card-border)",
                      borderRadius: "13px 13px 13px 4px",
                      padding: "10px 14px",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      maxWidth: "88%",
                    }}
                  >
                    Morning! Your ads: one&rsquo;s winning, one&rsquo;s not. Move NZ$40/day to the winner?
                  </div>
                  <div
                    style={{
                      alignSelf: "flex-end",
                      background: "var(--navy)",
                      color: "var(--on-navy)",
                      borderRadius: "13px 13px 4px 13px",
                      padding: "10px 14px",
                      fontSize: 12.5,
                      maxWidth: "70%",
                    }}
                  >
                    Yes — do it.
                  </div>
                  <div
                    style={{
                      background: "var(--cream-dim)",
                      border: "1px solid var(--card-border)",
                      borderRadius: "13px 13px 13px 4px",
                      padding: "10px 14px",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      maxWidth: "88%",
                    }}
                  >
                    Done. Receipt&rsquo;s here if you ever want to check my work.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, maxWidth: "92%" }}>
                    <span
                      style={{
                        flex: "none",
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "var(--cyan)",
                        color: "oklch(0.22 0.05 262)",
                        fontSize: 10.5,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 2,
                      }}
                    >
                      S
                    </span>
                    <div
                      style={{
                        background: "var(--cyan-wash)",
                        borderRadius: "13px 13px 13px 4px",
                        padding: "10px 14px",
                        fontSize: 12.5,
                        lineHeight: 1.55,
                      }}
                    >
                      Hey! I can see your goal, strategy and receipts — never your credentials. What are
                      you wrestling with?
                    </div>
                  </div>
                  <div
                    style={{
                      alignSelf: "flex-end",
                      background: "var(--navy)",
                      color: "var(--on-navy)",
                      borderRadius: "13px 13px 4px 13px",
                      padding: "10px 14px",
                      fontSize: 12.5,
                      maxWidth: "70%",
                    }}
                  >
                    Can someone sanity-check my strategy?
                  </div>
                  <div style={{ display: "flex", gap: 8, maxWidth: "92%" }}>
                    <span
                      style={{
                        flex: "none",
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "var(--cyan)",
                        color: "oklch(0.22 0.05 262)",
                        fontSize: 10.5,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 2,
                      }}
                    >
                      S
                    </span>
                    <div
                      style={{
                        background: "var(--cyan-wash)",
                        borderRadius: "13px 13px 13px 4px",
                        padding: "10px 14px",
                        fontSize: 12.5,
                        lineHeight: 1.55,
                      }}
                    >
                      Already looked this morning. One nudge: record the welcome-flow voiceover this week
                      — it&rsquo;s your biggest open lever. Want a 20-minute call?
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={label}>Backed by real experts</div>
          <h2 style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em", margin: "14px 0 0" }}>
            Built by operators. Backed by humans, 24/7.
          </h2>
          <div
            style={{
              display: "flex",
              gap: 18,
              alignItems: "flex-start",
              marginTop: 22,
              background: "white",
              border: "1px solid var(--card-border)",
              borderRadius: 16,
              padding: "20px 22px",
              maxWidth: 520,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/tom.png"
              alt="Tom Hall-Taylor"
              style={{ width: 76, height: 76, flex: "none", borderRadius: "50%", objectFit: "cover" }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15.5, lineHeight: 1.6, fontWeight: 500 }}>
                &ldquo;We built Junction AI with 10+ years of marketing expertise, and $10s of millions in
                online revenue.&rdquo;
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
                <b style={{ color: "var(--ink)" }}>Tom Hall-Taylor</b> · Founder, Junction
              </div>
            </div>
          </div>
          <p
            style={{
              fontSize: 14.5,
              lineHeight: 1.65,
              color: "var(--ink-soft)",
              margin: "18px 0 0",
              maxWidth: 500,
            }}
          >
            That expertise is built into Junction — plus the world-class skills relevant to your specific
            business, researched when you sign up. You get 24/7 access to your agent, and our team
            replies to any question, always working to lift your performance.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--muted)",
                fontWeight: 600,
              }}
            >
              Reach him on
            </span>
            {["SMS", "Telegram", "Slack", "WhatsApp", "Email"].map((c) => (
              <span
                key={c}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: "1px solid var(--card-border-2)",
                  borderRadius: 999,
                  padding: "7px 14px",
                }}
              >
                {c}
              </span>
            ))}
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>+ more</span>
          </div>
        </div>
      </section>

      <section id="pricing" style={{ maxWidth: 1100, margin: "0 auto", padding: "80px 40px" }}>
        <div
          style={{
            maxWidth: 520,
            margin: "0 auto",
            background: "white",
            border: "1.5px solid oklch(0.78 0.13 220 / 0.5)",
            borderRadius: 22,
            padding: "40px 44px",
            textAlign: "center",
            boxShadow: "0 18px 50px oklch(0.27 0.055 262 / 0.1)",
          }}
        >
          <div style={label}>Pricing — simple, like the rest</div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 6, marginTop: 16 }}>
            <span style={{ fontSize: 54, fontWeight: 700, letterSpacing: "-0.03em" }}>$100</span>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>USD / month</span>
          </div>
          <div
            style={{
              display: "inline-block",
              fontSize: 12.5,
              fontWeight: 700,
              color: "oklch(0.22 0.05 262)",
              background: "var(--cyan)",
              borderRadius: 999,
              padding: "6px 16px",
              marginTop: 12,
            }}
          >
            14-day free trial
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 9,
              marginTop: 24,
              fontSize: 13.5,
              color: "oklch(0.4 0.04 262)",
              textAlign: "left",
              maxWidth: 320,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            {[
              "Unc, working on your goal 24/7",
              "All 35 routines, customised to you",
              "Human experts behind him, always",
              "Nothing runs without your okay — everything receipted",
            ].map((t) => (
              <div key={t} style={{ display: "flex", gap: 9 }}>
                <span style={{ color: "var(--cyan-link)", fontWeight: 700 }}>✓</span>
                {t}
              </div>
            ))}
          </div>
          <Link href="/app">
            <button className="btn-navy" style={{ marginTop: 28, padding: "13px 32px", fontSize: 14.5 }}>
              Start your free trial
            </button>
          </Link>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12 }}>Cancel any time</div>
        </div>
      </section>

      <section style={{ background: "var(--navy)", color: "var(--on-navy)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "88px 40px", textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/mascot.png"
            alt=""
            style={{ width: 170, height: 182, objectFit: "contain", animation: "jfloat 5s ease-in-out infinite" }}
          />
          <h2
            style={{
              fontSize: 38,
              fontWeight: 700,
              letterSpacing: "-0.025em",
              margin: "20px 0 0",
              lineHeight: 1.15,
            }}
          >
            He&rsquo;s a workaholic with one goal:
            <br />
            to grow your business.
          </h2>
          <Link href="/app">
            <button
              className="btn-cyan"
              style={{
                marginTop: 30,
                padding: "15px 34px",
                fontSize: 15,
                boxShadow: "0 0 40px oklch(0.78 0.13 220 / 0.4)",
              }}
            >
              Meet Unc →
            </button>
          </Link>
        </div>
      </section>
    </div>
  );
}
