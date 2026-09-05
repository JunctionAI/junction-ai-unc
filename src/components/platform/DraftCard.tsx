"use client";
/* One artifact — the real work a routine produced — as a brand card in the chat-bubble
   grammar. Collapsed: routine tag, kind chip, title, first lines, "Open". Open: the body
   (markdown → headings / bold / lists, no dependency), the items, the evidence, and the
   founder's actions: Approve · Hold (why?) · Why · Edit · Copy · "Send me this on <channel>".

   Every action POSTs /api/artifacts/<id>; approve/hold/edit write a taste_event (+ a memory
   in accounts mode) so Unc learns what gets through. Amber only where a decision waits. */

import React, { useEffect, useRef, useState } from "react";
import type { ArtifactView } from "@/lib/artifacts/handlers";
import { markdownToPlain, parseMarkdown, type Block, type InlineRun } from "@/lib/artifacts/markdown";
import { CHANNEL_LABEL, isChannel } from "@/lib/channels/types";
import { artifactHeaders, deliveryNotice } from "@/lib/artifacts/client";

export type { ArtifactView };

const sysTag: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "var(--cyan-link)", background: "var(--cyan-wash)", borderRadius: 5, padding: "2px 7px" };
const kindChip: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "oklch(0.45 0.03 262)", background: "oklch(0.945 0.008 260)", borderRadius: 5, padding: "2px 7px" };
const smallMascot: React.CSSProperties = { width: 26, height: 28, objectFit: "contain", flex: "none" };
const linkBtn: React.CSSProperties = { border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 };
const ghostBtn: React.CSSProperties = { border: "1px solid oklch(0.88 0.015 260)", background: "transparent", color: "var(--muted-2)", borderRadius: 999, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" };

export const KIND_LABEL: Record<ArtifactView["kind"], string> = {
  post: "Post",
  post_set: "Post set",
  email: "Email",
  hook_list: "Hooks",
  keyword_list: "Keywords",
  content_gap: "Content gaps",
  lead_brief: "Lead brief",
  outreach_draft: "Outreach",
  meeting_brief: "Meeting brief",
  question_list: "Questions",
  calendar: "Calendar",
  generic: "Draft",
};

const STATUS_LABEL: Record<ArtifactView["status"], { text: string; color: string; bg: string }> = {
  draft: { text: "Waiting on you", color: "var(--amber-text)", bg: "var(--amber-wash)" },
  approved: { text: "Approved", color: "oklch(0.45 0.12 150)", bg: "oklch(0.95 0.04 150)" },
  held: { text: "Held", color: "var(--muted-2)", bg: "oklch(0.945 0.008 260)" },
  edited: { text: "Edited", color: "oklch(0.45 0.1 240)", bg: "oklch(0.94 0.03 225)" },
  used: { text: "Used", color: "oklch(0.45 0.12 150)", bg: "oklch(0.95 0.04 150)" },
};

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.kind === "bold" ? (
          <strong key={i}>{r.text}</strong>
        ) : r.kind === "em" ? (
          <em key={i}>{r.text}</em>
        ) : r.kind === "code" ? (
          <code key={i} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.92em", background: "oklch(0.965 0.006 260)", borderRadius: 4, padding: "0 4px" }}>
            {r.text}
          </code>
        ) : (
          <React.Fragment key={i}>{r.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/** Markdown body → React (headings, paragraphs, lists, quotes, rules). */
export function Markdown({ body }: { body: string }) {
  const blocks: Block[] = parseMarkdown(body);
  return (
    <div data-testid="artifact-markdown" style={{ fontSize: 13.5, lineHeight: 1.6, color: "oklch(0.3 0.06 262)" }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const size = b.level === 1 ? 16 : b.level === 2 ? 14.5 : 13.5;
            return (
              <div key={i} style={{ fontSize: size, fontWeight: 600, marginTop: i ? 12 : 0, marginBottom: 4, color: "var(--ink)" }}>
                <Runs runs={b.runs} />
              </div>
            );
          }
          case "paragraph":
            return (
              <p key={i} style={{ margin: "0 0 8px" }}>
                <Runs runs={b.runs} />
              </p>
            );
          case "list":
            return b.ordered ? (
              <ol key={i} style={{ margin: "0 0 8px", paddingLeft: 22 }}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Runs runs={it} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} style={{ margin: "0 0 8px", paddingLeft: 20 }}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Runs runs={it} />
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={i} style={{ margin: "0 0 8px", paddingLeft: 12, borderLeft: "3px solid oklch(0.88 0.015 260)", color: "var(--muted-2)" }}>
                <Runs runs={b.runs} />
              </blockquote>
            );
          case "rule":
            return <hr key={i} style={{ border: "none", borderTop: "1px solid oklch(0.92 0.008 260)", margin: "10px 0" }} />;
        }
      })}
    </div>
  );
}

export interface DraftCardProps {
  artifact: ArtifactView;
  /** Start open (the routine detail's "last artifact"). */
  defaultOpen?: boolean;
  /** Verified channels on the account → "Send me this on <channel>" buttons. */
  channels?: string[];
  /** After any decision — the parent can refresh its list. */
  onChange?: (a: ArtifactView) => void;
  onOpenRoutine?: (routineId: string) => void;
  /** Demo / MemoryStore: say so once. */
  persisted?: boolean;
}

type Reply = { artifact?: ArtifactView; memory?: string | null; sent?: { channel: string; status: string }[]; error?: string };

export default function DraftCard(props: DraftCardProps) {
  const a = props.artifact;
  return <BoundDraftCard key={`${a.accountId}:${a.contextGeneration}:${a.id}:${a.revision}`} {...props} />;
}

function BoundDraftCard({ artifact: initial, defaultOpen = false, channels = [], onChange, onOpenRoutine, persisted = true }: DraftCardProps) {
  const alive = useRef(true);
  const posting = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [a, setA] = useState(initial);
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(initial.editedBody ?? initial.body);
  const [holding, setHolding] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const body = a.editedBody ?? a.body;
  const status = STATUS_LABEL[a.status];
  const plain = () => `${a.title}\n\n${markdownToPlain(body)}${a.items.length ? `\n\n${a.items.map((it, i) => `${i + 1}. ${it.title}\n${markdownToPlain(it.body)}`).join("\n\n")}` : ""}`;

  async function post(payload: Record<string, unknown>): Promise<Reply | null> {
    if (posting.current || !alive.current) return null;
    posting.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(a.id)}`, { method: "POST", headers: { "content-type": "application/json", ...artifactHeaders(a.accountId, a.contextGeneration) }, body: JSON.stringify({ ...payload, expectedRevision: a.revision ?? 0 }) });
      const data = (await res.json().catch(() => ({}))) as Reply;
      if (!alive.current) return null;
      if (!res.ok) {
        setError(data.error ?? `couldn’t do that (${res.status})`);
        return null;
      }
      if (data.artifact) {
        if (data.artifact.id !== a.id || data.artifact.accountId !== a.accountId || data.artifact.contextGeneration !== a.contextGeneration)
          throw new Error("Draft context changed. Reload before continuing.");
        setA(data.artifact);
        onChange?.(data.artifact);
      }
      return data;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      posting.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const approve = async () => {
    const r = await post({ action: "approve" });
    if (r) setNote(r.memory ? "Approved — I’ll remember what got through." : "Approved.");
  };
  const hold = async () => {
    const r = await post({ action: "hold", reason: holdReason });
    if (r) {
      setHolding(false);
      setNote(holdReason ? "Held — noted why, so the next one is closer." : "Held. Nothing moves; I’ll draft differently next time.");
    }
  };
  const saveEdit = async () => {
    const r = await post({ action: "edit", editedBody: draftBody });
    if (r) {
      setEditing(false);
      setNote("Saved your edit — I’ll learn from the difference.");
    }
  };
  const openWhy = async () => {
    const next = !why;
    setWhy(next);
    if (next) void post({ action: "why" });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plain());
      setNote("Copied.");
    } catch {
      setNote("Couldn’t reach the clipboard — select the text and copy it.");
    }
  };
  const send = async (channel: string) => {
    const r = await post({ action: "send", channel });
    if (r?.sent) setNote(deliveryNotice(r.sent, CHANNEL_LABEL[channel as keyof typeof CHANNEL_LABEL] ?? channel));
  };

  const using = Array.isArray(a.meta.using) ? (a.meta.using as unknown[]).filter((u): u is string => typeof u === "string") : [];
  const whyText = [using.length ? `I drafted this from: ${using.join(", ")}.` : "", a.evidence.length ? `Evidence lines: ${a.evidence.length}.` : "", a.meta.via === "n8n" ? "Made by your n8n workflow." : ""].filter(Boolean).join(" ") || "I drafted this from the run's material — open the routine to see its reads.";

  return (
    <div data-testid="draft-card" data-artifact={a.id} data-status={a.status} style={{ display: "flex", gap: 10 }}>
      <img src="/brand/mascot-small.png" alt="" style={{ ...smallMascot, marginTop: 4 }} />
      <div style={{ background: "white", border: "1px solid var(--card-border)", borderRadius: "4px 14px 14px 14px", padding: "14px 18px", flex: 1, minWidth: 0, maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <button onClick={() => onOpenRoutine?.(a.routineId)} style={{ ...sysTag, border: "none", cursor: onOpenRoutine ? "pointer" : "default" }} title={a.routineName}>
            {a.routineId}
          </button>
          <span style={kindChip}>{KIND_LABEL[a.kind]}</span>
          <span style={{ fontSize: 14, fontWeight: 500, minWidth: 0 }}>{a.title}</span>
          <span data-testid="artifact-status" style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: status.color, background: status.bg, borderRadius: 999, padding: "3px 10px" }}>
            {status.text}
          </span>
        </div>
        {!open && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6 }}>
            <div style={{ fontSize: 12.5, color: "var(--muted-2)", lineHeight: 1.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.preview}</div>
            <button data-testid="artifact-open" onClick={() => setOpen(true)} className="hov-underline" style={linkBtn}>
              Open →
            </button>
          </div>
        )}
        {open && (
          <div style={{ marginTop: 12 }}>
            {!editing && <Markdown body={body} />}
            {editing && (
              <div>
                <textarea aria-label="Edit the draft" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={Math.min(24, Math.max(6, draftBody.split("\n").length + 2))} style={{ width: "100%", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.55, border: "1px solid var(--card-border-2)", borderRadius: 10, padding: "10px 12px", outline: "none", background: "oklch(0.985 0.003 90)", color: "var(--ink)", resize: "vertical" }} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => void saveEdit()} disabled={busy} className="btn-navy" style={{ padding: "7px 16px", fontSize: 12.5, fontWeight: 600 }}>
                    Save edit
                  </button>
                  <button onClick={() => { setEditing(false); setDraftBody(body); }} style={ghostBtn}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {a.items.length > 0 && !editing && (
              <div data-testid="artifact-items" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                {a.items.map((it, i) => (
                  <div key={i} style={{ border: "1px solid oklch(0.92 0.008 260)", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                      {i + 1}. {it.title}
                    </div>
                    {it.body && (
                      <div style={{ marginTop: 4 }}>
                        <Markdown body={it.body} />
                      </div>
                    )}
                    {it.meta && Object.keys(it.meta).length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        {Object.entries(it.meta)
                          .filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object")
                          .slice(0, 6)
                          .map(([k, v]) => (
                            <span key={k} style={{ fontSize: 10.5, color: "var(--muted)", background: "oklch(0.965 0.006 260)", borderRadius: 999, padding: "2px 8px" }}>
                              {k.replace(/_/g, " ")}: {String(v)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {why && (
              <div data-testid="artifact-why" style={{ background: "var(--cyan-wash)", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, lineHeight: 1.55, color: "oklch(0.3 0.06 262)", marginTop: 12 }}>
                {whyText}
                {a.evidence.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {a.evidence.slice(0, 12).map((e, i) => (
                      <li key={i}>
                        <span style={{ color: "var(--muted)" }}>{e.source}:</span> {e.ref}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!editing && (
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                {a.status === "draft" && (
                  <>
                    <button data-testid="artifact-approve" onClick={() => void approve()} disabled={busy} className="btn-navy" style={{ padding: "8px 18px", fontSize: 12.5, fontWeight: 600 }}>
                      Approve
                    </button>
                    <button data-testid="artifact-hold" onClick={() => setHolding((h) => !h)} disabled={busy} className="hov-border-muted" style={ghostBtn}>
                      Hold
                    </button>
                  </>
                )}
                <button onClick={() => void openWhy()} className="hov-underline" style={{ ...linkBtn, padding: "8px 6px" }}>
                  Why?
                </button>
                <button onClick={() => setEditing(true)} className="hov-underline" style={{ ...linkBtn, padding: "8px 6px" }}>
                  Edit
                </button>
                <button onClick={() => void copy()} className="hov-underline" style={{ ...linkBtn, padding: "8px 6px" }}>
                  Copy
                </button>
                {channels.filter(isChannel).map((c) => (
                  <button key={c} data-testid={`artifact-send-${c}`} onClick={() => void send(c)} disabled={busy} className="hov-underline" style={{ ...linkBtn, padding: "8px 6px" }}>
                    Send me this on {CHANNEL_LABEL[c]}
                  </button>
                ))}
                <button onClick={() => setOpen(false)} className="hov-underline" style={{ ...linkBtn, marginLeft: "auto", color: "var(--muted)" }}>
                  Close
                </button>
              </div>
            )}
            {holding && a.status === "draft" && (
              <div data-testid="artifact-hold-reason" style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input aria-label="Why hold it?" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} placeholder="Why? One line helps me draft the next one closer." style={{ flex: 1, minWidth: 240, padding: "8px 11px", fontSize: 12.5, border: "1px solid var(--input-border)", borderRadius: 8, background: "white", color: "var(--ink)", outline: "none" }} />
                <button onClick={() => void hold()} disabled={busy} style={{ ...ghostBtn, borderColor: "oklch(0.8 0.09 75)", background: "var(--amber-wash)", color: "var(--amber-text)", fontWeight: 600 }}>
                  Hold it
                </button>
              </div>
            )}
            {note && <div data-testid="artifact-note" style={{ fontSize: 12.5, color: "var(--cyan-text)", marginTop: 10, lineHeight: 1.5 }}>{note}</div>}
            {error && <div style={{ fontSize: 12.5, color: "var(--amber-text)", marginTop: 10, lineHeight: 1.5 }}>Couldn’t do that: {error}</div>}
            {!persisted && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>Demo mode: drafts live in memory and vanish when the server restarts.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
