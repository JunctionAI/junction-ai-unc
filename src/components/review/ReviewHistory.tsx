"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import Image from "next/image";
import {createAccountFetch} from "@/lib/db/accountRequest";
import {artifactHeaders} from "@/lib/artifacts/client";
import {parseReviewHistory,reviewMediaUrl,type ReviewPresentation} from "@/lib/artifacts/reviewPresentation";
import styles from "./review.module.css";

type Version=ReviewPresentation["version"];
function Preview({version,current,label}:{version:Version;current:ReviewPresentation;label:string}){
 const view={...current,output:{...current.output,revision:version.revision},version};
 return <article className={styles.historyPreview} aria-label={label}><h3>{label}</h3>
  <h4>{version.content.title}</h4>
  {version.content.imagePath&&<Image src={reviewMediaUrl(version.content.imagePath,view)} alt={`${label} creative`} width={1200} height={1600} unoptimized style={{width:"100%",height:"auto"}}/>}
  {version.content.videoPath&&<video src={reviewMediaUrl(version.content.videoPath,view)} controls preload="metadata"/>}
  {version.content.body&&<div className={styles.body}>{version.content.body}</div>}
 </article>;
}
/** Read-only comparison: no comment, approve, restore or execution control here. */
export default function ReviewHistory({current}:{current:ReviewPresentation}){
 const {account_id:accountId,context_generation:generation,id:outputId}=current.output;
 const request=useMemo(()=>createAccountFetch(accountId),[accountId]);
 const [versions,setVersions]=useState<Version[]>([]),[next,setNext]=useState<number|null>(null);
 const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [selected,setSelected]=useState<number|null>(null);
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function load(before:number|null){
  if(controller.current)return;
  const c=new AbortController();controller.current=c;setBusy(true);setError("");
  try{
   const suffix=before===null?"":`&beforeRevision=${before}`;
   const response=await request(`/api/review/outputs/${outputId}?history=1${suffix}`,{headers:artifactHeaders(accountId,generation),signal:c.signal});
   if(!response.ok)throw new Error("History is unavailable. Please try again.");
   const history=parseReviewHistory((await response.json()).history,current,before);
   if(c.signal.aborted)return;
   setVersions(old=>before===null?history.versions:[...old,...history.versions]);setNext(history.nextCursor);setLoaded(true);
  }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:"History unavailable.");}
  finally{if(!c.signal.aborted){controller.current=null;setBusy(false);}}
 }
 const chosen=versions.find(v=>v.revision===selected);
 return <section className={styles.history} aria-label="Version history"><h2>Version history</h2>
  <p className={styles.small}>Compare earlier work. Feedback below always applies to current version {current.output.revision}. Viewing history does not restore or approve it.</p>
  {!loaded&&<button disabled={busy} onClick={()=>load(null)}>{busy?"Loading versions…":"Show versions"}</button>}
  {error&&<p role="alert">{error}</p>}
  {loaded&&<><div className={styles.historyChoices}>{versions.map(v=><button key={v.revision} disabled={v.revision===current.output.revision} aria-pressed={selected===v.revision} onClick={()=>setSelected(v.revision)}>Version {v.revision}{v.revision===current.output.revision?" · current":""}</button>)}
   {next!==null&&<button disabled={busy} onClick={()=>load(next)}>{busy?"Loading…":"Older versions"}</button>}
   {chosen&&<button onClick={()=>setSelected(null)}>Close comparison</button>}</div>
   {versions.length===1&&next===null&&<p>No earlier versions yet.</p>}
  </>}
  {chosen&&<div className={styles.comparison}><Preview version={chosen} current={current} label={`Earlier · version ${chosen.revision}`}/><Preview version={current.version} current={current} label={`Current · version ${current.output.revision}`}/></div>}
 </section>;
}
