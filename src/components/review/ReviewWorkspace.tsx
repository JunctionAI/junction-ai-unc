"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {createAccountFetch} from "@/lib/db/accountRequest";
import {artifactHeaders} from "@/lib/artifacts/client";
import {imageAnchor,reviewMediaUrl,reviewPresentationSchema,type ReviewPresentation} from "@/lib/artifacts/reviewPresentation";
import type {ReviewComment} from "@/lib/artifacts/reviewContract";
import styles from "./review.module.css";
const ReviewHistory=dynamic(()=>import("./ReviewHistory"));
const ReviewActions=dynamic(()=>import("./ReviewActions"));

export default function ReviewWorkspace({accountId,generation,outputId}:{accountId:string;generation:number;outputId:string}){
 const request=useMemo(()=>createAccountFetch(accountId),[accountId]);
 const [review,setReview]=useState<ReviewPresentation|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[note,setNote]=useState(""),[busy,setBusy]=useState(false);
 const [anchor,setAnchor]=useState<ReviewComment["anchor"]>({kind:"whole"});
 const [intent,setIntent]=useState<ReviewComment["intent"]>("change_output");
 const pending=useRef<ReviewComment|null>(null),video=useRef<HTMLVideoElement|null>(null);
 const load=useCallback(async(signal?:AbortSignal)=>{
   const response=await request(`/api/review/outputs/${outputId}`,{headers:artifactHeaders(accountId,generation),signal});
   if(!response.ok)throw new Error(response.status===401?"Sign in again to review this work.":response.status===409?"Your business context changed. Reload this page.":"This review is unavailable. It may still be in setup.");
   const parsed=reviewPresentationSchema.parse((await response.json()).review);
   if(parsed.output.account_id!==accountId||parsed.output.id!==outputId||parsed.output.context_generation!==generation)throw new Error("Review context changed.");
   return parsed;
 },[request,accountId,generation,outputId]);
 useEffect(()=>{const c=new AbortController();load(c.signal).then(parsed=>{if(!c.signal.aborted){setReview(parsed);setError("");}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[load]);
 async function refresh(){const parsed=await load();setReview(parsed);setError("");}
 async function submit(){
   if(!review||!note.trim()||busy)return;setBusy(true);setError("");setNotice("");
   const candidate={output:{accountId,artifactId:review.output.artifact_id,outputId,revision:review.output.revision},anchor,text:note.trim(),intent};
   const previous=pending.current;
   const comment=previous&&JSON.stringify({...previous,id:undefined})===JSON.stringify({...candidate,id:undefined})?previous:{id:crypto.randomUUID(),...candidate};
   pending.current=comment;
   try{
     const response=await request(`/api/review/outputs/${outputId}`,{method:"POST",headers:{...artifactHeaders(accountId,generation),"content-type":"application/json"},body:JSON.stringify(comment)});
     if(!response.ok)throw new Error(response.status===409?"This output changed. Refresh and review the new version before commenting.":"Save not confirmed. Retry keeps the same comment ID.");
     const result=await response.json();
     if(result.saved?.commentId!==comment.id)throw new Error("Save not confirmed. Refresh to check.");
     setNotice(result.status==="revision_queued"?"Comment saved. Revision queued—not finished yet.":"Preference suggestion saved. It is not a brand rule yet.");
     pending.current=null;setNote("");setAnchor({kind:"whole"});
     await refresh();
   }catch(e){setError(e instanceof Error?e.message:"Unable to save.");}finally{setBusy(false);}
 }
 const content=review?.version.content;
 const visualComments=review?.output.kind==="image"||review?.output.kind==="email";
 return <main className={styles.shell}>
  <header className={styles.header}><a href={`/app?account=${encodeURIComponent(accountId)}`}>junction / your desk</a><button disabled={busy} onClick={()=>refresh().catch(e=>setError(e.message))}>Refresh status</button></header>
  <p className={styles.eyebrow}>Taste Gate · {review?.output.kind??"Review"}</p><h1>{content?.title??"Review your work"}</h1>
  <p>Version {review?.output.revision??"—"} · Add your taste. Nothing is sent by commenting.</p>
  {error&&<p role="alert" className={styles.alert}>{error}</p>}{notice&&<p role="status" className={styles.notice}>{notice}</p>}
  {!review&&!error&&<p role="status">Loading your work…</p>}
  {review&&<ReviewHistory key={`${accountId}:${generation}:${outputId}:${review.output.revision}`} current={review}/>}
  {review&&<ReviewActions key={`actions:${accountId}:${generation}:${outputId}:${review.output.revision}`} current={review}/>}
  {review&&<div className={styles.layout}><section className={styles.artwork} aria-label="Output preview">
    {content?.imagePath&&<button type="button" disabled={!visualComments} aria-label="Place a comment pin on this image. Keyboard activation selects the centre." className={styles.image} onClick={e=>{setAnchor(e.detail===0?{kind:"visual",x:0.5,y:0.5}:imageAnchor(e.clientX,e.clientY,e.currentTarget.getBoundingClientRect()));}}>
      <Image src={reviewMediaUrl(content.imagePath,review)} alt={content.title??"Creative preview"} width={1200} height={1600} loading="eager" unoptimized style={{width:"100%",height:"auto"}}/>
      {anchor.kind==="visual"&&<span className={styles.pin} style={{left:`${anchor.x*100}%`,top:`${anchor.y*100}%`}}>1</span>}
    </button>}
    {content?.videoPath&&<><video ref={video} src={reviewMediaUrl(content.videoPath,review)} controls preload="metadata"/>{review.output.kind==="video"&&<button onClick={()=>setAnchor({kind:"video",seconds:video.current?.currentTime??0})}>Comment at this timestamp</button>}</>}
    {content?.body&&<div className={styles.body}>{content.body}</div>}
    {!content?.body&&!content?.imagePath&&!content?.videoPath&&<p>No reviewable content has been attached yet.</p>}
  </section><aside id="review-feedback" className={styles.panel}><h2>Add your taste</h2>
    <label>Comment on<select value={anchor.kind==="section"?anchor.sectionId:""} onChange={e=>setAnchor(e.target.value?{kind:"section",sectionId:e.target.value}:{kind:"whole"})}><option value="">Whole output</option>{review.output.section_ids.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
    <p className={styles.small}>{anchor.kind==="visual"?"Image point selected. Coordinates stay proportional on mobile.":anchor.kind==="video"?`Video at ${anchor.seconds.toFixed(1)}s`:anchor.kind==="section"?`Section: ${anchor.sectionId}`:visualComments&&content?.imagePath?"You can also tap the image to place a pin.":"Your feedback applies to the whole output."}</p>
    <label>Your feedback<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={4000} placeholder="Make the headline more editorial…"/></label>
    <label>Apply this to<select value={intent} onChange={e=>setIntent(e.target.value as ReviewComment["intent"])}><option value="change_output">Change this output</option><option value="suggest_brand_preference">Suggest a brand preference</option></select></label>
    <button className={styles.primary} disabled={busy||!note.trim()} onClick={submit}>{busy?"Saving…":"Save feedback"}</button>
    <p className={styles.small}>Action approvals are separate from feedback. Provider execution is not released on this screen yet.</p>
    <h3>Revision jobs</h3>{review.jobs.length?review.jobs.map(j=><p key={j.id}>Version {j.base_revision} → {j.status}</p>):<p>No revisions requested.</p>}
    <h3>Comments</h3>{review.comments.map(c=><article key={c.id} className={styles.comment}><small>Version {c.output_revision} · {c.intent==="change_output"?"One-off edit":"Preference suggestion"}</small><p>{c.note}</p></article>)}
  </aside></div>}
  {review&&<a className={styles.mobileFeedback} href="#review-feedback">Add feedback</a>}
 </main>;
}
