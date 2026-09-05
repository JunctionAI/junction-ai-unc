import { beforeEach, expect, it } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { SupabaseStore } from "../store/supabase";
import { readEditor } from "../presets/editor";
import { executeManual, readManual, manualResult, cancelManual, continueManual } from "../manual";
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
  const resumed=await start(id);expect(resumed.result.runId).toBe(prepared?.run?.id);expect(producer.calls).toHaveLength(1);
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
  if(record.run===null)throw new Error("Unexpected cancellation");
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

it("cancels a missing request and permanently refuses its delayed original POST",async()=>{
  const id=crypto.randomUUID();expect(await readManual(db,identity,id)).toBeNull();
  expect((await cancelManual(db,identity,id,spec.id,"run")).operation.phase).toBe("cancelled");
  expect((await cancelManual(db,identity,id,spec.id,"run")).operation.phase).toBe("cancelled");
  await expect(start(id)).rejects.toThrow("cancelled");expect(producer.calls).toHaveLength(0);expect(db.rows("routine_runs")).toHaveLength(0);
  expect((await start()).result.status).toBe("done");
});
it("preserves the pause guard and cancels a settings-invalidated unclaimed run after the hold",async()=>{
  const claim=db.rpcs.claim_manual_routine_request,id=crypto.randomUUID();db.rpcs.claim_manual_routine_request=()=>{throw new Error("lost before claim");};
  await expect(start(id)).rejects.toThrow();const run=db.rows("routine_runs")[0];
  db.rows("accounts")[0].automation_paused=true;db.rows("routine_states")[0].enabled=false;
  await expect(cancelManual(db,identity,id,spec.id,"run")).rejects.toThrow("Account is paused");
  expect((await readManual(db,identity,id))?.operation.phase).toBe("prepared");
  db.rows("accounts")[0].automation_paused=false;
  const cancelled=await cancelManual(db,identity,id,spec.id,"run");expect(cancelled.run).toBeNull();
  expect(db.rows("routine_runs")[0]).toMatchObject({id:run.id,status:"skipped"});
  db.rpcs.claim_manual_routine_request=claim;db.rows("accounts")[0].automation_paused=false;db.rows("routine_states")[0].enabled=true;
  await expect(start(id)).rejects.toThrow("cancelled");expect(producer.calls).toHaveLength(0);
});
it("does not cancel claimed/uncertain work or another owner/generation/request purpose",async()=>{
  const id=crypto.randomUUID();await start(id);
  await expect(cancelManual(db,identity,id,spec.id,"run")).rejects.toThrow("Cancellation not confirmed");
  const absent=crypto.randomUUID();
  await expect(cancelManual(db,{...identity,userId:crypto.randomUUID()},absent,spec.id,"run")).rejects.toThrow();
  await expect(cancelManual(db,{...identity,contextGeneration:0},absent,spec.id,"run")).rejects.toThrow();
  await cancelManual(db,identity,absent,spec.id,"run");
  await expect(cancelManual(db,identity,absent,spec.id,"input")).rejects.toThrow();
  expect(await readManual(db,{...identity,contextGeneration:0},absent)).toBeNull();
});
it("reconciles a lost successful cancellation reply without forgetting or starting work",async()=>{
  const cancel=db.rpcs.cancel_manual_routine_request,id=crypto.randomUUID();
  db.rpcs.cancel_manual_routine_request=async p=>{await cancel(p);throw new Error("lost commit reply");};
  await expect(cancelManual(db,identity,id,spec.id,"run")).rejects.toThrow();
  expect((await readManual(db,identity,id))?.operation.phase).toBe("cancelled");
  await expect(start(id)).rejects.toThrow("cancelled");expect(producer.calls).toHaveLength(0);
});
it("cancelling an unclaimed answer leaves the original waiting run untouched",async()=>{
  producer=new FakeProducer(()=>({needs:[{input:"topic",why:"Choose a topic"}]}));deps.producer=producer;
  const first=await start(),original=structuredClone(db.rows("routine_runs")[0]);
  db.rpcs.claim_manual_routine_request=()=>{throw new Error("lost before claim");};
  const id=crypto.randomUUID(),answer={routineId:spec.id,runId:first.result.runId,answers:{topic:"Synthetic"}};
  await expect(executeManual(db,identity,id,"input",answer,await snapshot(),deps)).rejects.toThrow();
  await cancelManual(db,identity,id,spec.id,"input");
  expect(db.rows("routine_runs")[0]).toEqual(original);expect(producer.calls).toHaveLength(1);
});
it("different prepared input IDs cannot both resume an identical waiting snapshot",async()=>{
  producer=new FakeProducer(()=>({needs:[{input:"topic",why:"Choose a topic"}]}));deps.producer=producer;
  const first=await start(),original=(await store.getRun(first.result.runId))!;
  const p={p_account:identity.accountId,p_actor:identity.userId,p_generation:identity.contextGeneration,p_purpose:"input",
    p_body:{routineId:spec.id,runId:original.id,answers:{topic:"Synthetic"}},p_revision:(await snapshot()).configurationRevision,p_initial:original};
  const firstId=crypto.randomUUID(),secondId=crypto.randomUUID();
  await db.rpcs.prepare_manual_routine_request({...p,p_request:firstId});
  await db.rpcs.prepare_manual_routine_request({...p,p_request:secondId});
  expect(await db.rpcs.claim_manual_routine_request({...p,p_request:firstId})).toBe(true);
  // Same cursor, inputs and needs; only the database-managed revision differs.
  db.rows("routine_runs")[0].status="waiting_input";
  expect(db.rows("routine_runs")[0].snapshot).toEqual(original.snapshot);
  expect(db.rows("routine_runs")[0].input_revision).toBe(1);
  await expect(Promise.resolve().then(()=>db.rpcs.claim_manual_routine_request({...p,p_request:secondId}))).rejects.toThrow();
  expect(producer.calls).toHaveLength(1);
});

it("continues a prepared start using only server-held body and original run identity",async()=>{
  const claim=db.rpcs.claim_manual_routine_request,id=crypto.randomUUID();
  db.rpcs.claim_manual_routine_request=()=>{throw new Error("lost before claim");};
  await expect(start(id)).rejects.toThrow();const prepared=await readManual(db,identity,id);
  db.rpcs.claim_manual_routine_request=claim;
  const result=await continueManual(db,identity,id,spec.id,"run",deps);
  expect(result.result.runId).toBe(prepared?.run?.id);expect(result.result.status).toBe("done");
  const replay=await continueManual(db,identity,id,spec.id,"run",deps);
  expect(replay.result.runId).toBe(result.result.runId);expect(producer.calls).toHaveLength(1);
  expect(db.rows("routine_runs")).toHaveLength(1);
});
it("continues original answers after reload without resubmitting their content",async()=>{
  producer=new FakeProducer((_n,ctx)=>ctx.inputs?.topic?{artifact:SAMPLE_ARTIFACT}:{needs:[{input:"topic",why:"Choose a topic"}]});deps.producer=producer;
  const first=await start(),claim=db.rpcs.claim_manual_routine_request,id=crypto.randomUUID();
  const original={routineId:spec.id,runId:first.result.runId,answers:{topic:"Private original answer"}};
  db.rpcs.claim_manual_routine_request=()=>{throw new Error("lost before claim");};
  await expect(executeManual(db,identity,id,"input",original,await snapshot(),deps)).rejects.toThrow();
  db.rpcs.claim_manual_routine_request=claim;
  expect((await continueManual(db,identity,id,spec.id,"input",deps)).result.status).toBe("done");
  expect(producer.calls[1].ctx.inputs?.topic).toBe("Private original answer");
  expect(db.rows("routine_runs")).toHaveLength(1);
});
it("never creates a request through continuation and refuses changed identity/configuration",async()=>{
  const id=crypto.randomUUID();
  await expect(continueManual(db,identity,id,spec.id,"run",deps)).rejects.toThrow("unavailable");
  expect(db.rows("routine_runs")).toHaveLength(0);
  db.rpcs.claim_manual_routine_request=()=>{throw new Error("lost before claim");};
  await expect(start(id)).rejects.toThrow();
  await expect(continueManual(db,{...identity,userId:crypto.randomUUID()},id,spec.id,"run",deps)).rejects.toThrow();
  await expect(continueManual(db,identity,id,spec.id,"input",deps)).rejects.toThrow();
  await expect(continueManual(db,identity,id,"D02-W01","run",deps)).rejects.toThrow();
  db.rows("routine_states")[0].version=2;
  await expect(continueManual(db,identity,id,spec.id,"run",deps)).rejects.toThrow("Settings changed");
  expect(producer.calls).toHaveLength(0);
});
it("continuation cannot restart cancelled or uncertain claimed work",async()=>{
  const cancelled=crypto.randomUUID();await cancelManual(db,identity,cancelled,spec.id,"run");
  await expect(continueManual(db,identity,cancelled,spec.id,"run",deps)).rejects.toThrow("unavailable");
  const claim=db.rpcs.claim_manual_routine_request,id=crypto.randomUUID();
  db.rpcs.claim_manual_routine_request=async p=>{await claim(p);throw new Error("lost successful claim reply");};
  await expect(start(id)).rejects.toThrow();
  expect((await continueManual(db,identity,id,spec.id,"run",deps)).result.status).toBe("running");
  expect(producer.calls).toHaveLength(0);
});
