"use client";
import { useAccountRequest, useSelectedAccount } from "./AccountScope";
import type { AccountFetch } from "@/lib/db/accountRequest";
/* First-run card: "Where should I reach you?" — Telegram / WhatsApp / Slack / Text / Just the app.

   Accounts mode only (the caller mounts it; demo mode never fetches). GET /api/channels/links
   gives the linked state and which channels are switched on; choosing one POSTs for a
   one-time code and shows the exact instruction (deep link where the platform has one), then
   polls until the link is verified. "I'll do this later" is an honest state — nothing is
   assumed. Copy in Unc's voice. `initial` lets a server render / test pass the listing in.

   Mount (coordinator, Platform.tsx, after the first routine is on):
     import ConnectChannelStep from "./ConnectChannelStep";
     <ConnectChannelStep onDone={(choice) => …} />                        — docs/CHANNELS.md */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels/types";
import { pollLink } from "@/lib/channels/linkPolling";

export interface WireLink {
  id: string;
  bindingVersion?: number;
  channel: Channel;
  label: string;
  verified: boolean;
  handle: string | null;
  displayName: string | null;
  verifiedAt: string | null;
  codeExpiresAt: string | null;
  prefs: { brief: boolean; approvals: boolean; drafts: boolean; quiet_hours: { start: string; end: string } | null };
  lastInboundAt: string | null;
  workspace: string | null;
}
export interface WireAvailability {
  channel: Channel;
  configured: boolean;
  setupOnly?: boolean;
  botUsername?: string | null;
  number?: string | null;
  setupNote?: string;
}
export interface LinksListing {
  links: WireLink[];
  channels: WireAvailability[];
}
type LinksResponse = Partial<LinksListing> & { fallback?: boolean; error?: string };
type IssueResponse = { linkId?: string | null; code?: string | null; expiresAt?: string | null; instruction?: { url: string | null; text: string }; fallback?: boolean; reason?: string; error?: string };

export const STEP_TITLE = "Where should I reach you?";
export const STEP_LINE = "Wherever you talk to me, it’s the same conversation — and every decision still lands in the app.";
export const LATER_LABEL = "I’ll do this later";
export const APP_ONLY_LABEL = "Just the app";
export const NOT_ON_LINE = "Not connected yet — provider setup is required.";
export const WAITING_LINE = "Waiting for your message — this code lasts 10 minutes.";
export const LINKED_LINE = "linked — this channel is connected. delivery still depends on your enabled routines and notification settings.";
export const POLL_MS = 4000;

const CHOICES: { channel: Channel; line: string }[] = [
  { channel: "apple", line: "Junction in Messages — the same Unc conversation." },
  { channel: "telegram", line: "A bot in your Telegram — buttons for approvals." },
  { channel: "whatsapp", line: "Unc on WhatsApp — reply buttons for approvals." },
  { channel: "slack", line: "A DM in your workspace — approve from Slack." },
  { channel: "sms", line: "Plain text — reply YES, HOLD or WHY." },
];

const card: React.CSSProperties = { background: "white", border: "1px solid var(--card-border-2)", borderRadius: 18, padding: "18px 20px", maxWidth: 760 };
const choiceBtn = (active: boolean, disabled: boolean): React.CSSProperties => ({
  textAlign: "left",
  border: `1px solid ${active ? "var(--cyan)" : "var(--card-border)"}`,
  background: active ? "var(--cyan-wash)" : "white",
  borderRadius: 14,
  padding: "11px 13px",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.55 : 1,
  display: "flex",
  flexDirection: "column",
  gap: 3,
  color: "var(--ink)",
});
const ghost: React.CSSProperties = { border: "1px solid var(--card-border)", background: "transparent", color: "var(--ink-soft)", borderRadius: 999, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const pill = (fg: string, bg: string): React.CSSProperties => ({ display: "inline-block", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: fg, background: bg, borderRadius: 999, padding: "3px 9px" });

export type FetchedListing = { listing: LinksListing; error: null } | { listing: null; error: string };

/** GET /api/channels/links, never throws; demo mode / no session read as an error line. */
export async function fetchListing(signal?: AbortSignal, request: AccountFetch = fetch): Promise<FetchedListing> {
  try {
    const res = await request("/api/channels/links", { signal: signal ?? AbortSignal.timeout(10_000), cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as LinksResponse;
    if (!res.ok || data.fallback || !data.links) return { listing: null, error: data.error ?? (data.fallback ? "Sign in to link a channel." : `couldn’t load channels (${res.status})`) };
    return { listing: { links: data.links, channels: data.channels ?? [] }, error: null };
  } catch {
    return { listing: null, error: "couldn’t reach the app" };
  }
}

export function verifiedFor(listing: LinksListing | null, channel: Channel): WireLink | null {
  return listing?.links.find((l) => l.channel === channel && l.verified) ?? null;
}

export default function ConnectChannelStep({ onDone, initial, compact }: { onDone?: (choice: "linked" | "later" | "app") => void; initial?: LinksListing | null; compact?: boolean }) {
  const accountRequest = useAccountRequest();
  const accountId = useSelectedAccount();
  const [listing, setListing] = useState<LinksListing | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Channel | null>(null);
  const [issue, setIssue] = useState<IssueResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkState, setLinkState] = useState<"waiting" | "linked" | "expired" | "error">("waiting");
  const doneRef = useRef(false);

  /** Apply a fetched listing (or its error) to state; `load` never sets state itself. */
  const apply = useCallback((r: FetchedListing): LinksListing | null => {
    if (r.error !== null) {
      setLoadError(r.error);
      return null;
    }
    setListing(r.listing);
    setLoadError(null);
    return r.listing;
  }, []);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    void fetchListing(undefined, accountRequest).then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [initial, apply, accountRequest]);

  // Poll while a code is out, until the chosen channel reads verified.
  useEffect(() => {
    if (!chosen || !issue?.code) return;
    return pollLink({
      expiresAt: issue.expiresAt,
      intervalMs: POLL_MS,
      fetch: async (signal) => {
        const r = await fetchListing(signal, accountRequest);
        if (r.error !== null) throw new Error(r.error);
        return r;
      },
      apply,
      verified: (r) => !!r.listing?.links.some(l => l.id === issue.linkId && l.channel === chosen && l.verified),
      finish: (state) => {
        setLinkState(state);
        if (state === "linked" && !doneRef.current) { doneRef.current = true; onDone?.("linked"); }
      },
    });
  }, [chosen, issue, apply, onDone, accountRequest]);

  async function choose(channel: Channel) {
    const avail = listing?.channels.find((c) => c.channel === channel);
    if (!avail?.configured || busy) return;
    setChosen(channel);
    setIssue(null);
    setLinkState("waiting");
    doneRef.current = false;
    if (channel === "slack") {
      // an API route that 302s to Slack's consent screen — a full navigation, not a client route
      window.location.assign(`/api/channels/slack/start?redirect_to=${encodeURIComponent(window.location.pathname || "/app")}${accountId ? `&account=${encodeURIComponent(accountId)}` : ""}`);
      return;
    }
    setBusy(true);
    try {
      const res = await accountRequest("/api/channels/links", { method: "POST", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ channel }) });
      const data = (await res.json().catch(() => ({}))) as IssueResponse;
      if (res.status === 401) setIssue({ error: "Sign in first." });
      else if (!res.ok || data.fallback || !data.code) setIssue({ error: data.error ?? NOT_ON_LINE });
      else setIssue(data);
    } catch {
      setIssue({ error: "couldn’t get a code — try again" });
    } finally {
      setBusy(false);
    }
  }

  const linked = listing?.links.filter((l) => l.verified) ?? [];

  return (
    <div data-testid="connect-channel-step" style={{ ...card, ...(compact ? { padding: "14px 16px" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <img src="/brand/mascot-small.png" alt="" style={{ width: 26, height: 28, objectFit: "contain" }} />
        <div style={{ fontSize: 15, fontWeight: 700 }}>{STEP_TITLE}</div>
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, marginBottom: 12 }}>{STEP_LINE}</div>

      {loadError && (
        <div data-testid="channels-error" style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
          {loadError} <button style={ghost} onClick={() => void fetchListing(undefined, accountRequest).then(apply)}>try again</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr 1fr" : "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        {CHOICES.map(({ channel, line }) => {
          const avail = listing?.channels.find((c) => c.channel === channel);
          const configured = !!avail?.configured;
          const already = verifiedFor(listing, channel);
          const active = chosen === channel;
          return (
            <button key={channel} data-testid={`choice-${channel}`} data-configured={configured ? "1" : "0"} disabled={!configured} onClick={() => choose(channel)} style={choiceBtn(active, !configured)}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{CHANNEL_LABEL[channel]}</span>
                {already && <span style={pill("var(--cyan-text)", "var(--cyan-wash)")}>Linked</span>}
              </span>
              <span style={{ fontSize: 12, color: configured ? "var(--ink-soft)" : "var(--muted)", lineHeight: 1.4 }}>{avail?.setupOnly ? avail.setupNote : configured ? (already ? `${already.displayName ?? already.handle ?? already.workspace ?? "this device"} — add another or leave it.` : line) : (avail?.setupNote ?? NOT_ON_LINE)}</span>
            </button>
          );
        })}
      </div>

      {chosen && chosen !== "slack" && (
        <div data-testid="link-instruction" style={{ marginTop: 14, background: "var(--cream-dim)", border: "1px solid var(--card-border)", borderRadius: 14, padding: "12px 14px" }}>
          {busy && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Getting you a code…</div>}
          {issue?.error && <div role="alert" style={{ fontSize: 12.5, color: "var(--muted)" }}>{issue.error} <button disabled={busy} style={ghost} onClick={() => choose(chosen)}>try again</button></div>}
          {issue?.code && (
            <>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{issue.instruction?.text}</div>
              {chosen === "sms" && <div data-testid="sms-link-safety" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>Send this code from your own phone to connect it to the business currently open in Unc. This does not give Unc access to your personal SMS inbox. One business per phone for this pilot. Reply STOP to disconnect.</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                <code data-testid="link-code" style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1.5, background: "white", border: "1px solid var(--card-border)", borderRadius: 10, padding: "6px 12px" }}>
                  {issue.code}
                </code>
                {issue.instruction?.url && linkState === "waiting" && (
                  <a href={issue.instruction.url} target="_blank" rel="noreferrer" className="btn-cyan" style={{ padding: "8px 16px", fontSize: 12, display: "inline-block" }}>
                    Open {CHANNEL_LABEL[chosen]}
                  </a>
                )}
                <button disabled={busy} onClick={() => choose(chosen)} style={ghost}>
                  New code
                </button>
              </div>
              <div role="status" style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>{linkState === "linked" ? LINKED_LINE : linkState === "expired" ? "that code has expired. get a new code to try again." : linkState === "error" ? "i couldn’t confirm the connection. checking has paused — get a new code to retry." : WAITING_LINE}</div>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        {linked.length > 0 && (
          <span data-testid="linked-summary" style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
            Reaching you on {linked.map((l) => l.label).join(", ")}.
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button data-testid="later" onClick={() => onDone?.("later")} style={ghost}>
          {LATER_LABEL}
        </button>
        <button data-testid="app-only" onClick={() => onDone?.("app")} style={ghost}>
          {APP_ONLY_LABEL}
        </button>
      </div>
    </div>
  );
}
