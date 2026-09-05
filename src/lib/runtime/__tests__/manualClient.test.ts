import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {loadManualJournal,manualJournalKey,saveManualJournal,sendManualJournal} from "../manualClient";
const ctx={accountId:"account-a",contextGeneration:1};
const key=manualJournalKey(ctx,"D01-W01","run");
let rows:Map<string,string>;
beforeEach(()=>{rows=new Map();vi.stubGlobal("sessionStorage",{getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>rows.set(k,v),removeItem:(k:string)=>rows.delete(k)});});
afterEach(()=>vi.unstubAllGlobals());
it("keeps the original request identity across reload and isolates account/generation/purpose",()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{routineId:"D01-W01"});
 expect(loadManualJournal(key)).toEqual(r);
 expect(()=>saveManualJournal(key,ctx,"D01-W01",r.path,r.body)).toThrow("original request");
 expect(loadManualJournal(manualJournalKey({...ctx,contextGeneration:2},"D01-W01","run"))).toBeNull();
 expect(loadManualJournal(manualJournalKey(ctx,"D01-W01","input"))).toBeNull();
});
it("storage failure refuses a new request and sends nothing",()=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);vi.stubGlobal("sessionStorage",{getItem:()=>null,setItem:()=>{throw new Error("storage denied");}});
 expect(()=>saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{})).toThrow("storage denied");expect(fetch).not.toHaveBeenCalled();
});
it("checking a request is GET only and a continued request preserves its ID",async()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{routineId:"D01-W01"});
 const fetch=vi.fn(async()=>Response.json({...ctx,requestId:r.requestId,phase:"prepared",run:{routineId:"D01-W01",status:"running"}}));vi.stubGlobal("fetch",fetch);
 await sendManualJournal(r,true);expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining(r.requestId),expect.objectContaining({method:"GET"}));
 await sendManualJournal(r);expect(fetch).toHaveBeenLastCalledWith(r.path,expect.objectContaining({method:"POST",body:JSON.stringify({...r.body,requestId:r.requestId})}));
});
it("a timeout never automatically retries or forgets the original identity",async()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{}),fetch=vi.fn(async()=>{throw new Error("timeout");});vi.stubGlobal("fetch",fetch);
 await expect(sendManualJournal(r)).rejects.toThrow("timeout");expect(fetch).toHaveBeenCalledOnce();expect(loadManualJournal(key)?.requestId).toBe(r.requestId);
});
