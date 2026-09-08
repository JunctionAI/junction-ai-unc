import {z} from "zod";
import type {DbClient} from "../db/types";
import {reviewOutputSchema} from "./reviewContract";
import {reviewMediaDescriptor} from "./reviewMedia";

export const reviewContentSchema=z.object({
  title:z.string().trim().min(1).max(300),
  body:z.string().trim().min(1).max(100000).optional(),
  media:z.object({image:reviewMediaDescriptor.optional(),video:reviewMediaDescriptor.optional()}).strict().optional(),
}).strict().superRefine((content,ctx)=>{
  if(!content.body&&!content.media?.image&&!content.media?.video)ctx.addIssue({code:"custom",message:"Finished content required"});
  if(content.media?.image?.format==="mp4"||content.media?.video&&content.media.video.format!=="mp4")ctx.addIssue({code:"custom",message:"Wrong media format"});
});
export const reviewRegistrationSchema=z.object({
  output:reviewOutputSchema,sourceRunId:z.uuid(),content:reviewContentSchema,
}).strict();

/** Internal adapter, not a browser endpoint. Producers retain a stable output ID
 * across retries. Upload and verify private immutable media before calling this. */
export async function registerReviewOutput(db:DbClient,context:{accountId:string;contextGeneration:number},input:unknown){
  const {output,content,sourceRunId}=reviewRegistrationSchema.parse(input);
  if(output.ref.accountId!==context.accountId||output.ref.revision!==0)throw new Error("Invalid registration context");
  const payload={...content,
    ...(content.media?.image?{imagePath:`/api/review/media/${output.ref.outputId}_image`}:{}),
    ...(content.media?.video?{videoPath:`/api/review/media/${output.ref.outputId}_video`}:{}),
  };
  const result=await db.rpc("register_review_output",{
    acct:context.accountId,generation:context.contextGeneration,source_run:sourceRunId,
    artifact:output.ref.artifactId,output:output.ref.outputId,output_kind:output.kind,
    sections:output.sectionIds,duration:output.durationSeconds,payload,
  });
  if(result.error)throw new Error(result.error.code==="40001"?"Output registration conflicts with current state":"Output registration failed");
  const receipt=z.object({outputId:z.literal(output.ref.outputId),revision:z.literal(0),duplicate:z.boolean()}).strict().parse(result.data);
  return {...receipt,reviewUrl:`/app/review/${receipt.outputId}?account=${encodeURIComponent(context.accountId)}`};
}
