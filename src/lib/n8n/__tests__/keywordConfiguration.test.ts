import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { keywordPilotContract, KEYWORD_PILOT_PIN } from "../keywordAdmission";
import { keywordShadowSpec } from "../keywordShadowSpec";
import { readKeywordConfiguration } from "../keywordConfiguration";
import { keywordConfigurationRequest } from "../keywordConfigurationClient";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import type { AccountSession } from "@/lib/db/session";
const A="aa5cfc84-2569-4c99-9b40-67003ae55eda",U="74802c60-149a-4405-b719-dc058d174072";
const ctx={accountId:A,actorId:U,contextGeneration:1};
let db:FakeSupabase,session:AccountSession|Response;
vi.mock("@/lib/db/session",()=>({requireAccountOwnerSession:async()=>session}));
vi.mock("@/lib/db/runtimeContext",()=>({assertRuntimeContext:async()=>{}}));
import {GET,POST} from "@/app/api/routines/keyword-configuration/route";
function fixture() {
  const now=new Date(),contract=keywordPilotContract({authorizedBy:U,market:"US",contextGeneration:1,maxProviderCalls:1,
    approvalReference:"TEST",idempotencyKey:"TEST",expiresAt:new Date(now.getTime()+600000).toISOString()},now);
  const spec=keywordShadowSpec(contract,2);
  return {...ctx,routineId:"D03-W01",version:1,stateUpdatedAt:null,enabled:false,hasDraft:false,paused:true,spec:null as typeof spec|null,
    workflow:{id:"00000000-0000-4000-8000-000000000003",accountId:A,routineId:"D03-W01",webhookUrl:KEYWORD_PILOT_PIN.receiverUrl,active:true},
    candidates:[{market:"US",spec,sourceRunId:"00000000-0000-4000-8000-000000000004"}]};
}
const req=(body?:unknown,account=A,generation="1")=>new Request("https://unc.test/api/routines/keyword-configuration",{
  method:body===undefined?"GET":"POST",headers:{"content-type":"application/json","x-unc-account-id":account,"x-unc-context-generation":generation},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{
  db=new FakeSupabase();db.seed("accounts",[{id:A,context_generation:1,automation_paused:true}]);
  session={accountId:A,userId:U,email:null,role:"owner",db,service:db};
  vi.stubEnv("UNC_COMMANDS_ENABLED","false");
});
afterEach(()=>vi.unstubAllEnvs());
describe("reviewed keyword configuration",()=>{
  it("projects only business settings, not recipes or internal registration",()=>{
    const {view}=readKeywordConfiguration(fixture(),ctx);
    expect(view).toMatchObject({market:null,markets:["US"],paused:true,released:false});
    expect(view).not.toHaveProperty("spec");expect(view).not.toHaveProperty("workflow");expect(view).not.toHaveProperty("candidates");
  });
  it.each(["accountId","actorId","contextGeneration"] as const)("rejects another %s",field=>{
    const s=fixture();Object.assign(s,{[field]:field==="contextGeneration"?2:"00000000-0000-4000-8000-000000000009"});
    expect(()=>readKeywordConfiguration(s,ctx)).toThrow();
  });
  it("rejects malformed, mismatched and duplicate recipes",()=>{
    const s=fixture();s.candidates[0].market="NZ";expect(()=>readKeywordConfiguration(s,ctx)).toThrow();
    const t=fixture();t.candidates.push(t.candidates[0]);expect(()=>readKeywordConfiguration(t,ctx)).toThrow();
    const x=fixture();x.candidates[0].spec.nodes=[];expect(()=>readKeywordConfiguration(x,ctx)).toThrow();
  });
  it.each([401,403,503,200])("does not enter RPC for session response %s",async status=>{
    session=Response.json({fallback:true},{status});const rpc=vi.spyOn(db,"rpc");
    const response=await GET(req());expect(response.status).toBe(status===200?503:status);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses missing or mismatched captured account context",async()=>{
    const rpc=vi.spyOn(db,"rpc");expect((await GET(req(undefined,"other"))).status).toBe(409);
    expect((await GET(req(undefined,A,"2"))).status).toBe(409);expect(rpc).not.toHaveBeenCalled();
  });
  it("gets a validated paused owner snapshot",async()=>{
    const rpc=vi.spyOn(db,"rpc").mockResolvedValue({data:fixture(),error:null});
    const res=await GET(req());expect(res.status).toBe(200);expect(await res.json()).toEqual(readKeywordConfiguration(fixture(),ctx).view);
    expect(rpc).toHaveBeenCalledWith("keyword_customer_configuration",{input:{...ctx,operation:"read"}});
  });
  it("saves the server-selected recipe and original CAS without enabling or dispatching",async()=>{
    const raw=fixture(),saved={...raw,version:2,stateUpdatedAt:"2026-09-06T00:00:00.123456+00:00",spec:raw.candidates[0].spec};
    const rpc=vi.spyOn(db,"rpc").mockResolvedValueOnce({data:raw,error:null}).mockResolvedValueOnce({data:saved,error:null});
    const res=await POST(req({market:"US",version:1,stateUpdatedAt:null}));expect(res.status).toBe(200);expect((await res.json()).market).toBe("US");
    expect(rpc).toHaveBeenLastCalledWith("keyword_customer_configuration",{input:{...ctx,operation:"save",market:"US",expectedVersion:1,expectedUpdatedAt:null,spec:raw.candidates[0].spec}});
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("rejects client-supplied credentials, recipes, tenant fields and unsupported markets",async()=>{
    const rpc=vi.spyOn(db,"rpc");for(const extra of [{spec:{}},{accountId:A},{credentialId:"x"},{market:"GB"}])
      expect((await POST(req({market:"US",version:1,stateUpdatedAt:null,...extra}))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["40001","PT409"])("returns %s as a conflict for stale save without retrying",async code=>{
    const rpc=vi.spyOn(db,"rpc").mockResolvedValueOnce({data:fixture(),error:null}).mockResolvedValueOnce({data:null,error:{code,message:"stale"}});
    expect((await POST(req({market:"US",version:1,stateUpdatedAt:null}))).status).toBe(409);expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("retains old saved history without advertising it as a current executable recipe",()=>{
    const s=fixture();s.spec=structuredClone(s.candidates[0].spec);s.candidates=[];
    const node=s.spec.nodes.find(n=>n.kind==="n8n");
    if(node?.kind!=="n8n"||!node.shadowContract)throw Error("missing fixture");
    node.shadowContract.workflowVersion="92135add-3c35-43e4-9649-5bb3d4557814";
    const original=structuredClone(s.spec),{view}=readKeywordConfiguration(s,ctx);
    expect(view).toMatchObject({market:null,markets:[],released:false,paused:true});expect(s.spec).toEqual(original);
  });
  it("rejects a stale revision masquerading as a new candidate",()=>{
    const s=fixture(),node=s.candidates[0].spec.nodes.find(n=>n.kind==="n8n");
    if(node?.kind!=="n8n"||!node.shadowContract)throw Error("missing fixture");
    node.shadowContract.workflowVersion="92135add-3c35-43e4-9649-5bb3d4557814";
    expect(()=>readKeywordConfiguration(s,ctx)).toThrow("Unreviewed configuration");
  });
  it("client refuses wrong account/actor/generation and unexpected internals",async()=>{
    const {view}=readKeywordConfiguration(fixture(),ctx);
    for(const patch of [{accountId:U},{actorId:A},{contextGeneration:2},{spec:{}},{seedKeyword:"travel bag"}]) {
      const fetcher=vi.fn().mockResolvedValue(Response.json({...view,...patch}));
      await expect(keywordConfigurationRequest(ctx,undefined,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("client never retries a lost save response",async()=>{
    const fetcher=vi.fn().mockRejectedValue(Error("lost reply"));
    await expect(keywordConfigurationRequest(ctx,{market:"US",version:1,stateUpdatedAt:null},fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:"POST",headers:{"x-unc-account-id":A,"x-unc-context-generation":"1"}});
  });
});
