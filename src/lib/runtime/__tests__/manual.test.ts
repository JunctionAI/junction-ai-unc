import { beforeEach, expect, it } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { SupabaseStore } from "../store/supabase";
import { readEditor } from "../presets/editor";
import { executeManual, readManual, manualResult } from "../manual";
import { FakeProducer, SAMPLE_ARTIFACT } from "./helpers";
import type { RoutineSpec } from "../types";
import type { ServiceDeps } from "../../../worker/service";

const identity={accountId:"00000000-0000-4000-8000-000000000001",userId:"00000000-0000-4000-8000-000000000002",contextGeneration:1};
const spec:RoutineSpec={id:"D01-W01",version:1,name:"Synthetic manual acceptance",wave:1,mutates:false,nodes:[
  {kind:"trigger",id:"trigger",cadence:"0 7 * * *"},
  {kind:"produce",id:"draft",skill:"D01-W01"},
  {kind:"receipt",id:"receipt",summary:"Synthetic completion"},
]};
let db:FakeSupabase,store:SupabaseStore,producer:FakeProducer,deps:ServiceDeps;
const body={routineId:spec.id,version:1,stateUpdatedAt:"2026-09-05T12:00:00.000Z"};
const snapshot=()=>readEditor(db,identity,spec.id);
const start=async(id=crypto.randomUUID())=>executeManual(db,identity,id,"run",body,await snapshot(),deps);
beforeEach(()=>{
  db=new FakeSupabase();db.now=()=>"2026-09-05T12:00:00.000Z";
  db.seed("accounts",[{id:identity.accountId,name:"Synthetic",currency:"NZD",context_generation:1,automation_paused:false}]);
  db.seed("account_members",[{account_id:identity.accountId,user_id:identity.userId,role:"owner"}]);
  db.seed("routine_states",[{account_id:identity.accountId,routine_id:spec.id,version:1,enabled:true,live_spec:spec,draft_spec:null,updated_at:db.now()}]);
  store=new SupabaseStore(db);producer=new FakeProducer();
  deps={store,db,producer,n8n:null,presets:null,accounts:{listAccounts:async()=>[],getAccount:async()=>({account:{accountId:identity.accountId,contextGeneration:1,currency:"NZD",budgetMonthly:0}})}};
});
it("replays the exact saved result with one run, artifact and producer invocation",async()=>{
  const id=crypto.randomUUID(),first=await start(id),second=await start(id);
  expect(first.result.status).toBe("done");expect(second.result.runId).toBe(first.result.runId);
  expect(second.result.artifact?.id).toBe(first.result.artifact?.id);expect(producer.calls).toHaveLength(1);
  expect(db.rows("routine_runs")).toHaveLength(1);expect(db.rows("artifacts")).toHaveLength(1);
  expect((await readManual(db,identity,id))?.operation.phase).toBe("claimed");
});
it("recovers an unclaimed reservation with its original identity after a process interruption",async()=>{
  const claim=db.rpcs.claim_manual_routine_request,id=crypto.randomUUID();
  db.rpcs.claim_manual_routine_request=()=>{throw new Error("connection lost before claim");};
  await expect(start(id)).rejects.toThrow();const prepared=await readManual(db,identity,id);
  expect(prepared?.operation.phase).toBe("prepared");expect(producer.calls).toHaveLength(0);
  db.rpcs.claim_manual_routine_request=claim;
  const resumed=await start(id);expect(resumed.result.runId).toBe(prepared?.run.id);expect(producer.calls).toHaveLength(1);
});
it("never executes after a lost successful claim reply, including repeated requests",async()=>{
  const claim=db.rpcs.claim_manual_routine_request,id=crypto.randomUUID();
  db.rpcs.claim_manual_routine_request=async p=>{await claim(p);throw new Error("lost reply after commit");};
  await expect(start(id)).rejects.toThrow();db.rpcs.claim_manual_routine_request=claim;
  const replay=await start(id);expect(replay.result.status).toBe("running");expect(producer.calls).toHaveLength(0);
  await expect(start()).rejects.toThrow();expect(db.rows("routine_runs")).toHaveLength(1);
});
it("refuses changed request, wrong identity and wrong account resolver without producer work",async()=>{
  const id=crypto.randomUUID();await start(id);
  await expect(executeManual(db,identity,id,"run",{...body,version:2},await snapshot(),deps)).rejects.toThrow("different request");
  expect(await readManual(db,{...identity,contextGeneration:0},id)).toBeNull();
  expect(await readManual(db,{...identity,userId:crypto.randomUUID()},id)).toBeNull();
  producer.calls.length=0;deps.accounts.getAccount=async()=>({account:{accountId:identity.accountId,contextGeneration:2,currency:"NZD",budgetMonthly:0}});
  await expect(start()).rejects.toThrow("context changed");expect(producer.calls).toHaveLength(0);
});
it("rechecks pause, ownership and configuration between prepare and claim",async()=>{
  const claim=db.rpcs.claim_manual_routine_request;
  db.rpcs.claim_manual_routine_request=async p=>{db.rows("accounts")[0].automation_paused=true;return claim(p);};
  await expect(start()).rejects.toThrow();expect(producer.calls).toHaveLength(0);
});
it("answers use the original run once; replay returns full receipts without repeating the producer",async()=>{
  producer=new FakeProducer((_n,ctx)=>ctx.inputs?.topic?{artifact:SAMPLE_ARTIFACT}:{needs:[{input:"topic",why:"Choose a topic"}]});deps.producer=producer;
  const first=await start();expect(first.result.status).toBe("waiting_input");
  const id=crypto.randomUUID(),answer={routineId:spec.id,runId:first.result.runId,answers:{topic:"Synthetic only"}};
  const result=await executeManual(db,identity,id,"input",answer,await snapshot(),deps);
  const replay=await executeManual(db,identity,id,"input",answer,await snapshot(),deps);
  expect(result.result.status).toBe("done");expect(replay.result.runId).toBe(first.result.runId);
  expect(producer.calls).toHaveLength(2);expect(db.rows("routine_runs")).toHaveLength(1);expect(db.rows("artifacts")).toHaveLength(1);
});
it("read-only reconciliation never claims a prepared operation",async()=>{
  db.rpcs.claim_manual_routine_request=()=>{throw new Error("not sent");};const id=crypto.randomUUID();
  await expect(start(id)).rejects.toThrow();const record=(await readManual(db,identity,id))!;
  expect((await manualResult(store,record)).summary).toContain("not started");expect(producer.calls).toHaveLength(0);
});
it("malformed admission or claim responses never reach the producer",async()=>{
  const claim=db.rpcs.claim_manual_routine_request;
  db.rpcs.claim_manual_routine_request=async p=>{await claim(p);return {claimed:true};};
  await expect(start()).rejects.toThrow("uncertain");expect(producer.calls).toHaveLength(0);
});
it("concurrent same-request attempts have one durable claim winner",async()=>{
  const id=crypto.randomUUID(),result=await Promise.allSettled([start(id),start(id)]);
  expect(result.some(r=>r.status==="fulfilled")).toBe(true);expect(producer.calls).toHaveLength(1);
  expect(db.rows("routine_runs")).toHaveLength(1);expect(db.rows("artifacts")).toHaveLength(1);
});
