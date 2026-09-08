import { z } from "zod";
import type { ReviewIdentity } from "./reviewApi";

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const historySchema = z.object({
  output: z.object({ id:z.uuid(), account_id:z.uuid(), context_generation:revision, revision }),
  versions: z.array(z.object({output_id:z.uuid(),account_id:z.uuid(),revision,
    content:z.record(z.string(),z.unknown()),created_at:z.string()})).max(10),
  nextCursor:revision.nullable(),
});
/** Reject a misbound adapter before exposing any historical content. Read-only. */
export async function readReviewHistory(identity:ReviewIdentity,outputId:string,before:number|null) {
  if(before!==null)revision.parse(before);
  const result=await identity.db.rpc("read_review_history",{
    acct:identity.accountId,generation:identity.contextGeneration,actor:identity.userId,
    output:outputId,before_revision:before,
  });
  if(result.error)throw new Error("Could not load review history");
  if(result.data===null)return null;
  const value=historySchema.parse(result.data);
  if(value.output.id!==outputId||value.output.account_id!==identity.accountId||
    value.output.context_generation!==identity.contextGeneration)throw new Error("History context mismatch");
  let previous=before;
  for(const version of value.versions){
    if(version.output_id!==outputId||version.account_id!==identity.accountId||
      version.revision>value.output.revision||(previous!==null&&version.revision>=previous))
      throw new Error("History version mismatch");
    previous=version.revision;
  }
  if(value.nextCursor!==null&&(value.versions.length!==10||value.nextCursor!==previous))
    throw new Error("History cursor mismatch");
  return value;
}
