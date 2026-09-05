"use client";

import React, { useEffect, useState } from "react";
import { isAgentSnapshot } from "@/lib/agents/client";
import { routineBlock, type AgentsSnapshot } from "@/lib/agents/types";
import { CONNECTOR_PLATFORMS } from "@/lib/db/mapping";
import { receiptHandle } from "@/lib/platform/approvals";
import type { PlatformVals } from "@/lib/platform/derive";
import { CATALOG_SPEC_BY_ID } from "@/lib/runtime/catalog-specs";
import { readPlatforms, requiredPlatforms } from "@/lib/runtime/availability";
import type { KpiContract, Node, RoutineSpec } from "@/lib/runtime/types";
import RunNowPanel, { type RunNowProps } from "./RunNowPanel";
import DraftCard, { type ArtifactView } from "./DraftCard";
import { artifactHeaders } from "@/lib/artifacts/client";
import RoutineInspector, { type ParamsView } from "./RoutineInspector";
import { agoLabel, runStatusLabel, type RoutinesLive } from "./useRoutinesState";

const contractCard: React.CSSProperties = { background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "17px 19px" };
const contractLabel: React.CSSProperties = { fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 };

/* Demo mode (live = null): the prototype's detail view, verbatim.

   Accounts mode (live from RoutinesView): the state pill, the version badge and the workflow
   canvas come from the real routine (routine_states + the catalog spec's actual node chain,
   read-only), the receipts trail is the LAST REAL RUN (GET /api/routines/state?routineId=),
   and "Set this up" is the real setup state: which sources the chain reads and whether each
   is connected, the account's currency and budget, then Run now. No demo furniture. */

type Trail = { id: string; kind: string; platform: string | null; description: string; createdAt: string }[];


const NAME_BY_PLATFORM: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([n, p]) => [p, n]));

const NODE_STYLE: Record<Node["kind"], { tag: string; color: string }> = {
  trigger: { tag: "TRIGGER", color: "oklch(0.5 0.12 75)" },
  read: { tag: "READ", color: "oklch(0.55 0.11 235)" },
  check: { tag: "CHECK", color: "oklch(0.55 0.11 235)" },
  decide: { tag: "DECIDE", color: "oklch(0.45 0.1 240)" },
  produce: { tag: "PRODUCE", color: "oklch(0.45 0.12 150)" },
  n8n: { tag: "N8N", color: "oklch(0.45 0.12 150)" },
  gate: { tag: "GATE", color: "oklch(0.5 0.12 75)" },
  execute: { tag: "EXECUTE", color: "oklch(0.45 0.1 240)" },
  receipt: { tag: "RECEIPT", color: "oklch(0.55 0.11 235)" },
};

function cadenceLabel(c: string): string {
  if (c === "manual") return "Manual";
  if (c.startsWith("event:")) return `On ${c.slice(6).replace(/:/g, " ")}`;
  if (c === "0 7 * * *") return "Daily 07:00";
  if (c === "0 8 * * 1") return "Mondays 08:00";
  if (c === "0 */6 * * *") return "Every 6 h";
  if (c === "0 * * * *") return "Hourly";
  return `cron ${c}`;
}

function accountCadence(spec: RoutineSpec | undefined): string {
  const trigger = spec?.nodes.find((node) => node.kind === "trigger");
  return trigger?.kind === "trigger" ? cadenceLabel(trigger.cadence) : "On demand";
}

function accountWriteMode(spec: RoutineSpec | undefined): string {
  return spec?.mutates
    ? "Approval gated — prepares the exact change and waits for an owner before any destination write."
    : "Draft only — produces inspectable work and never changes the destination.";
}

function targetLabel(kpi: KpiContract, currency: string): string {
  const target = Number.isInteger(kpi.target) ? String(kpi.target) : String(kpi.target);
  if (kpi.unit === "$") return `${currency} ${target}`;
  if (kpi.unit === "%" || kpi.unit === "×" || kpi.unit === "h") return `${target}${kpi.unit}`;
  return `${target} ${kpi.unit}`;
}

function accountKpi(spec: RoutineSpec | undefined, currency: string): string {
  if (!spec?.kpi) return "No measurement contract published yet.";
  const direction = spec.kpi.op === "gte" ? "at least" : "at most";
  return `${spec.kpi.label} — target ${direction} ${targetLabel(spec.kpi, currency)}, measured over ${spec.kpi.windowDays} days.`;
}

/** The spec's chain as canvas cards: name + one honest line per node. */
export function specNodes(routineId: string, configured?: RoutineSpec): { tag: string; name: string; desc: string; color: string }[] {
  const spec = configured ?? CATALOG_SPEC_BY_ID[routineId];
  if (!spec) return [];
  return spec.nodes.map((n) => {
    const s = NODE_STYLE[n.kind];
    switch (n.kind) {
      case "trigger":
        return { ...s, name: "Schedule", desc: cadenceLabel(n.cadence) };
      case "read":
        return { ...s, name: NAME_BY_PLATFORM[n.source] ?? n.source, desc: `${n.query.resource}${n.query.window ? ` · ${n.query.window}` : ""}${n.optional ? " · optional" : ""}` };
      case "check":
        return { ...s, name: n.id.replace(/_/g, " "), desc: n.onFail === "fail" ? "fails closed" : "skips quietly" };
      case "decide":
        return { ...s, name: "Decision", desc: `${n.options.length} options · ${n.rule.kind}` };
      case "produce":
        return { ...s, name: "Draft the work", desc: `skill ${n.skill ?? routineId}${n.maxItems ? ` · ≤ ${n.maxItems} items` : ""}` };
      case "n8n":
        return { ...s, name: "n8n workflow", desc: n.webhookUrlEnv ? `webhook from ${n.webhookUrlEnv}` : "registered webhook" };
      case "gate":
        return { ...s, name: "Approval", desc: `${n.approver ?? "you"} · ${n.expiryHours} h` };
      case "execute":
        return { ...s, name: n.mutation.action.replace(/_/g, " "), desc: `${NAME_BY_PLATFORM[n.platform] ?? n.platform} · wave 2` };
      case "receipt":
        return { ...s, name: "Receipt", desc: `${n.measurementWindowDays ?? 14}-day measure` };
    }
  });
}

export default function RoutineDetail({ V, run, live = null, inspectorInitial }: { V: PlatformVals; run: Omit<RunNowProps, "routineId">; live?: RoutinesLive | null; /** Accounts mode, server render / tests: the params view in hand (undefined = fetch). */ inspectorInitial?: ParamsView | null }) {
  const routineId = V.selId ?? "";
  const accounts = !!live;
  const mine = live?.data?.routines.find((r) => r.routineId === routineId) ?? null;
  const [trail, setTrail] = useState<Trail | null>(null);
  const [trailErr, setTrailErr] = useState<string | null>(null);
  const [connected, setConnected] = useState<string[] | null>(live?.data?.connected ?? null);
  const [tick, setTick] = useState(0);
  const [lastArtifact, setLastArtifact] = useState<ArtifactView | null | undefined>(undefined);
  const [channels, setChannels] = useState<string[]>([]);
  const [detail, setDetail] = useState<AgentsSnapshot | null>(live?.eligibility ?? null);
  const [artifactError, setArtifactError] = useState(false);

  useEffect(() => {
    if (!accounts || !routineId) return;
    let cancelled = false;
    const c=new AbortController();const timer=setTimeout(()=>c.abort(),20_000);
    (async () => {
      try {
        const res = await fetch(`/api/agents?routineId=${encodeURIComponent(routineId)}`, { cache: "no-store", signal:c.signal, headers:artifactHeaders(V.accountId,V.contextGeneration) });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !isAgentSnapshot(body,{accountId:V.accountId ?? "",contextGeneration:V.contextGeneration}) || body.spec?.id!==routineId) throw new Error("Routine context or configuration could not be verified.");
        else {
          setDetail(body);
          setTrail(body.lastRunReceipts ?? []);
          if (Array.isArray(body.connected)) setConnected(body.connected);
          setTrailErr(null);
        }
      } catch (e) {
        if (!cancelled) {setDetail(null);setTrail(null);setConnected(null);setTrailErr(e instanceof Error ? e.message : String(e));}
      } finally {clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;c.abort();clearTimeout(timer);
    };
  }, [accounts, routineId, tick, V.accountId, V.contextGeneration]);

  /* The last artifact this routine produced (GET /api/artifacts?routineId=…&limit=1). */
  useEffect(() => {
    if (!accounts || !routineId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/artifacts?routineId=${encodeURIComponent(routineId)}&limit=1`, { cache: "no-store", headers: artifactHeaders(V.accountId, V.contextGeneration) });
        const body = (await res.json().catch(() => ({}))) as { accountId?: string; contextGeneration?: number; artifacts?: ArtifactView[]; channels?: string[]; fallback?: boolean };
        if (cancelled) return;
        if (res.ok && body.accountId === V.accountId && body.contextGeneration === V.contextGeneration && Array.isArray(body.artifacts)) {
          setLastArtifact(body.artifacts[0] ?? null);
          setChannels(Array.isArray(body.channels) ? body.channels : []);
        } else {setLastArtifact(undefined);setChannels([]);setArtifactError(true);}
      } catch {
        if (!cancelled) {setLastArtifact(undefined);setChannels([]);setArtifactError(true);}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts, routineId, tick, V.accountId, V.contextGeneration]);

  const refresh = () => {
    setDetail(null);setTrail(null);setTrailErr(null);setLastArtifact(undefined);setArtifactError(false);
    setTick((n) => n + 1);
    live?.refresh();
  };

  const spec = accounts ? detail?.spec : undefined;
  const nodes = accounts && spec ? specNodes(routineId,spec) : [];
  const detailRow=detail?.routines.find(r=>r.routineId===routineId);
  const currentRow=live?.eligibility?.routines.find(r=>r.routineId===routineId);
  const eligibility = detail && live?.eligibility && !live.loading && detailRow?.version===currentRow?.version && detailRow?.stateUpdatedAt===currentRow?.stateUpdatedAt ? {...detail,role:live.eligibility.role,paused:live.eligibility.paused,routines:live.eligibility.routines} : null;
  const block = accounts ? (live?.error || trailErr || routineBlock(eligibility,routineId)) : null;
  const sources = spec ? readPlatforms(spec) : [];
  const have = new Set(connected ?? []);
  const minimum = spec?.minimum ?? null;
  /* Only required reads + the stated minimum's platforms gate the routine; optional reads help ("Better with …"). */
  const required = new Set<string>(spec ? requiredPlatforms(spec) : []);
  const stateText = accounts ? (mine ? (mine.enabled ? "On" : "Off") : "…") : V.selState;
  const stateColor = accounts ? (mine?.enabled ? "oklch(0.45 0.1 240)" : "oklch(0.52 0.03 260)") : V.selStateColor;
  const stateBg = accounts ? (mine?.enabled ? "oklch(0.94 0.03 225)" : "oklch(0.945 0.008 260)") : V.selStateBg;
  const cadence = accounts ? (spec ? accountCadence(spec) : "Configuration not verified") : V.selCadence;
  const writeMode = accounts ? (spec ? accountWriteMode(spec) : "Configuration not verified") : V.selMode;
  const kpi = accounts ? accountKpi(spec, run.account.currency) : V.selKpi;

  return (
    <>
      <button
        data-buddy="Every step here is inspectable. Nothing runs outside these bounds."
        onClick={V.closeSys}
        className="hov-underline"
        style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: 0 }}
      >
        ← All routines
      </button>
      {accounts && <button onClick={refresh} style={{marginLeft:18}}>Refresh routine</button>}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap:"wrap", gap: 24, marginTop: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--cyan-link)" }}>
            {V.selId} · {V.selCat}
          </div>
          <h1 style={{ fontWeight: 600, fontSize: 26, margin: "8px 0 0", letterSpacing: "-0.015em" }}>{V.selName}</h1>
        </div>
        <span data-testid="detail-state" style={{ maxWidth:"100%", boxSizing:"border-box", fontSize: 11, fontWeight: 600, color: stateColor, background: stateBg, borderRadius: 6, padding: "5px 11px", marginTop: 6 }}>
          {stateText}
          {accounts && mine ? ` · ${mine.availabilityCopy}` : ""}
        </span>
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.6, color: "oklch(0.4 0.04 262)", marginTop: 12, maxWidth: 640 }}>{accounts ? "Inspect this routine’s saved configuration and execution evidence." : V.selPurpose}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12, marginTop: 28 }}>
        <div style={contractCard}>
          <div style={contractLabel}>{accounts ? "Configured cadence" : "Trigger & cadence"}</div>
          <div data-testid="contract-cadence" style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>{cadence}</div>
          {accounts && <p style={{fontSize:12,color:"var(--muted)"}}>Configuration only. No upcoming run or active schedule is verified here.</p>}
        </div>
        <div style={contractCard}>
          <div style={contractLabel}>Write mode</div>
          <div data-testid="contract-mode" style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>{writeMode}</div>
        </div>
        <div style={contractCard}>
          <div style={contractLabel}>KPI</div>
          <div data-testid="contract-kpi" style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>{kpi}</div>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>Workflow</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{accounts ? "— saved configuration, not an execution receipt" : "— click a step to inspect and edit it"}</span>
          <span data-testid="detail-version" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: accounts ? "oklch(0.45 0.1 240)" : V.wfVerColor, background: accounts ? "oklch(0.94 0.03 225)" : V.wfVerBg, borderRadius: 6, padding: "4px 10px" }}>
            {accounts ? (spec ? `v${spec.version} · configured` : "Configuration not verified") : V.wfVersion}
          </span>
        </div>
        <div
          style={{
            border: "1px solid var(--card-border)",
            borderRadius: 14,
            padding: "26px 20px",
            overflowX: "auto",
            backgroundColor: "white",
            backgroundImage: "radial-gradient(oklch(0.92 0.008 260) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {accounts
              ? nodes.map((n, i) => (
                  <React.Fragment key={`${n.tag}-${i}`}>
                    <div data-testid="spec-node" style={{ flex: "none", width: 128, textAlign: "left", background: "white", border: "1.5px solid oklch(0.89 0.012 260)", borderRadius: 11, padding: "11px 12px" }}>
                      <div style={{ fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: n.color, fontWeight: 700 }}>{n.tag}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4, color: "var(--ink)" }}>{n.name}</div>
                      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>{n.desc}</div>
                    </div>
                    {i < nodes.length - 1 && (
                      <div style={{ width: 30, height: 2, background: "oklch(0.8 0.02 260)", position: "relative", flex: "none" }}>
                        <div style={{ position: "absolute", right: -1, top: -3, width: 0, height: 0, borderLeft: "6px solid oklch(0.8 0.02 260)", borderTop: "4px solid transparent", borderBottom: "4px solid transparent" }}></div>
                      </div>
                    )}
                  </React.Fragment>
                ))
              : V.wfNodes.map((n) => (
                  <React.Fragment key={n.tag}>
                    <button onClick={n.pick} style={{ flex: "none", width: 128, textAlign: "left", background: "white", border: `1.5px solid ${n.border}`, borderRadius: 11, padding: "11px 12px", cursor: "pointer", boxShadow: n.shadow }}>
                      <div style={{ fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: n.tagColor, fontWeight: 700 }}>{n.tag}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4, color: "var(--ink)" }}>{n.name}</div>
                      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>{n.desc}</div>
                    </button>
                    {n.hasNext && (
                      <div style={{ width: 30, height: 2, background: "oklch(0.8 0.02 260)", position: "relative", flex: "none" }}>
                        <div style={{ position: "absolute", right: -1, top: -3, width: 0, height: 0, borderLeft: "6px solid oklch(0.8 0.02 260)", borderTop: "4px solid transparent", borderBottom: "4px solid transparent" }}></div>
                      </div>
                    )}
                  </React.Fragment>
                ))}
          </div>
        </div>
        {/* Accounts mode: the one-screen "Adjust this routine" panel (industry presets + optional steps → routine_params + a draft version). */}
        {accounts && routineId && <RoutineInspector key={`${V.accountId}:${V.contextGeneration}:${routineId}`} routineId={routineId} currency={run.account.currency} initial={inspectorInitial} onSaved={refresh} context={{accountId:V.accountId ?? "",contextGeneration:V.contextGeneration}} blockReason={eligibility?.role==="owner" && !eligibility.paused && !trailErr ? null : block ?? "Account eligibility unavailable."} runBlockReason={block} />}
        {!accounts && (
          <div style={{ marginTop: 12, background: "white", border: "1px solid var(--card-border)", borderRadius: 14, padding: "18px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: V.inspColor, fontWeight: 700, border: "1px solid var(--card-border)", borderRadius: 5, padding: "3px 8px" }}>{V.inspTag}</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{V.inspName}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 14 }}>
              {V.inspParams.map((pp) => (
                <label key={pp.k} style={{ display: "block" }}>
                  <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>{pp.k}</span>
                  <input
                    value={pp.v}
                    onChange={pp.set}
                    style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--card-border-2)", borderRadius: 8, padding: "8px 11px", fontSize: 13, outline: "none", background: "oklch(0.985 0.003 90)", color: "var(--ink)" }}
                  />
                </label>
              ))}
            </div>
            {V.wfDraft && (
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, background: "var(--amber-wash)", borderRadius: 10, padding: "12px 16px", flexWrap: "wrap" }}>
                <div style={{ fontSize: 12.5, color: "oklch(0.4 0.1 70)", lineHeight: 1.5, flex: 1, minWidth: 260 }}>{V.wfDraftMsg}</div>
                {V.wfCanValidate && (
                  <button onClick={V.wfValidate} className="btn-navy" style={{ flex: "none", padding: "8px 17px", fontSize: 12.5, fontWeight: 600 }}>
                    Run dry-run validation
                  </button>
                )}
                {V.wfValidated && (
                  <button onClick={V.wfPromote} className="btn-cyan" style={{ flex: "none", padding: "8px 17px", fontSize: 12.5, fontWeight: 700 }}>
                    Promote to production
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {accounts && (
        <div data-testid="last-run" style={{ marginTop: 12, background: "white", border: "1px solid var(--card-border)", borderRadius: 14, padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>Last run</span>
            {mine?.lastRun && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                — {agoLabel(mine.lastRun.at)} · {runStatusLabel(mine.lastRun.status)}
                {mine.lastRun.summary ? ` · ${mine.lastRun.summary}` : ""}
              </span>
            )}
          </div>
          {trailErr && <div style={{ fontSize: 12.5, color: "var(--amber-text)", marginTop: 8 }}>Couldn’t load the trail ({trailErr}).</div>}
          {!trailErr && trail === null && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>Reading the last run…</div>}
          {!trailErr && trail !== null && trail.length === 0 && (
            <div data-testid="last-run-empty" style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
              No saved run found in this context’s recent history. Selection, eligibility and execution are checked separately.
            </div>
          )}
          {!trailErr && trail !== null && trail.length > 0 && (
            <div data-testid="last-run-trail" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {trail.map((r) => (
                <div key={r.id} data-testid="last-run-row" style={{ display: "flex", gap: 10, fontSize: 12.5, lineHeight: 1.5, alignItems: "baseline" }}>
                  <span style={{ flex: "none", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, color: "var(--muted)" }}>{receiptHandle(r.id)}</span>
                  <span style={{ flex: "none", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cyan-link)", background: "var(--cyan-wash)", borderRadius: 5, padding: "2px 7px" }}>{r.kind}</span>
                  <span style={{ color: "var(--muted-2)", minWidth: 0 }}>{r.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {accounts && (
        <div data-testid="last-artifact" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>Last draft</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>— the real work this routine produced last time it ran</span>
          </div>
          {artifactError && <p role="alert">Couldn’t verify the last draft. Refresh; no empty result has been assumed.</p>}
          {lastArtifact === undefined && !artifactError && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Reading the last draft…</div>}
          {lastArtifact === null && (
            <div data-testid="last-artifact-empty" style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
              No saved draft found for this routine in the current business context.
            </div>
          )}
          {live?.eligibility && lastArtifact && lastArtifact.accountId === V.accountId && lastArtifact.contextGeneration === V.contextGeneration && lastArtifact.routineId === routineId && <DraftCard artifact={lastArtifact} defaultOpen channels={channels} onChange={(a) => setLastArtifact(a)} />}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10, background: "var(--cyan-wash)", borderRadius: 13, padding: "16px 20px", flexWrap: "wrap" }}>
        <img src="/brand/mascot-small.png" alt="" style={{ width: 38, height: 41, objectFit: "contain", flex: "none" }} />
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "oklch(0.3 0.06 262)", flex: 1, minWidth: 260 }}>
          Review saved run receipts for what was actually read or prepared. Publishing, customer messaging and ad changes remain disabled.
        </div>
        {V.selId && <RunNowPanel key={`${V.accountId}:${V.contextGeneration}:${routineId}`} routineId={V.selId} accountId={run.accountId} account={run.account} persisted={run.persisted} contextGeneration={V.contextGeneration} eligibility={eligibility} blockReason={block} onDone={accounts ? refresh : undefined} />}
        {!accounts && V.setupIdle && (
          <button onClick={V.openSetup} className="btn-navy" style={{ flex: "none", marginLeft: "auto", padding: "9px 18px", fontSize: 12.5, fontWeight: 600 }}>
            Set this up
          </button>
        )}
      </div>

      {accounts && (
        <div data-testid="real-setup" style={{ marginTop: 14, background: "white", border: "1.5px solid oklch(0.78 0.13 220 / 0.5)", borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--cyan-text)", fontWeight: 600 }}>Set up {V.selName}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>— what it reads, and what it needs from you</span>
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
            {sources.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>Reads no connected platform — research reads only.</span>}
            {sources.map((p) => {
              const ok = have.has(p);
              const helps = !required.has(p);
              return (
                <span key={p} data-testid={`source-${p}`} data-ok={ok ? "1" : "0"} style={{ fontSize: 12, border: `1px solid ${ok || helps ? "oklch(0.88 0.015 260)" : "oklch(0.8 0.09 75)"}`, color: ok ? "oklch(0.35 0.05 262)" : helps ? "var(--muted)" : "oklch(0.45 0.11 70)", background: ok ? "white" : helps ? "oklch(0.975 0.004 260)" : "oklch(0.93 0.05 80)", borderRadius: 999, padding: "5px 12px" }}>
                  {NAME_BY_PLATFORM[p] ?? p} · {ok ? "connected" : helps ? "optional" : "not connected"}
                </span>
              );
            })}
            <span style={{ fontSize: 12, border: "1px solid oklch(0.88 0.015 260)", color: "oklch(0.35 0.05 262)", background: "white", borderRadius: 999, padding: "5px 12px" }}>Currency · {run.account.currency}</span>
            <span style={{ fontSize: 12, border: "1px solid oklch(0.88 0.015 260)", color: "oklch(0.35 0.05 262)", background: "white", borderRadius: 999, padding: "5px 12px" }}>
              Budget guardrail · {run.account.currency} {Math.round(run.account.budgetMonthly).toLocaleString("en-NZ")}/mo
            </span>
          </div>
          {minimum && (
            <div data-testid="spec-minimum" style={{ fontSize: 12.5, color: "oklch(0.35 0.05 262)", marginTop: 10, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600 }}>Needs:</span> {minimum.summary}
              {minimum.inputs.length ? <span style={{ color: "var(--muted)" }}> · I ask you for {minimum.inputs.map((i) => i.replace(/_/g, " ")).join(", ")} when I don’t have it</span> : null}
            </div>
          )}
          {mine?.skillSource === "n8n" && (
            <div data-testid="skill-source-n8n" style={{ fontSize: 12.5, color: "oklch(0.35 0.05 262)", marginTop: 10, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600 }}>An n8n workflow is registered.</span> <span style={{ color: "var(--muted)" }}>Registration alone is not execution proof. Credential ownership and independent receipts are verified per integration; a fallback draft is not n8n success.</span>
            </div>
          )}
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
            <p role={block?"status":undefined}>{block ?? "Requirements check passed for a manual shadow request. Provider data and output still need execution evidence."}</p>
            {mine?.betterWithCopy && <p>{mine.betterWithCopy}</p>}
            <button onClick={V.goConnectors} className="hov-underline" style={{border:"none",background:"transparent",color:"var(--cyan-link)",cursor:"pointer"}}>Open Connectors →</button>
          </div>
        </div>
      )}

      {!accounts && V.setupOn && (
        <div style={{ marginTop: 14, background: "white", border: "1.5px solid oklch(0.78 0.13 220 / 0.5)", borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--cyan-text)", fontWeight: 600 }}>Set up {V.selName}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>— {V.setupProgress}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
            {V.setupSteps.map((ss) => (
              <div key={ss.title} style={{ display: "flex", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 24, flex: "none" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: ss.cBg, color: ss.cFg, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{ss.mark}</div>
                  {ss.line && <div style={{ width: 2, flex: 1, minHeight: 14, background: "var(--card-border)" }}></div>}
                </div>
                <div style={{ flex: 1, paddingBottom: 18, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: ss.tColor }}>{ss.title}</div>
                  {ss.active && (
                    <>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 9 }}>
                        {ss.items.map((it) => (
                          <span key={it.t} style={{ fontSize: 12, border: `1px solid ${it.border}`, color: it.color, background: it.bg, borderRadius: 999, padding: "5px 12px" }}>
                            {it.t}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 9, lineHeight: 1.5 }}>{ss.note}</div>
                      <button onClick={ss.next} className="btn-navy" style={{ marginTop: 11, padding: "8px 17px", fontSize: 12.5, fontWeight: 600 }}>
                        {ss.cta}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!accounts && V.setupDone && (
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, background: "var(--cyan-wash)", borderRadius: 13, padding: "14px 18px", fontSize: 13, color: "oklch(0.35 0.08 240)", fontWeight: 500 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan-link)", animation: "jpulse 1.6s infinite" }}></span>
          Dry run scheduled tonight — zero outward actions. The result and receipt land in Home tomorrow morning.
        </div>
      )}
    </>
  );
}
