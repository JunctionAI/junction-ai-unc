"use client";
import { useCallback, useEffect, useState } from "react";
import { artifactHeaders } from "@/lib/artifacts/client";
import type { ArtifactDraft, ProduceNeed } from "@/lib/runtime/types";
type View={accountId:string;contextGeneration:number;released:boolean;settings:{enabled:boolean;prepare_articles:boolean;prepare_page_edits:boolean}|null;keyword:{id:string;title:string}|null;packages:{id:string;market:string;status:string;attempt:number;result:{artifact?:ArtifactDraft;needs?:ProduceNeed[]}|null}[]};
export default function SeoPackagePanel({accountId,contextGeneration}:{accountId:string;contextGeneration:number}){
  const [view,setView]=useState<View|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const load=useCallback(async(body?:unknown,signal?:AbortSignal)=>{
    const response=await fetch("/api/seo/packages",{method:body?"POST":"GET",cache:"no-store",signal,
      headers:{...artifactHeaders(accountId,contextGeneration),"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    if(!response.ok||data.accountId!==accountId||data.contextGeneration!==contextGeneration||!Array.isArray(data.packages))throw Error(data.error??"Could not verify this SEO workspace");
    return data as View;
  },[accountId,contextGeneration]);
  useEffect(()=>{const c=new AbortController();void load(undefined,c.signal).then(data=>{if(!c.signal.aborted){setView(data);setError("");}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[load]);
  const change=async(body:unknown)=>{setBusy(true);try{setView(await load(body));setError("");}catch{setError("Could not confirm the change. Refresh its saved status before trying again.");}finally{setBusy(false);}};
  return <section style={{background:"white",border:"1px solid var(--card-border)",borderRadius:13,padding:20,marginTop:16}} aria-label="SEO work packages">
    <h3>Turn research into website drafts</h3>
    <p>After your keyword routine runs, I can read your website and prepare guide revisions, page titles, descriptions and internal links together. Nothing is published.</p>
    {error&&<p role="alert">{error}</p>}
    {view&&<>
      <p>{view.settings?.enabled?"draft preparation is on. new keyword results will feed the same work package flow.":"draft preparation is off."}</p>
      <button disabled={busy||!view.released} onClick={()=>void change({operation:"settings",enabled:!view.settings?.enabled,prepareArticles:true,preparePageEdits:true})}>{view.settings?.enabled?"Stop automatic draft preparation":"Enable guide and page drafts"}</button>{" "}
      <button disabled={busy||!view.released||!view.settings?.enabled||!view.keyword} onClick={()=>void change({operation:"run",keywordArtifactId:view.keyword!.id})}>Prepare from latest research</button>{" "}
      <button disabled={busy} onClick={()=>void load().then(data=>{setView(data);setError("");}).catch(e=>setError(e.message))}>Refresh saved status</button>
      {!view.released&&<p>This package flow has not been released yet.</p>}
      {view.packages.map(p=><article key={p.id} style={{borderTop:"1px solid #ddd",marginTop:18,paddingTop:16}}>
        <h4>{p.market} SEO work</h4>
        <p>{p.status==="ready"?"i've prepared your drafts for review 🔎 nothing has been published.":p.status==="queued"?"your research is queued for draft preparation.":p.status==="running"?"this package was claimed for preparation. if it stays here, Junction needs to reconcile it; it won't be retried automatically.":p.status==="needs"?"i need to resolve the issue below before these drafts are ready.":"this package was cancelled."}</p>
        {p.result?.needs?.map((n,i)=><p key={i}>{n.why}</p>)}
        {p.status==="needs"&&p.attempt===1&&<button disabled={busy||!view.released} onClick={()=>void change({operation:"retry",packageId:p.id})}>Retry once after resolving the issue</button>}
        {p.result?.artifact&&<><p>{p.result.artifact.body}</p>{p.result.artifact.items?.map((item,i)=><details key={i} style={{marginBottom:12}}><summary>{item.title}</summary><div style={{whiteSpace:"pre-wrap",padding:12}}>{item.body}</div><pre style={{whiteSpace:"pre-wrap",fontSize:12}}>{JSON.stringify(item.meta,null,2)}</pre></details>)}</>}
        <small>Package {p.id}. Review only; CMS publishing is not enabled.</small>
      </article>)}
    </>}
  </section>;
}
