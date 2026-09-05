import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {loadManualJournal,manualJournalKey,saveManualJournal,sendManualJournal} from "../manualClient";
const ctx={accountId:"account-a",contextGeneration:1,actorId:"owner-a"};
const key=manualJournalKey(ctx,"D01-W01","run");
let rows:Map<string,string>;
beforeEach(()=>{rows=new Map();vi.stubGlobal("sessionStorage",{getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>rows.set(k,v),removeItem:(k:string)=>rows.delete(k)});});
afterEach(()=>vi.unstubAllGlobals());
it("keeps the original request identity across reload and isolates account/generation/purpose",()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{routineId:"D01-W01"});
 expect(loadManualJournal(key)).toEqual(r);
 expect(()=>saveManualJournal(key,ctx,"D01-W01",r.path,{})).toThrow("original request");
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
 await sendManualJournal(r);expect(fetch).toHaveBeenLastCalledWith("/api/routines/request",expect.objectContaining({method:"POST",body:JSON.stringify({action:"continue",requestId:r.requestId,routineId:r.routineId,purpose:"run"})}));
});
it("a timeout never automatically retries or forgets the original identity",async()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{}),fetch=vi.fn(async()=>{throw new Error("timeout");});vi.stubGlobal("fetch",fetch);
 await expect(sendManualJournal(r)).rejects.toThrow("timeout");expect(fetch).toHaveBeenCalledOnce();expect(loadManualJournal(key)?.requestId).toBe(r.requestId);
});
it("a 404 never clears the journal; only a matching cancellation receipt permits recovery",async()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{});
 const fetch=vi.fn(async()=>Response.json({error:"not found"},{status:404}));vi.stubGlobal("fetch",fetch);
 await expect(sendManualJournal(r,true)).rejects.toThrow("Outcome not confirmed");expect(loadManualJournal(key)?.requestId).toBe(r.requestId);
 fetch.mockImplementation(async()=>Response.json({...ctx,requestId:r.requestId,routineId:r.routineId,purpose:"run",phase:"cancelled",run:null}));
 expect((await sendManualJournal(r,false,true)).phase).toBe("cancelled");
 expect(fetch).toHaveBeenLastCalledWith("/api/routines/request",expect.objectContaining({method:"POST",body:JSON.stringify({action:"cancel",requestId:r.requestId,routineId:r.routineId,purpose:"run"})}));
 expect(loadManualJournal(key)?.requestId).toBe(r.requestId); // Explicit UI clear only.
});
it("rejects mismatched cancellation evidence and retains the original key after a lost reply",async()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{});
 const fetch=vi.fn(async()=>Response.json({...ctx,requestId:r.requestId,routineId:r.routineId,purpose:"input",phase:"cancelled",run:null}));vi.stubGlobal("fetch",fetch);
 await expect(sendManualJournal(r,false,true)).rejects.toThrow();
 fetch.mockImplementation(async()=>{throw new Error("lost cancellation reply");});
 await expect(sendManualJournal(r,false,true)).rejects.toThrow();expect(loadManualJournal(key)?.requestId).toBe(r.requestId);
});
it("rejects stored context tampering and oversized requests before any send",()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{});
 rows.set(key,JSON.stringify({...r,contextGeneration:2}));expect(()=>loadManualJournal(key)).toThrow("cannot be read");
 rows.clear();expect(()=>saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{text:"x".repeat(17000)})).toThrow("safely saved");
 expect(loadManualJournal(key)).toBeNull();
});
it("persists only identity, binds to the owner, and sends answers only on the initial POST",async()=>{
 const inputKey=manualJournalKey(ctx,"D01-W01","input"),answer={runId:"original-run",answers:{topic:"Private customer answer"}};
 const r=saveManualJournal(inputKey,ctx,"D01-W01","/api/routines/resume-input",answer);
 expect(rows.get(inputKey)).not.toContain("Private customer answer");expect(rows.get(inputKey)).not.toContain("answers");
 expect(loadManualJournal(manualJournalKey({...ctx,actorId:"owner-b"},"D01-W01","input"))).toBeNull();
 const fetch=vi.fn(async()=>Response.json({...ctx,requestId:r.requestId,phase:"claimed",run:{routineId:r.routineId,status:"done"}}));vi.stubGlobal("fetch",fetch);
 await sendManualJournal(r,false,false,answer);
 expect(fetch).toHaveBeenLastCalledWith(r.path,expect.objectContaining({headers:expect.objectContaining({"x-unc-actor-id":ctx.actorId}),body:JSON.stringify({...answer,requestId:r.requestId})}));
 await sendManualJournal(loadManualJournal(inputKey)!);
 expect(fetch).toHaveBeenLastCalledWith("/api/routines/request",expect.objectContaining({body:JSON.stringify({action:"continue",requestId:r.requestId,routineId:r.routineId,purpose:"input"})}));
 expect(rows.get(inputKey)).not.toContain("Private customer answer");
});
it("refuses evidence for a different owner and does not abandon actor-unbound legacy storage",async()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{});
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({...ctx,actorId:"owner-b",requestId:r.requestId,phase:"claimed",run:{routineId:r.routineId,status:"done"}})));
 await expect(sendManualJournal(r,true)).rejects.toThrow("Outcome not confirmed");expect(loadManualJournal(key)?.requestId).toBe(r.requestId);
 rows.clear();const legacy=`unc:manual:v1:${ctx.accountId}:${ctx.contextGeneration}:D01-W01:run`;
 rows.set(legacy,JSON.stringify({requestId:r.requestId}));
 expect(()=>saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{})).toThrow("older saved request");expect(rows.has(legacy)).toBe(true);
});
it("rejects body/actor injection into the minimal journal and refuses missing owner identity",()=>{
 const r=saveManualJournal(key,ctx,"D01-W01","/api/routines/run",{});
 rows.set(key,JSON.stringify({...r,body:{answers:"should not be stored"}}));expect(()=>loadManualJournal(key)).toThrow("cannot be read");
 rows.set(key,JSON.stringify({...r,actorId:"owner-b"}));expect(()=>loadManualJournal(key)).toThrow("cannot be read");
 rows.clear();expect(()=>saveManualJournal(manualJournalKey({...ctx,actorId:undefined},"D01-W01","run"),{...ctx,actorId:undefined},"D01-W01","/api/routines/run",{})).toThrow("safely saved");
});
