import {describe,it,expect,vi} from 'vitest';
import type {DbClient} from '../../db/types';
import {reconcileReviewAction} from '../reviewReconciliation';
const id='00000000-0000-4000-8000-000000000001',p='00000000-0000-4000-8000-000000000002';
const scope={accountId:id,proposalId:p,contextGeneration:0};
function setup(patch:Record<string,unknown>={}){
 const rpc=vi.fn().mockResolvedValueOnce({error:null,data:{proposalId:p,accountId:id,contextGeneration:0,outputId:p,revision:0,
  action:'send',targetId:'sandbox',payload:{body:'approved'},idempotencyKey:`review-action:${p}`,status:'uncertain',receipt:{reason:'timeout'},...patch}})
  .mockResolvedValue({error:null,data:{proposalId:p,status:'succeeded',duplicate:false}});
 const deps={db:{rpc} as unknown as DbClient,binding:{accountId:id,action:'send' as const,targetId:'sandbox'},
  authorizeRead:vi.fn(async()=>{}),verifyReadOnly:vi.fn(async()=>({confirmed:true,evidence:{providerId:'fixture',exact:true}}))};
 return {rpc,deps};
}
describe('read-only reconciliation (simulated provider)',()=>{
 it('resolves only confirmed exact-target readback',async()=>{
  const {rpc,deps}=setup();expect(await reconcileReviewAction(scope,deps)).toEqual({status:'succeeded'});
  expect(rpc.mock.calls.map(x=>x[0])).toEqual(['read_review_action_attempt','reconcile_review_action_success']);
  expect(deps.verifyReadOnly).toHaveBeenCalledTimes(1);
 });
 it('leaves negative or delayed results uncertain without a write',async()=>{
  const {rpc,deps}=setup();deps.verifyReadOnly.mockResolvedValue({confirmed:false,evidence:{providerId:'fixture',exact:false}});
  expect(await reconcileReviewAction(scope,deps)).toEqual({status:'uncertain'});expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('never retries when provider read fails',async()=>{
  const {rpc,deps}=setup();deps.verifyReadOnly.mockRejectedValue(new Error('timeout'));
  expect(await reconcileReviewAction(scope,deps)).toEqual({status:'uncertain'});expect(rpc).toHaveBeenCalledTimes(1);
 });
 for(const patch of [{accountId:p},{targetId:'wrong'},{action:'change_ads'},{contextGeneration:1}])it('refuses foreign scope '+JSON.stringify(patch),async()=>{
  const {deps}=setup(patch);await expect(reconcileReviewAction(scope,deps)).rejects.toThrow('scope mismatch');expect(deps.verifyReadOnly).not.toHaveBeenCalled();
 });
 it('returns existing terminal outcomes without provider work',async()=>{
  for(const status of ['succeeded','failed']){const {deps}=setup({status});expect(await reconcileReviewAction(scope,deps)).toEqual({status});expect(deps.verifyReadOnly).not.toHaveBeenCalled();}
 });
 it('lost persistence response stays uncertain',async()=>{
  const {rpc,deps}=setup();rpc.mockResolvedValueOnce({error:{code:'timeout'},data:null});
  expect(await reconcileReviewAction(scope,deps)).toEqual({status:'uncertain'});
 });
});
