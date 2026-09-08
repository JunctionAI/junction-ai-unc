import {describe,it,expect,vi} from 'vitest';
import type {DbClient} from '../../db/types';
import {reviewApi} from '../reviewApi';
import {reviewActionState,reviewActionsSchema} from '../reviewActions';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const decision={operation:'decide_action',proposalId:other,revision:1,decision:'approved'};
function setup(data:unknown={proposalId:other,revision:1,status:'approved',duplicate:false,executed:false}){
 const rpc=vi.fn().mockResolvedValue({data,error:null});
 const bind=vi.fn().mockResolvedValue({accountId:id,userId:other,contextGeneration:1,db:{rpc} as unknown as DbClient});
 return {rpc,bind,enabled:true};
}
const post=(body:unknown)=>new Request('https://junction.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
describe('review action HTTP boundary (simulated RPC)',()=>{
 it('records exact version decision without executing',async()=>{const d=setup();const r=await reviewApi(post(decision),id,d);expect(r.status).toBe(200);expect((await r.json()).saved.executed).toBe(false);expect(d.rpc).toHaveBeenCalledTimes(1);expect(d.rpc).toHaveBeenCalledWith('decide_review_action',{acct:id,generation:1,actor:other,output:id,expected_revision:1,proposal:other,decision:'approved'});});
 it('refuses browser attempts to replace actor, payload or target',async()=>{for(const key of ['actor','action_payload','targetId']){const d=setup();expect((await reviewApi(post({...decision,[key]:'replacement'}),id,d)).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled();}});
 it('maps owner and stale-version refusal',async()=>{for(const [code,status] of [['42501',403],['40001',409]]){const d=setup();d.rpc.mockResolvedValue({data:null,error:{code}});expect((await reviewApi(post(decision),id,d)).status).toBe(status);}});
 it('does not accept a false execution claim or mismatched receipt',async()=>{for(const data of [{proposalId:id,revision:1,status:'approved',duplicate:false,executed:false},{proposalId:other,revision:1,status:'approved',duplicate:false,executed:true}]){expect((await reviewApi(post(decision),id,setup(data))).status).toBe(503);}});
 it('does not expose another account actions',async()=>{const d=setup({output:{id,account_id:other,context_generation:1,revision:1},canDecide:true,actions:[]});expect((await reviewApi(new Request('https://junction.test?actions=1'),id,d)).status).toBe(503);});
 it('rejects ambiguous action/history query',async()=>{const d=setup();expect((await reviewApi(new Request('https://junction.test?actions=1&history=1'),id,d)).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled();});
 it('hides cancellation after dispatch, including superseded approvals',()=>{
  for(const status of ['dispatching','succeeded','failed','uncertain'] as const){
   const a=reviewActionsSchema.parse({output:{id,account_id:id,context_generation:1,revision:1},canDecide:true,actions:[{
    id:other,revision:0,action:'send',targetId:'sandbox',description:'test',expiresAt:'2099',status:'approved',effectiveStatus:'superseded',
    execution:{status,startedAt:'now',completedAt:status==='dispatching'?null:'later'},
   }]}).actions[0];
   expect(reviewActionState(a)).toMatchObject({canApprove:false,canWithdraw:false});
   if(status==='uncertain')expect(reviewActionState(a).message).toContain('Do not repeat');
  }
 });
 it('does not enable decisions when an older response omits execution status',()=>{
  const a=reviewActionsSchema.parse({output:{id,account_id:id,context_generation:1,revision:1},canDecide:true,actions:[{
   id:other,revision:1,action:'send',targetId:'sandbox',description:'test',expiresAt:'2099',status:'approved',effectiveStatus:'approved',
  }]}).actions[0];
  expect(reviewActionState(a)).toMatchObject({canApprove:false,canWithdraw:false});
  expect(reviewActionState({...a,execution:null}).canWithdraw).toBe(true);
 });
 it('rejects inconsistent execution state from storage',async()=>{
  for(const [status,completedAt] of [['dispatching','later'],['succeeded',null]]){
   const d=setup({output:{id,account_id:id,context_generation:1,revision:1},canDecide:true,actions:[{
    id:other,revision:1,action:'send',targetId:'sandbox',description:'test',expiresAt:'2099',status:'approved',effectiveStatus:'approved',
    execution:{status,startedAt:'now',completedAt},
   }]});
   expect((await reviewApi(new Request('https://junction.test?actions=1'),id,d)).status).toBe(503);
  }
 });
});
