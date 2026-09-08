import { z } from "zod";
import type { DbClient } from "../db/types";
import { reviewCommentSchema } from "./reviewContract";
import { saveReviewComment } from "./reviewStore";
import { readReviewHistory } from "./reviewHistory";

export type ReviewIdentity = {accountId:string;userId:string;contextGeneration:number;db:DbClient};
type Dependencies = { enabled:boolean; bind:(request:Request)=>Promise<ReviewIdentity|Response> };
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
async function boundedJson(request:Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim()!=="application/json") throw new Error("JSON required");
  const reader=request.body?.getReader();if(!reader)throw new Error("Body required");
  let bytes=0;const chunks:Uint8Array[]=[];
  try {while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;
    if(bytes>24000){await reader.cancel();throw new Error("Body too large");}chunks.push(item.value);}
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {reader.releaseLock();}
}
export async function reviewApi(request:Request,outputId:string,deps:Dependencies) {
  if(!deps.enabled)return json({error:"Review workspace is not released yet"},503);
  if(!z.uuid().safeParse(outputId).success)return json({error:"Invalid output"},400);
  if(!["GET","POST"].includes(request.method))return json({error:"Method not allowed"},405);
  try {
    const identity=await deps.bind(request);
    if(identity instanceof Response){identity.headers.set("cache-control","private, no-store");return identity;}
    if(request.method==="GET"){
      const params=new URL(request.url).searchParams;
      if(params.has("history")||params.has("beforeRevision")){
        const cursor=params.get("beforeRevision");
        if(params.getAll("history").length!==1||params.get("history")!=="1"||params.getAll("beforeRevision").length>1||
          (cursor!==null&&(!/^(0|[1-9][0-9]*)$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))))
          return json({error:"Invalid history request"},400);
        const history=await readReviewHistory(identity,outputId,cursor===null?null:Number(cursor));
        return history?json({history}):json({error:"Review not found"},404);
      }
      const result=await identity.db.rpc("read_review_output",{acct:identity.accountId,generation:identity.contextGeneration,actor:identity.userId,output:outputId});
      if(result.error)return json({error:"Could not load this review"},result.error.code==="42501"?403:result.error.code==="40001"?409:503);
      if(!result.data)return json({error:"Review not found"},404);
      // Check identity before returning any content even if the adapter is misconfigured.
      const value=result.data as {output?:{id?:string;account_id?:string;context_generation?:number}};
      if(value.output?.id!==outputId||value.output.account_id!==identity.accountId||value.output.context_generation!==identity.contextGeneration)
        return json({error:"Could not verify review context"},503);
      return json({review:result.data});
    }
    let input:z.infer<typeof reviewCommentSchema>;
    try{input=reviewCommentSchema.parse(await boundedJson(request));}catch{return json({error:"Invalid review comment"},400);}
    if(input.output.outputId!==outputId||input.output.accountId!==identity.accountId)return json({error:"Review not found"},404);
    const saved=await saveReviewComment(identity.db,identity,input);
    return json({saved,status:saved.jobId?"revision_queued":"preference_confirmation_required"},saved.duplicate?200:201);
  }catch(error){
    return json({error:error instanceof Error&&error.message==="Output changed; reload before commenting"?error.message:"Could not complete review request"},
      error instanceof Error&&error.message==="Output changed; reload before commenting"?409:503);
  }
}
