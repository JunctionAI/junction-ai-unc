"use client";
import { useAccountRequest } from "@/components/platform/AccountScope";
/* Channels — manage the places Unc reaches you: what goes where (brief / decisions /
   drafts), quiet hours, unlink, add another. Accounts mode only. `initial` lets a server
   render / test pass the listing in; every change is a PATCH / DELETE on /api/channels/links.

   Mount (coordinator, Sidebar.tsx / Platform.tsx view switch):
     import ChannelsSettings from "./ChannelsSettings";
     case "channels": return <ChannelsSettings />;                      — docs/CHANNELS.md */

import React, { useCallback, useEffect, useState } from "react";
import type { AgentContext } from "@/lib/agents/client";
import { artifactHeaders } from "@/lib/artifacts/client";
import SlackRouteSetupPanel from "./SlackRouteSetupPanel";
import ConnectChannelStep, { fetchListing, type FetchedListing, type LinksListing, type WireLink } from "./ConnectChannelStep";

export const SETTINGS_TITLE = "Channels";
export const SETTINGS_LINE = "Wherever you talk to me, it’s the same conversation — and every decision still lands in the app.";
export const EMPTY_LINE = "I’m only in the app right now. Pick a channel and I’ll meet you there too.";
export const ADD_LABEL = "Add another";

const card: React.CSSProperties = { background: "white", border: "1px solid var(--card-border-2)", borderRadius: 18, padding: "16px 18px", maxWidth: 760 };
const ghost: React.CSSProperties = { border: "1px solid var(--card-border)", background: "transparent", color: "var(--ink-soft)", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const pill = (fg: string, bg: string): React.CSSProperties => ({ display: "inline-block", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: fg, background: bg, borderRadius: 999, padding: "3px 9px" });

const TOGGLES: { key: "brief" | "approvals" | "drafts"; label: string; line: string }[] = [
  { key: "brief", label: "Morning brief", line: "What happened, what needs you, one thing I noticed." },
  { key: "approvals", label: "Decisions", line: "Anything waiting on you, with Approve / Hold / Why." },
  { key: "drafts", label: "Drafts", line: "A line when a new draft lands." },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{ width: 36, height: 20, borderRadius: 999, border: "none", background: on ? "var(--cyan)" : "var(--card-border)", position: "relative", cursor: "pointer", flex: "none" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.15s" }} />
    </button>
  );
}

export function describeLink(l: WireLink): string {
  if (l.channel === "slack") return l.workspace ? `${l.workspace} workspace` : "Slack";
  return l.displayName ? `${l.displayName}${l.handle ? ` · ${l.handle}` : ""}` : (l.handle ?? "this device");
}

export default function ChannelsSettings({ initial, context }: { initial?: LinksListing | null; context?: AgentContext }) {
  const accountRequest = useAccountRequest();
  const [listing, setListing] = useState<LinksListing | null>(initial ?? null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);

  const apply = useCallback((r: FetchedListing) => {
    if (r.error !== null) setNote(r.error);
    else setListing(r.listing);
  }, []);
  const load = useCallback(() => fetchListing(undefined, accountRequest).then(apply), [apply, accountRequest]);

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

  async function patch(link: WireLink, prefs: Partial<WireLink["prefs"]>) {
    const optimistic = { ...link, prefs: { ...link.prefs, ...prefs } };
    setListing((l) => (l ? { ...l, links: l.links.map((x) => (x.id === link.id ? optimistic : x)) } : l));
    try {
      const res = await accountRequest("/api/channels/links", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ linkId: link.id, prefs }) });
      if (!res.ok) {
        setNote("couldn’t save that — try again");
        await load();
      }
    } catch {
      setNote("couldn’t save that — try again");
    }
  }

  async function remove(link: WireLink) {
    if (link.channel === "slack" && (!context || link.bindingVersion === undefined)) {
      setNote("Refresh this account’s Slack connection before unlinking."); setConfirmUnlink(null); return;
    }
    try {
      const res = await accountRequest("/api/channels/links", { method: "DELETE", headers: { "content-type": "application/json", ...(link.channel === "slack" && context ? artifactHeaders(context.accountId, context.contextGeneration) : {}) }, body: JSON.stringify({ linkId: link.id, ...(link.channel === "slack" ? { bindingVersion: link.bindingVersion } : {}) }) });
      const result = await res.json().catch(() => null);
      if (res.ok && result?.ok === true) {
        setNote(`Unlinked this ${link.label} connection. Other connections are unchanged.`);
        setListing((l) => (l ? { ...l, links: l.links.filter((x) => x.id !== link.id) } : l));
      } else setNote("Unlink not confirmed. Refresh connections before retrying.");
    } catch {
      setNote("Unlink not confirmed. Refresh connections before retrying.");
    } finally {
      setConfirmUnlink(null);
    }
  }

  const linked = listing?.links.filter((l) => l.verified) ?? [];

  return (
    <div data-testid="channels-settings" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{SETTINGS_TITLE}</div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>{SETTINGS_LINE}</div>
        {note && (
          <div data-testid="channels-note" style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
            {note}
          </div>
        )}
      </div>

      {context && <SlackRouteSetupPanel context={context} />}

      {listing && linked.length === 0 && !adding && (
        <div data-testid="channels-empty" style={card}>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 10 }}>{EMPTY_LINE}</div>
          <ConnectChannelStep initial={listing} compact onDone={() => void load()} />
        </div>
      )}

      {linked.map((l) => (
        <div key={l.id} data-testid={`link-${l.channel}`} style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{l.label}</div>
            <span style={pill("var(--cyan-text)", "var(--cyan-wash)")}>Linked</span>
            <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{describeLink(l)}</span>
            <span style={{ flex: 1 }} />
            {confirmUnlink === l.id ? (
              <>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Unlink {l.label}?</span>
                <button data-testid="unlink-yes" onClick={() => remove(l)} style={ghost}>
                  Yes, unlink
                </button>
                <button onClick={() => setConfirmUnlink(null)} style={ghost}>
                  Keep
                </button>
              </>
            ) : (
              <button data-testid="unlink" onClick={() => setConfirmUnlink(l.id)} style={ghost}>
                Unlink
              </button>
            )}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {TOGGLES.map((t) => (
              <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Toggle on={l.prefs[t.key]} onChange={(v) => patch(l, { [t.key]: v })} label={`${t.label} on ${l.label}`} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{t.line}</div>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Toggle on={!!l.prefs.quiet_hours} onChange={(v) => patch(l, { quiet_hours: v ? { start: "21:00", end: "07:00" } : null })} label={`Quiet hours on ${l.label}`} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Quiet hours</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>I hold the brief and drafts until morning; a decision that would lapse still comes through in the app.</div>
                </div>
                {l.prefs.quiet_hours && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <input type="time" aria-label="Quiet from" value={l.prefs.quiet_hours.start} onChange={(e) => patch(l, { quiet_hours: { start: e.target.value, end: l.prefs.quiet_hours!.end } })} style={{ border: "1px solid var(--card-border)", borderRadius: 8, padding: "4px 6px", fontSize: 12 }} />
                    to
                    <input type="time" aria-label="Quiet until" value={l.prefs.quiet_hours.end} onChange={(e) => patch(l, { quiet_hours: { start: l.prefs.quiet_hours!.start, end: e.target.value } })} style={{ border: "1px solid var(--card-border)", borderRadius: 8, padding: "4px 6px", fontSize: 12 }} />
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {listing && linked.length > 0 && (
        <div>
          {adding ? (
            <ConnectChannelStep initial={listing} compact onDone={() => { setAdding(false); void load(); }} />
          ) : (
            <button data-testid="add-channel" onClick={() => setAdding(true)} style={ghost}>
              {ADD_LABEL}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
