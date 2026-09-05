import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import type { AccountSession } from "@/lib/db/session";
import { readSlackRouteSetup, slackRouteSetupRequest } from "../slackRouteSetupClient";
const A="aa5cfc84-2569-4c99-9b40-67003ae55eda", U="74802c60-149a-4405-b719-dc058d174072", L="22ebc4cc-5592-4404-b32f-e12c7b01c1cd";
const ctx={accountId:A,actorId:U,contextGeneration:1};
let db:FakeSupabase, session:AccountSession|Response;
const stage=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/db/session",()=>({requireAccountOwnerSession:async()=>session}));
vi.mock("@/lib/db/runtimeContext",()=>({assertRuntimeContext:async()=>{}}));
vi.mock("@/lib/channels/slackRoutes",()=>({stageSlackRoute:stage}));
import {GET,POST} from "@/app/api/channels/slack/routes/route";
const identity={identityLinkId:L,identityLinkVersion:2,workspaceId:"T1",workspaceName:"Synthetic",botUserId:"UBOT",credentialStored:true};
const save={identityLinkId:L,identityLinkVersion:2,workspaceId:"T1",conversationId:"C1"};
const fixture=()=>({...ctx,paused:true,identities:[identity],routes:[] as Record<string,unknown>[],activationAvailable:false,executedAction:"none"});
const saved=()=>({...fixture(),routes:[{...save,routeId:U,revision:0,state:"staged",verifiedAt:"2026-09-06T00:00:00Z",bindingCurrent:true}]});
const request=(body?:unknown,headers:Record<string,string>={},search="")=>new Request("https://unc.test/api/channels/slack/routes"+search,{
  method:body===undefined?"GET":"POST",headers:{"content-type":"application/json","x-unc-account-id":A,"x-unc-context-generation":"1",...(body===undefined?{}:{"x-unc-actor-id":U}),...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{vi.clearAllMocks();stage.mockResolvedValue({});db=new FakeSupabase();db.seed("accounts",[{id:A,context_generation:1,automation_paused:true}]);
  session={accountId:A,userId:U,email:null,role:"owner",db,service:db};});
describe("owner-only Slack route setup",()=>{
  it.each([200,401,403,503])("session failure %s never accesses route data",async status=>{
    session=Response.json({fallback:true},{status});const rpc=vi.spyOn(db,"rpc"),res=await GET(request());
    expect(res.status).toBe(status===200?503:status);expect(res.headers.get("cache-control")).toBe("private, no-store");expect(rpc).not.toHaveBeenCalled();expect(stage).not.toHaveBeenCalled();
  });
  it("GET establishes the verified actor, returns only strict setup fields, and never verifies or sends with Slack",async()=>{
    const rpc=vi.spyOn(db,"rpc").mockResolvedValue({data:fixture(),error:null});const res=await GET(request());
    expect(res.status).toBe(200);expect(await res.json()).toEqual(fixture());expect(rpc).toHaveBeenCalledWith("slack_route_owner_view",{input:ctx});expect(stage).not.toHaveBeenCalled();
  });
  it.each([{"x-unc-account-id":U},{"x-unc-context-generation":"0"},{"x-unc-actor-id":A}] as Record<string,string>[])("rejects stale browser context %j",async headers=>{
    const rpc=vi.spyOn(db,"rpc");expect((await GET(request(undefined,headers))).status).toBe(409);expect(rpc).not.toHaveBeenCalled();expect(stage).not.toHaveBeenCalled();
  });
  it("POST requires the previously verified actor and same-origin JSON",async()=>{
    for(const [headers,status] of [[{"x-unc-actor-id":""},409],[{origin:"https://evil.test"},403],[{"sec-fetch-site":"cross-site"},403],[{"content-type":"text/plain"},415]] as [Record<string,string>,number][])
      expect((await POST(request(save,headers))).status).toBe(status);
    expect(stage).not.toHaveBeenCalled();
  });
  it("strict request refuses activation, credentials, forged authority and invalid channels before provider access",async()=>{
    for(const input of [{...save,enabled:true},{...save,accountId:U},{...save,actorId:A},{...save,token:"PRIVATE"},{...save,conversationId:"D1"},{...save,identityLinkVersion:-1}])
      expect((await POST(request(input))).status).toBe(400);
    expect((await GET(request(undefined,{},"?accountId=other"))).status).toBe(400);expect(stage).not.toHaveBeenCalled();
  });
  it("stages with server authority, then confirms a fresh matching readback",async()=>{
    const rpc=vi.spyOn(db,"rpc").mockResolvedValue({data:saved(),error:null});const res=await POST(request(save,{origin:"https://unc.test"}));
    expect(res.status).toBe(200);expect(await res.json()).toEqual(saved());expect(stage).toHaveBeenCalledExactlyOnceWith(expect.any(Object),{...save,...ctx});
    expect(rpc).toHaveBeenCalledWith("slack_route_owner_view",{input:ctx});
  });
  it("failed or foreign readback never reports a confirmed save",async()=>{
    for(const value of [fixture(),{...saved(),actorId:A},{...saved(),secret:"PRIVATE"},{...saved(),routes:[{...saved().routes[0],bindingCurrent:false}]}]) {
      vi.spyOn(db,"rpc").mockResolvedValue({data:value,error:null});expect((await POST(request(save))).status).toBe(503);
    }
  });
  it("provider and database errors cannot leak credentials; missing scopes have an actionable local code",async()=>{
    stage.mockRejectedValue(Error("PRIVATE_PROVIDER_TOKEN"));const res=await POST(request(save));expect(res.status).toBe(503);expect(await res.text()).not.toContain("PRIVATE_PROVIDER_TOKEN");
    stage.mockRejectedValue(Error("Slack connection needs channel metadata read access; reconnect with channels:read/groups:read"));
    expect(await (await POST(request(save))).json()).toMatchObject({code:"slack_metadata_scope_required"});
  });
  it("browser captures actor from read, requires it on writes and never retries an ambiguous save",async()=>{
    expect(await slackRouteSetupRequest({accountId:A,contextGeneration:1},undefined,vi.fn().mockResolvedValue(Response.json(fixture())))).toEqual(fixture());
    const fetcher=vi.fn().mockRejectedValue(Error("lost reply"));
    await expect(slackRouteSetupRequest({accountId:A,contextGeneration:1},save,fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
    await expect(slackRouteSetupRequest(ctx,save,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:"POST",cache:"no-store",headers:{"x-unc-actor-id":U,"x-unc-account-id":A,"x-unc-context-generation":"1"}});
  });
  it("rejects inconsistent wire claims, duplicates, unknown fields and wrong staged channel",async()=>{
    for(const patch of [{accountId:U},{actorId:A},{contextGeneration:2},{activationAvailable:true},{credential:"PRIVATE"},{identities:[identity,identity]}])
      expect(()=>readSlackRouteSetup({...fixture(),...patch},ctx)).toThrow();
    await expect(slackRouteSetupRequest(ctx,save,vi.fn().mockResolvedValue(Response.json(fixture())))).rejects.toThrow();
    expect(await slackRouteSetupRequest(ctx,save,vi.fn().mockResolvedValue(Response.json(saved())))).toEqual(saved());
  });
});
