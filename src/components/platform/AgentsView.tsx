"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_AREAS, AGENT_JOBS } from "@/lib/agents/catalog";
import type { AgentsSnapshot, AgentRoutine } from "@/lib/agents/types";
import { artifactHeaders } from "@/lib/artifacts/client";
import styles from "./agents.module.css";

export default function AgentsView({accountId,contextGeneration,onInspect,onSaved}:{accountId:string;contextGeneration:number;onInspect:(id:string)=>void;onSaved?:(id:string,enabled:boolean)=>void}) {
  const [data,setData]=useState<AgentsSnapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [tick,setTick]=useState(0);
  const [area,setArea]=useState("All");
  const [search,setSearch]=useState("");
  const saving=useRef(false);
  const mounted=useRef(true);
  const refresh=useCallback(()=>{setLoading(true);setTick(n=>n+1);},[]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const c=new AbortController(); let cancelled=false; const timer=setTimeout(()=>c.abort(),20_000);
    void (async()=>{
      try {
        const res=await fetch("/api/agents",{cache:"no-store",headers:artifactHeaders(accountId,contextGeneration),signal:c.signal});
        const b=await res.json() as AgentsSnapshot;
        if(cancelled) return;
        if(!res.ok || b.accountId!==accountId || b.contextGeneration!==contextGeneration || !Array.isArray(b.routines) ||
          !["owner","member"].includes(b.role) || typeof b.paused!=="boolean") throw new Error("Unverified state");
        setData(b);setError(null);
      } catch {if(!cancelled){setData(null);setError("Couldn’t verify this account’s agent settings. Refresh to try again; no switch state has been assumed.");}}
      finally {clearTimeout(timer);if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;clearTimeout(timer);c.abort();};
  },[accountId,contextGeneration,tick]);
  useEffect(()=>{const visible=()=>{if(document.visibilityState==="visible"&&!saving.current)refresh();};document.addEventListener("visibilitychange",visible);return()=>document.removeEventListener("visibilitychange",visible);},[refresh]);
  async function change(r:AgentRoutine) {
    if(saving.current || loading || !data || data.role!=="owner" || !r.enabled && (data.paused||r.selectionBlock))return;
    saving.current=true;setBusy(r.routineId);setNotice(null);
    const c=new AbortController();const timer=setTimeout(()=>c.abort(),20_000);
    try {
      const res=await fetch("/api/agents",{method:"POST",headers:{"content-type":"application/json",...artifactHeaders(accountId,contextGeneration)},
        body:JSON.stringify({routineId:r.routineId,enabled:!r.enabled,stateUpdatedAt:r.stateUpdatedAt,version:r.version}),signal:c.signal});
      const b=await res.json(); if(!mounted.current)return;
      const saved=b.saved;
      if(!res.ok || !saved || saved.accountId!==accountId || saved.contextGeneration!==contextGeneration || saved.routineId!==r.routineId || saved.enabled!==!r.enabled || !Number.isSafeInteger(saved.version) || typeof saved.stateUpdatedAt!=="string") {
        setNotice("Save not confirmed. Checking the stored switch before another change.");
      } else {
        setData(d=>d?{...d,routines:d.routines.map(x=>x.routineId===r.routineId?{...x,...saved}:x)}:null);
        onSaved?.(r.routineId,saved.enabled);
        setNotice(saved.enabled?"Routine selected. No run was started; inspect it to request a shadow run.":"Routine switched off. Work already in flight still needs its own execution check.");
      }
    } catch {if(mounted.current)setNotice("Save outcome is uncertain. Checking the stored switch; this request will not be retried automatically.");}
    finally {clearTimeout(timer);saving.current=false;if(mounted.current){setBusy(null);refresh();}}
  }
  const byId=new Map(data?.routines.map(r=>[r.routineId,r])??[]);
  const visible=AGENT_JOBS.filter(j=>(area==="All"||j.area===area)&&`${j.label} ${j.routineId??""} ${j.designLabels.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  return <div className={styles.content}>
    <header className={styles.heading}><h1>Agents</h1><button onClick={refresh} disabled={loading||!!busy}>{loading?"Refreshing…":"Refresh"}</button></header>
    <p>Choose the work you want help with. Each switch saves one routine; it does not start a run, create a schedule or authorize publishing.</p>
    {error&&<p role="alert" className={styles.notice}>{error}</p>}
    {!data&&loading&&<p role="status">Reading this account’s saved routines…</p>}
    {data?.paused&&<p className={styles.notice}>Automation is paused for setup verification. New selections are disabled; existing selections can still be switched off.</p>}
    {data?.role==="member"&&<p className={styles.notice}>Read-only member. Only the account owner can change selections.</p>}
    {notice&&<p role="status" className={styles.notice}>{notice}</p>}
    <div className={styles.summary}>{data?`${data.routines.filter(r=>r.enabled).length} of ${data.routines.length} catalog routines selected` : "Selection counts unverified"}<span>Selected does not mean running</span></div>
    <div className={styles.filters} role="group" aria-label="Filter agents">{["All",...AGENT_AREAS].map(a=><button key={a} aria-pressed={area===a} onClick={()=>setArea(a)}>{a}</button>)}</div>
    <label className={styles.search}>Find a routine<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Work, original design label or routine ID" /></label>
    {AGENT_AREAS.filter(a=>visible.some(j=>j.area===a)).map(a=>{
      const jobs=visible.filter(j=>j.area===a);const ids=AGENT_JOBS.filter(j=>j.area===a&&j.routineId).map(j=>j.routineId!);
      return <section key={a} className={styles.area}><div className={styles.areaHeading}><h2>{a}</h2><span>{data?`${ids.filter(id=>byId.get(id)?.enabled).length} of ${ids.length} selected`:"Not verified"}</span></div>
        {jobs.map(j=>{const r=j.routineId?byId.get(j.routineId):undefined;const blocked=!r||!r.enabled&&(!!data?.paused||!!r.selectionBlock);return <article key={j.key} className={styles.job} data-testid={`agent-${j.key}`}>
          <button className={styles.toggle} role="switch" aria-label={j.label} aria-checked={!!r?.enabled} disabled={!data||loading||!!busy||data.role!=="owner"||blocked} onClick={()=>r&&void change(r)}><span/></button>
          <div className={styles.description}><h3>{j.label}</h3>{j.note&&<p>{j.note}</p>}{r?<><small>{r.routineId} · v{r.version} · {r.availabilityCopy}</small>{r.selectionBlock&&<p>{r.selectionBlock}</p>}{r.betterWithCopy&&<p>{r.betterWithCopy}</p>}<p>{r.lastRun?`Last saved run: ${r.lastRun.status.replaceAll("_"," ")} · ${new Date(r.lastRun.at).toISOString().slice(0,16).replace("T"," ")} UTC` : "No saved run in this business context."}</p></>:<small>{j.routineId?"Runtime listing unavailable":"Not available — no executable routine mapping"}</small>}</div>
          <div className={styles.actions}><span>{busy&&busy===j.routineId?"Saving…":r?(r.enabled?"Selected":"Off"):"Unavailable"}</span>{r&&<button onClick={()=>onInspect(r.routineId)}>Inspect →</button>}</div>
        </article>;})}
      </section>;
    })}
    {!visible.length&&<p>No matching routine.</p>}
    <p className={styles.foot}>Availability is a requirements check, not a successful execution receipt. Schedules and actual provider outputs are verified separately. Google Ads planning and backlink gap remain distinct from the existing Meta and competitor-page routines.</p>
  </div>;
}
