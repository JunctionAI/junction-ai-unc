import { artifactHeaders } from "../artifacts/client";
import type { AgentContext } from "../agents/client";

export type ManualJournal = { requestId:string; path:string; body:Record<string,unknown>; accountId:string; contextGeneration:number; routineId:string };
export const manualJournalKey=(ctx:AgentContext,routineId:string,purpose:string)=>`unc:manual:v1:${ctx.accountId}:${ctx.contextGeneration}:${routineId}:${purpose}`;
export const MANUAL_JOURNAL_EVENT="unc-manual-journal";
const purposeFor=(path:string)=>({"/api/routines/run":"run","/api/routines/params":"validate","/api/routines/resume-input":"input"}[path]);
const notify=()=>{if(typeof window!=="undefined")window.dispatchEvent(new Event(MANUAL_JOURNAL_EVENT));};
export function clearManualJournal(key:string){sessionStorage.removeItem(key);notify();}
export function loadManualJournal(key:string):ManualJournal|null {
  const value=sessionStorage.getItem(key);if(!value)return null;
  if(value.length>32768)throw new Error("Saved request exceeds the recovery limit. Inspect account run history before starting another request.");
  const r=JSON.parse(value) as ManualJournal;
  if(!r || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.requestId) || !purposeFor(r.path) || !r.body || typeof r.body!=="object" || Array.isArray(r.body) ||
    typeof r.accountId!=="string" || !r.accountId || !Number.isSafeInteger(r.contextGeneration) || r.contextGeneration<0 || typeof r.routineId!=="string" ||
    manualJournalKey(r,r.routineId,purposeFor(r.path)!)!==key)
    throw new Error("Saved request cannot be read. Inspect account run history before starting another request.");
  return r;
}
/** Persist before POST. Storage failure stops admission; no silent new-ID fallback. */
export function saveManualJournal(key:string,ctx:AgentContext,routineId:string,path:string,body:Record<string,unknown>):ManualJournal {
  const previous=loadManualJournal(key);
  if(previous)throw new Error("Check the original request before starting another one.");
  const r={...ctx,routineId,path,body,requestId:crypto.randomUUID()};
  const serialized=JSON.stringify(r);
  if(!purposeFor(path) || manualJournalKey(ctx,routineId,purposeFor(path)!)!==key || serialized.length>32768 || new TextEncoder().encode(JSON.stringify(body)).length>16384)
    throw new Error("Request cannot be safely saved for recovery.");
  sessionStorage.setItem(key,serialized);notify();return r;
}
export async function sendManualJournal(journal:ManualJournal,inspect=false,cancel=false) {
  if(inspect && cancel)throw new Error("Choose one recovery action.");
  const res=await fetch(cancel?"/api/routines/request":inspect?`/api/routines/request?requestId=${encodeURIComponent(journal.requestId)}`:journal.path,
    {method:inspect?"GET":"POST",cache:"no-store",headers:{"content-type":"application/json",...artifactHeaders(journal.accountId,journal.contextGeneration)},
      ...(inspect?{}:{body:JSON.stringify(cancel?{action:"cancel",requestId:journal.requestId,routineId:journal.routineId,purpose:purposeFor(journal.path)}:{...journal.body,requestId:journal.requestId})})});
  const body=await res.json().catch(()=>({})) as Record<string,unknown>;
  const run=body.run as {routineId?:string;status?:string}|undefined;
  if(!res.ok || body.accountId!==journal.accountId || body.contextGeneration!==journal.contextGeneration || body.requestId!==journal.requestId ||
    (run?.routineId??body.routineId)!==journal.routineId ||
    (body.phase==="cancelled" ? body.run!==null || body.purpose!==purposeFor(journal.path) : !run?.status || !["prepared","claimed"].includes(String(body.phase))) ||
    cancel && body.phase!=="cancelled")
    throw new Error("Outcome not confirmed. Check this original request; no automatic retry was sent.");
  return body;
}
