"use client";
import { useEffect, useState } from "react";
import { parseOpsRunWork, type OpsRunWork } from "@/lib/ops/runWork";
import { opsTime } from "@/lib/ops/types";
import styles from "./ops.module.css";

type Cursor = { artifactAfter?: string; receiptAfter?: string; generation?: number };
function Execution({ value }: { value: OpsRunWork["receipts"][number]["execution"] }) {
  if (!value) return <p className={styles.muted}>No correlated external execution evidence recorded.</p>;
  return <dl className={styles.execution}>
    <dt>Workflow</dt><dd>{value.workflowId || "Not recorded"}</dd>
    <dt>Revision</dt><dd>{value.workflowVersion || "Not recorded"}</dd>
    <dt>Execution</dt><dd>{value.executionId || "Not recorded"}</dd>
    <dt>Stored revision evidence</dt><dd>{value.revisionEvidence || "Not recorded"} · {opsTime(value.verifiedAt)}</dd>
    <dt>Reported outcome / action</dt><dd>{value.status || "Unknown"} / {value.executedAction || "Unknown"}</dd>
  </dl>;
}
export function OpsRunWorkContent({ data }: { data: OpsRunWork }) {
  return <>
    <p className={styles.code}>Account {data.accountId} · generation {data.contextGeneration}<br />Run {data.run.id}</p>
    <p>{data.run.routineId} · version {data.run.version} · {data.run.mode} · saved status: {data.run.status}<br />Started {opsTime(data.run.startedAt)} · finished {opsTime(data.run.finishedAt)}</p>
    <p className={styles.muted}>Saved work and stored verification only—not a fresh provider check. Reviewing here does not approve or execute anything. Output is shown as plain text; evidence references are not opened automatically.</p>
    <section><h2>Produced work</h2>{data.artifacts.length ? data.artifacts.map(f => <article className={styles.card} key={f.id}>
      <h3>{f.title}</h3><p>{f.kind} · {f.status} · revision {f.revision} · {opsTime(f.createdAt)}</p>
      <code>Artifact {f.id}</code>
      {f.editedBody !== null ? <><h4>Saved edited version</h4><div className={styles.workText}>{f.editedBody || "(Empty saved edit)"}</div><details><summary>Original output</summary><div className={styles.workText}>{f.body}</div></details></> : <div className={styles.workText}>{f.body}</div>}
      {f.items.map((item, i) => <section className={styles.workItem} key={i}>{item.title && <h4>{item.title}</h4>}{item.body && <div className={styles.workText}>{item.body}</div>}</section>)}
      <details><summary>Sources and execution evidence</summary>{f.evidence.length ? <ul>{f.evidence.map((e, i) => <li key={i}>{e.source || "Unnamed source"}<div className={styles.workText}>{e.ref || "No reference recorded"}</div></li>)}</ul> : <p>No source references recorded.</p>}<Execution value={f.execution} /></details>
    </article>) : <p className={styles.empty}>No artifacts on this page. A saved run status alone does not prove useful output.</p>}</section>
    <section><h2>Linked receipts</h2>{data.receipts.length ? data.receipts.map(r => <details className={styles.card} key={r.id}>
      <summary>{r.description}</summary><p>{r.kind} · {r.platform || "No platform"} · {opsTime(r.createdAt)}</p><code>Receipt {r.id}<br />Run {r.runId}</code><Execution value={r.execution} />
    </details>) : <p className={styles.empty}>No linked receipts on this page.</p>}</section>
    <p className={styles.muted}>Read {opsTime(data.checkedAt)} · audit {data.auditId}. Raw metadata, snapshots, credentials and customer chat are excluded.</p>
  </>;
}
export default function OpsRunReview({ accountId, runId }: { accountId: string; runId: string }) {
  const [pages, setPages] = useState<Cursor[]>([{}]);
  const [revision, refresh] = useState(0);
  const cursor = pages.at(-1)!;
  const key = `${accountId}:${runId}:${revision}:${JSON.stringify(cursor)}`;
  const [state, setState] = useState<{ key: string; data?: OpsRunWork; error?: string }>({ key: "" });
  const data = state.key === key ? state.data : undefined;
  const error = state.key === key ? state.error : undefined;
  useEffect(() => {
    const controller = new AbortController(); let cancelled = false;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const params = new URLSearchParams({ accountId, runId });
    if (cursor.artifactAfter) params.set("artifactAfter", cursor.artifactAfter);
    if (cursor.receiptAfter) params.set("receiptAfter", cursor.receiptAfter);
    if (cursor.generation !== undefined) params.set("generation", String(cursor.generation));
    void (async () => {
      try {
        const response = await fetch(`/api/ops/run?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          const message = response.status === 403 ? "This account needs a separate operator work-read grant. Metadata access alone does not allow opening outputs."
            : response.status === 401 ? "Sign in with your verified operator account."
            : response.status === 404 ? "This run is not available in the selected account's current context."
            : response.status === 409 ? "Context or page changed. Refresh from the first page."
            : "Couldn't read saved work. No successful or empty result is inferred.";
          if (!cancelled) setState({ key, error: message }); return;
        }
        const work = parseOpsRunWork(await response.json(), accountId, runId, cursor.generation);
        if (!work) throw new Error("Invalid run scope");
        if (!cancelled) setState({ key, data: work });
      } catch { if (!cancelled) setState({ key, error: "Couldn't verify saved work. Refresh to retry." }); }
      finally { clearTimeout(timeout); }
    })();
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [accountId, runId, cursor, key]);
  return <section aria-label="Run output review">
    <a href={`#client/${accountId}`}>← Back to client</a>
    <header className={styles.header}><h2>Run output review</h2><button onClick={() => { setPages([{}]); refresh(n => n + 1); }}>Refresh work</button></header>
    {error ? <p role="alert" className={styles.error}>{error}</p> : !data ? <p role="status">Reading authorized run output…</p> : <OpsRunWorkContent data={data} />}
    <div className={styles.filters}><button disabled={pages.length < 2} onClick={() => setPages(p => p.slice(0, -1))}>Previous work page</button><span>Page {pages.length} · up to 20 artifacts / 50 receipts per page</span><button disabled={!data?.hasMore} onClick={() => data && setPages(p => [...p, { artifactAfter: data.artifactAfter ?? undefined, receiptAfter: data.receiptAfter ?? undefined, generation: data.contextGeneration }])}>Next work page</button></div>
    {data && !data.hasMore && <p className={styles.muted}>End of saved work at this read. Refresh to check for later changes.</p>}
  </section>;
}
