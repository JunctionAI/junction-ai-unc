"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { PlatformState } from "@/lib/platform/state";
import type { PlatformVals, UncSend } from "@/lib/platform/derive";
import type { Persistence } from "@/lib/db/useAccountPersistence";
import { publishPersistence } from "@/lib/unc/accountFacts";
import { openPortal } from "@/lib/billing/clientActions";
import type { WorkspaceSnapshot } from "@/lib/workspace/read";
import DraftCard from "./DraftCard";
import WorkspaceHistory from "./WorkspaceHistory";
import { useWorkspace } from "./useWorkspace";
import styles from "./client-workspace.module.css";

type Tab = "today" | "inbox" | "agents" | "ask" | "connections" | "strategy" | "channels";
export function workspaceTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
const titles: Record<Tab, string> = { today: "Today", inbox: "Work inbox", agents: "Agents", ask: "Ask", connections: "Connections", strategy: "Business plan", channels: "Messaging channels" };

export interface ClientWorkspaceProps {
  S: PlatformState; V: PlatformVals; account: Persistence; send: UncSend;
  legacy: ReactNode; onModels: () => void; onSkills: () => void; onContext: () => void;
  initial?: WorkspaceSnapshot;
  billingEnabled?: boolean;
}

export default function ClientWorkspace(props: ClientWorkspaceProps) {
  return <BoundWorkspace key={`${props.account.accountId}:${props.S.contextGeneration}`} {...props} />;
}

function BoundWorkspace({ S, V, account, send, legacy, onModels, onSkills, onContext, initial, billingEnabled = false }: ClientWorkspaceProps) {
  const work = useWorkspace(account.accountId!, S.contextGeneration ?? 0, initial);
  const data = work.data;
  const [localTab, setLocalTab] = useState<"today" | "inbox" | "ask">("today");
  const [filter, setFilter] = useState("All");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [text, setText] = useState("");
  const [billingError, setBillingError] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  // These derive navigation callbacks capture only the stable platform setter.
  const navigation = useRef({ today: V.goToday, agents: V.goSystems, connections: V.goConnectors, channels: V.goChannels, strategy: V.goStrategy });
  const tab: Tab = S.view === "systems" ? "agents" : S.view === "connectors" ? "connections" : S.view === "channels" ? "channels" : S.view === "strategy" ? "strategy" : localTab;
  useEffect(() => { publishPersistence({ mode: "account", accountId: account.accountId }); }, [account.accountId]);
  useEffect(() => {
    const sync = () => {
      const value = window.location.hash.slice(1);
      if (value === "today" || value === "inbox" || value === "ask") { setLocalTab(value); navigation.current.today(); }
      else if (value === "agents" || value === "connections" || value === "channels" || value === "strategy") navigation.current[value]();
    };
    sync(); window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => { if (tab === "ask") chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [S.messages.length, tab]);
  const navigate = (next: Tab) => {
    if (next === "today" || next === "inbox") work.refresh();
    window.location.assign(`#${next}`);
    if (next === "agents") V.goSystems();
    else if (next === "connections") V.goConnectors();
    else if (next === "channels") V.goChannels();
    else if (next === "strategy") V.goStrategy();
    else { setLocalTab(next); V.goToday(); }
  };
  const openRoutine = (id: string) => { window.location.assign("#agents"); V.openRoutineById(id); };
  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || S.messages.some(m => m.typing)) return;
    const message = text.trim(); setText(""); navigate("ask");
    send({ surface: "corner", text: message, canned: "" });
  };
  const categories = [...new Set(data?.routines.map(r => r.category) ?? [])];
  const truncated = data && Object.values(data.truncated).some(Boolean);
  const pendingArtifacts = data?.artifacts.filter(a => a.status === "draft" || a.status === "edited") ?? [];
  const pendingApprovals = data?.approvals.filter(a => a.status === "pending" && a.expiresAt > data.fetchedAt) ?? [];
  const draftCard = (a: WorkspaceSnapshot["artifacts"][number]) => <DraftCard key={a.id} artifact={a} channels={[]} readOnly={!data?.canReview || work.loading} onOpenRoutine={openRoutine} onChange={changed => {
    work.setData(current => current && changed.accountId === current.accountId && changed.contextGeneration === current.contextGeneration ? { ...current, artifacts: current.artifacts.map(row => row.id === changed.id ? changed : row) } : current);
    work.refresh();
  }} />;
  const approvalCard = (a: WorkspaceSnapshot["approvals"][number]) => <article className={styles.card} key={a.id}>
    <div className={styles.row}><span className={styles.tag}>{a.category || a.routineId}</span><h3>{a.title}</h3><span className={styles.muted}>{a.status}</span></div>
    <p>{a.detail}</p><p>{a.before && <>Before: {a.before}<br /></>}{a.after && <>Proposed: {a.after}</>}</p>
    <details><summary>Why and execution receipt</summary><p>{a.reasoning || "No reasoning was recorded."}</p><p className={styles.code}>Run {a.runId}<br />Approval {a.id}<br />Expires {workspaceTime(a.expiresAt)}</p></details>
    <p className={styles.notice}>This is a run approval, not a draft review. Resuming action-bearing runs is unavailable in this shadow release.</p>
    <button onClick={() => openRoutine(a.routineId)} className={styles.link}>Inspect routine →</button>
  </article>;
  const composer = <form className={styles.composer} onSubmit={ask}><input aria-label="Ask your agents" placeholder="Ask about your business or request a piece of work…" value={text} onChange={e => setText(e.target.value)} maxLength={4000} /><button disabled={!text.trim() || S.messages.some(m => m.typing)}>Ask</button></form>;

  return <div className={`${styles.workspace} unc-platform`}>
    <aside className={styles.sidebar} aria-label="Client navigation">
      <Link className={styles.brand} href="/">↗ <span>Junction</span><small>PRIVATE BETA</small></Link>
      <div className={styles.accountName}>{account.accountName || "Your workspace"}</div>
      <nav>{(["today", "inbox", "agents", "ask", "connections"] as Tab[]).map(id => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => navigate(id)}><span className={styles.dot} />{titles[id]}{id === "inbox" && data && data.counts.needsReview > 0 && <small>{data.counts.needsReview}{truncated ? "+" : ""}</small>}</button>)}</nav>
      <div className={styles.secondary}><button onClick={() => navigate("strategy")}>Business plan</button><button onClick={() => navigate("channels")}>Messaging channels</button><button onClick={onContext}>Business context</button><button onClick={onModels}>Models</button><button onClick={onSkills}>Skills</button></div>
      <div className={styles.identity}><span>{account.userEmail}</span><span>{account.role === "member" ? "Read-only member" : account.autosave === "pending" || account.autosave === "saving" ? "Saving…" : "Saved"}</span>{billingEnabled && <button onClick={() => { void openPortal().then(setBillingError); }}>Manage billing</button>}{billingError && <p role="alert">{billingError}</p>}<form action="/auth/signout" method="post"><button>Sign out</button></form><p>Publishing, customer messaging and ad changes are disabled.</p></div>
    </aside>
    <main className={styles.main}>
      {(S.automationPaused || data?.paused) && <aside className={styles.pause} role="status">Automation paused for setup verification. Connections and saved work are preserved; account chat is available.</aside>}
      {tab === "today" || tab === "inbox" || tab === "ask" ? <div className={styles.content}>
        <header className={styles.heading}><h1>{titles[tab]}</h1><div><span>{data ? `Checked ${workspaceTime(data.fetchedAt)}` : "Reading saved work"}</span><button onClick={work.refresh} disabled={work.loading}>{work.loading ? "Refreshing…" : "Refresh"}</button></div></header>
        {work.error && <div className={styles.error} role="alert">{work.error}</div>}
        {!data && work.loading && <div className={styles.skeleton} role="status">Loading this account’s saved work…</div>}
        {tab === "today" && <>
          <section className={styles.stats} aria-label="Recorded work summary">{[
            ["Needs review", data?.counts.needsReview], ["Completed · last 24h", data?.counts.completed24h], ["Routines enabled", data?.counts.routinesOn], ["Runs needing attention", data?.counts.needsAttention],
          ].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value ?? "—"}</strong></div>)}</section>
          <p className={styles.caption}>Counts describe the saved records in this view. Enabled does not mean running. No hours saved or business results are inferred.</p>
          {composer}
          <section><div className={styles.sectionHeading}><h2>Needs you</h2><button onClick={() => navigate("inbox")} className={styles.link}>Open inbox →</button></div>
            <div className={styles.workList}>{pendingArtifacts.slice(0, 3).map(draftCard)}{pendingApprovals.slice(0, 2).map(approvalCard)}</div>
            {data && !pendingArtifacts.length && !pendingApprovals.length && <div className={styles.empty}>No draft or run approval is waiting in the current view. Results will appear here after a verified run.</div>}
          </section>
          <section><div className={styles.sectionHeading}><h2>Your routines</h2><button className={styles.link} onClick={() => navigate("agents")}>Manage agents →</button></div><div className={styles.areas}>{categories.map(category => {
            const rows = data!.routines.filter(r => r.category === category); const on = rows.filter(r => r.enabled).length;
            return <button key={category} onClick={() => navigate("agents")}><h3>{category}</h3><div className={styles.pips}>{rows.map(r => <span key={r.id} data-on={r.enabled} />)}</div><small>{on} of {rows.length} enabled</small></button>;
          })}</div><p className={styles.caption}>Current executable catalog only. Additional jobs in the design still need their contracts and readiness checks.</p></section>
          <div className={styles.columns}><section><h2>Recent runs</h2>{data && !data.runs.length && <p className={styles.muted}>No saved runs for this business context yet.</p>}{data?.runs.slice(0, 6).map(r => <div className={styles.run} key={r.id}><strong>{r.name}</strong><span>{r.status.replaceAll("_", " ")} · {r.mode === "dry_run" ? "shadow" : "live"}</span><time>{workspaceTime(r.finishedAt || r.startedAt)}</time><small className={styles.code}>{r.id}</small></div>)}</section><section><h2>What’s next</h2><p>{S.automationPaused ? "Finish setup verification before enabling runs." : "Review saved work and choose which ready routines to enable."}</p><button className={styles.link} onClick={() => navigate("connections")}>Check connections →</button><p className={styles.caption}>No next-run time is claimed without a confirmed schedule.</p></section></div>
        </>}
        {tab === "inbox" && <>
          <button className={styles.link} onClick={() => setHistoryOpen(open => !open)}>{historyOpen ? "Back to recent work" : "Browse full saved history →"}</button>
          {historyOpen ? <WorkspaceHistory key={`${account.accountId}:${S.contextGeneration}:${data?.fetchedAt}`} accountId={account.accountId!} generation={S.contextGeneration ?? 0} onOpenRoutine={openRoutine} /> : <>
          <p className={styles.muted}>Research, recommendations and drafts. Approving a draft records your review; it does not publish, send or resume a run.</p>
          {data && !data.canReview && <p className={styles.notice}>Review changes are unavailable while paused or without owner access. You can still read, inspect evidence and copy the work.</p>}
          <div className={styles.filters} role="group" aria-label="Filter work by specialty">{["All", ...categories].map(category => <button key={category} aria-pressed={filter === category} onClick={() => setFilter(category)}>{category}</button>)}</div>
          <div className={styles.workList}>{data?.artifacts.filter(a => filter === "All" || a.category === filter).map(draftCard)}{data?.approvals.filter(a => filter === "All" || a.category === filter).map(approvalCard)}</div>
          {data && !data.artifacts.some(a => filter === "All" || a.category === filter) && !data.approvals.some(a => filter === "All" || a.category === filter) && <div className={styles.empty}>No saved work matches this filter.</div>}
          <section><h2>Execution receipts</h2>{data && !data.receipts.length && <p className={styles.muted}>No receipts recorded for this business context.</p>}{data?.receipts.map(r => <details key={r.id} className={styles.receipt}><summary>{r.description || r.kind}</summary><p>{workspaceTime(r.createdAt)} · {r.kind}</p><p className={styles.code}>Receipt {r.id}<br />Run {r.runId || "Not attached"}</p></details>)}</section>
          </>}
        </>}
        {tab === "ask" && <><p className={styles.muted}>Your saved account conversation. A queued request is not a completed run; missing access and paused routines remain explicit.</p><div className={styles.chat} role="log" aria-label="Account conversation">{!S.messages.length && <p>What would you like help with?</p>}{S.messages.map((m, i) => <div key={i} data-from={m.from} className={styles.message}><small>{m.from === "u" ? "You" : "Junction"}</small><p>{m.typing ? "Working on your request…" : m.text}</p>{m.link && <button className={styles.link} onClick={() => V.openRoutineById(m.link!)}>{m.linkLabel || "Open routine"}</button>}</div>)}<div ref={chatEnd} /></div>{composer}</>}
        {data && <p className={styles.caption}>Current business context · generation {data.contextGeneration}. Up to {data.window} recent records per list.{truncated ? " A list reached its limit; these counts are not lifetime totals. Browse full saved history in Work inbox for older records." : ""}</p>}
      </div> : <div className={styles.legacy}>{legacy}</div>}
    </main>
  </div>;
}
