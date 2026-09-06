"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ALL_SYSTEMS } from "@/lib/platform/catalog";
import { OPS_STAGES, opsNext, opsStage, opsTime, type OpsClient, type OpsRun, type OpsSnapshot, type OpsSourceBinding } from "@/lib/ops/types";
import styles from "./ops.module.css";
import OpsRunReview from "./OpsRunReview";
import OpsDraftPreview from "./OpsDraftPreview";

const names = new Map(ALL_SYSTEMS.map(r => [r.id, r.name]));
type View = "clients" | "pipeline" | "runs" | `client/${string}` | `run/${string}/${string}`;
const readView = (): View => {
  const hash = window.location.hash.slice(1);
  return hash === "pipeline" || hash === "runs" || /^client\/[0-9a-f-]{36}$/i.test(hash) || /^run\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(hash) ? hash.toLowerCase() as View : "clients";
};

export default function OpsConsole() {
  const [view, setView] = useState<View>("clients");
  const [revision, refresh] = useState(0);
  const [state, setState] = useState<{ key: string; data?: OpsSnapshot; error?: string; code?: number }>({ key: "" });
  const [sourceState, setSourceState] = useState<{ key: string; bindings?: OpsSourceBinding[]; error?: string }>({ key: "" });
  const [sourceRead, setSourceRead] = useState<{ key: string; bindingId: string; data?: { sourceRowCount: number; sourceMaxUpdatedAt: string | null; bridgeFetchedAt: string }; error?: string }>({ key: "", bindingId: "" });
  const [search, setSearch] = useState("");
  const [runStatus, setRunStatus] = useState("all");
  const [runClient, setRunClient] = useState("all");
  const reviewingRun = view.startsWith("run/") ? view.split("/")[2] : null;
  const accountId = view.startsWith("client/") ? view.slice(7) : reviewingRun ? view.split("/")[1] : null;
  const key = `${accountId || "index"}:${revision}`;
  const data = state.key === key ? state.data : undefined;
  const error = state.key === key ? state.error : undefined;
  const loading = !data && !error;
  const sources = accountId && sourceState.key === key ? sourceState.bindings : undefined;
  const sourceError = accountId && sourceState.key === key ? sourceState.error : undefined;
  useEffect(() => {
    const sync = () => { if (window.location.hash !== "#ops-main") setView(readView()); };
    sync(); window.addEventListener("hashchange", sync);
    const visible = () => { if (document.visibilityState === "visible") refresh(r => r + 1); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("hashchange", sync); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let cancelled = false;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    void (async () => {
      try {
        const response = await fetch(`/api/ops${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          const message = response.status === 401 ? "Sign in with your verified operator account." : response.status === 403 ? "This login has no operator read access for this selection. Client ownership alone does not grant it." : "Couldn't read saved records. No empty or healthy state is inferred.";
          if (!cancelled) setState({ key, error: message, code: response.status }); return;
        }
        const snapshot = await response.json() as OpsSnapshot;
        if (!Array.isArray(snapshot.clients) || !Array.isArray(snapshot.runs) || !snapshot.checkedAt || (accountId && snapshot.selected?.accountId !== accountId)) throw new Error("Invalid scope");
        if (!cancelled) setState({ key, data: snapshot });
      } catch { if (!cancelled) setState({ key, error: "Couldn't verify saved records. Refresh to retry; no empty or healthy state is inferred." }); }
      finally { clearTimeout(timeout); }
    })();
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [accountId, key]);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController(); let cancelled = false;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    void (async () => {
      try {
        const response = await fetch(`/api/ops/sources?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          if (!cancelled) setSourceState({ key, error: response.status === 403 ? "This operator cannot read source identities for this client." : "Source identity could not be verified." });
          return;
        }
        const body = await response.json() as { accountId?: unknown; bindings?: unknown };
        if (body.accountId !== accountId || !Array.isArray(body.bindings) || body.bindings.some(row => !row || typeof row !== "object" || (row as { accountId?: unknown }).accountId !== accountId)) throw new Error("Invalid source scope");
        if (!cancelled) setSourceState({ key, bindings: body.bindings as OpsSourceBinding[] });
      } catch { if (!cancelled) setSourceState({ key, error: "Source identity could not be verified." }); }
      finally { clearTimeout(timeout); }
    })();
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [accountId, key]);

  const client = data?.clients.find(c => c.id === accountId);
  const detail = data?.selected;
  const clients = data?.clients.filter(c => `${c.name} ${c.id} ${c.website || ""}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const runRows = (data?.runs ?? []).filter(r => (runStatus === "all" || r.status === runStatus) && (runClient === "all" || r.accountId === runClient));
  const total = (field: "enabledCount" | "pendingDraftCount" | "pendingRunApprovalCount") => data?.clients.reduce((sum, c) => sum + c[field], 0);
  const clientLink = (c: OpsClient) => <a href={`#client/${c.id}`} className={styles.clientLink}>{c.name}<small>{c.id}</small></a>;
  const count = (label: string, value: number | undefined, note?: string) => <div className={styles.stat}><span>{label}</span><strong>{value ?? "—"}</strong>{note && <small>{note}</small>}</div>;
  const runsTable = (rows: OpsRun[]) => rows.length ? <div className={styles.tableWrap}><table><thead><tr><th>Account / routine</th><th>Saved status</th><th>Started</th><th>Finished</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><a href={`#client/${r.accountId}`}>{data?.clients.find(c => c.id === r.accountId)?.name || r.accountId}</a><strong>{names.get(r.routineId) || r.routineId}</strong><small>{r.routineId} · version {r.version}</small><code>{r.id}</code><a href={`#run/${r.accountId}/${r.id}`}>Review output and receipts →</a></td><td>{r.status.replaceAll("_", " ")}<small>{r.mode === "dry_run" ? "shadow / dry run" : r.mode}</small></td><td>{opsTime(r.startedAt)}</td><td>{opsTime(r.finishedAt)}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>No saved runs match this view. No execution is inferred.</p>;
  const title = accountId ? client?.name || "Client detail" : view === "pipeline" ? "Setup pipeline" : view === "runs" ? "Run monitor" : "Clients";
  const verifySource = async (source: OpsSourceBinding) => {
    if (!accountId || !client) return;
    setSourceRead({ key, bindingId: source.id });
    try {
      const response = await fetch("/api/ops/source-read", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ accountId, contextGeneration:client.contextGeneration, bindingId:source.id }) });
      const body = await response.json() as { accountId?: unknown; bindingId?: unknown; sourceRowCount?: unknown; sourceMaxUpdatedAt?: unknown; bridgeFetchedAt?: unknown };
      if (!response.ok || body.accountId !== accountId || body.bindingId !== source.id || !Number.isSafeInteger(body.sourceRowCount) || (body.sourceMaxUpdatedAt !== null && typeof body.sourceMaxUpdatedAt !== "string") || typeof body.bridgeFetchedAt !== "string") throw new Error("Unverified source response");
      setSourceRead({ key, bindingId:source.id, data:{ sourceRowCount:Number(body.sourceRowCount), sourceMaxUpdatedAt:body.sourceMaxUpdatedAt as string | null, bridgeFetchedAt:body.bridgeFetchedAt } });
    } catch { setSourceRead({ key, bindingId:source.id, error:"Fresh stored-data read could not be verified." }); }
  };

  return <div className={styles.root}>
    <a className={styles.skip} href="#ops-main">Skip to content</a>
    <aside className={styles.sidebar} aria-label="Operator navigation">
      <Link href="/" className={styles.brand}>↗ Junction <small>OPS</small></Link>
      <nav>{[["clients", "Clients"], ["pipeline", "Setup pipeline"], ["runs", "Run monitor"]].map(([id, label]) => <a key={id} href={`#${id}`} aria-current={view === id || (id === "clients" && accountId) ? "page" : undefined}>{label}</a>)}</nav>
      <div className={styles.sideFoot}><Link href="/app">My client workspace →</Link><form method="post" action="/auth/signout"><button>Sign out</button></form><p>Operator review and separately authorized draft previews. Publishing, customer messaging and ad changes remain disabled.</p></div>
    </aside>
    <main id="ops-main" tabIndex={-1} className={styles.main}>
      <div className={styles.notice}>Unc records only. Existing agents outside Unc still need independent reconciliation; this view does not call them or certify them live.</div>
      <div className={styles.content}>
        {accountId && <a href="#clients">← All clients</a>}
        <header className={styles.header}><h1>{title}</h1><div><span>{data ? `Checked ${opsTime(data.checkedAt)}` : "Reading saved records"}</span><button onClick={() => refresh(r => r + 1)} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></header>
        {error && <div role="alert" className={styles.error}><p>{error}</p>{state.code === 401 && <Link href="/login?next=%2Fops">Sign in →</Link>}</div>}
        {loading && <div role="status" className={styles.loading}>Loading authorized account records…</div>}
        {!accountId && view === "clients" && <>
          <div className={styles.stats}>{count("Account records", data?.accountCount, "Not a count of live clients")}{count("Login not assigned", data?.clients.filter(c => !c.memberCount).length)}{count("Routines enabled", total("enabledCount"), "Enabled does not mean running")}{count("Needs review", data ? total("pendingDraftCount")! + total("pendingRunApprovalCount")! : undefined)}</div>
          <p className={styles.muted}>Setup stages come from saved evidence, not a manually ticked “live” label. No revenue, MRR or time saved is inferred.</p>
          <label className={styles.search}>Find a client<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, account ID or website" /></label>
          {data && <div className={styles.tableWrap}><table><thead><tr><th>Account</th><th>Setup stage</th><th>Dated reads</th><th>Enabled</th><th>Review queue</th><th>Last run</th></tr></thead><tbody>{clients.map(c => <tr key={c.id}><td>{clientLink(c)}{data.clients.filter(other => other.name === c.name).length > 1 && <span className={styles.warning}>Same display name · distinct account</span>}</td><td><span className={styles.badge}>{opsStage(c)}</span></td><td>{c.datedReadCount} / {c.connectorCount}<small>Not current freshness</small></td><td>{c.enabledCount}</td><td>{c.pendingDraftCount + c.pendingRunApprovalCount}</td><td>{opsTime(c.lastRunAt)}</td></tr>)}</tbody></table>{!clients.length && <p className={styles.empty}>No authorized records match this search.</p>}</div>}
        </>}
        {!accountId && view === "pipeline" && <><p className={styles.muted}>What each account still needs, derived from stored records. These are setup checks, not proof of billing, delivery or customer acceptance.</p>{data && <div className={styles.pipeline}>{OPS_STAGES.map(stage => <section key={stage}><h2>{stage} <small>{data.clients.filter(c => opsStage(c) === stage).length}</small></h2>{data.clients.filter(c => opsStage(c) === stage).map(c => <article className={styles.card} key={c.id}>{clientLink(c)}<p>{opsNext(c)}</p><small>Account created {opsTime(c.createdAt)} · not time in stage</small></article>)}</section>)}</div>}</>}
        {!accountId && view === "runs" && <>
          <p className={styles.muted}>Up to {data?.historyLimit ?? 100} most recent runs across authorized accounts, current context only. No automatic retry: an uncertain result needs reconciliation first.</p>
          <div className={styles.stats}>{count("Runs in window", data?.runs.length)}{count("Failed in window", data?.runs.filter(r => r.status === "failed").length)}{count("Waiting for input", data?.runs.filter(r => r.status === "waiting_input").length)}{count("Waiting for approval", data?.runs.filter(r => r.status === "waiting_approval").length)}</div>
          <div className={styles.filters}><label>Account<select value={runClient} onChange={e => setRunClient(e.target.value)}><option value="all">All authorized accounts</option>{data?.clients.map(c => <option value={c.id} key={c.id}>{c.name} · {c.id.slice(0, 8)}</option>)}</select></label><label>Status<select value={runStatus} onChange={e => setRunStatus(e.target.value)}><option value="all">All statuses</option>{["running", "waiting_input", "waiting_approval", "done", "failed", "skipped"].map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label></div>
          {data && runsTable(runRows)}
          <p className={styles.muted}>Delivery failures, provider costs and stalled-run thresholds are not inferred from run status. Those monitoring views remain to be wired.</p>
        </>}
        {accountId && reviewingRun && data && detail && <OpsRunReview key={`${accountId}:${reviewingRun}:${revision}`} accountId={accountId} runId={reviewingRun} />}
        {accountId && !reviewingRun && data && client && detail && <>
          <OpsDraftPreview key={`${accountId}:${client.contextGeneration}`} accountId={accountId} generation={client.contextGeneration} />
          <p className={styles.code}>{client.id} · generation {client.contextGeneration} · {client.currency}</p>
          <div className={styles.stats}>{count("Login members", client.memberCount)}{count("Verified source identities", sources?.filter(source => source.status === "verified").length, "Not provider access")}{count("Dated connector reads", client.datedReadCount, `of ${client.connectorCount} saved connector rows`)}{count("Routines enabled", client.enabledCount)}</div>
          <section className={styles.card}><h2>Setup checklist</h2><p className={styles.badge}>{opsStage(client)}{client.paused ? " · automation paused" : " · no account pause recorded"}</p><p>{opsNext(client)}</p><ul><li>Saved website: {client.website || "Not recorded"}</li><li>Login membership: {client.memberCount ? `${client.memberCount} saved member(s); role grants are separate from operator access.` : "No assigned login. Reconcile ownership before inviting."}</li><li>Callable registry: {client.registeredWorkflowCount} active row(s). Independent execution verification still required.</li><li>Existing-system mapping: {sources ? sources.some(source => source.status === "verified") ? `${sources.filter(source => source.status === "verified").length} exact source identity binding(s); provider grants and data freshness remain separate.` : "No verified binding. Do not merge or reconnect accounts from display names." : sourceError ? "Could not verify it; no missing or valid mapping is inferred." : "Checking exact identity."}</li><li>Customer acceptance: not inferred from these records.</li></ul></section>
          <section><h2>Existing system identity</h2><p className={styles.muted}>Exact source bindings only. These do not contain credentials or establish a fresh provider read, login access or routine readiness.</p>{sourceError ? <div role="alert" className={styles.error}>{sourceError}</div> : sources ? sources.length ? sources.map(source => { const read=sourceRead.key===key&&sourceRead.bindingId===source.id?sourceRead:null; return <article className={styles.card} key={source.id}><h3>{source.displayName}</h3><span className={styles.badge}>{source.status}</span><p className={styles.code}>{source.sourceSystem} · {source.sourceProject}<br />{source.sourceKind} · {source.sourceKey}</p><small>Verified {opsTime(source.verifiedAt)} · revision {source.revision}</small>{source.sourceReadAuthorized ? <p><button onClick={() => void verifySource(source)} disabled={!!read&&!read.data&&!read.error}>{read&&!read.data&&!read.error?"Verifying stored data…":"Verify stored campaign data"}</button></p> : <p className={styles.muted}>No fresh source-read authority for this operator/client.</p>}{read?.data && <p><strong>{read.data.sourceRowCount} sent campaign rows</strong><br />Source updated {opsTime(read.data.sourceMaxUpdatedAt)} · bridge checked {opsTime(read.data.bridgeFetchedAt)}<br /><small>This is stored source evidence, not a new Klaviyo API call or routine result.</small></p>}{read?.error && <p role="alert" className={styles.error}>{read.error}</p>}</article>; }) : <p className={styles.empty}>No verified existing-system source identity. Do not join by display name.</p> : <div role="status" className={styles.loading}>Checking exact source identity…</div>}</section>
          <section><h2>Connections and read freshness</h2>{detail.connectors.length ? <div className={styles.connectionGrid}>{detail.connectors.map(c => <article className={styles.card} key={c.id}><h3>{c.platform}</h3><span className={styles.badge}>{c.status.replaceAll("_", " ")}</span><p className={styles.code}>{c.externalRef || "Business asset not selected"}</p><p>Last read: {opsTime(c.lastReadAt)}<br />Result: {c.lastReadResult || "Not recorded"}<br />Metrics: {c.lastReadMetrics ?? "Unknown"}</p><small>Saved read evidence, not a fresh provider check.</small></article>)}</div> : <p className={styles.empty}>No connector records for this account.</p>}</section>
          <section><h2>Routine switches</h2><p className={styles.muted}>Saved switches only. No operator-side activation or change of customer permissions.</p><div className={styles.routines}>{ALL_SYSTEMS.map(r => <div key={r.id}><span>{r.name}<small>{r.id}</small></span><strong>{detail.routines.find(s => s.id === r.id)?.enabled ? "Enabled" : "Off"}</strong></div>)}</div></section>
          <section><h2>Saved review queue</h2><p className={styles.muted}>{client.pendingDraftCount} pending draft(s) · {client.pendingRunApprovalCount} unexpired run approval(s). Opening work requires a separate read grant and never gives approval or execution authority.</p>{detail.drafts.length ? detail.drafts.map(d => <article className={styles.card} key={d.id}><h3>{d.title}</h3><p>{d.status} · revision {d.revision} · {opsTime(d.createdAt)}</p><code>Artifact {d.id}<br />Run {d.runId}</code><p><a href={`#run/${accountId}/${d.runId}`}>Review output and receipts →</a></p></article>) : <p className={styles.empty}>No saved draft headers in this context.</p>}</section>
          <section><h2>Recent runs</h2>{runsTable(detail.runs)}</section>
          <section><h2>Execution receipts</h2>{detail.receipts.length ? detail.receipts.map(r => <details className={styles.card} key={r.id}><summary>{r.description}</summary><p>{r.kind} · {r.platform || "No platform recorded"} · {opsTime(r.createdAt)}</p><code>Receipt {r.id}<br />Run {r.runId}</code></details>) : <p className={styles.empty}>No run-linked receipts in this context.</p>}</section>
          <section><h2>Verified channel bindings</h2>{detail.channels.length ? detail.channels.map((c, i) => <p key={`${c.channel}:${i}`}>{c.channel} · verified {opsTime(c.verifiedAt)} · last inbound {opsTime(c.lastInboundAt)}</p>) : <p className={styles.empty}>No currently member-bound verified channel links.</p>}<p className={styles.muted}>A verified binding does not establish a successful reply or authorized customer messaging.</p></section>
        </>}
        {data && <footer className={styles.footer}>Checked {opsTime(data.checkedAt)} · {data.clients.length} of {data.accountCount} authorized account records. {data.accountCount > data.accountLimit && "Account window reached; additional account navigation remains unavailable."} Each history list is capped at {data.historyLimit}. {(data.runs.length >= data.historyLimit || (detail && [detail.runs, detail.drafts, detail.receipts].some(a => a.length >= data.historyLimit))) && "History window reached; older records are not included."} No customer chat, credential values or raw run payloads are exposed here.</footer>}
      </div>
    </main>
  </div>;
}
