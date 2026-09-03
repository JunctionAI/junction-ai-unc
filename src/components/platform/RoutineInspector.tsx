"use client";
/* "Adjust this routine" — the one-screen inspector in accounts mode (docs/PRESETS.md).

   The routine's 3–6 relevant preset fields as labelled inputs / sliders with the industry default
   under each ("Industry: NZ$25–35 · yours: NZ$30"), one toggle row per optional step the spec
   exposes ("Include: Gorgias tickets · 7d"), and Save → routine_params + a new draft version through
   the existing versioning; validate (dry run) and promote sit right under it, unchanged in meaning.
   Demo mode never mounts this (RoutineDetail keeps the prototype's inspector there).

   Reads GET /api/routines/params?routineId=; `initial` lets a server render / test start with the
   view in hand (no fetch). */

import { useEffect, useState } from "react";
import { formatValue, industryLine } from "@/lib/runtime/presets/industry";
import type { PresetField, PresetValue } from "@/lib/runtime/presets/types";

export interface ParamsField extends PresetField {
  relevant: boolean;
  bound: boolean;
}

export interface ParamsView {
  routineId: string;
  domain: string;
  currency: string;
  band: { id: string; label: string; why: string } | null;
  fields: ParamsField[];
  steps: { id: string; label: string; kind: string; included: boolean }[];
  version: { live: number; draft: number | null };
  canPromote: boolean;
}

type Body = Partial<ParamsView> & { error?: string; issues?: { key: string; message: string }[]; fallback?: boolean; run?: { runId: string; status: string; summary: string }; passed?: boolean };

export const INSPECTOR_TITLE = "Adjust this routine";
export const INSPECTOR_SUB = "— the numbers it runs on. Industry defaults from your band; change what you know better.";
export const NO_BAND_LINE = "I don’t know your model yet, so these are conservative. The scan or a word from you sharpens them.";

const label: React.CSSProperties = { fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 };
const inputStyle: React.CSSProperties = { display: "block", width: "100%", marginTop: 5, border: "1px solid var(--card-border-2)", borderRadius: 8, padding: "8px 11px", fontSize: 13, outline: "none", background: "oklch(0.985 0.003 90)", color: "var(--ink)" };

export function sourceLabel(source: PresetField["source"]): string {
  return source === "founder" ? "yours" : source === "unc" ? "my adjustment" : "industry";
}

export default function RoutineInspector({ routineId, currency, initial, onSaved }: { routineId: string; currency: string; initial?: ParamsView | null; onSaved?: () => void }) {
  const [view, setView] = useState<ParamsView | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, PresetValue>>({});
  const [stepEdits, setStepEdits] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"save" | "validate" | "promote" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (initial !== undefined || !routineId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/routines/params?routineId=${encodeURIComponent(routineId)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Body;
        if (cancelled) return;
        if (!res.ok || body.fallback || !Array.isArray(body.fields)) setError(body.error ?? `couldn’t load the settings (${res.status})`);
        else {
          setView(body as ParamsView);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routineId, initial]);

  const cur = view?.currency ?? currency;
  const fields = (view?.fields ?? []).filter((f) => f.relevant);
  const dirty = Object.keys(edits).length > 0 || Object.keys(stepEdits).length > 0;

  const apply = (body: Body) => {
    if (Array.isArray(body.fields)) setView(body as ParamsView);
  };

  async function save() {
    if (!view) return;
    setBusy("save");
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/routines/params", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ routineId, params: edits, steps: stepEdits }) });
      const body = (await res.json().catch(() => ({}))) as Body;
      if (!res.ok) setError(body.issues?.length ? body.issues.map((i) => i.message).join(" · ") : (body.error ?? `couldn’t save (${res.status})`));
      else {
        apply(body);
        setEdits({});
        setStepEdits({});
        setNote(body.version?.draft ? `Saved. Draft v${body.version.draft} is ready — run the dry-run validation, then promote it.` : "Saved. These steer the drafting; the chain itself is unchanged, so nothing to promote.");
        onSaved?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function act(action: "validate" | "promote" | "discard") {
    setBusy(action === "discard" ? "save" : action);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/routines/params", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ routineId, action }) });
      const body = (await res.json().catch(() => ({}))) as Body;
      if (!res.ok) setError(body.error ?? `${action} failed (${res.status})`);
      else {
        apply(body);
        if (action === "validate") setNote(body.passed ? `Dry run passed (${body.run?.summary ?? "no incident"}). Promote when you’re happy.` : `Dry run did not pass: ${body.run?.summary ?? body.run?.status ?? "no summary"}. Nothing promoted.`);
        if (action === "promote") setNote(`Promoted — v${body.version?.live ?? "?"} is live. Every run from now uses your numbers.`);
        if (action === "discard") setNote("Draft discarded. The live version stands.");
        onSaved?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="routine-inspector" style={{ marginTop: 12, background: "white", border: "1px solid var(--card-border)", borderRadius: 14, padding: "18px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "oklch(0.45 0.1 240)", fontWeight: 700, border: "1px solid var(--card-border)", borderRadius: 5, padding: "3px 8px" }}>SETTINGS</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{INSPECTOR_TITLE}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{INSPECTOR_SUB}</span>
        {view && (
          <span data-testid="inspector-version" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "oklch(0.45 0.1 240)", background: "oklch(0.94 0.03 225)", borderRadius: 6, padding: "4px 10px" }}>
            v{view.version.live} live{view.version.draft ? ` · v${view.version.draft} draft` : ""}
          </span>
        )}
      </div>
      {error && <div style={{ fontSize: 12.5, color: "var(--amber-text)", marginTop: 10 }}>{error}</div>}
      {!view && !error && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>Reading the settings…</div>}
      {view && (
        <>
          <div data-testid="inspector-band" style={{ fontSize: 12.5, color: "oklch(0.35 0.05 262)", marginTop: 10, lineHeight: 1.5 }}>
            {view.band ? (
              <>
                <span style={{ fontWeight: 600 }}>Set for {view.band.label}</span> <span style={{ color: "var(--muted)" }}>— {view.band.why}</span>
              </>
            ) : (
              NO_BAND_LINE
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 14 }}>
            {fields.map((f) => {
              const value = edits[f.key] !== undefined ? edits[f.key] : f.value;
              const shown: ParamsField = { ...f, value };
              const line = industryLine(shown, cur);
              return (
                <label key={f.key} data-testid={`param-${f.key}`} style={{ display: "block" }}>
                  <span style={label}>
                    {f.label}
                    {f.unit === "money" ? ` · ${cur}` : f.unit && f.unit !== "x" ? ` · ${f.unit}` : ""}
                  </span>
                  {f.kind === "choice" ? (
                    <select value={value === null ? "" : String(value)} onChange={(e) => setEdits((d) => ({ ...d, [f.key]: e.target.value || null }))} style={inputStyle}>
                      <option value="">— industry default —</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={value === null ? "" : String(value)}
                        min={f.range?.[0]}
                        max={f.range?.[1]}
                        step={f.unit === "x" ? 0.1 : f.unit === "money" ? 1 : 1}
                        placeholder={f.industry?.value === null || f.industry === null ? "not set" : formatValue(f.industry.value, f, cur)}
                        onChange={(e) => setEdits((d) => ({ ...d, [f.key]: e.target.value === "" ? null : Number(e.target.value) }))}
                        style={inputStyle}
                      />
                      {f.range && typeof value === "number" && (
                        <input type="range" aria-label={`${f.label} slider`} min={f.range[0]} max={f.range[1]} step={f.unit === "x" ? 0.1 : 1} value={value} onChange={(e) => setEdits((d) => ({ ...d, [f.key]: Number(e.target.value) }))} style={{ width: "100%", marginTop: 6 }} />
                      )}
                    </>
                  )}
                  <span data-testid={`industry-${f.key}`} style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.4 }}>
                    {line}
                    {shown.source !== "industry" || edits[f.key] !== undefined ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 5, padding: "1px 6px" }}>{edits[f.key] !== undefined ? "unsaved" : sourceLabel(shown.source)}</span> : null}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "oklch(0.4 0.04 262)", marginTop: 3, lineHeight: 1.4 }}>{f.helper}</span>
                </label>
              );
            })}
          </div>
          {view.steps.length > 0 && (
            <div data-testid="inspector-steps" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              {view.steps.map((s) => {
                const included = stepEdits[s.id] !== undefined ? stepEdits[s.id] : s.included;
                return (
                  <label key={s.id} data-testid={`step-${s.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, border: `1px solid ${included ? "oklch(0.88 0.015 260)" : "oklch(0.92 0.008 260)"}`, color: included ? "oklch(0.35 0.05 262)" : "var(--muted)", background: included ? "white" : "oklch(0.975 0.004 260)", borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>
                    <input type="checkbox" checked={included} onChange={(e) => setStepEdits((d) => ({ ...d, [s.id]: e.target.checked }))} />
                    Include: {s.label}
                  </label>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            <button onClick={() => void save()} disabled={!dirty || busy !== null} className="btn-navy" style={{ flex: "none", padding: "8px 17px", fontSize: 12.5, fontWeight: 600, opacity: dirty ? 1 : 0.55, cursor: dirty ? "pointer" : "default" }}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <button onClick={() => (setEdits({}), setStepEdits({}))} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12.5, fontWeight: 500, cursor: "pointer", padding: 0 }}>
                Reset
              </button>
            )}
            <span style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 220 }}>Nothing runs on a new number until the draft passes a dry run and you promote it.</span>
          </div>
          {(view.version.draft || note) && (
            <div data-testid="inspector-draft" style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, background: "var(--amber-wash)", borderRadius: 10, padding: "12px 16px", flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, color: "oklch(0.4 0.1 70)", lineHeight: 1.5, flex: 1, minWidth: 260 }}>{note ?? `Draft v${view.version.draft} is waiting. Run the dry-run validation, then promote it — the live version keeps running meanwhile.`}</div>
              {view.version.draft && (
                <>
                  <button onClick={() => void act("validate")} disabled={busy !== null} className="btn-navy" style={{ flex: "none", padding: "8px 17px", fontSize: 12.5, fontWeight: 600 }}>
                    {busy === "validate" ? "Running…" : "Run dry-run validation"}
                  </button>
                  {view.canPromote && (
                    <button onClick={() => void act("promote")} disabled={busy !== null} className="btn-cyan" style={{ flex: "none", padding: "8px 17px", fontSize: 12.5, fontWeight: 700 }}>
                      {busy === "promote" ? "Promoting…" : "Promote to production"}
                    </button>
                  )}
                  <button onClick={() => void act("discard")} disabled={busy !== null} className="hov-underline" style={{ border: "none", background: "transparent", color: "oklch(0.4 0.1 70)", fontSize: 12, cursor: "pointer", padding: 0 }}>
                    Discard draft
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
