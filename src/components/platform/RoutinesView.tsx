"use client";

import { useState } from "react";
import type { PlatformVals } from "@/lib/platform/derive";
import type { RunNowProps } from "./RunNowPanel";
import RoutineDetail from "./RoutineDetail";
import { agoLabel, runStatusLabel, useRoutinesState, type RoutinesStateListing, type RoutineStateView } from "./useRoutinesState";

/** `run` = who a manual "Run now (dry run)" runs for (Platform decides: the account, or `demo`). */
export type RunTarget = Omit<RunNowProps, "routineId">;

/* Demo mode (run.persisted = false): the prototype's rows, verbatim, from derive.ts.

   Accounts mode: every row comes from GET /api/routines/state — the real enabled state
   (routine_states), version, honest availability ("needs Klaviyo connected", "draft-only for
   now") plus the "Better with Gorgias connected" hint for optional sources (a nudge, never a
   block), the last run and the last draft, and a "Recommended first" chip on the agreed plan's
   phase-1 launch-wave routines. Switching one on persists routine_states.enabled
   (POST /api/routines/state) AND dry-runs it at once (POST /api/routines/run): the row shows
   "Running now…" then "Draft ready · view". The client-side switch is kept in step (derive's
   toggle) so the autosave never writes the old value back. */

export const ROUTINES_COPY = {
  recommended: "Recommended first",
  planStart: (channel: string) => `Your plan starts with ${channel} — this one first.`,
  running: "Running now…",
  draftReady: "Draft ready",
  view: "view",
  loading: "Reading your routines…",
  failed: "Couldn’t reach the runtime just now",
  nothingYet: "Nothing has run yet",
  /** Optional sources not yet connected — shown after the availability line; the switch stays live. */
  betterWith: (names: string) => `Better with ${names} connected`,
} as const;

type RunOutcome = { status: string; summary: string; drafts: number; runId: string } | { error: string };
type RunResponse = { run?: { runId: string; status: string; summary: string; receipts: { kind: string }[] }; error?: string };
type StateResponse = { routine?: RoutineStateView; error?: string; fallback?: boolean };

const ON_KNOB = "19.5px"; // derive.ts channelRows.knobLeft when the client-side switch is on

export default function RoutinesView({ V, run, initialLive = null }: { V: PlatformVals; run: RunTarget; initialLive?: RoutinesStateListing | null }) {
  const live = useRoutinesState(run.persisted, initialLive);
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, RunOutcome>>({});
  const [switchErr, setSwitchErr] = useState<Record<string, string>>({});

  const rowsByName = Object.fromEntries(V.channelRows.map((cr) => [cr.name, cr]));

  /** Keep derive's client-side switch equal to the persisted value (its toggle flips whatever it currently shows). */
  const syncClient = (name: string, enabled: boolean) => {
    const cr = rowsByName[name];
    if (cr && (cr.knobLeft === ON_KNOB) !== enabled) cr.toggle();
  };

  async function switchTo(r: RoutineStateView, enabled: boolean) {
    if (busy) return;
    setBusy(r.routineId);
    setSwitchErr((e) => ({ ...e, [r.routineId]: "" }));
    try {
      const res = await fetch("/api/routines/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ routineId: r.routineId, enabled }) });
      const data = (await res.json().catch(() => ({}))) as StateResponse;
      if (!res.ok || !data.routine) {
        setSwitchErr((e) => ({ ...e, [r.routineId]: data.error ?? `couldn’t save that (${res.status})` }));
        return;
      }
      live.patch(data.routine);
      syncClient(r.name, enabled);
      if (!enabled) return;
      // On → dry run now. The draft lands in "What I drafted" and on this row.
      setRunning(r.routineId);
      try {
        const rr = await fetch("/api/routines/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: run.accountId, routineId: r.routineId, account: run.account }) });
        const rd = (await rr.json().catch(() => ({}))) as RunResponse;
        if (!rr.ok || !rd.run) setOutcomes((o) => ({ ...o, [r.routineId]: { error: rd.error ?? `run failed (${rr.status})` } }));
        else setOutcomes((o) => ({ ...o, [r.routineId]: { status: rd.run!.status, summary: rd.run!.summary, drafts: rd.run!.receipts.filter((x) => x.kind === "draft").length, runId: rd.run!.runId } }));
      } catch (e) {
        setOutcomes((o) => ({ ...o, [r.routineId]: { error: e instanceof Error ? e.message : String(e) } }));
      } finally {
        setRunning(null);
        live.refresh();
      }
    } catch (e) {
      setSwitchErr((x) => ({ ...x, [r.routineId]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  }

  const accounts = run.persisted;
  const liveRows = accounts && live.data ? live.data.routines : null;
  const anyOn = !!liveRows?.some((r) => r.enabled);

  function statusLine(r: RoutineStateView): { text: string; tone: "cyan" | "muted" | "amber"; view: boolean } {
    if (running === r.routineId) return { text: ROUTINES_COPY.running, tone: "cyan", view: false };
    const o = outcomes[r.routineId];
    if (o && "error" in o) return { text: `Couldn’t run it: ${o.error}`, tone: "amber", view: false };
    if (o && o.drafts > 0) return { text: `${ROUTINES_COPY.draftReady} ·`, tone: "cyan", view: true };
    if (o) return { text: `${runStatusLabel(o.status)} — ${o.summary}`, tone: "muted", view: true };
    if (r.lastRun) {
      const bits = [`Last run ${agoLabel(r.lastRun.at)} · ${runStatusLabel(r.lastRun.status)}`];
      if (r.lastDraft) bits.push(`${ROUTINES_COPY.draftReady} ·`);
      return { text: bits.join(" · "), tone: r.lastRun.status === "failed" ? "amber" : "muted", view: !!r.lastDraft };
    }
    return { text: r.enabled ? ROUTINES_COPY.nothingYet : "", tone: "muted", view: false };
  }

  return (
    <div style={{ maxWidth: 1020, margin: "0 auto", padding: "50px 48px 96px" }}>
      {V.noSel && (
        <>
          {V.catAll && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <h1 style={{ fontWeight: 600, fontSize: 28, margin: 0, letterSpacing: "-0.015em" }}>Routines</h1>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>pick a role · switch things on and off inside</div>
              </div>
              {accounts && live.error && (
                <div data-testid="routines-live-error" style={{ fontSize: 12.5, color: "var(--amber-text)", marginTop: 10, lineHeight: 1.5 }}>
                  {ROUTINES_COPY.failed} ({live.error}).
                </div>
              )}
              {accounts && !live.data && !live.error && (
                <div data-testid="routines-loading" style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 10 }}>
                  {ROUTINES_COPY.loading}
                </div>
              )}
              {accounts && liveRows && !anyOn && live.data?.planChannel && (
                <div data-testid="routines-plan-start" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, background: "var(--cyan-wash)", borderRadius: 13, padding: "12px 16px", fontSize: 13, color: "oklch(0.3 0.06 262)" }}>
                  <img src="/brand/mascot-small.png" alt="" style={{ width: 30, height: 32, objectFit: "contain", flex: "none" }} />
                  <span>{ROUTINES_COPY.planStart(live.data.planChannel)}</span>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 26 }}>
                {V.catCards.map((cc2) => {
                  const inCat = liveRows?.filter((r) => r.category === cc2.name);
                  const onLabel = inCat ? `${inCat.filter((r) => r.enabled).length} of ${inCat.length} on` : accounts ? "…" : cc2.onLabel;
                  const recommended = !!inCat?.some((r) => r.recommended && !r.enabled);
                  return (
                    <button key={cc2.name} onClick={cc2.open} className="hov-card-cyan" style={{ textAlign: "left", background: "white", border: `1px solid ${recommended ? "oklch(0.78 0.13 220 / 0.6)" : "var(--card-border)"}`, borderRadius: 16, padding: 22, cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 17, fontWeight: 600 }}>{cc2.name}</div>
                        {recommended && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "3px 8px" }}>{ROUTINES_COPY.recommended}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 5 }}>{cc2.tagline}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--cyan-text)", marginTop: 14 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)" }}></span>
                        {onLabel}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {V.catOne && (
            <>
              <button onClick={V.backToCats} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: 0 }}>
                ← All roles
              </button>
              <h1 style={{ fontWeight: 600, fontSize: 28, margin: "16px 0 0", letterSpacing: "-0.015em" }}>{V.selCatName}</h1>
              <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 6 }}>{V.selCatTag}</div>
              {accounts && live.error && (
                <div data-testid="routines-live-error" style={{ fontSize: 12.5, color: "var(--amber-text)", marginTop: 10, lineHeight: 1.5 }}>
                  {ROUTINES_COPY.failed} ({live.error}).
                </div>
              )}
              {accounts && liveRows && !anyOn && live.data?.planChannel === V.selCatName && (
                <div data-testid="routines-plan-start" style={{ fontSize: 13, color: "var(--cyan-text)", marginTop: 12, fontWeight: 500 }}>
                  {ROUTINES_COPY.planStart(live.data.planChannel)}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 26, maxWidth: 720 }}>
                {!accounts &&
                  V.channelRows.map((cr) => (
                    <div key={cr.name} style={{ display: "flex", alignItems: "center", gap: 16, background: "white", border: "1px solid var(--card-border)", borderRadius: 13, padding: "16px 20px" }}>
                      <button
                        onClick={cr.toggle}
                        title="On / off"
                        style={{ flex: "none", width: 40, height: 23, borderRadius: 999, border: "none", background: cr.togBg, position: "relative", cursor: "pointer", transition: "background 0.25s" }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: 2.5,
                            left: cr.knobLeft,
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background: "white",
                            transition: "left 0.25s",
                            boxShadow: "0 1px 3px oklch(0.3 0.03 262 / 0.3)",
                          }}
                        ></span>
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{cr.benefit}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          {cr.name} · saves ~{cr.saves} h/wk
                        </div>
                      </div>
                      <button onClick={cr.how} className="hov-underline" style={{ flex: "none", border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
                        Tutorial →
                      </button>
                    </div>
                  ))}
                {accounts &&
                  liveRows &&
                  liveRows
                    .filter((r) => r.category === V.selCatName)
                    .map((r) => {
                      const cr = rowsByName[r.name];
                      const on = r.enabled;
                      const disabled = busy === r.routineId || (!on && !r.canEnable);
                      const sl = statusLine(r);
                      return (
                        <div key={r.routineId} data-testid={`routine-${r.routineId}`} data-enabled={on ? "1" : "0"} style={{ display: "flex", alignItems: "center", gap: 16, background: "white", border: `1px solid ${r.recommended && !on ? "oklch(0.78 0.13 220 / 0.6)" : "var(--card-border)"}`, borderRadius: 13, padding: "16px 20px" }}>
                          <button
                            onClick={() => void switchTo(r, !on)}
                            disabled={disabled}
                            title={on ? "Switch off" : r.canEnable ? "Switch on — dry-runs now" : r.availabilityCopy}
                            aria-label={`${r.name} — ${on ? "on" : "off"}`}
                            style={{ flex: "none", width: 40, height: 23, borderRadius: 999, border: "none", background: on ? "oklch(0.72 0.17 150)" : "oklch(0.88 0.015 260)", position: "relative", cursor: disabled ? "not-allowed" : "pointer", opacity: !on && !r.canEnable ? 0.55 : 1, transition: "background 0.25s" }}
                          >
                            <span style={{ position: "absolute", top: 2.5, left: on ? ON_KNOB : "2.5px", width: 18, height: 18, borderRadius: "50%", background: "white", transition: "left 0.25s", boxShadow: "0 1px 3px oklch(0.3 0.03 262 / 0.3)" }}></span>
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{cr?.benefit ?? r.name}</span>
                              {r.recommended && !on && (
                                <span data-testid="recommended-chip" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--cyan-text)", background: "var(--cyan-wash)", borderRadius: 999, padding: "3px 8px" }}>
                                  {ROUTINES_COPY.recommended}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                              {r.name} · v{r.version} · {r.availabilityCopy}
                              {r.betterWithCopy && (
                                <>
                                  {" · "}
                                  <span data-testid="better-with" style={{ color: "var(--cyan-text)" }}>{r.betterWithCopy}</span>
                                </>
                              )}
                            </div>
                            {(sl.text || switchErr[r.routineId]) && (
                              <div data-testid="routine-status" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 5, fontWeight: 500, color: switchErr[r.routineId] ? "var(--amber-text)" : sl.tone === "cyan" ? "var(--cyan-text)" : sl.tone === "amber" ? "var(--amber-text)" : "var(--muted)" }}>
                                {running === r.routineId && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan-link)", animation: "jpulse 1.6s infinite", flex: "none" }}></span>}
                                <span>{switchErr[r.routineId] || sl.text}</span>
                                {sl.view && !switchErr[r.routineId] && (
                                  <button onClick={cr?.how} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                                    {ROUTINES_COPY.view}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <button onClick={cr?.how} className="hov-underline" style={{ flex: "none", border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
                            Tutorial →
                          </button>
                        </div>
                      );
                    })}
              </div>
            </>
          )}
        </>
      )}
      {V.hasSel && <RoutineDetail V={V} run={run} live={accounts ? live : null} />}
    </div>
  );
}
