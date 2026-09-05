"use client";
/* "Adjust this routine" — the one-screen inspector in accounts mode (docs/PRESETS.md).

   The routine's 3–6 relevant preset fields as labelled inputs / sliders with the industry default
   under each ("Industry: NZ$25–35 · yours: NZ$30"), one toggle row per optional step the spec
   exposes ("Include: Gorgias tickets · 7d"), and Save → routine_params + a new draft version through
   the existing versioning; validate (dry run) and promote sit right under it, unchanged in meaning.
   Demo mode never mounts this (RoutineDetail keeps the prototype's inspector there).

   Reads GET /api/routines/params?routineId=; `initial` lets a server render / test start with the
   view in hand (no fetch). */

import { useCallback, useEffect, useRef, useState } from "react";
import { artifactHeaders } from "@/lib/artifacts/client";
import type { AgentContext } from "@/lib/agents/client";
import { formatValue, industryLine } from "@/lib/runtime/presets/industry";
import type { PresetField, PresetValue } from "@/lib/runtime/presets/types";
import type { SkillFile } from "@/lib/runtime/skills/types";
import type { AgreementScore } from "@/lib/runtime/agreement";
import ManualRecovery, { useManualRecovery } from "./ManualRecovery";

export interface ParamsField extends PresetField {
  relevant: boolean;
  bound: boolean;
}

export interface ParamsView {
  accountId?:string;contextGeneration?:number;role?:"owner"|"member";stateUpdatedAt?:string|null;configurationRevision?:string;
  routineId: string;
  domain: string;
  currency: string;
  band: { id: string; label: string; why: string } | null;
  fields: ParamsField[];
  steps: { id: string; label: string; kind: string; included: boolean }[];
  version: { live: number; draft: number | null };
  canPromote: boolean;
  skillFile?: SkillFile | null;
  agreement?: Pick<AgreementScore, "decided" | "approved" | "held" | "rate" | "applyUnlocked" | "line"> | null;
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

export default function RoutineInspector({ routineId, currency, initial, onSaved, context, blockReason, runBlockReason }: { routineId: string; currency: string; initial?: ParamsView | null; onSaved?: () => void; context?:AgentContext; blockReason?:string|null; runBlockReason?:string|null }) {
  const [view, setView] = useState<ParamsView | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, PresetValue>>({});
  const [stepEdits, setStepEdits] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"save" | "validate" | "promote" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tick,setTick]=useState(0);
  const inFlight=useRef(false);
  const mounted=useRef(true);
  const recovery=useManualRecovery(context,routineId,"validate");
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const accountId=context?.accountId, contextGeneration=context?.contextGeneration;
  const matches=useCallback((b:Body)=>!!accountId && b.accountId===accountId && b.contextGeneration===contextGeneration && b.routineId===routineId && Array.isArray(b.fields) && !!b.version,[accountId,contextGeneration,routineId]);
  const headers={"content-type":"application/json",...artifactHeaders(context?.accountId,context?.contextGeneration)};
  const blocked=blockReason || (!context || view?.role!=="owner" ? "Only a verified account owner can change these settings." : !view.configurationRevision ? "Refresh settings before changing this configuration." : null);

  useEffect(() => {
    if (initial !== undefined || !routineId) return;
    let cancelled = false;const c=new AbortController();const timer=setTimeout(()=>c.abort(),20_000);
    (async () => {
      try {
        const res = await fetch(`/api/routines/params?routineId=${encodeURIComponent(routineId)}`, { cache: "no-store",headers:artifactHeaders(context?.accountId,context?.contextGeneration),signal:c.signal });
        const body = (await res.json().catch(() => ({}))) as Body;
        if (cancelled) return;
        if (!res.ok || !matches(body)) {setView(null);setError("Couldn’t verify these account settings. Refresh to try again.");}
        else {
          setView(body as ParamsView);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {setView(null);setError(e instanceof Error ? e.message : String(e));}
      } finally {clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;c.abort();clearTimeout(timer);
    };
  }, [routineId, initial, context?.accountId, context?.contextGeneration, tick,matches]);

  const cur = view?.currency ?? currency;
  const fields = (view?.fields ?? []).filter((f) => f.relevant);
  const dirty = Object.keys(edits).length > 0 || Object.keys(stepEdits).length > 0;

  const apply = (body: Body) => {
    if (matches(body)) setView(body as ParamsView);
  };

  async function save() {
    if (!view || busy || inFlight.current || blocked) return;
    inFlight.current=true;
    setBusy("save");
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/routines/params", { method: "PATCH", headers, body: JSON.stringify({ routineId, params: edits, steps: stepEdits, version:view.version.live,stateUpdatedAt:view.stateUpdatedAt,configurationRevision:view.configurationRevision }) });
      const body = (await res.json().catch(() => ({}))) as Body;
      if(!mounted.current)return;
      if (!res.ok || !matches(body)) {setError(body.issues?.length ? body.issues.map((i)=>i.message).join(" · ") : "Save not confirmed. Refresh to inspect the saved settings; no automatic retry.");}
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
      inFlight.current=false;
      if(mounted.current)setBusy(null);
    }
  }

  async function act(action: "validate" | "promote" | "discard") {
    if(!view || busy || inFlight.current || blocked || action!=="discard" && runBlockReason || action==="validate" && recovery.blocked)return;
    inFlight.current=true;
    setBusy(action === "discard" ? "save" : action);
    setError(null);
    setNote(null);
    try {
      const payload={routineId,action,version:view.version.live,stateUpdatedAt:view.stateUpdatedAt,configurationRevision:view.configurationRevision};
      const res = action==="validate"?null:await fetch("/api/routines/params", { method: "POST", headers, body: JSON.stringify(payload) });
      const body = (action==="validate"?await recovery.submit("/api/routines/params",payload):await res!.json().catch(()=>({}))) as Body;
      if(!mounted.current)return;
      if (res && !res.ok || !matches(body)) setError("Outcome not confirmed. Refresh to inspect the saved settings; no automatic retry.");
      else {
        apply(body);
        if (action === "validate") setNote(body.passed ? `Dry run passed (${body.run?.summary ?? "no incident"}). Promote when you’re happy.` : `Dry run did not pass: ${body.run?.summary ?? body.run?.status ?? "no summary"}. Nothing promoted.`);
        if (action === "promote") setNote(`Configured version v${body.version?.live ?? "?"} saved. This does not enable a routine or verify a schedule.`);
        if (action === "discard") setNote("Draft workflow discarded. The configured version is unchanged; saved editor values remain until you change them.");
        onSaved?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current=false;
      if(mounted.current)setBusy(null);
    }
  }

  return (
    <div data-testid="routine-inspector" style={{ marginTop: 12, background: "white", border: "1px solid var(--card-border)", borderRadius: 14, padding: "18px 22px" }}>
      <ManualRecovery recovery={recovery} busy={!!busy} blocked={!!blocked||!!runBlockReason} onResult={body=>{const r=body.run as {summary:string};setNote(r.summary);setError(null);setTick(t=>t+1);onSaved?.();}}/>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "oklch(0.45 0.1 240)", fontWeight: 700, border: "1px solid var(--card-border)", borderRadius: 5, padding: "3px 8px" }}>SETTINGS</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{INSPECTOR_TITLE}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{INSPECTOR_SUB}</span>
        {view && (
          <span data-testid="inspector-version" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "oklch(0.45 0.1 240)", background: "oklch(0.94 0.03 225)", borderRadius: 6, padding: "4px 10px" }}>
            v{view.version.live} configured{view.version.draft ? ` · v${view.version.draft} draft` : ""}
          </span>
        )}
      </div>
      <button onClick={()=>{setView(null);setError(null);setTick(n=>n+1);setEdits({});setStepEdits({});}} disabled={!!busy}>Refresh settings</button>
      {blocked && <p role="status">{blocked}</p>}
      {error && <div style={{ fontSize: 12.5, color: "var(--amber-text)", marginTop: 10 }}>{error}</div>}
      {!view && !error && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>Reading the settings…</div>}
      {view && (
        <>
          {view.agreement && (
            <div data-testid="inspector-agreement" style={{ fontSize: 12.5, color: view.agreement.applyUnlocked ? "oklch(0.4 0.1 150)" : "oklch(0.35 0.05 262)", marginTop: 10, lineHeight: 1.5 }}>
              {view.agreement.line}
            </div>
          )}
          {view.skillFile && (
            <div data-testid="inspector-skill-file" style={{ marginTop: 14, border: "1px solid var(--card-border)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ ...label, marginBottom: 6 }}>This skill</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "oklch(0.3 0.05 262)", marginBottom: 8 }}>{view.skillFile.goal}</div>
              {(["owns", "reads", "decides", "writes", "never"] as const).map((k) => (
                <div key={k} data-testid={`skill-${k}`} style={{ fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>
                  <span style={{ fontWeight: 600, textTransform: "capitalize", color: "var(--muted)", letterSpacing: "0.04em" }}>{k}: </span>
                  {view.skillFile![k].join(" · ")}
                </div>
              ))}
              <div data-testid="skill-apply" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 8, color: "oklch(0.4 0.08 70)" }}>
                <span style={{ fontWeight: 600 }}>Apply: </span>
                {view.skillFile.apply}
              </div>
            </div>
          )}
          <div data-testid="inspector-band" style={{ fontSize: 12.5, color: "oklch(0.35 0.05 262)", marginTop: 10, lineHeight: 1.5 }}>
            {view.band ? (
              <>
                <span style={{ fontWeight: 600 }}>Set for {view.band.label}</span> <span style={{ color: "var(--muted)" }}>— {view.band.why}</span>
              </>
            ) : (
              NO_BAND_LINE
            )}
          </div>
          <fieldset disabled={!!blocked || !!busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 14, marginTop: 14 }}>
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
              <div style={{ fontSize: 12.5, color: "oklch(0.4 0.1 70)", lineHeight: 1.5, flex: 1, minWidth: 260 }}>{note ?? `Draft v${view.version.draft} is waiting. Run the dry-run validation, then promote it — the configured version stays unchanged; a schedule is not verified here.`}</div>
              {view.version.draft && (
                <>
                  <button onClick={() => void act("validate")} disabled={busy !== null || !!runBlockReason || recovery.blocked} className="btn-navy" style={{ flex: "none", padding: "8px 17px", fontSize: 12.5, fontWeight: 600 }}>
                    {busy === "validate" ? "Running…" : "Run dry-run validation"}
                  </button>
                  {view.canPromote && (
                    <button onClick={() => void act("promote")} disabled={busy !== null || !!runBlockReason} className="btn-cyan" style={{ flex: "none", padding: "8px 17px", fontSize: 12.5, fontWeight: 700 }}>
                      {busy === "promote" ? "Promoting…" : "Use validated configuration"}
                    </button>
                  )}
                  <button onClick={() => void act("discard")} disabled={busy !== null} className="hov-underline" style={{ border: "none", background: "transparent", color: "oklch(0.4 0.1 70)", fontSize: 12, cursor: "pointer", padding: 0 }}>
                    Discard draft
                  </button>
                </>
              )}
            </div>
          )}
          </fieldset>
        </>
      )}
    </div>
  );
}
