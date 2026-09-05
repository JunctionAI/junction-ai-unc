import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { slackCutoverApproval, transitionSlackRoute } from "../slackRouteLifecycle";
import { confirmStagedRoute, slackRouteTransition } from "../slackRouteSetupClient";
const A="aa5cfc84-2569-4c99-9b40-67003ae55eda",U="74802c60-149a-4405-b719-dc058d174072",L="22ebc4cc-5592-4404-b32f-e12c7b01c1cd",R="44ebc4cc-5592-4404-b32f-e12c7b01c1cd";
const now=new Date("2026-09-06T00:00:00Z"),ctx={accountId:A,actorId:U,contextGeneration:1};
const change={routeId:R,revision:2,action:"activate" as const};
const pin={...ctx,routeId:R,revision:2,workspaceId:"T1",conversationId:"C1",botUserId:"UBOT",expiresAt:"2026-09-06T00:10:00Z",reference:"synthetic-cutover",previousResponderStopped:true};
const route={routeId:R,revision:2,workspaceId:"T1",conversationId:"C1",identityLinkId:L,identityLinkVersion:0,state:"staged" as const,verifiedAt:now.toISOString(),bindingCurrent:true};
const view=()=>({...ctx,paused:false,identities:[{identityLinkId:L,identityLinkVersion:0,workspaceId:"T1",workspaceName:"Synthetic",botUserId:"UBOT",credentialStored:true}],
  routes:[route],activationAvailable:false as const,executedAction:"none" as const});
const env=(patch={})=>({UNC_SLACK_ROUTE_ACTIVATION_ENABLED:"true",UNC_SLACK_ROUTE_ACTIVATION_SCOPE:JSON.stringify({...pin,...patch})});
function setup(){
  const db=new FakeSupabase();db.seed("channel_secrets",[{channel:"slack",scope_id:"T1",updated_at:now.toISOString()}]);
  const rpc=vi.spyOn(db,"rpc").mockImplementation(async name=>({data:name==="slack_route_owner_view"?view():{id:R,account_id:A,revision:3,state:"active"},error:null}));
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({ok:true,team_id:"T1",user_id:"UBOT",bot_id:"B1"}))
    .mockResolvedValueOnce(Response.json({ok:true,channel:{id:"C1",is_member:true,is_archived:false,is_shared:false}}));
  const tokenFor=vi.fn().mockResolvedValue("synthetic-token");return {db,rpc,fetch,tokenFor,now:()=>now,env:env()};
}
describe("Slack route cutover lifecycle",()=>{
  it.each([{}, {UNC_SLACK_ROUTE_ACTIVATION_ENABLED:"false"}, {UNC_MESSAGING_ENABLED:"true"}, {...env(),UNC_SLACK_ROUTE_ACTIVATION_SCOPE:"{"}])("off/missing/malformed scope refuses before provider or DB access",async config=>{
    const d=setup();d.env=config as typeof d.env;await expect(transitionSlackRoute(d,ctx,change)).rejects.toThrow();expect(d.rpc).not.toHaveBeenCalled();expect(d.tokenFor).not.toHaveBeenCalled();expect(d.fetch).not.toHaveBeenCalled();
  });
  it.each([{accountId:U},{actorId:A},{contextGeneration:0},{routeId:L},{revision:1},{expiresAt:"2026-09-05T23:59:59Z"},
    {expiresAt:"2026-09-06T01:00:01Z"},{previousResponderStopped:false},{reference:""},{secret:"PRIVATE"}])("rejects scope mismatch %j",patch=>{
    expect(()=>slackCutoverApproval(env(patch),ctx,change,now)).toThrow();
  });
  it("uses exact owner readback and bounded provider reads, pins credential timestamp, then commits once",async()=>{
    const d=setup();await transitionSlackRoute(d,ctx,change);expect(d.fetch).toHaveBeenCalledTimes(2);
    expect(d.fetch.mock.calls[0][1]).toMatchObject({method:"POST",redirect:"error",signal:expect.any(AbortSignal)});
    expect(d.rpc).toHaveBeenLastCalledWith("transition_slack_conversation_route",{input:{...ctx,...change},approval:pin,evidence:{workspaceId:"T1",conversationId:"C1",botUserId:"UBOT",isMember:true,isArchived:false,isShared:false,verifiedAt:now.toISOString(),credentialUpdatedAt:now.toISOString()}});
  });
  it.each([{paused:true},{routes:[{...route,revision:1}]},{routes:[{...route,bindingCurrent:false}]},{identities:[]}])("changed account/binding refuses before reading provider %j",patch=>{
    const d=setup();d.rpc.mockResolvedValue({data:{...view(),...patch},error:null});
    return expect(transitionSlackRoute(d,ctx,change)).rejects.toThrow().then(()=>expect(d.fetch).not.toHaveBeenCalled());
  });
  it("rejects a different approved workspace or bot before token access",async()=>{
    for(const patch of [{workspaceId:"T2"},{conversationId:"C2"},{botUserId:"UOTHER"}]){const d=setup();d.env=env(patch);
      await expect(transitionSlackRoute(d,ctx,change)).rejects.toThrow();expect(d.tokenFor).not.toHaveBeenCalled();}
  });
  it("failed provider verification never commits; uncertain commits never retry",async()=>{
    const d=setup();d.fetch.mockReset().mockRejectedValue(Error("timeout"));
    await expect(transitionSlackRoute(d,ctx,change)).rejects.toThrow();expect(d.rpc).toHaveBeenCalledTimes(1);
    const lost=setup();lost.rpc.mockResolvedValueOnce({data:view(),error:null}).mockRejectedValue(Error("lost commit response"));
    await expect(transitionSlackRoute(lost,ctx,change)).rejects.toThrow();expect(lost.rpc).toHaveBeenCalledTimes(2);expect(lost.fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["pause","revoke"] as const)("%s requires no provider credentials or activation scope",async action=>{
    const d=setup();d.env={} as typeof d.env;d.rpc.mockResolvedValue({data:{id:R,account_id:A,revision:3,state:action==="pause"?"staged":"revoked"},error:null});
    await transitionSlackRoute(d,ctx,{...change,action});expect(d.fetch).not.toHaveBeenCalled();expect(d.tokenFor).not.toHaveBeenCalled();
    expect(d.rpc).toHaveBeenCalledExactlyOnceWith("transition_slack_conversation_route",{input:{...ctx,...change,action},approval:null,evidence:null});
  });
  it("browser never supplies approval and only reports matching readback",async()=>{
    const paused={...view(),routes:[{...route,revision:3}]},fetcher=vi.fn().mockResolvedValue(Response.json(paused));
    expect(await slackRouteTransition(ctx,{...change,action:"pause"},fetcher)).toEqual(paused);
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:"PATCH",headers:{"x-unc-actor-id":U}});
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({...change,action:"pause"});
    const failed=vi.fn().mockRejectedValue(Error("lost reply"));await expect(slackRouteTransition(ctx,change,failed)).rejects.toThrow();expect(failed).toHaveBeenCalledTimes(1);
    await expect(slackRouteTransition(ctx,change,vi.fn().mockResolvedValue(Response.json(view())))).rejects.toThrow();
  });
  it("new staged mapping can coexist with immutable retired history",()=>{
    expect(()=>confirmStagedRoute({...view(),routes:[{...route,routeId:U,state:"revoked"},route]},
      {identityLinkId:L,identityLinkVersion:0,workspaceId:"T1",conversationId:"C1"})).not.toThrow();
  });
});
