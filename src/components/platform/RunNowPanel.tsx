"use client";
/* "Run now (dry run)" — a manual trigger from the routine detail view.

   POSTs /api/routines/run for this routine (the same service + adapters the always-on loop
   uses; dry run only, the executor refuses every mutation) and renders the receipt trail
   inline: id · kind · description. Works in demo mode (MemoryStore — runs vanish when the
   server restarts) and in accounts mode (persisted; the route binds the run to the session).
   `onDone` lets the detail view refresh its real state once a run has landed.

   waiting_input: the producer asked for something — the ask renders with an answer box per
   input (and a Connectors pointer per platform); "Send answers" POSTs /api/routines/resume-input
   and the run carries on from the same panel. */

import { useState } from "react";
import { receiptHandle } from "@/lib/platform/approvals";
import { CONNECTOR_PLATFORMS } from "@/lib/db/mapping";

const PLATFORM_NAME: Record<string, string> = Object.fromEntries(Object.entries(CONNECTOR_PLATFORMS).map(([n, p]) => [p, n]));

export interface RunNowProps {
  routineId: string;
  accountId: string;
  /** Fallback account context for when the accounts source doesn't know the id yet. */
  account: { currency: string; budgetMonthly: number };
  /** false = demo/MemoryStore: say so, in one line. */
  persisted: boolean;
  /** Accounts mode: called after a run finishes (any status) so the caller can re-read state. */
  onDone?: () => void;
  onOpenConnectors?: () => void;
}

export type RunNeed = { platform?: string; input?: string; why: string };
export type RunView = { runId: string; status: string; summary: string; error?: string | null; receipts: { id: string; kind: string; description: string }[]; artifact?: { id: string; kind: string; title: string; items: number } | null; needs?: RunNeed[] | null };

type RunResponse = { run?: RunView; error?: string };

export function runStatusHeading(status: string): string {
  switch (status) {
    case "done":
      return "Dry run complete";
    case "skipped":
      return "Nothing to do today";
    case "failed":
      return "Run failed closed";
    case "waiting_input":
      return "I need something from you";
    case "waiting_approval":
      return "Waiting for your approval";
    case "running":
      return "Still running";
    default:
      return status;
  }
}

export default function RunNowPanel({ routineId, accountId, account, persisted, onDone, onOpenConnectors }: RunNowProps) {
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  async function sendAnswers() {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/routines/resume-input", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.runId, answers }) });
      const data = (await res.json().catch(() => ({}))) as RunResponse;
      if (!res.ok || !data.run) setError(data.error ?? `couldn’t resume (${res.status})`);
      else {
        setRun({ ...data.run, receipts: [...run.receipts, ...data.run.receipts] });
        setAnswers({});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onDone?.();
    }
  }

  async function runNow() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/routines/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, routineId, account: { currency: account.currency, budgetMonthly: account.budgetMonthly } }),
      });
      const data = (await res.json().catch(() => ({}))) as RunResponse;
      if (!res.ok || !data.run) {
        setError(data.error ?? `run failed (${res.status})`);
        setRun(null);
      } else setRun(data.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onDone?.();
    }
  }

  const showCard = Boolean(run || error);
  return (
    <div data-testid="run-now" style={showCard ? { flexBasis: "100%", marginTop: 4, background: "white", border: "1px solid var(--card-border)", borderRadius: 14, padding: "14px 22px" } : { display: "contents" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button
          onClick={() => void runNow()}
          disabled={busy}
          className="hov-border-muted"
          style={{ flex: "none", border: "1px solid oklch(0.88 0.015 260)", background: "transparent", color: "var(--muted-2)", borderRadius: 999, padding: "8px 17px", fontSize: 12.5, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Running…" : "Run now (dry run)"}
        </button>
        {showCard && (
          <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, flex: 1, minWidth: 240 }}>
            Runs this system’s chain now against its reads — zero outward actions. The receipts land right here.
            {!persisted && " Demo mode: runs live in memory and vanish when the server restarts."}
          </span>
        )}
      </div>
      {error && (
        <div style={{ fontSize: 12.5, color: "var(--amber-text)", marginTop: 10, lineHeight: 1.5 }}>Couldn’t run it: {error}</div>
      )}
      {run && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
            {runStatusHeading(run.status)} <span style={{ color: "var(--muted)", fontWeight: 500 }}>— {run.summary}</span>
          </div>
          {run.artifact && (
            <div data-testid="run-artifact" style={{ marginTop: 8, fontSize: 12.5, color: "oklch(0.35 0.05 262)", background: "var(--cyan-wash)", borderRadius: 10, padding: "9px 12px", lineHeight: 1.5 }}>
              Drafted <span style={{ fontWeight: 600 }}>{run.artifact.title}</span>
              {run.artifact.items ? ` (${run.artifact.items} items)` : ""} — it’s in What I drafted on Home and under Last draft above.
            </div>
          )}
          {run.status === "waiting_input" && run.needs && run.needs.length > 0 && (
            <div data-testid="run-needs" style={{ marginTop: 10, border: "1px dashed oklch(0.8 0.09 75)", borderRadius: 12, padding: "12px 14px", background: "white" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--amber-text)" }}>To draft this I need:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                {run.needs.map((n, i) => (
                  <div key={i} data-testid="run-need">
                    <div style={{ fontSize: 12.5, color: "oklch(0.35 0.05 262)", lineHeight: 1.5 }}>
                      {n.platform ? (
                        <>
                          <span style={{ fontWeight: 600 }}>{PLATFORM_NAME[n.platform] ?? n.platform} connected</span> — {n.why}
                          {onOpenConnectors && (
                            <>
                              {" "}
                              <button onClick={onOpenConnectors} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", fontSize: 12.5, fontWeight: 500, cursor: "pointer", padding: 0 }}>
                                Open Connectors →
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <span style={{ fontWeight: 600 }}>{(n.input ?? "an answer").replace(/_/g, " ")}</span> — {n.why}
                        </>
                      )}
                    </div>
                    {n.input && (
                      <textarea
                        aria-label={n.input.replace(/_/g, " ")}
                        value={answers[n.input] ?? ""}
                        onChange={(e) => setAnswers((a) => ({ ...a, [n.input!]: e.target.value }))}
                        rows={3}
                        placeholder="Type it here — a few lines is plenty."
                        style={{ display: "block", width: "100%", marginTop: 6, fontFamily: "inherit", fontSize: 13, lineHeight: 1.5, border: "1px solid var(--input-border)", borderRadius: 8, padding: "8px 10px", outline: "none", background: "white", color: "var(--ink)", resize: "vertical" }}
                      />
                    )}
                  </div>
                ))}
              </div>
              {run.needs.some((n) => n.input) && (
                <button onClick={() => void sendAnswers()} disabled={busy || !Object.values(answers).some((v) => v.trim())} className="btn-navy" style={{ marginTop: 10, padding: "8px 17px", fontSize: 12.5, fontWeight: 600 }}>
                  {busy ? "Drafting…" : "Send answers and draft"}
                </button>
              )}
            </div>
          )}
          <div data-testid="run-trail" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {run.receipts.map((r) => (
              <div key={r.id} data-testid="run-trail-row" style={{ display: "flex", gap: 10, fontSize: 12.5, lineHeight: 1.5, alignItems: "baseline" }}>
                <span style={{ flex: "none", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, color: "var(--muted)" }}>{receiptHandle(r.id)}</span>
                <span style={{ flex: "none", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cyan-link)", background: "var(--cyan-wash)", borderRadius: 5, padding: "2px 7px" }}>{r.kind}</span>
                <span style={{ color: "var(--muted-2)", minWidth: 0 }}>{r.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
