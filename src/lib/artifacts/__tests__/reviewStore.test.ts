import { describe,it,expect,vi } from "vitest";
import type { DbClient } from "../../db/types";
import { saveReviewComment } from "../reviewStore";
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const identity={accountId:id,userId:other,contextGeneration:2};
const comment={id,output:{accountId:id,artifactId:id,outputId:id,revision:0},anchor:{kind:"whole"},text:"shorter",intent:"change_output"};
describe("review comment persistence boundary (simulated RPC)",()=>{
  it("sends the server identity and creates the durable job in one call",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{commentId:id,jobId:other,duplicate:false},error:null});
    const saved=await saveReviewComment({rpc} as unknown as DbClient,identity,comment);
    expect(saved.jobId).toBe(other);expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][1]).toMatchObject({actor:other,generation:2,expected_revision:0});
  });
  it("refuses foreign tenant before database access",async()=>{
    const rpc=vi.fn();await expect(saveReviewComment({rpc} as unknown as DbClient,identity,{...comment,output:{...comment.output,accountId:other}})).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("brand suggestion does not create a revision job",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{commentId:id,jobId:null,duplicate:false},error:null});
    await expect(saveReviewComment({rpc} as unknown as DbClient,identity,{...comment,intent:"suggest_brand_preference"})).resolves.toMatchObject({jobId:null});
  });
  it("refuses a false success response",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{commentId:id,jobId:null,duplicate:false},error:null});
    await expect(saveReviewComment({rpc} as unknown as DbClient,identity,comment)).rejects.toThrow();
  });
  it("reports stale output without leaking database error text",async()=>{
    const rpc=vi.fn().mockResolvedValue({error:{code:"40001",message:"private"}});
    await expect(saveReviewComment({rpc} as unknown as DbClient,identity,comment)).rejects.toThrow("Output changed; reload before commenting");
  });
});
