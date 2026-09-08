import {describe,it,expect,vi} from "vitest";
import type {DbClient} from "../../db/types";
import {runReviewRevision} from "../reviewRevision";
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const context={accountId:id,contextGeneration:1};
function setup(){
 const produce=vi.fn().mockResolvedValue({title:'Title',body:'Revised body'}),checkContext=vi.fn().mockResolvedValue(undefined);
 const rpc=vi.fn(async(fn:string,args?:Record<string,unknown>):Promise<{data:unknown;error:unknown}>=>{
  if(fn==='claim_review_revision')return {data:{jobId:id,token:args?.token,output:{id,account_id:id,artifact_id:id,context_generation:1,revision:0,kind:'article',section_ids:[],duration_seconds:null},content:{title:'Title',body:'Original body'},comment:{id:other,account_id:id,output_id:id,output_revision:0,anchor:{kind:'whole'},note:'Shorter',intent:'change_output'}},error:null};
  if(fn==='fail_review_revision')return {data:true,error:null};
  return {data:{outputId:id,revision:1,duplicate:false},error:null};
 });
 return {rpc,db:{rpc} as unknown as DbClient,produce,checkContext};
}
describe('revision orchestration (simulated producer and database)',()=>{
 it('claims once, produces once and commits the exact next revision',async()=>{const d=setup();expect((await runReviewRevision(context,id,d)).status).toBe('done');expect(d.produce).toHaveBeenCalledTimes(1);expect(d.rpc.mock.calls.map(c=>c[0])).toEqual(['claim_review_revision','complete_review_revision']);expect(d.rpc.mock.calls[1][1]?.payload).toEqual({title:'Title',body:'Revised body'});});
 it('does no provider work for an unclaimed job',async()=>{const d=setup();d.rpc.mockResolvedValue({data:null,error:null});expect((await runReviewRevision(context,id,d)).status).toBe('not_claimed');expect(d.produce).not.toHaveBeenCalled();});
 it('refuses paused context before claiming',async()=>{const d=setup();d.checkContext.mockRejectedValue(new Error('Paused'));await expect(runReviewRevision(context,id,d)).rejects.toThrow();expect(d.rpc).not.toHaveBeenCalled();});
 it('marks producer failure without retry or completion',async()=>{const d=setup();d.produce.mockRejectedValue(new Error('Provider timeout'));expect((await runReviewRevision(context,id,d)).status).toBe('failed');expect(d.produce).toHaveBeenCalledTimes(1);expect(d.rpc.mock.calls.map(c=>c[0])).toEqual(['claim_review_revision','fail_review_revision']);});
 it('does not mark a possibly committed revision failed after transport loss',async()=>{const d=setup();const original=d.rpc.getMockImplementation()!;d.rpc.mockImplementation(async(fn,args)=>{if(fn==='complete_review_revision')throw new Error('Lost response');return original(fn,args);});expect((await runReviewRevision(context,id,d)).status).toBe('uncertain');expect(d.rpc.mock.calls.some(c=>c[0]==='fail_review_revision')).toBe(false);});
 it('refuses media without a verified preparation adapter',async()=>{const d=setup();d.produce.mockResolvedValue({title:'Creative',media:{image:{format:'png',bytes:2,sha256:'a'.repeat(64)}}});expect((await runReviewRevision(context,id,d)).status).toBe('failed');});
});
