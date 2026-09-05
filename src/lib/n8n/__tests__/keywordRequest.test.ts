import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {FakeSupabase} from "@/lib/db/__tests__/fakeSupabase";
import {MemoryStore} from "@/lib/runtime/store/memory";
import type {AccountSession} from "@/lib/db/session";
import {keywordPilotContract,KEYWORD_PILOT_PIN} from "../keywordAdmission";
import {keywordShadowSpec} from "../keywordShadowSpec";
import {commandId,DbCommandQueue,digest} from "@/lib/commands/queue";
import {workflowFingerprint} from "@/lib/commands/releaseScope";
import {clearKeywordRequest,keywordRequestKey,loadKeywordRequest,sendKeywordRequest,startKeywordRequest,type KeywordRequestOutcome} from "../keywordRequestClient";
const A="aa5cfc84-2569-4c99-9b40-67003ae55eda",U="74802c60-149a-4405-b719-dc058d174072",ctx={accountId:A,actorId:U,contextGeneration:1};
let db:FakeSupabase,store:MemoryStore,session:AccountSession|Response,configuration:ReturnType<typeof fixture>;
vi.mock("@/lib/db/session",()=>({requireAccountOwnerSession:async()=>session}));
vi.mock("@/lib/runtime/store",()=>({getStore:()=>store}));
import {GET,POST} from "@/app/api/routines/keyword-request/route";
const selection={market:"US" as const,version:2 as const,stateUpdatedAt:"2026-09-06T00:00:00.123456+00:00"};
function fixture(){
  const now=new Date(),contract=keywordPilotContract({authorizedBy:U,market:"US",contextGeneration:1,maxProviderCalls:1,approvalReference:"TEST",idempotencyKey:"TEST",expiresAt:new Date(now.getTime()+600000).toISOString()},now);
  const spec=keywordShadowSpec(contract,2),workflow={id:randomUUID(),accountId:A,routineId:"D03-W01",active:true,webhookUrl:KEYWORD_PILOT_PIN.receiverUrl};
  return {...ctx,routineId:"D03-W01",version:2,stateUpdatedAt:selection.stateUpdatedAt,enabled:true,hasDraft:false,paused:false,spec,workflow,candidates:[{market:"US",spec,sourceRunId:randomUUID()}]};
}
const req=(id:string,body?:unknown,headers:Record<string,string>={})=>new Request(`https://unc.test/api/routines/keyword-request${body===undefined?`?requestId=${id}`:""}`,{
  method:body===undefined?"GET":"POST",headers:{"content-type":"application/json","x-unc-account-id":A,"x-unc-context-generation":"1","x-unc-actor-id":U,...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
beforeEach(async()=>{
  db=new FakeSupabase();store=new MemoryStore();configuration=fixture();
  db.seed("accounts",[{id:A,context_generation:1,automation_paused:false}]);db.seed("account_members",[{account_id:A,user_id:U,role:"owner"}]);
  db.rpcs.keyword_customer_configuration=()=>structuredClone(configuration);
  session={accountId:A,userId:U,role:"owner",email:null,db,service:db};
  await store.putRoutineState({accountId:A,routineId:"D03-W01",version:2,enabled:true,liveSpec:configuration.spec,draftSpec:null,updatedAt:selection.stateUpdatedAt});
  await store.putN8nWorkflow(configuration.workflow);
  vi.stubEnv("UNC_COMMANDS_ENABLED","true");vi.stubEnv("UNC_COMMAND_RELEASE_SCOPES",JSON.stringify([{accountId:A,contextGeneration:1,channel:"app",routineId:"D03-W01",
    specHash:digest(configuration.spec),workflowHash:workflowFingerprint(configuration.workflow),expiresAt:new Date(Date.now()+600000).toISOString()}]));
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("keyword request API uses the existing command queue",()=>{
  it("queues once and reads the original request after duplicate delivery",async()=>{
    const id=randomUUID(),body={...selection,requestId:id};
    const first=await POST(req(id,body));expect(first.status).toBe(200);const result=await first.json();
    expect(result).toMatchObject({...ctx,requestId:id,phase:"record",command:{status:"queued"},canStartNew:false});
    expect(await (await POST(req(id,body))).json()).toEqual(result);expect(await (await GET(req(id))).json()).toEqual(result);
    expect(db.rows("routine_commands")).toHaveLength(1);expect(db.rows("routine_runs")).toHaveLength(0);
  });
  it("reads a prior queued request when commands are off and the account paused",async()=>{
    const id=randomUUID();await POST(req(id,{...selection,requestId:id}));vi.stubEnv("UNC_COMMANDS_ENABLED","false");
    await db.from("accounts").update({automation_paused:true}).eq("id",A);
    expect((await (await GET(req(id))).json()).command.status).toBe("queued");
  });
  it.each(["account","generation","actor"])("refuses changed %s headers before queueing",async field=>{
    const id=randomUUID(),headers:Record<string,string>=field==="account"?{"x-unc-account-id":randomUUID()}:field==="generation"?{"x-unc-context-generation":"2"}:{"x-unc-actor-id":randomUUID()};
    expect((await POST(req(id,{...selection,requestId:id},headers))).status).toBe(409);expect(db.rows("routine_commands")).toHaveLength(0);
  });
  it.each([401,403,200])("refuses session status %s with no public cache",async status=>{
    session=Response.json({fallback:true},{status});const res=await GET(req(randomUUID()));expect(res.status).toBe(status===200?503:status);expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("an absent original request is unknown, never permission to replay",async()=>{
    const result=await (await GET(req(randomUUID()))).json();expect(result).toMatchObject({phase:"not_found",command:null,canStartNew:false});
  });
  it.each(["market","version","stateUpdatedAt"])("refuses stale displayed %s without enqueueing",async field=>{
    const id=randomUUID(),body={...selection,requestId:id,...(field==="market"?{market:"NZ"}:field==="version"?{version:1}:{stateUpdatedAt:"2026-09-06T00:00:00.123455+00:00"})};
    const res=await POST(req(id,body));if(field==="version")expect(res.status).toBe(400);else expect((await res.json()).phase).toBe("refused");expect(db.rows("routine_commands")).toHaveLength(0);
  });
  it.each(["off","paused","disabled"])("refuses %s without saving a command",async state=>{
    if(state==="off")vi.stubEnv("UNC_COMMANDS_ENABLED","false");if(state==="paused")configuration.paused=true;if(state==="disabled")configuration.enabled=false;
    const id=randomUUID();expect((await (await POST(req(id,{...selection,requestId:id}))).json()).phase).toBe("refused");expect(db.rows("routine_commands")).toHaveLength(0);
  });
  it("rechecks the selected workflow after configuration read",async()=>{
    vi.spyOn(store,"findN8nWorkflow").mockResolvedValue({...configuration.workflow,id:randomUUID()});
    const id=randomUUID();expect((await (await POST(req(id,{...selection,requestId:id}))).json()).phase).toBe("refused");expect(db.rows("routine_commands")).toHaveLength(0);
  });
  it("does not call the generic run endpoint, issuer or model from the request route",async()=>{
    const rpc=vi.spyOn(db,"rpc"),id=randomUUID();await POST(req(id,{...selection,requestId:id}));
    expect(rpc.mock.calls.map(c=>c[0])).toEqual(["keyword_customer_configuration"]);
  });
  it("failed command with unresolved provider evidence cannot release a new request",async()=>{
    const id=randomUUID();await POST(req(id,{...selection,requestId:id}));const command=commandId({accountId:A,userId:U,contextGeneration:1,channel:"app",requestId:id});
    await db.from("routine_commands").update({status:"failed",run_id:command}).eq("id",command);
    db.seed("n8n_shadow_permits",[{account_id:A,run_id:command,status:"uncertain"}]);
    expect((await (await GET(req(id))).json()).canStartNew).toBe(false);
    await db.from("n8n_shadow_permits").update({status:"refused"}).eq("run_id",command);expect((await (await GET(req(id))).json()).canStartNew).toBe(true);
  });
  it("lost response after queue insertion is recoverable without replay",async()=>{
    const original=DbCommandQueue.prototype.enqueue;
    const enqueue=vi.spyOn(DbCommandQueue.prototype,"enqueue").mockImplementation(async function(this:DbCommandQueue,c){await original.call(this,c);throw Error("lost reply");});
    const id=randomUUID();expect((await POST(req(id,{...selection,requestId:id}))).status).toBe(503);
    enqueue.mockRestore();expect((await (await GET(req(id))).json()).command.status).toBe("queued");expect(db.rows("routine_commands")).toHaveLength(1);
  });
});
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>map.delete(k),clear:()=>map.clear(),key:()=>null,length:0} as Storage;}
describe("keyword request browser identity journal",()=>{
  it("persists before transport and prevents a second pending identity",()=>{
    const s=storage(),j=startKeywordRequest(ctx,selection,s);expect(loadKeywordRequest(ctx,s)).toEqual(j);
    expect(()=>startKeywordRequest(ctx,selection,s)).toThrow();expect(s.getItem(keywordRequestKey(ctx))).not.toContain("credential");
  });
  it("storage failure stops before a request can be sent",()=>{
    const s=storage();s.setItem=()=>{throw Error("storage unavailable");};expect(()=>startKeywordRequest(ctx,selection,s)).toThrow();
  });
  it("lost transport is never retried and preserves the original identity",async()=>{
    const s=storage(),j=startKeywordRequest(ctx,selection,s),fetcher=vi.fn().mockRejectedValue(Error("timeout"));
    await expect(sendKeywordRequest(j,false,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);expect(loadKeywordRequest(ctx,s)?.requestId).toBe(j.requestId);
  });
  it("does not clear an unresolved or unrelated request",()=>{
    const s=storage(),j=startKeywordRequest(ctx,selection,s);const o={...ctx,routineId:"D03-W01",requestId:j.requestId,phase:"not_found",command:null,reply:"unknown",canStartNew:false} as KeywordRequestOutcome;
    expect(()=>clearKeywordRequest(ctx,j,o,s)).toThrow();expect(loadKeywordRequest(ctx,s)).toEqual(j);
    clearKeywordRequest(ctx,j,{...o,phase:"refused",canStartNew:true},s);expect(loadKeywordRequest(ctx,s)).toBeNull();
  });
  it("rejects foreign response and unsafe completed-state claims",async()=>{
    const j=startKeywordRequest(ctx,selection,storage());const base={...ctx,requestId:j.requestId,routineId:"D03-W01",phase:"not_found",command:null,reply:"unknown",canStartNew:false};
    for(const patch of [{actorId:randomUUID()},{accountId:randomUUID()},{contextGeneration:2},{requestId:randomUUID()},{canStartNew:true}])
      await expect(sendKeywordRequest(j,true,vi.fn().mockResolvedValue(Response.json({...base,...patch})))).rejects.toThrow();
  });
});
