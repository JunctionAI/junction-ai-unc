"use client";
/* "What Unc knows" — the founder's window into Unc's memory of them (accounts mode only; the
   sidebar hides the link in demo mode). Reads/writes /api/brain/memories and /api/brain/profile.
   Every row can be corrected or forgotten; the founder is the source of truth. Mirrors the
   ModelSettings dialog pattern. */

import { useEffect, useMemo, useState } from "react";

type Kind = "fact" | "preference" | "constraint" | "decision" | "relationship" | "event" | "lesson" | "summary";
type Source = "chat" | "onboarding" | "scan" | "receipt" | "self_review" | "intake" | "founder" | "brief";

interface Memory {
  id: string;
  kind: Kind;
  text: string;
  source: Source;
  confidence: number;
  importance: number;
  tags: string[];
  happensAt: string | null;
  createdAt: string;
}

const GROUPS: { title: string; kinds: Kind[]; empty: string }[] = [
  { title: "Preferences & constraints", kinds: ["preference", "constraint"], empty: "Nothing yet — tell me how you like things done and what's off the table." },
  { title: "Facts", kinds: ["fact", "summary"], empty: "Nothing yet. Your site scan and our chats fill this in." },
  { title: "People", kinds: ["relationship"], empty: "No one yet — who's on the team and who I should copy in." },
  { title: "Upcoming", kinds: ["event"], empty: "Nothing on the horizon that I know of." },
  { title: "Lessons", kinds: ["lesson"], empty: "I'll write these as we learn what works for you." },
  { title: "Decisions", kinds: ["decision"], empty: "No decisions recorded yet." },
];

const SOURCE_LABEL: Record<Source, string> = {
  chat: "from our chat",
  onboarding: "from onboarding",
  scan: "from your site",
  receipt: "from a receipt",
  self_review: "from my review",
  intake: "from intake",
  founder: "you told me",
  brief: "from a brief",
};

const ADD_KINDS: { value: Kind; label: string }[] = [
  { value: "fact", label: "A fact" },
  { value: "preference", label: "A preference" },
  { value: "constraint", label: "A constraint" },
  { value: "relationship", label: "A person" },
  { value: "event", label: "Something coming up" },
  { value: "decision", label: "A decision" },
];

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

const chip: React.CSSProperties = { fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 999, background: "var(--cyan-wash, oklch(0.94 0.03 225))", color: "oklch(0.45 0.1 240)", whiteSpace: "nowrap" };
const ghost: React.CSSProperties = { border: "1px solid oklch(0.85 0.02 262)", background: "transparent", color: "var(--ink)", cursor: "pointer", fontSize: 12, padding: "4px 10px", borderRadius: 999 };
const primary: React.CSSProperties = { border: "none", background: "var(--navy)", color: "var(--on-navy, white)", cursor: "pointer", fontSize: 12, padding: "6px 12px", borderRadius: 999 };
const input: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid oklch(0.85 0.02 262)", background: "white", color: "var(--ink)", width: "100%", boxSizing: "border-box" };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; fallback?: boolean };
  if (!res.ok || body.fallback) throw new Error(body.error ?? `request failed (${res.status})`);
  return body;
}

export default function WhatUncKnows({ onClose }: { onClose: () => void }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [contextGeneration, setContextGeneration] = useState(0);
  const [notes, setNotes] = useState<string>("");
  const [notesSaved, setNotesSaved] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [addText, setAddText] = useState("");
  const [addKind, setAddKind] = useState<Kind>("fact");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, p] = await Promise.all([call<{ memories: Memory[]; contextGeneration: number }>("/api/brain/memories"), call<{ founderNotes: string | null }>("/api/brain/profile")]);
        if (cancelled) return;
        setMemories(m.memories);
        setContextGeneration(m.contextGeneration);
        setNotes(p.founderNotes ?? "");
        setNotesSaved(p.founderNotes ?? "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const list = memories ?? [];
    return GROUPS.map((g) => ({ ...g, rows: list.filter((m) => g.kinds.includes(m.kind)) }));
  }, [memories]);

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const forget = (m: Memory) =>
    run(m.id, async () => {
      await call("/api/brain/memories", { method: "DELETE", headers: { "x-unc-context-generation": String(contextGeneration) }, body: JSON.stringify({ id: m.id }) });
      setMemories((cur) => (cur ?? []).filter((x) => x.id !== m.id));
    });

  const saveEdit = () => {
    if (!editing) return;
    const { id, text } = editing;
    if (!text.trim()) return;
    return run(id, async () => {
      const { memory } = await call<{ memory: Memory }>("/api/brain/memories", { method: "PATCH", headers: { "x-unc-context-generation": String(contextGeneration) }, body: JSON.stringify({ id, text: text.trim() }) });
      setMemories((cur) => (cur ?? []).map((x) => (x.id === id ? memory : x)));
      setEditing(null);
    });
  };

  const add = () => {
    const text = addText.trim();
    if (!text) return;
    return run("add", async () => {
      const { memory } = await call<{ memory: Memory }>("/api/brain/memories", { method: "POST", headers: { "x-unc-context-generation": String(contextGeneration) }, body: JSON.stringify({ text, kind: addKind }) });
      setMemories((cur) => [memory, ...(cur ?? [])]);
      setAddText("");
    });
  };

  const saveNotes = () =>
    run("notes", async () => {
      const r = await call<{ founderNotes: string | null }>("/api/brain/profile", { method: "PATCH", body: JSON.stringify({ founderNotes: notes }) });
      setNotesSaved(r.founderNotes ?? "");
      setNotes(r.founderNotes ?? "");
    });

  return (
    <div role="dialog" aria-label="What Unc knows" onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0.2 0.03 262 / 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 92vw)", maxHeight: "88vh", overflow: "auto", background: "var(--cream)", color: "var(--ink)", borderRadius: 14, padding: "26px 28px 22px", boxShadow: "0 24px 60px oklch(0.2 0.03 262 / 0.35)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>What Unc knows</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700 }}>This is what I’ve learned about you</h2>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>
            Close
          </button>
        </div>
        <p style={{ margin: "10px 0 18px", fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>
          Correct me anytime — you’re the source of truth. Forget a line and I stop using it; edit one and I keep your version. Everything here shapes what I propose and how I talk to you.
        </p>

        {error && <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 9, background: "oklch(0.97 0.03 80)", color: "var(--ink)", fontSize: 13 }}>{error}</div>}
        {!memories && !error && <div style={{ fontSize: 13, color: "var(--muted)" }}>Fetching…</div>}

        {memories && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <section style={{ padding: "12px 14px", borderRadius: 11, background: "oklch(0.985 0.01 90)", border: "1px solid oklch(0.92 0.01 90)" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>Add something I should know</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 160px auto", gap: 8, alignItems: "center" }}>
                <input
                  style={input}
                  placeholder="e.g. Never discount the flagship. Or: Sam signs off on anything customer-facing."
                  value={addText}
                  onChange={(e) => setAddText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void add();
                  }}
                />
                <select style={{ ...input, width: "auto" }} value={addKind} onChange={(e) => setAddKind(e.target.value as Kind)}>
                  {ADD_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <button type="button" style={primary} disabled={busy === "add" || !addText.trim()} onClick={() => void add()}>
                  Add
                </button>
              </div>
            </section>

            {grouped.map((g) => (
              <section key={g.title}>
                <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>
                  {g.title} <span style={{ color: "oklch(0.7 0.02 260)" }}>· {g.rows.length}</span>
                </div>
                {g.rows.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 0 2px" }}>{g.empty}</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {g.rows.map((m) => (
                    <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start", padding: "10px 12px", borderRadius: 10, background: "white", border: "1px solid oklch(0.91 0.01 260)" }}>
                      <div style={{ minWidth: 0 }}>
                        {editing?.id === m.id ? (
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              autoFocus
                              style={input}
                              value={editing.text}
                              onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void saveEdit();
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                            <button type="button" style={primary} disabled={busy === m.id} onClick={() => void saveEdit()}>
                              Save
                            </button>
                            <button type="button" style={ghost} onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ fontSize: 13.5, lineHeight: 1.5, overflowWrap: "anywhere" }}>{m.text}</div>
                        )}
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                          <span style={chip}>{SOURCE_LABEL[m.source] ?? m.source}</span>
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>{m.kind === "event" && m.happensAt ? `on ${fmtDate(m.happensAt)}` : fmtDate(m.createdAt)}</span>
                          {m.source !== "founder" && m.confidence < 0.8 && <span style={{ fontSize: 11, color: "var(--muted)" }}>· I’m not certain of this one</span>}
                        </div>
                      </div>
                      {editing?.id !== m.id && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" style={ghost} disabled={busy === m.id} onClick={() => setEditing({ id: m.id, text: m.text })}>
                            Edit
                          </button>
                          <button type="button" style={ghost} disabled={busy === m.id} onClick={() => void forget(m)}>
                            Forget
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}

            <section style={{ padding: "12px 14px", borderRadius: 11, background: "oklch(0.985 0.01 90)", border: "1px solid oklch(0.92 0.01 90)" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>How to work with me</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8, lineHeight: 1.5 }}>Your words, in your own hand. I read this before every brief and every reply — how you like to be spoken to, what to always run past you, when not to ping you.</div>
              <textarea style={{ ...input, minHeight: 96, resize: "vertical", fontFamily: "inherit" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Keep it short. Anything that touches pricing or the brand name comes to me first. Don't message on Sundays." />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, alignItems: "center" }}>
                {notes === notesSaved && notesSaved && <span style={{ fontSize: 11, color: "var(--muted)" }}>Saved</span>}
                <button type="button" style={primary} disabled={busy === "notes" || notes === notesSaved} onClick={() => void saveNotes()}>
                  Save
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
