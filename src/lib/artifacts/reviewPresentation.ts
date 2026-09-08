import { z } from "zod";
import { anchorSchema } from "./reviewContract";
// Only server-proxied assets. Never load arbitrary provider URLs or execute generated HTML.
const mediaPath=z.string().regex(/^\/api\/review\/media\/[a-zA-Z0-9_-]+$/);
export const reviewContentSchema=z.object({title:z.string().max(300).optional(),body:z.string().max(100000).optional(),imagePath:mediaPath.optional(),videoPath:mediaPath.optional()});
export const reviewPresentationSchema=z.object({
  output:z.object({id:z.uuid(),account_id:z.uuid(),artifact_id:z.uuid(),context_generation:z.number().int().nonnegative(),revision:z.number().int().nonnegative(),kind:z.string(),section_ids:z.array(z.string()),duration_seconds:z.number().nullable()}),
  version:z.object({revision:z.number().int().nonnegative(),content:reviewContentSchema}),
  comments:z.array(z.object({id:z.uuid(),output_revision:z.number().int(),note:z.string(),intent:z.string(),anchor:anchorSchema})),
  jobs:z.array(z.object({id:z.uuid(),base_revision:z.number().int(),status:z.enum(["queued","running","done","failed","superseded"])})),
}).superRefine((value,ctx)=>{
  if(value.version.revision!==value.output.revision)ctx.addIssue({code:"custom",message:"Version mismatch"});
  for(const slot of ["image","video"] as const){const path=value.version.content[`${slot}Path`];
    if(path&&path!==`/api/review/media/${value.output.id}_${slot}`)ctx.addIssue({code:"custom",message:"Media output mismatch"});}
});
export type ReviewPresentation=z.infer<typeof reviewPresentationSchema>;
export const historyPresentationSchema=z.object({
  output:z.object({id:z.uuid(),account_id:z.uuid(),context_generation:z.number().int().nonnegative(),revision:z.number().int().nonnegative()}),
  versions:z.array(z.object({output_id:z.uuid(),account_id:z.uuid(),revision:z.number().int().nonnegative(),content:reviewContentSchema,created_at:z.string()})).max(10),
  nextCursor:z.number().int().nonnegative().nullable(),
});
export function parseReviewHistory(input:unknown,current:ReviewPresentation,before:number|null){
  const parsed=historyPresentationSchema.parse(input);
  if(parsed.output.id!==current.output.id||parsed.output.account_id!==current.output.account_id||
    parsed.output.context_generation!==current.output.context_generation||parsed.output.revision!==current.output.revision)
    throw new Error("The current version changed. Refresh before comparing.");
  let previous=before;
  for(const v of parsed.versions){
    if(v.output_id!==current.output.id||v.account_id!==current.output.account_id||v.revision>current.output.revision||
      (previous!==null&&v.revision>=previous))throw new Error("History could not be verified.");
    reviewPresentationSchema.parse({...current,output:{...current.output,revision:v.revision},version:v});
    previous=v.revision;
  }
  if(parsed.nextCursor!==null&&(parsed.versions.length!==10||parsed.nextCursor!==previous))throw new Error("History cursor could not be verified.");
  return parsed;
}
export function reviewMediaUrl(path:string,review:ReviewPresentation){
  return `${path}?${new URLSearchParams({account:review.output.account_id,generation:String(review.output.context_generation),revision:String(review.output.revision)})}`;
}
export function imageAnchor(clientX:number,clientY:number,rect:{left:number;top:number;width:number;height:number}) {
  if(![clientX,clientY,rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)throw new Error("Image not ready");
  return {kind:"visual" as const,x:Math.max(0,Math.min(1,(clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(clientY-rect.top)/rect.height))};
}
