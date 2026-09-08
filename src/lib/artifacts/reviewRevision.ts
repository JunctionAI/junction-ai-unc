import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {DbClient} from "../db/types";
import {reviewOutputSchema,reviewCommentSchema,type ReviewOutput,type ReviewComment} from "./reviewContract";
import {reviewContentSchema} from "./reviewProducer";

type Content=z.infer<typeof reviewContentSchema>;
export type RevisionInput={output:ReviewOutput;comment:ReviewComment;content:Content};
type Context={accountId:string;contextGeneration:number};
type Dependencies={
  db:DbClient;
  checkContext:(context:Context)=>Promise<void>;
  produce:(input:RevisionInput)=>Promise<unknown>;
  /** Copies/uploads every media slot to the next immutable revision and verifies it. */
  prepareMedia?:(output:ReviewOutput,content:Content)=>Promise<void>;
};

/** No automatic retries. A transport failure after completion submission is uncertain,
 * not failed: reconcile the stored job before any new paid work. */
export async function runReviewRevision(context:Context,jobId:string,deps:Dependencies){
  z.uuid().parse(jobId);z.uuid().parse(context.accountId);z.number().int().nonnegative().parse(context.contextGeneration);
  await deps.checkContext(context);
  const token=randomUUID();
  const claimed=await deps.db.rpc("claim_review_revision",{acct:context.accountId,generation:context.contextGeneration,job:jobId,token});
  if(claimed.error)throw new Error("Revision claim failed");
  if(!claimed.data)return {status:"not_claimed" as const};
  let output:ReviewOutput;let content:Content;
  try{
    const raw=z.object({jobId:z.literal(jobId),token:z.literal(token),output:z.object({id:z.uuid(),account_id:z.literal(context.accountId),artifact_id:z.uuid(),context_generation:z.literal(context.contextGeneration),revision:z.number(),kind:z.string(),section_ids:z.array(z.string()),duration_seconds:z.number().nullable()}),content:z.record(z.string(),z.unknown()),comment:z.object({id:z.uuid(),account_id:z.literal(context.accountId),output_id:z.uuid(),output_revision:z.number(),anchor:z.unknown(),note:z.string(),intent:z.literal("change_output")})}).parse(claimed.data);
    output=reviewOutputSchema.parse({ref:{accountId:raw.output.account_id,artifactId:raw.output.artifact_id,outputId:raw.output.id,revision:raw.output.revision},kind:raw.output.kind,sectionIds:raw.output.section_ids,durationSeconds:raw.output.duration_seconds});
    if(raw.comment.output_id!==output.ref.outputId||raw.comment.output_revision!==output.ref.revision)throw new Error("Comment version mismatch");
    const comment=reviewCommentSchema.parse({id:raw.comment.id,output:output.ref,anchor:raw.comment.anchor,text:raw.comment.note,intent:raw.comment.intent});
    const original=reviewContentSchema.parse({title:raw.content.title,body:raw.content.body,media:raw.content.media});
    await deps.checkContext(context);
    content=reviewContentSchema.parse(await deps.produce({output,comment,content:original}));
    // Never silently turn an image/email/video revision into text-only output.
    if(original.media?.image&&!content.media?.image||original.media?.video&&!content.media?.video)throw new Error("Media slot lost");
    if(content.media?.image||content.media?.video){
      if(!deps.prepareMedia)throw new Error("Media preparation unavailable");
      await deps.checkContext(context);
      await deps.prepareMedia({...output,ref:{...output.ref,revision:output.ref.revision+1}},content);
    }
    await deps.checkContext(context);
  }catch{
    try{const failed=await deps.db.rpc("fail_review_revision",{acct:context.accountId,generation:context.contextGeneration,job:jobId,token});
      return {status:failed.error||failed.data!==true?"uncertain" as const:"failed" as const};
    }catch{return {status:"uncertain" as const};}
  }
  const payload={...content,...(content.media?.image?{imagePath:`/api/review/media/${output.ref.outputId}_image`}:{}),...(content.media?.video?{videoPath:`/api/review/media/${output.ref.outputId}_video`}:{})};
  try{
    const result=await deps.db.rpc("complete_review_revision",{acct:context.accountId,generation:context.contextGeneration,job:jobId,token,payload});
    if(result.error)return {status:"uncertain" as const};
    if(result.data===null)return {status:"superseded" as const};
    const receipt=z.object({outputId:z.literal(output.ref.outputId),revision:z.literal(output.ref.revision+1),duplicate:z.boolean()}).strict().parse(result.data);
    return {status:"done" as const,...receipt};
  }catch{return {status:"uncertain" as const};}
}
