import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({snapshot:vi.fn(),trigger:vi.fn(),resume:vi.fn(),account:vi.fn(),getRun:vi.fn(),manual:vi.fn(),editor:vi.fn()}));
vi.mock("@/lib/runtime/manual",()=>({executeManual:mocks.manual,ManualRequestError:class ManualRequestError extends Error{constructor(message:string,public status=409){super(message);}}}));
vi.mock("@/lib/runtime/presets/editor",()=>({readEditor:mocks.editor}));
vi.mock("@/lib/db/client",()=>({isDbConfigured:()=>true}));
vi.mock("../server",()=>({agentSnapshot:mocks.snapshot}));
vi.mock("@/lib/runtime/store",()=>({getStore:()=>({getRun:mocks.getRun})}));
vi.mock("@/worker/wiring",()=>({defaultAccountsSource:()=>({listAccounts:async()=>[],getAccount:mocks.account})}));
vi.mock("@/worker/service",()=>({triggerRun:mocks.trigger,resumeWithInput:mocks.resume,WorkerError:class WorkerError extends Error{constructor(public code:string,message:string){super(message);}}}));
import {POST as start} from "@/app/api/routines/run/route";
import {POST as resume} from "@/app/api/routines/resume-input/route";
const accountId="00000000-0000-4000-8000-000000000001";
const row={routineId:"D01-W01",enabled:true,version:2,stateUpdatedAt:"2026-09-05T12:00:00Z",selectionBlock:null};
const snapshot=()=>({accountId,contextGeneration:1,role:"owner",paused:false,routines:[{...row}]});
const body=()=>({accountId,routineId:row.routineId,version:row.version,stateUpdatedAt:row.stateUpdatedAt});
const req=(b:unknown)=>new Request("https://unc.test/api/routines/run",{method:"POST",headers:{"content-type":"application/json","x-unc-account-id":accountId,"x-unc-context-generation":"1","x-unc-actor-id":"owner-a"},body:JSON.stringify(b)});
beforeEach(()=>{
  vi.clearAllMocks();mocks.snapshot.mockResolvedValue({session:{userId:"owner-a"},data:snapshot()});
  mocks.account.mockResolvedValue({account:{accountId,contextGeneration:1,currency:"NZD",budgetMonthly:0}});
  mocks.getRun.mockResolvedValue({id:"run",accountId,contextGeneration:1,routineId:"D01-W01"});
  mocks.manual.mockImplementation(async()=>({requestId:"request",phase:"claimed",result:{runId:"run",routineId:row.routineId,version:2,status:"done",mode:"dry_run",summary:"Synthetic only",receipts:[]}}));
});
it("rejects member, paused, off, keyword and unavailable requests before dispatch",async()=>{
  for(const change of [{role:"member"},{paused:true},{routines:[{...row,enabled:false}]},{routines:[{...row,selectionBlock:"Keyword pilot requires independent verification"}]}]){
    mocks.snapshot.mockResolvedValue({session:{userId:"owner-a"},data:{...snapshot(),...change}});expect((await start(req(body()))).status).toBeGreaterThanOrEqual(400);
  }
  expect(mocks.trigger).not.toHaveBeenCalled();
});
it("rejects stale revisions, foreign accounts and browser-supplied business inputs",async()=>{
  for(const change of [{accountId:"foreign"},{version:1},{stateUpdatedAt:null},{vars:{website:"other.example"}},{account:{currency:"USD",budgetMonthly:900}}])expect((await start(req({...body(),...change}))).status).toBeGreaterThanOrEqual(400);
  expect(mocks.trigger).not.toHaveBeenCalled();
});
it("returns the captured account and delegates only to durable admission",async()=>{
  expect(await (await start(req(body()))).json()).toMatchObject({accountId,contextGeneration:1,run:{runId:"run",routineId:"D01-W01",version:2}});
  expect(mocks.manual).toHaveBeenCalledOnce();expect(mocks.trigger).not.toHaveBeenCalled();
});
it("does not resume a run from another generation or an off routine",async()=>{
  mocks.getRun.mockResolvedValue({id:"run",accountId,contextGeneration:0,routineId:"D01-W01"});
  expect((await resume(req({runId:"run",answers:{topic:"golf"}}))).status).toBe(404);
  mocks.getRun.mockResolvedValue({id:"run",accountId,contextGeneration:1,routineId:"D01-W01"});
  mocks.snapshot.mockResolvedValue({session:{userId:"owner-a"},data:{...snapshot(),routines:[{...row,enabled:false}]}});
  expect((await resume(req({runId:"run",answers:{topic:"golf"}}))).status).toBe(409);expect(mocks.resume).not.toHaveBeenCalled();
});
