"use client";
import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from "react";
import type {AgentContext} from "@/lib/agents/client";
import {clearKeywordRequest,KEYWORD_REQUEST_EVENT,keywordRequestKey,loadKeywordRequest,sendKeywordRequest,startKeywordRequest,
  type KeywordRequestOutcome,type KeywordRequestSelection} from "@/lib/n8n/keywordRequestClient";
const subscribe=(changed:()=>void)=>{window.addEventListener("storage",changed);window.addEventListener(KEYWORD_REQUEST_EVENT,changed);
  return()=>{window.removeEventListener("storage",changed);window.removeEventListener(KEYWORD_REQUEST_EVENT,changed);};};
const serverSnapshot=()=>null;
type Props={context:AgentContext;selection:KeywordRequestSelection|null;blockReason:string|null;onDone:()=>void};
export default function KeywordRunPanel(props:Props){return <KeywordRun key={keywordRequestKey(props.context)} {...props}/>;}
function KeywordRun({context,selection,blockReason,onDone}:Props){
  const key=keywordRequestKey(context);
  const stored=useSyncExternalStore(subscribe,useCallback(()=>{try{return sessionStorage.getItem(key);}catch{return "unreadable";}},[key]),serverSnapshot);
  const {journal,journalError}=useMemo(()=>{try{return {journal:stored?loadKeywordRequest(context):null,journalError:null};}
    catch{return {journal:null,journalError:"Saved request could not be read. Check account history before starting another."};}},[stored,context]);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [outcome,setOutcome]=useState<KeywordRequestOutcome|null>(null);
  const locked=useRef(false),active=useRef<AbortController|null>(null);
  useEffect(()=>{const c=new AbortController();active.current=c;return()=>c.abort();},[]);
  const current=outcome?.requestId===journal?.requestId?outcome:null;
  async function request(inspect:boolean){
    if(locked.current||!active.current||active.current.signal.aborted||journalError||!context.actorId)return;
    if(!inspect&&(journal||!selection||blockReason))return;
    locked.current=true;setBusy(true);setError("");
    const controller=active.current;
    try{
      const j=inspect?journal:startKeywordRequest(context,selection!);if(!j)throw Error("Original request is unavailable.");
      const result=await sendKeywordRequest(j,inspect,fetch,controller.signal);
      if(controller.signal.aborted)return;
      setOutcome(result);
      if(result.phase==="refused"){clearKeywordRequest(context,j,result);setError(result.reply);}
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Request outcome could not be verified.");}
    finally{if(!controller.signal.aborted){locked.current=false;setBusy(false);}}
  }
  function allowNew(){if(!journal||!current?.canStartNew||busy)return;try{clearKeywordRequest(context,journal,current);setOutcome(null);setError("");}catch{setError("Check the original request again before starting another.");}}
  return <section aria-label="Run keyword research" style={{width:"100%",fontSize:13,lineHeight:1.6,overflowWrap:"anywhere"}}>
    {!journal&&!journalError&&<><p>{selection?`Research “golf travel bag” in ${selection.market}, using the saved setup.`:"Save a reviewed keyword market before requesting research."}</p>
      <button className="btn-navy" disabled={busy||!!blockReason||!selection||!context.actorId} onClick={()=>void request(false)}>Run keyword research</button>
      {blockReason&&<p>{blockReason}</p>}</>}
    {journal&&<><p>Request {journal.requestId.slice(0,8)} · {journal.market} · {current?.command?.status??"outcome needs checking"}</p>
      {current&&<p role="status">{current.reply}</p>}
      <button disabled={busy} onClick={()=>void request(true)}>Check original request</button>{" "}
      {current?.canStartNew&&<button disabled={busy} onClick={allowNew}>Allow a new request</button>}{" "}
      {current?.command?.runId&&<button disabled={busy} onClick={onDone}>Show latest saved result</button>}
    </>}
    {(error||journalError)&&<p role="alert">{error||journalError}</p>}
    {busy&&<p role="status">{journal?"Checking the original request…":"Saving your request…"}</p>}
  </section>;
}
