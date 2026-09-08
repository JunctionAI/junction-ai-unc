import {describe,it,expect,vi} from "vitest";
import type {DbClient} from "../../db/types";
import {readReviewHistory} from "../reviewHistory";
import {reviewApi} from "../reviewApi";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
const version=(revision:number)=>({output_id:a,account_id:a,revision,content:{body:`Version ${revision}`},created_at:"2026-09-09T00:00:00Z"});
function setup(data:unknown={output:{id:a,account_id:a,context_generation:1,revision:1},versions:[version(1),version(0)],nextCursor:null}){
 const rpc=vi.fn().mockResolvedValue({data,error:null});
 const identity={accountId:a,userId:b,contextGeneration:1,db:{rpc} as unknown as DbClient};
 return {rpc,identity,enabled:true,bind:vi.fn().mockResolvedValue(identity)};
}
describe("review history boundary (simulated RPC)",()=>{
 it("returns ordered versions without an execution or write call",async()=>{
  const d=setup();const value=await readReviewHistory(d.identity,a,null);
  expect(value?.versions.map(v=>v.revision)).toEqual([1,0]);expect(d.rpc).toHaveBeenCalledTimes(1);
  expect(d.rpc).toHaveBeenCalledWith("read_review_history",{acct:a,generation:1,actor:b,output:a,before_revision:null});
 });
 it("rejects foreign tenant, output, generation, unordered and future versions",async()=>{
  const base={output:{id:a,account_id:a,context_generation:1,revision:1},versions:[version(1),version(0)],nextCursor:null};
  for(const data of [
   {...base,output:{...base.output,account_id:b}}, {...base,output:{...base.output,context_generation:2}},
   {...base,versions:[{...version(1),account_id:b}]},{...base,versions:[{...version(1),output_id:b}]},
   {...base,versions:[version(0),version(1)]},{...base,versions:[version(2)]},
   {...base,nextCursor:0},
  ]){const d=setup(data);await expect(readReviewHistory(d.identity,a,null)).rejects.toThrow();}
 });
 it("checks exclusive cursor and page continuation",async()=>{
  const d=setup({output:{id:a,account_id:a,context_generation:1,revision:12},
   versions:Array.from({length:10},(_,i)=>version(11-i)),nextCursor:2});
  expect((await readReviewHistory(d.identity,a,12))?.nextCursor).toBe(2);
  await expect(readReviewHistory(d.identity,a,11)).rejects.toThrow();
 });
 it("validates query once and does not call RPC on invalid cursors",async()=>{
  for(const query of ["history=0","beforeRevision=1","history=1&history=1","history=1&beforeRevision=-1",
   "history=1&beforeRevision=01","history=1&beforeRevision=1&beforeRevision=2","history=1&beforeRevision=9007199254740992"]){
   const d=setup();expect((await reviewApi(new Request(`https://junction.test?${query}`),a,d)).status).toBe(400);
   expect(d.rpc).not.toHaveBeenCalled();
  }
 });
 it("serves history behind the existing session boundary with no-store",async()=>{
  const d=setup();const r=await reviewApi(new Request("https://junction.test?history=1"),a,d);
  expect(r.status).toBe(200);expect((await r.json()).history.versions).toHaveLength(2);
  expect(r.headers.get("cache-control")).toContain("no-store");
 });
 it("returns 404 for missing output and refuses unauthenticated access",async()=>{
  const d=setup(null);expect((await reviewApi(new Request("https://junction.test?history=1"),a,d)).status).toBe(404);
  d.rpc.mockClear();d.bind.mockResolvedValue(new Response(null,{status:401}) as never);
  expect((await reviewApi(new Request("https://junction.test?history=1"),a,d)).status).toBe(401);
  expect(d.rpc).not.toHaveBeenCalled();
 });
});
