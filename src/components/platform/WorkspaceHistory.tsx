"use client";
import { useEffect, useState } from "react";
import type { WorkspaceHistoryPage } from "@/lib/workspace/history";
import { artifactHeaders } from "@/lib/artifacts/client";
import DraftCard from "./DraftCard";
import styles from "./client-workspace.module.css";

/** Mounted only when requested, and keyed by account/generation by its parent.
 * Page responses are disposable; no work or cursors are persisted in the browser. */
export default function WorkspaceHistory({ accountId, generation, onOpenRoutine }: {
  accountId: string; generation: number; onOpenRoutine: (id: string) => void;
}) {
  const [positions, setPositions] = useState<(string | null)[]>([null]);
  const [data, setData] = useState<WorkspaceHistoryPage | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const cursor = positions.at(-1) ?? null;
  useEffect(() => {
    const controller = new AbortController(); let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    void (async () => {
      try {
        const response = await fetch(`/api/workspace/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
          { headers: artifactHeaders(accountId, generation), cache: "no-store", signal: controller.signal });
        const page = await response.json() as WorkspaceHistoryPage;
        if (disposed) return;
        if (!response.ok || page.accountId !== accountId || page.contextGeneration !== generation || !Array.isArray(page.entries) ||
          page.entries.length > 50 || !Number.isFinite(Date.parse(page.asOf)) ||
          !(page.nextCursor === null || typeof page.nextCursor === "string" && page.nextCursor.length > 0 && page.nextCursor.length <= 1024) ||
          page.entries.some(e => !e || !["artifact", "approval", "receipt", "run"].includes(e.kind) ||
            e.kind === "artifact" && (e.artifact.accountId !== accountId || e.artifact.contextGeneration !== generation))) throw Error();
        setData(page); setError(false);
      } catch { if (!disposed) { setData(null); setError(true); } }
      finally { clearTimeout(timeout); if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [accountId, generation, cursor, refresh]);
  const move = (next: (string | null)[]) => { setLoading(true); setData(null); setError(false); setPositions(next); };
  return <section aria-label="Saved work history">
    <h2>Saved work history</h2>
    <p className={styles.caption}>Drafts, approvals, runs and receipts in this business context. History is read-only; nothing here starts or resumes work.</p>
    <div className={styles.filters}>
      <button disabled={loading} onClick={() => { move([null]); setRefresh(n => n + 1); }}>Start from newest</button>
      <button disabled={loading || positions.length < 2} onClick={() => move(positions.slice(0, -1))}>Newer page</button>
      <span>Page {positions.length}</span>
      <button disabled={loading || !data?.nextCursor} onClick={() => { if (data?.nextCursor) move([...positions, data.nextCursor]); }}>Older page</button>
    </div>
    {loading && <p role="status">Loading saved history…</p>}
    {error && <p role="alert" className={styles.error}>Couldn’t verify this history page. No empty or completed state has been assumed. Start from newest to retry.</p>}
    {data && <>
      <p className={styles.caption}>Records created through {data.asOf}. Statuses reflect the latest read; this is not a frozen audit export. Refresh from newest to include later arrivals.</p>
      {!data.entries.length && <p className={styles.empty}>No saved records on this page.</p>}
      <div className={styles.workList}>{data.entries.map(entry => {
        const key = `${entry.kind}:${entry.id}`;
        if (entry.kind === "artifact") return <DraftCard key={key} artifact={entry.artifact} channels={[]} readOnly onOpenRoutine={onOpenRoutine} />;
        if (entry.kind === "approval") return <details key={key} className={styles.card}><summary>{entry.approval.title} · {entry.approval.status}</summary>
          <p>{entry.approval.detail}</p><p>{entry.approval.reasoning}</p><p>Before: {entry.approval.before || "Not recorded"}<br />Proposed: {entry.approval.after || "Not recorded"}</p>
          <p>Run approval only. Nothing is resumed from history.</p><p className={styles.code}>{entry.occurredAt}<br />Approval {entry.id}<br />Run {entry.approval.runId}</p></details>;
        if (entry.kind === "receipt") return <details key={key} className={styles.receipt}><summary>{entry.receipt.description || entry.receipt.kind}</summary>
          <p>{entry.occurredAt} · {entry.receipt.kind}</p><p className={styles.code}>Receipt {entry.id}<br />Run {entry.receipt.runId || "Not attached"}</p></details>;
        return <article key={key} className={styles.run}><strong>{entry.run.name}</strong><span>{entry.run.status.replaceAll("_", " ")} · {entry.run.mode === "dry_run" ? "shadow" : "live"}</span>
          <time>{entry.run.finishedAt || entry.run.startedAt}</time><small className={styles.code}>Run {entry.id}</small><button className={styles.link} onClick={() => onOpenRoutine(entry.run.routineId)}>Inspect routine →</button></article>;
      })}</div>
      {!data.nextCursor && <p className={styles.caption}>End of this history view.</p>}
    </>}
  </section>;
}
