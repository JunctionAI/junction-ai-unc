import {beforeEach,describe,expect,it,vi} from "vitest";
import {FakeSupabase} from "@/lib/db/__tests__/fakeSupabase";
import type {AccountSession} from "@/lib/db/session";
import {AGENT_JOBS} from "../catalog";
import {ALL_SYSTEMS} from "@/lib/platform/catalog";
const A="00000000-0000-4000-8000-000000000001", U="00000000-0000-4000-8000-000000000002";
let db:FakeSupabase, session:AccountSession|Response;
const listing=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/db/session",()=>({requireAccountSession:async()=>session}));
vi.mock("@/lib/db/runtimeContext",()=>({assertRuntimeContext:async()=>{}}));
vi.mock("@/lib/runtime/store",()=>({getStore:()=>({})}));
vi.mock("@/lib/runtime/routinesState",()=>({routinesStateForAccount:listing}));
import {GET,POST} from "@/app/api/agents/route";
import {GET as legacyGet,POST as legacyPost} from "@/app/api/routines/state/route";
import {POST as setupPost} from "@/app/api/setup/enable/route";
const request=(body?:unknown,account=A,generation="1")=>new Request("https://unc.test/api/agents",{method:body===undefined?"GET":"POST",headers:{"content-type":"application/json","x-unc-account-id":account,"x-unc-context-generation":generation},...(body===undefined?{}:{body:JSON.stringify(body)})});
const change={routineId:"D01-W01",enabled:true,stateUpdatedAt:null,version:1};
beforeEach(()=>{
  db=new FakeSupabase();db.seed("accounts",[{id:A,name:"Fixture",context_generation:1,automation_paused:false}]);db.seed("account_members",[{account_id:A,user_id:U,role:"owner"}]);
  session={accountId:A,userId:U,role:"owner",email:"fixture@example.test",db,service:db};
  listing.mockReset();listing.mockResolvedValue({routines:[{routineId:"D01-W01",enabled:false,version:1,canEnable:true,skillSource:"builtin",availabilityCopy:"drafts only"}],connected:[],business:{},recommendedFirst:[],planChannel:null});
});
describe("account-bound Agents API",()=>{
  it("uses one contract on every legacy switch URL and refuses old revision-less writes",async()=>{
    expect(legacyGet).toBe(GET);expect(legacyPost).toBe(POST);expect(setupPost).toBe(POST);
    for(const handler of [legacyPost,setupPost])expect((await handler(request({routineId:"D01-W01",enabled:true}))).status).toBe(400);
    expect(listing).not.toHaveBeenCalled();
  });
  it("passes exact requested detail into current-generation history and refuses unknown queries",async()=>{
    const r=request();const detailed=new Request(r.url+"?routineId=D01-W01",{headers:r.headers});
    expect((await GET(detailed)).status).toBe(200);expect(listing).toHaveBeenLastCalledWith(expect.anything(),A,{routineId:"D01-W01",contextGeneration:1});
    expect((await GET(new Request(r.url+"?routineId=made-up",{headers:r.headers}))).status).toBe(400);
    expect((await GET(new Request(r.url+"?routineId=D01-W01&routineId=D02-W01",{headers:r.headers}))).status).toBe(400);
  });
  it("marks authentication and context denials private and non-cacheable",async()=>{
    expect((await GET(request(undefined,U))).headers.get("cache-control")).toBe("private, no-store");
    session=Response.json({error:"sign in"},{status:401});const r=await GET(request());expect(r.status).toBe(401);expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("reads current-generation history and authoritative role, pause and revision",async()=>{
    const r=await GET(request());expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("private, no-store");
    const b=await r.json();expect(b).toMatchObject({accountId:A,contextGeneration:1,role:"owner",paused:false});expect(b.routines[0].stateUpdatedAt).toBeNull();
    expect(listing).toHaveBeenCalledWith(expect.anything(),A,{contextGeneration:1});
  });
  it("rejects wrong account, missing/stale generation and demo fallback",async()=>{
    for(const [a,g] of [[U,"1"],[A,"0"],[A,""]]) expect((await GET(request(undefined,a,g))).status).toBe(409);
    expect(listing).not.toHaveBeenCalled();session=Response.json({fallback:true});expect((await GET(request())).status).toBe(503);
  });
  it("does not let a member or missing membership write",async()=>{
    await db.from("account_members").update({role:"member"}).eq("account_id",A);expect((await POST(request(change))).status).toBe(403);
    await db.from("account_members").delete().eq("account_id",A);expect((await POST(request(change))).status).toBe(403);
  });
  it("refuses paused enable, unavailable routine and unregistered keyword before switch RPC",async()=>{
    const rpc=vi.spyOn(db,"rpc");await db.from("accounts").update({automation_paused:true}).eq("id",A);expect((await POST(request(change))).status).toBe(409);
    await db.from("accounts").update({automation_paused:false}).eq("id",A);listing.mockResolvedValue({routines:[{...change,canEnable:false,skillSource:"builtin",availabilityCopy:"needs data"}]});expect((await POST(request(change))).status).toBe(409);
    listing.mockResolvedValue({routines:[{routineId:"D03-W01",canEnable:true,skillSource:"n8n"}]});expect((await POST(request({...change,routineId:"D03-W01"}))).status).toBe(409);expect(rpc).not.toHaveBeenCalled();
  });
  it("writes only the exact CAS preference using server actor; never dispatches a run",async()=>{
    const saved={accountId:A,contextGeneration:1,routineId:"D01-W01",enabled:true,version:1,stateUpdatedAt:"2026-09-05T11:30:00Z"};
    const rpc=vi.spyOn(db,"rpc").mockResolvedValue({data:saved,error:null});expect(await (await POST(request(change))).json()).toEqual({saved});
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_agent_switch",{p_account:A,p_actor:U,p_generation:1,p_routine:"D01-W01",p_enabled:true,p_expected_updated_at:null,p_expected_version:1});
  });
  it("permits switching off while paused, but never hides a lost/conflicting save",async()=>{
    await db.from("accounts").update({automation_paused:true}).eq("id",A);const rpc=vi.spyOn(db,"rpc").mockResolvedValue({data:null,error:{code:"40001",message:"sensitive database detail"}});
    const r=await POST(request({...change,enabled:false}));expect(r.status).toBe(409);expect(await r.text()).not.toContain("sensitive");expect(rpc).toHaveBeenCalledOnce();
    rpc.mockResolvedValue({data:null,error:null});expect((await POST(request({...change,enabled:false}))).status).toBe(503);
  });
  it("rejects invented routines and extra/injected authority fields",async()=>{
    for(const b of [{...change,routineId:"lead-calls"},{...change,userId:U},{...change,version:0},{...change,stateUpdatedAt:"not-time"},null])expect((await POST(request(b))).status).toBe(400);
    expect(listing).not.toHaveBeenCalled();
  });
});
describe("supplied catalog reconciliation",()=>{
  it("maps all 35 existing IDs once, preserves 38 design labels, and isolates five unimplemented additions",()=>{
    const ids=AGENT_JOBS.flatMap(j=>j.routineId?[j.routineId]:[]);expect(ids.sort()).toEqual(ALL_SYSTEMS.map(s=>s.id).sort());expect(new Set(ids).size).toBe(35);
    const design=AGENT_JOBS.filter(j=>!["google-bofu","backlink-gap"].includes(j.key)).flatMap(j=>j.designLabels);expect(design).toHaveLength(38);expect(new Set(design).size).toBe(38);
    expect(AGENT_JOBS.filter(j=>j.routineId===null)).toHaveLength(5);
    expect(AGENT_JOBS.find(j=>j.routineId==="D04-W01")?.designLabels).toHaveLength(2);
    expect(AGENT_JOBS.find(j=>j.routineId==="D03-W06")?.note).toContain("not referring-domain");
  });
});
