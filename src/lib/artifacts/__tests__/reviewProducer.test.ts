import {describe,it,expect,vi} from "vitest";
import type {DbClient} from "../../db/types";
import {registerReviewOutput} from "../reviewProducer";
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const context={accountId:id,contextGeneration:1};
const input={output:{ref:{accountId:id,artifactId:id,outputId:id,revision:0},kind:'email',sectionIds:['hero'],durationSeconds:null},sourceRunId:id,content:{title:'Your next round',body:'Ready for your next trip?'}};
function setup(){const rpc=vi.fn().mockResolvedValue({data:{outputId:id,revision:0,duplicate:false},error:null});return {rpc,db:{rpc} as unknown as DbClient};}
describe('review producer registration (simulated RPC)',()=>{
 it('binds output to exact originating run and returns deep link',async()=>{const d=setup();const result=await registerReviewOutput(d.db,context,input);expect(result.reviewUrl).toBe(`/app/review/${id}?account=${id}`);expect(d.rpc).toHaveBeenCalledWith('register_review_output',expect.objectContaining({acct:id,generation:1,source_run:id,artifact:id,output:id}));});
 it('refuses foreign account or noninitial revision before persistence',async()=>{for(const ref of [{...input.output.ref,accountId:other},{...input.output.ref,revision:1}]){const d=setup();await expect(registerReviewOutput(d.db,context,{...input,output:{...input.output,ref}})).rejects.toThrow();expect(d.rpc).not.toHaveBeenCalled();}});
 it('does not accept an empty brief as a finished output',async()=>{const d=setup();await expect(registerReviewOutput(d.db,context,{...input,content:{title:'Still generating'}})).rejects.toThrow();expect(d.rpc).not.toHaveBeenCalled();});
 it('derives media paths and rejects caller supplied URLs',async()=>{const d=setup();const media={image:{format:'png',bytes:12,sha256:'a'.repeat(64)}};await registerReviewOutput(d.db,context,{...input,content:{title:'Email',media}});expect(d.rpc.mock.calls[0][1].payload.imagePath).toBe(`/api/review/media/${id}_image`);await expect(registerReviewOutput(d.db,context,{...input,content:{title:'Email',imagePath:'https://untrusted.example',media}})).rejects.toThrow();});
 it('rejects unknown registration receipt rather than claiming success',async()=>{const d=setup();d.rpc.mockResolvedValue({data:{outputId:other,revision:0,duplicate:false},error:null});await expect(registerReviewOutput(d.db,context,input)).rejects.toThrow();});
});
