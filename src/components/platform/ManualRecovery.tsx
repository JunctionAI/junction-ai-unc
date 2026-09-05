"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AgentContext } from "@/lib/agents/client";
import { clearManualJournal, loadManualJournal, MANUAL_JOURNAL_EVENT, manualJournalKey, saveManualJournal, sendManualJournal } from "@/lib/runtime/manualClient";

const subscribe=(changed:()=>void)=>{window.addEventListener("storage",changed);window.addEventListener(MANUAL_JOURNAL_EVENT,changed);
  return()=>{window.removeEventListener("storage",changed);window.removeEventListener(MANUAL_JOURNAL_EVENT,changed);};};
const serverSnapshot=()=>null;

export function useManualRecovery(context:AgentContext|undefined,routineId:string,purpose:string) {
  const key=context?manualJournalKey(context,routineId,purpose):null;
  const stored=useSyncExternalStore(subscribe,useCallback(()=>{try{return key?sessionStorage.getItem(key):null;}catch{return "storage_unavailable";}},[key]),serverSnapshot);
  const {journal,error}=useMemo(()=>{try{return{journal:key&&stored?loadManualJournal(key):null,error:null};}catch(e){return{journal:null,error:String(e)};}},[key,stored]);
  const [outcome,setOutcome]=useState<{key:string|null;requestId:string;phase:string|null;status:string|null}|null>(null);
  const current=outcome?.key===key && outcome?.requestId===journal?.requestId;
  const phase=current?outcome?.phase??null:null,status=current?outcome?.status??null:null;
  const active=useRef(key);
  useEffect(()=>{active.current=key;return()=>{active.current=null;};},[key]);
  async function submit(path:string,body:Record<string,unknown>) {
    if(!key || !context)throw new Error("Saved account required.");
    const j=saveManualJournal(key,context,routineId,path,body);
    const data=await sendManualJournal(j);if(active.current!==key)throw new Error("Account view changed; inspect the saved request.");
    setOutcome({key,requestId:j.requestId,phase:String(data.phase),status:(data.run as {status:string}|null)?.status??null});return data;
  }
  async function recover(continueOriginal:boolean) {
    if(!journal)throw new Error("Original request unavailable.");
    if(continueOriginal && phase!=="prepared")throw new Error("Only an unclaimed original request can be continued.");
    const data=await sendManualJournal(journal,!continueOriginal);
    if(active.current!==key)throw new Error("Account view changed; inspect the saved request.");
    setOutcome({key,requestId:journal.requestId,phase:String(data.phase),status:(data.run as {status:string}|null)?.status??null});return data;
  }
  async function cancel() {
    if(!journal)throw new Error("Original request unavailable.");
    const data=await sendManualJournal(journal,false,true);
    if(active.current!==key)throw new Error("Account view changed; inspect the saved request.");
    setOutcome({key,requestId:journal.requestId,phase:"cancelled",status:null});return data;
  }
  const terminal=phase==="cancelled" || phase==="claimed" && (["done","failed","skipped"].includes(status??"") || purpose==="input" && status==="waiting_input");
  function clear() {if(!key || !terminal)return;clearManualJournal(key);setOutcome(null);}
  return {journal,phase,status,error,terminal,submit,recover,cancel,clear,blocked:!!journal || !!error};
}

export default function ManualRecovery({recovery,busy,blocked,onResult}: {recovery:ReturnType<typeof useManualRecovery>;busy:boolean;blocked?:boolean;onResult:(body:Record<string,unknown>)=>void}) {
  const [checking,setChecking]=useState(false),[error,setError]=useState<string|null>(null);
  const inFlight=useRef(false);
  async function check(action:"inspect"|"continue"|"cancel") {
    if(inFlight.current || busy)return;inFlight.current=true;setChecking(true);setError(null);
    try{const data=await(action==="cancel"?recovery.cancel():recovery.recover(action==="continue"));if(data.run)onResult(data);}catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{inFlight.current=false;setChecking(false);}
  }
  if(!recovery.journal && !recovery.error)return null;
  return <div role="status" style={{fontSize:12,marginTop:10,lineHeight:1.6}}>
    {recovery.journal && <>Request {recovery.journal.requestId.slice(0,8)} · {recovery.phase==="cancelled"?"cancelled before start":recovery.phase==="prepared"?"prepared, not started":recovery.status??"outcome needs checking"}.{" "}
      <button disabled={busy||checking} onClick={()=>void check("inspect")}>Check original run</button>{" "}
      {recovery.phase==="prepared" && <button disabled={busy||checking||blocked} onClick={()=>void check("continue")}>Continue original request</button>}
      {recovery.phase!=="claimed" && recovery.phase!=="cancelled" && <button disabled={busy||checking} onClick={()=>void check("cancel")}>Cancel unstarted request</button>}
      {recovery.terminal && <button disabled={busy||checking} onClick={()=>recovery.clear()}>Allow a new request</button>}
    </>}
    {(error||recovery.error) && <p>{error||recovery.error}</p>}
  </div>;
}
