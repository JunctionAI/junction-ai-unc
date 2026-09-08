import {createHash} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import type {DbClient} from "../../db/types";
import {reviewMedia,boundedReviewBlob} from "../reviewMedia";
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const bytes=new Uint8Array([1,2,3,4,5]);
function setup(){
 const data={output:{id,account_id:id,context_generation:1,revision:0},version:{revision:0,content:{media:{image:{format:"png",bytes:5,sha256:createHash('sha256').update(bytes).digest('hex')}}}}};
 const rpc=vi.fn().mockResolvedValue({data,error:null});
 return {data,rpc,enabled:true,bind:vi.fn().mockResolvedValue({accountId:id,userId:other,contextGeneration:1,db:{rpc} as unknown as DbClient}),download:vi.fn().mockResolvedValue(new Blob([bytes]))};
}
function request(query=`account=${id}&generation=1&revision=0`,range?:string){return new Request(`https://junction.test/api/review/media/${id}_image?${query}`,{headers:range?{range}:{}});}
describe('private review media (simulated storage and session)',()=>{
 it('serves verified bytes from an account-scoped immutable key',async()=>{const d=setup();const r=await reviewMedia(request(),`${id}_image`,d);expect(r.status).toBe(200);expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);expect(d.download).toHaveBeenCalledWith(`${id}/1/${id}/0/image.png`,5);expect(r.headers.get('cache-control')).toContain('no-store');expect(r.headers.get('x-content-type-options')).toBe('nosniff');});
 it('cancels oversized storage streams before retaining the full object',async()=>{const cancel=vi.fn();const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(bytes);},cancel});expect(await boundedReviewBlob(stream,4)).toBeNull();expect(cancel).toHaveBeenCalled();});
 it('does no work when disabled',async()=>{const d=setup();expect((await reviewMedia(request(),`${id}_image`,{...d,enabled:false})).status).toBe(503);expect(d.bind).not.toHaveBeenCalled();});
 it('denies missing login before storage reads',async()=>{const d=setup();d.bind.mockResolvedValue(new Response(null,{status:401}));expect((await reviewMedia(request(),`${id}_image`,d)).status).toBe(401);expect(d.download).not.toHaveBeenCalled();});
 it('checks membership-selected account and current generation',async()=>{for(const query of [`account=${other}&generation=1&revision=0`,`account=${id}&generation=2&revision=0`]){const d=setup();expect((await reviewMedia(request(query),`${id}_image`,d)).status).toBe(403);expect(d.rpc).not.toHaveBeenCalled();}});
 it('refuses a stale output revision',async()=>{const d=setup();expect((await reviewMedia(request(`account=${id}&generation=1&revision=2`),`${id}_image`,d)).status).toBe(404);expect(d.download).not.toHaveBeenCalled();});
 it('refuses a cross-account result from the database adapter',async()=>{const d=setup();d.data.output.account_id=other;expect((await reviewMedia(request(),`${id}_image`,d)).status).toBe(404);expect(d.download).not.toHaveBeenCalled();});
 it('checks bytes and hash, not the storage MIME claim',async()=>{for(const body of [new Uint8Array([1]),new Uint8Array([5,4,3,2,1])]){const d=setup();d.download.mockResolvedValue(new Blob([body],{type:'image/png'}));expect((await reviewMedia(request(),`${id}_image`,d)).status).toBe(503);}});
 it('returns only the requested byte range',async()=>{const d=setup();const r=await reviewMedia(request(undefined,'bytes=1-3'),`${id}_image`,d);expect(r.status).toBe(206);expect(r.headers.get('content-range')).toBe('bytes 1-3/5');expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([2,3,4]));});
 it('supports suffix ranges and refuses invalid or multi-range requests',async()=>{const d=setup();const r=await reviewMedia(request(undefined,'bytes=-2'),`${id}_image`,d);expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([4,5]));for(const range of ['bytes=5-9','bytes=4-2','bytes=-0','bytes=0-1,3-4','bytes=-'])expect((await reviewMedia(request(undefined,range),`${id}_image`,d)).status).toBe(416);});
 it('refuses missing/duplicate selectors and traversal IDs',async()=>{const d=setup();for(const query of ['',`account=${id}&account=${id}&generation=1&revision=0`])expect((await reviewMedia(request(query),`${id}_image`,d)).status).toBe(400);expect((await reviewMedia(request(),'../secret',d)).status).toBe(400);expect(d.bind).not.toHaveBeenCalled();});
 it('does not serve a video descriptor through an image slot',async()=>{const d=setup();d.data.version.content.media.image.format='mp4';expect((await reviewMedia(request(),`${id}_image`,d)).status).toBe(404);expect(d.download).not.toHaveBeenCalled();});
});
