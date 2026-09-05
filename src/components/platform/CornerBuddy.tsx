"use client";

import type { PlatformVals } from "@/lib/platform/derive";
import { initialState } from "@/lib/platform/state";
import { connectorSummary, enabledCount, homeBubble, stripDemoSeed, useAccountFacts, type AccountFacts } from "@/lib/unc/accountFacts";
import TypingDots from "./TypingDots";
import { mergeThread, useChannelThread, viaLabel, type ThreadRow } from "./useChannelThread";

/* Accounts mode (docs/PRODUCT-EXPERIENCE.md): the buddy's bubbles carry real facts — routines
   on, decisions waiting, drafts this week, connector state — never the prototype's demo lines,
   and the corner thread is the account's own chat_messages history. An empty (or demo-seeded)
   thread opens with Unc's one line. The human lane has no live desk behind it yet, so it says so
   and points at support@ instead of faking a reply. Demo mode renders the prototype verbatim. */

export const FIRST_UNC_LINE = "hey, i’m unc 👋 ask me about your business, or tell me what you want to work on.";
export const HUMAN_LANE_NOTE = "human support isn’t connected to this chat yet. email support@getjunction.ai to contact the team. no one has been assigned through this thread.";

const DEMO_CORNER_SEED = initialState.messages.map((m) => m.text);
const DEMO_HUMAN_SEED = initialState.humanThread.map((m) => m.text);

type ChatMsg = PlatformVals["chatMsgs"][number];
/** One bubble; `via` is set on turns said on a channel ("via Telegram") — app turns carry none. */
export type Bubble = ChatMsg & { via?: string | null };

const chipStyle: React.CSSProperties = { display: "inline-block", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "2px 8px", marginTop: 3 };

export function bubbleFromRow(r: ThreadRow): Bubble {
  return { text: r.body, fromUser: r.sender === "user", fromJunction: r.sender !== "user", typing: false, link: false, linkLabel: undefined, linkGo: () => {}, via: viaLabel(r.channel) };
}

/** The bubble text for the current view in accounts mode. Strategy carries its own real-fact
    data-buddy attributes, so its text passes straight through. */
export function accountBubble(V: Pick<PlatformVals, "isStrategy" | "isSystems" | "isConnectors" | "buddyText" | "libTotal"> & { automationPaused?: boolean }, facts: AccountFacts | null, now: Date = new Date()): string {
  if (V.automationPaused) return "Automation is paused for setup verification. Your account chat and connections remain available.";
  if (V.isStrategy) return V.buddyText;
  if (V.isSystems) {
    const on = enabledCount(facts);
    return on ? `${on} of ${V.libTotal} routines on. Turn another on and I dry-run it now — nothing sends without you.` : `Nothing on yet. Turn one on and I dry-run it now — nothing sends without you.`;
  }
  if (V.isConnectors) return `${connectorSummary(facts)}. Each connection unlocks more of the library — least privilege, always.`;
  return homeBubble(facts, now);
}

/** The thread to render in accounts mode: the real history, minus any demo-seeded opening lines,
    with the channel turns (Telegram / WhatsApp / Slack / text) interleaved by time — one conversation. */
export function accountThread(msgs: ChatMsg[], lane: "ai" | "human", remote: ThreadRow[] = []): Bubble[] {
  const real = stripDemoSeed(msgs, lane === "ai" ? DEMO_CORNER_SEED : DEMO_HUMAN_SEED);
  if (lane === "human") return real;
  const merged = mergeThread<Bubble>(real, remote, bubbleFromRow);
  if (merged.length) return merged;
  return [{ text: FIRST_UNC_LINE, fromUser: false, fromJunction: true, typing: false, link: false, linkLabel: undefined, linkGo: () => {} }];
}

/** `initialThread` — server render / tests: channel rows in hand (the hook polls only in the browser). */
export default function CornerBuddy({ V, initialThread = null }: { V: PlatformVals; initialThread?: ThreadRow[] | null }) {
  const { mode, facts } = useAccountFacts();
  const acct = mode === "account";
  const lane = V.chatIsHuman ? "human" : "ai";
  const remote = useChannelThread(acct && lane === "ai", V.chatOpen, initialThread);
  const msgs: Bubble[] = acct ? accountThread(V.chatMsgs, lane, remote) : V.chatMsgs;
  const humanOffline = acct && V.chatIsHuman;
  const bubbleText = acct ? accountBubble(V, facts) : V.buddyText;
  const showBubble = V.hasBuddyText && !!bubbleText;
  return (
    <div className="unc-corner" style={{ position: "fixed", right: 26, bottom: 24, zIndex: 50, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
      {V.chatOpen && (
        <div
          className="unc-chat-panel" role="region" aria-label="Chat with Unc"
          style={{
            width: 372,
            maxWidth: "calc(100vw - 32px)",
            height: 480,
            maxHeight: "calc(100dvh - 110px)",
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
                  {acct ? "J" : "S"}
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{V.chatTitle}</div>
                <div style={{ fontSize: 10.5, color: "var(--on-navy-dim)" }}>{humanOffline ? "Real people who know your setup · by email for now" : V.chatSub}</div>
              </div>
              <button aria-label="Close chat" onClick={V.toggleChat} style={{ border: "none", background: "transparent", color: "var(--on-navy-dim)", fontSize: 17, cursor: "pointer", padding: "4px 6px", lineHeight: 1 }}>
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
            {humanOffline && (
              <div data-testid="human-lane-note" style={{ alignSelf: "flex-start", maxWidth: "88%", background: "var(--cream-dim)", border: "1px solid var(--card-border)", borderRadius: "13px 13px 13px 4px", padding: "9px 13px", fontSize: 12.5, lineHeight: 1.5 }}>
                {HUMAN_LANE_NOTE}{" "}
                <a href="mailto:support@getjunction.ai" style={{ color: "var(--cyan-link)", fontWeight: 600 }}>
                  Email the team →
                </a>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ display: "contents" }}>
                {m.fromUser && !m.via && (
                  <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: "var(--navy)", color: "var(--on-navy)", borderRadius: "13px 13px 4px 13px", padding: "9px 13px", fontSize: 12.5, lineHeight: 1.5 }}>{m.text}</div>
                )}
                {m.fromUser && m.via && (
                  <div data-testid="channel-turn" style={{ alignSelf: "flex-end", maxWidth: "82%", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <div style={{ background: "var(--navy)", color: "var(--on-navy)", borderRadius: "13px 13px 4px 13px", padding: "9px 13px", fontSize: 12.5, lineHeight: 1.5 }}>{m.text}</div>
                    <span data-testid="via-chip" style={chipStyle}>{m.via}</span>
                  </div>
                )}
                {m.fromJunction && (
                  <div data-testid={m.via ? "channel-turn" : undefined} style={{ alignSelf: "flex-start", maxWidth: "88%", background: "var(--cream-dim)", border: "1px solid var(--card-border)", borderRadius: "13px 13px 13px 4px", padding: "9px 13px", fontSize: 12.5, lineHeight: 1.5 }}>
                    {m.typing ? <TypingDots /> : m.text}
                    {m.via && (
                      <div>
                        <span data-testid="via-chip" style={chipStyle}>{m.via}</span>
                      </div>
                    )}
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
              disabled={humanOffline}
              placeholder={humanOffline ? "Email support@getjunction.ai — this lane is by email for now" : V.chatPlaceholder}
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", fontSize: 16, background: "transparent", color: "var(--ink)", padding: "6px 8px" }}
            />
            <button onClick={V.send} disabled={humanOffline} className="btn-cyan" style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, opacity: humanOffline ? 0.5 : 1 }}>
              Send
            </button>
          </div>
        </div>
      )}
      {showBubble && !V.chatOpen && (
        <div
          data-testid="buddy-bubble"
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
          {bubbleText}
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
