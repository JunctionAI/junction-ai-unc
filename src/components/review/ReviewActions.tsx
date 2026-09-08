"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {createAccountFetch} from "@/lib/db/accountRequest";
import {artifactHeaders} from "@/lib/artifacts/client";
import {reviewActionsSchema,reviewActionState} from "@/lib/artifacts/reviewActions";
import type {ReviewPresentation} from "@/lib/artifacts/reviewPresentation";
import type {z} from "zod";
import styles from "./review.module.css";
const labels={prepare_provider_draft:"Prepare a provider draft",send:"Send",publish:"Publish",change_ads:"Change ads"};
function displayTime(value:string){const date=new Date(value);return Number.isNaN(date.valueOf())?"Time unavailable":date.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});}
export default function ReviewActions({current}:{current:ReviewPresentation}){
 const {account_id:accountId,id:outputId,context_generation:generation,revision}=current.output;
 const request=useMemo(()=>createAccountFetch(accountId),[accountId]);
 const [data,setData]=useState<z.infer<typeof reviewActionsSchema>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function load(signal:AbortSignal){
  const response=await request(`/api/review/outputs/${outputId}?actions=1`,{headers:artifactHeaders(accountId,generation),signal});
  if(!response.ok)throw new Error("Actions are unavailable. Try again.");
  const parsed=reviewActionsSchema.parse((await response.json()).actions);
  if(parsed.output.id!==outputId||parsed.output.account_id!==accountId||parsed.output.context_generation!==generation||parsed.output.revision!==revision)
    throw new Error("The output changed. Refresh before deciding.");
  if(!signal.aborted)setData(parsed);
 }
 async function act(proposalId?:string,decision?:"approved"|"held"){
  if(controller.current)return;const c=new AbortController();controller.current=c;setBusy(true);setError("");setNotice("");
  try{
   if(proposalId&&decision){
    const response=await request(`/api/review/outputs/${outputId}`,{method:"POST",headers:{...artifactHeaders(accountId,generation),"content-type":"application/json"},signal:c.signal,
     body:JSON.stringify({operation:"decide_action",proposalId,revision,decision})});
    if(!response.ok)throw new Error(response.status===409?"This action changed or expired. Refresh before deciding.":"Decision not confirmed. Refresh to check before retrying.");
    const saved=(await response.json()).saved;
    if(saved?.proposalId!==proposalId||saved.revision!==revision||saved.status!==decision||saved.executed!==false)throw new Error("Decision receipt could not be verified.");
    if(!c.signal.aborted)setNotice(decision==="approved"?"Approval recorded for this version and destination. Check the execution status below for the outcome.":"Action held before dispatch.");
   }
   await load(c.signal);
  }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:"Decision unavailable.");}
  finally{if(!c.signal.aborted){controller.current=null;setBusy(false);}}
 }
 return <section className={styles.history} aria-label="Action approvals"><h2>Actions to approve</h2>
  <p className={styles.small}>Each decision applies only to the named version and destination. Approval does not enable automatic actions or bypass the connected platform’s checks.</p>
  <button disabled={busy} onClick={()=>act()}>{busy?"Checking…":data?"Refresh actions":"Review actions"}</button>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status" className={styles.notice}>{notice}</p>}
  {data?.actions.length===0&&<p>No actions have been prepared for approval.</p>}
  {data&&!data.canDecide&&<p>Only your account owner can approve or hold actions.</p>}
  {data?.actions.map(a=>{const state=reviewActionState(a);return <article key={a.id} className={styles.comment}><h3>{labels[a.action]} · version {a.revision}</h3>
   <p>{a.description}</p><p>Destination: {a.targetId}</p><p>{state.message}</p><p className={styles.small}>Approval: {a.effectiveStatus} · expires {displayTime(a.expiresAt)}</p>
   {a.execution&&<p className={styles.small}>Started: {displayTime(a.execution.startedAt)}{a.execution.completedAt?` · Result recorded: ${displayTime(a.execution.completedAt)}`:""}</p>}
   {data.canDecide&&a.revision===revision&&state.canApprove&&<div className={styles.historyChoices}>
    <button disabled={busy} onClick={()=>act(a.id,"approved")}>Approve this action</button><button disabled={busy} onClick={()=>act(a.id,"held")}>Hold</button>
   </div>}
   {data.canDecide&&a.revision===revision&&state.canWithdraw&&<button disabled={busy} onClick={()=>act(a.id,"held")}>Withdraw approval</button>}
  </article>;})}
 </section>;
}
