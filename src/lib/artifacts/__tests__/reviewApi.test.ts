import {describe,it,expect,vi} from "vitest";
import type {DbClient} from "../../db/types";
import {reviewApi} from "../reviewApi";
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const comment={id,output:{accountId:id,artifactId:id,outputId:id,revision:0},anchor:{kind:"whole"},text:"Shorter",intent:"change_output"};
function setup(data:unknown={commentId:id,jobId:other,duplicate:false}){
 const rpc=vi.fn().mockResolvedValue({data,error:null});
 const bind=vi.fn().mockResolvedValue({accountId:id,userId:other,contextGeneration:1,db:{rpc} as unknown as DbClient});
 return {rpc,bind,enabled:true};
}
function post(body:unknown){return new Request('https://junction.test/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
describe('review HTTP boundary (simulated dependencies)',()=>{
 it('disabled feature does no work',async()=>{const d=setup();expect((await reviewApi(post(comment),id,{...d,enabled:false})).status).toBe(503);expect(d.bind).not.toHaveBeenCalled();});
 it('persists queued revision but does not claim completed edit',async()=>{const d=setup();const r=await reviewApi(post(comment),id,d);expect(r.status).toBe(201);expect((await r.json()).status).toBe('revision_queued');expect(r.headers.get('cache-control')).toContain('no-store');});
 it('denies unauthenticated requests before RPC',async()=>{const d=setup();d.bind.mockResolvedValue(new Response(null,{status:401}));expect((await reviewApi(post(comment),id,d)).status).toBe(401);expect(d.rpc).not.toHaveBeenCalled();});
 it('rejects mismatched path or tenant',async()=>{for(const field of ['outputId','accountId']){const d=setup();expect((await reviewApi(post({...comment,output:{...comment.output,[field]:other}}),id,d)).status).toBe(404);expect(d.rpc).not.toHaveBeenCalled();}});
 it('rejects extra execution instruction',async()=>{const d=setup();expect((await reviewApi(post({...comment,send:true}),id,d)).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled();});
 it('does not return another tenant from a faulty reader',async()=>{const d=setup({output:{id,account_id:other,context_generation:1},content:'private'});const r=await reviewApi(new Request('https://junction.test'),id,d);expect(r.status).toBe(503);expect(await r.text()).not.toContain('private');});
 it('returns the authenticated current output',async()=>{const d=setup({output:{id,account_id:id,context_generation:1}});expect((await reviewApi(new Request('https://junction.test'),id,d)).status).toBe(200);});
 it('limits payload size',async()=>{const d=setup();expect((await reviewApi(post({...comment,text:'x'.repeat(25000)}),id,d)).status).toBe(400);expect(d.rpc).not.toHaveBeenCalled();});
});
