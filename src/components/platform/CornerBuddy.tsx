"use client";

import type { PlatformVals } from "@/lib/platform/derive";

export default function CornerBuddy({ V }: { V: PlatformVals }) {
  return (
    <div style={{ position: "fixed", right: 26, bottom: 24, zIndex: 50, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
      {V.chatOpen && (
        <div
          style={{
            width: 372,
            height: 480,
            background: "white",
            border: "1px solid var(--card-border-2)",
            borderRadius: 18,
            boxShadow: "0 18px 50px oklch(0.27 0.055 262 / 0.28)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "12px 14px 10px", background: "var(--navy)", color: "var(--on-navy)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {V.chatIsAI && <img src="/brand/mascot-small.png" alt="" style={{ width: 28, height: 30, objectFit: "contain" }} />}
              {V.chatIsHuman && (
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--cyan)", color: "oklch(0.22 0.05 262)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  S
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{V.chatTitle}</div>
                <div style={{ fontSize: 10.5, color: "var(--on-navy-dim)" }}>{V.chatSub}</div>
              </div>
              <button onClick={V.toggleChat} style={{ border: "none", background: "transparent", color: "var(--on-navy-dim)", fontSize: 17, cursor: "pointer", padding: "4px 6px", lineHeight: 1 }}>
                ×
              </button>
            </div>
            <div style={{ display: "flex", marginTop: 10, background: "var(--navy-deep)", borderRadius: 999, padding: 3 }}>
              <button
                onClick={V.modeAI}
                style={{ flex: 1, border: "none", borderRadius: 999, padding: "6px 0", fontSize: 11.5, fontWeight: 600, cursor: "pointer", background: V.aiBg, color: V.aiFg, transition: "background 0.25s, color 0.25s" }}
              >
                Junction AI
              </button>
              <button
                onClick={V.modeHuman}
                style={{ flex: 1, border: "none", borderRadius: 999, padding: "6px 0", fontSize: 11.5, fontWeight: 600, cursor: "pointer", background: V.huBg, color: V.huFg, transition: "background 0.25s, color 0.25s" }}
              >
                Human support
              </button>
            </div>
          </div>
          <div data-autoscroll="1" style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {V.chatMsgs.map((m, i) => (
              <div key={i} style={{ display: "contents" }}>
                {m.fromUser && (
                  <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: "var(--navy)", color: "var(--on-navy)", borderRadius: "13px 13px 4px 13px", padding: "9px 13px", fontSize: 12.5, lineHeight: 1.5 }}>{m.text}</div>
                )}
                {m.fromJunction && (
                  <div style={{ alignSelf: "flex-start", maxWidth: "88%", background: "var(--cream-dim)", border: "1px solid var(--card-border)", borderRadius: "13px 13px 13px 4px", padding: "9px 13px", fontSize: 12.5, lineHeight: 1.5 }}>
                    {m.text}
                    {m.link && (
                      <div style={{ marginTop: 7 }}>
                        <button
                          onClick={m.linkGo}
                          className="hov-bg-cyanwash-deep"
                          style={{ border: "none", background: "var(--cyan-wash)", color: "var(--cyan-text)", borderRadius: 999, padding: "5px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                        >
                          {m.linkLabel}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--hairline)" }}>
            <input
              value={V.draft}
              onChange={V.onDraft}
              onKeyDown={V.onKey}
              placeholder={V.chatPlaceholder}
              style={{ flex: 1, border: "none", outline: "none", fontSize: 12.5, background: "transparent", color: "var(--ink)", padding: "6px 8px" }}
            />
            <button onClick={V.send} className="btn-cyan" style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700 }}>
              Send
            </button>
          </div>
        </div>
      )}
      {V.hasBuddyText && (
        <div
          style={{
            maxWidth: 250,
            background: "white",
            border: "1px solid var(--card-border-2)",
            borderRadius: "14px 14px 4px 14px",
            padding: "11px 15px",
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "oklch(0.3 0.06 262)",
            boxShadow: "0 8px 24px oklch(0.27 0.055 262 / 0.16)",
          }}
        >
          {V.buddyText}
        </div>
      )}
      <button
        onClick={V.toggleChat}
        className="hov-bg-navylift"
        style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "var(--navy)", color: "var(--on-navy)", borderRadius: 999, padding: "8px 20px 8px 10px", cursor: "pointer", boxShadow: "0 8px 28px oklch(0.27 0.055 262 / 0.35)" }}
      >
        <img src="/brand/mascot-small.png" alt="" style={{ width: 36, height: 39, objectFit: "contain", animation: "jfloat 5s ease-in-out infinite" }} />
        <span style={{ textAlign: "left" }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>In your corner</span>
          <span style={{ display: "block", fontSize: 11, color: "var(--on-navy-dim)" }}>Ask me anything</span>
        </span>
      </button>
    </div>
  );
}
