import { artifactHeaders } from "../artifacts/client";
import type { AgentContext } from "../agents/client";

export type ManualJournal = { requestId:string; path:string; body:Record<string,unknown>; accountId:string; contextGeneration:number; routineId:string };
export const manualJournalKey=(ctx:AgentContext,routineId:string,purpose:string)=>`unc:manual:v1:${ctx.accountId}:${ctx.contextGeneration}:${routineId}:${purpose}`;
export const MANUAL_JOURNAL_EVENT="unc-manual-journal";
const notify=()=>{if(typeof window!=="undefined")window.dispatchEvent(new Event(MANUAL_JOURNAL_EVENT));};
export function clearManualJournal(key:string){sessionStorage.removeItem(key);notify();}
export function loadManualJournal(key:string):ManualJournal|null {
  const value=sessionStorage.getItem(key);if(!value)return null;
  const r=JSON.parse(value) as ManualJournal;
  if(!r || typeof r.requestId!=="string" || !["/api/routines/run","/api/routines/params","/api/routines/resume-input"].includes(r.path) || !r.body || typeof r.body!=="object")
    throw new Error("Saved request cannot be read. Inspect account run history before starting another request.");
  return r;
}
/** Persist before POST. Storage failure stops admission; no silent new-ID fallback. */
export function saveManualJournal(key:string,ctx:AgentContext,routineId:string,path:string,body:Record<string,unknown>):ManualJournal {
  const previous=loadManualJournal(key);
  if(previous)throw new Error("Check the original request before starting another one.");
  const r={...ctx,routineId,path,body,requestId:crypto.randomUUID()};
  sessionStorage.setItem(key,JSON.stringify(r));notify();return r;
}
export async function sendManualJournal(journal:ManualJournal,inspect=false) {
  const res=await fetch(inspect?`/api/routines/request?requestId=${encodeURIComponent(journal.requestId)}`:journal.path,
    {method:inspect?"GET":"POST",cache:"no-store",headers:{"content-type":"application/json",...artifactHeaders(journal.accountId,journal.contextGeneration)},
      ...(inspect?{}:{body:JSON.stringify({...journal.body,requestId:journal.requestId})})});
  const body=await res.json().catch(()=>({})) as Record<string,unknown>;
  const run=body.run as {routineId?:string;status?:string}|undefined;
  if(!res.ok || body.accountId!==journal.accountId || body.contextGeneration!==journal.contextGeneration || body.requestId!==journal.requestId ||
    (run?.routineId??body.routineId)!==journal.routineId || !run?.status || !["prepared","claimed"].includes(String(body.phase)))
    throw new Error("Outcome not confirmed. Check this original request; no automatic retry was sent.");
  return body;
}
