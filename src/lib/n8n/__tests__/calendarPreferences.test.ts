import { beforeEach, describe, expect, it, vi } from "vitest";
import { calendarPreferencesRequest, calendarPreferencesSave, readCalendarPreferences } from "../calendarPreferencesClient";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import type { AccountSession } from "@/lib/db/session";
const A="aa5cfc84-2569-4c99-9b40-67003ae55eda",U="74802c60-149a-4405-b719-dc058d174072";
const ctx={accountId:A,actorId:U,contextGeneration:1};
let db:FakeSupabase,session:AccountSession|Response;
vi.mock("@/lib/db/session",()=>({requireAccountOwnerSession:async()=>session}));
vi.mock("@/lib/db/runtimeContext",()=>({assertRuntimeContext:async()=>{}}));
import { GET, POST } from "@/app/api/routines/calendar-preferences/route";
const fixture=()=>({...ctx,routineId:"D05-W07",timezone:null as string|null,updatedAt:null as string|null,canEdit:true,bound:false,paused:true,executedAction:"none"});
const save={timezone:"Pacific/Auckland",expectedUpdatedAt:null};
const saved=()=>({...fixture(),timezone:save.timezone,updatedAt:"2026-09-06T00:00:00.123456+00:00"});
const req=(body?:unknown,patch:Record<string,string>={},search="")=>new Request("https://unc.test/api/routines/calendar-preferences"+search,{
  method:body===undefined?"GET":"POST",headers:{"content-type":"application/json","x-unc-account-id":A,"x-unc-context-generation":"1","x-unc-actor-id":U,...patch},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{db=new FakeSupabase();db.seed("accounts",[{id:A,context_generation:1,automation_paused:true}]);session={accountId:A,userId:U,email:null,role:"owner",db,service:db};});
describe("customer calendar timezone",()=>{
  it("accepts real IANA choices without inventing a default",()=>{
    expect(readCalendarPreferences(fixture(),ctx).timezone).toBeNull();
    for(const timezone of ["Pacific/Auckland","Australia/Sydney","America/New_York","UTC"])expect(calendarPreferencesSave.safeParse({...save,timezone}).success).toBe(true);
    for(const timezone of ["NZ time","bad/timezone"," Pacific/Auckland",""])expect(calendarPreferencesSave.safeParse({...save,timezone}).success).toBe(false);
  });
  it.each([401,403,503,200])("rejects session response %s before RPC",async status=>{
    session=Response.json({fallback:true},{status});const rpc=vi.spyOn(db,"rpc"),res=await GET(req());
    expect(res.status).toBe(status===200?503:status);expect(res.headers.get("cache-control")).toBe("private, no-store");expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{"x-unc-account-id":U},{"x-unc-context-generation":"2"},{"x-unc-actor-id":A}] as Record<string,string>[])("rejects changed browser identity %j",async headers=>{
    const rpc=vi.spyOn(db,"rpc");expect((await GET(req(undefined,headers))).status).toBe(409);expect(rpc).not.toHaveBeenCalled();
  });
  it("reads a paused owner snapshot without internal bindings or credentials",async()=>{
    const rpc=vi.spyOn(db,"rpc").mockResolvedValue({data:fixture(),error:null});const res=await GET(req());
    expect(res.status).toBe(200);expect(await res.json()).toEqual(fixture());
    expect(rpc).toHaveBeenCalledWith("calendar_customer_preferences",{input:{...ctx,operation:"read"}});
  });
  it("saves only the explicit timezone and compare-and-swap timestamp",async()=>{
    const rpc=vi.spyOn(db,"rpc").mockResolvedValue({data:saved(),error:null}),res=await POST(req(save));
    expect(res.status).toBe(200);expect(await res.json()).toEqual(saved());expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("calendar_customer_preferences",{input:{...ctx,operation:"save",...save}});
    expect(db.calls.filter(c=>c.op==="insert"||c.op==="update")).toEqual([]);
  });
  it("rejects browser recipes, credentials, missing CAS and unknown fields",async()=>{
    const rpc=vi.spyOn(db,"rpc");
    for(const body of [{timezone:"UTC"},{...save,spec:{}},{...save,credentialId:"x"},{...save,accountId:U},{...save,enabled:true}])
      expect((await POST(req(body))).status).toBe(400);
    expect((await GET(req(undefined,{},"?accountId=other"))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["PT409",409],["42501",403],["22023",400],["XX000",503]] as const)("maps %s without echoing raw errors",async(code,status)=>{
    const rpc=vi.spyOn(db,"rpc").mockResolvedValue({data:null,error:{code,message:"PRIVATE_PROVIDER_TOKEN"}});
    const res=await POST(req(save));expect(res.status).toBe(status);expect(await res.text()).not.toContain("PRIVATE_PROVIDER_TOKEN");expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects inconsistent, cross-account or internal-field responses",async()=>{
    for(const patch of [{accountId:U},{actorId:A},{contextGeneration:2},{credentialId:"x"},{timezone:"UTC"},{bound:true,canEdit:true}]) {
      expect(()=>readCalendarPreferences({...fixture(),...patch},ctx)).toThrow();
      vi.spyOn(db,"rpc").mockResolvedValue({data:{...fixture(),...patch},error:null});expect((await GET(req())).status).toBe(503);
    }
  });
  it("requires save readback to match both choice and a new timestamp",async()=>{
    for(const response of [fixture(),{...saved(),timezone:"UTC"}]) {
      vi.spyOn(db,"rpc").mockResolvedValue({data:response,error:null});expect((await POST(req(save))).status).toBe(503);
    }
    vi.spyOn(db,"rpc").mockResolvedValue({data:saved(),error:null});expect((await POST(req({...save,expectedUpdatedAt:saved().updatedAt}))).status).toBe(503);
  });
  it("client includes the account, generation and actor and never retries a lost reply",async()=>{
    const fetcher=vi.fn().mockRejectedValue(Error("lost reply"));await expect(calendarPreferencesRequest(ctx,save,fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1]).toMatchObject({method:"POST",cache:"no-store",headers:{"x-unc-actor-id":U,"x-unc-account-id":A,"x-unc-context-generation":"1"}});
  });
  it("client rejects foreign, malformed and unconfirmed save replies",async()=>{
    for(const response of [{...saved(),actorId:A},{...saved(),spec:{}},{...saved(),timezone:"UTC"}])
      await expect(calendarPreferencesRequest(ctx,save,vi.fn().mockResolvedValue(Response.json(response)))).rejects.toThrow();
    expect(await calendarPreferencesRequest(ctx,save,vi.fn().mockResolvedValue(Response.json(saved())))).toEqual(saved());
  });
});
