import {describe,it,expect,vi} from "vitest";
import type {DbClient} from "../../db/types";
import {runReviewAction,type ReviewExecutionDependencies} from "../reviewExecution";
const accountId="00000000-0000-4000-8000-000000000001",proposalId="00000000-0000-4000-8000-000000000002";
const scope={accountId,proposalId,contextGeneration:1};
function setup(patch:Record<string,unknown>={}){
  const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>({error:null,data:name==="claim_review_action"?{
    proposalId,token:args.token,accountId,contextGeneration:1,outputId:proposalId,revision:2,
    action:"prepare_provider_draft",targetId:"sandbox",payload:{body:"Approved"},
    idempotencyKey:`review-action:${proposalId}`,expiresAt:new Date(Date.now()+60000).toISOString(),...patch,
  }:{proposalId,status:args.outcome,duplicate:false}}));
  const deps:ReviewExecutionDependencies={db:{rpc} as unknown as DbClient,
    binding:{accountId,action:"prepare_provider_draft",targetId:"sandbox"},authorize:vi.fn(async()=>{}),
    validate:vi.fn(async()=>{}),execute:vi.fn(async()=>({id:"draft-1"})),
    verify:vi.fn(async()=>({confirmed:true,receipt:{providerId:"draft-1",source:"synthetic"}}))};
  return {deps,rpc};
}
describe("review execution (simulated provider only)",()=>{
  it("requires exact scoped ticket and independent readback",async()=>{
    const {deps,rpc}=setup();expect(await runReviewAction(scope,deps)).toEqual({status:"succeeded"});
    expect(deps.authorize).toHaveBeenCalledTimes(2);expect(deps.execute).toHaveBeenCalledTimes(1);
    expect(deps.verify).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[1][1].outcome).toBe("succeeded");
  });
  for(const patch of [{accountId:proposalId},{contextGeneration:2},{targetId:"live-client"},{action:"send"},
    {idempotencyKey:"other"},{expiresAt:"2000-01-01T00:00:00Z"}])it(`refuses mismatched ${Object.keys(patch)[0]}`,async()=>{
    const {deps}=setup(patch);expect(await runReviewAction(scope,deps)).toEqual({status:"failed"});expect(deps.execute).not.toHaveBeenCalled();
  });
  it("does not dispatch an already claimed proposal",async()=>{
    const {deps,rpc}=setup();rpc.mockResolvedValueOnce({error:null,data:null as never});
    expect(await runReviewAction(scope,deps)).toEqual({status:"not_claimed"});expect(deps.execute).not.toHaveBeenCalled();
  });
  it("checks policy again after claim",async()=>{
    const {deps}=setup();vi.mocked(deps.authorize).mockRejectedValueOnce(new Error("paused"));
    await expect(runReviewAction(scope,deps)).rejects.toThrow("paused");expect(deps.db.rpc).not.toHaveBeenCalled();
    const next=setup();vi.mocked(next.deps.authorize).mockResolvedValueOnce().mockRejectedValueOnce(new Error("paused"));
    expect(await runReviewAction(scope,next.deps)).toEqual({status:"failed"});expect(next.deps.execute).not.toHaveBeenCalled();
  });
  it("does not assume provider failure means no mutation",async()=>{
    const {deps}=setup();vi.mocked(deps.execute).mockRejectedValue(new Error("timeout"));
    expect(await runReviewAction(scope,deps)).toEqual({status:"uncertain"});expect(deps.execute).toHaveBeenCalledTimes(1);
  });
  it("requires confirmed readback",async()=>{
    const {deps}=setup();vi.mocked(deps.verify).mockResolvedValue({confirmed:false,receipt:{}});
    expect(await runReviewAction(scope,deps)).toEqual({status:"uncertain"});
  });
  it("keeps a lost completion receipt uncertain",async()=>{
    const {deps,rpc}=setup();const original=rpc.getMockImplementation()!;
    rpc.mockImplementationOnce(original).mockRejectedValueOnce(new Error("lost"));
    expect(await runReviewAction(scope,deps)).toEqual({status:"uncertain"});expect(deps.execute).toHaveBeenCalledTimes(1);
  });
});
