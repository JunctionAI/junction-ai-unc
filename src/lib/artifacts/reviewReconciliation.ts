import {z} from "zod";
import type {DbClient} from "../db/types";
const attemptSchema=z.object({proposalId:z.uuid(),accountId:z.uuid(),contextGeneration:z.number().int().nonnegative(),
 outputId:z.uuid(),revision:z.number().int().nonnegative(),action:z.enum(["prepare_provider_draft","send","publish","change_ads"]),
 targetId:z.string().min(1),payload:z.record(z.string(),z.unknown()),idempotencyKey:z.string(),
 status:z.enum(["dispatching","succeeded","failed","uncertain"]),receipt:z.record(z.string(),z.unknown()).nullable()}).strict();
export type ReviewAttempt=z.infer<typeof attemptSchema>;
type Scope={accountId:string;contextGeneration:number;proposalId:string};
type Dependencies={db:DbClient;binding:{accountId:string;action:ReviewAttempt["action"];targetId:string};
 authorizeRead:(scope:Scope)=>Promise<void>;
 /** Read-only provider method, must bind object, target and exact approved payload.
  * No send/publish/mutation method is supplied to this reconciler. */
 verifyReadOnly:(attempt:ReviewAttempt)=>Promise<{confirmed:boolean;evidence:Record<string,unknown>}>};
export async function reconcileReviewAction(scope:Scope,deps:Dependencies){
 z.uuid().parse(scope.accountId);z.uuid().parse(scope.proposalId);z.number().int().nonnegative().parse(scope.contextGeneration);
 if(scope.accountId!==deps.binding.accountId)throw new Error("Reconciliation binding mismatch");
 await deps.authorizeRead(scope);
 const args={acct:scope.accountId,generation:scope.contextGeneration,proposal:scope.proposalId};
 const read=await deps.db.rpc("read_review_action_attempt",args);
 if(read.error)throw new Error("Attempt read unavailable");
 if(!read.data)return {status:"not_found" as const};
 const attempt=attemptSchema.parse(read.data);
 if(attempt.accountId!==scope.accountId||attempt.contextGeneration!==scope.contextGeneration||attempt.proposalId!==scope.proposalId||
  attempt.action!==deps.binding.action||attempt.targetId!==deps.binding.targetId||attempt.idempotencyKey!==`review-action:${scope.proposalId}`)
  throw new Error("Attempt scope mismatch");
 if(attempt.status==="succeeded"||attempt.status==="failed")return {status:attempt.status};
 try{
  await deps.authorizeRead(scope);
  const verified=z.object({confirmed:z.boolean(),evidence:z.record(z.string(),z.unknown())}).strict().parse(await deps.verifyReadOnly(attempt));
  if(!verified.confirmed||Object.keys(verified.evidence).length===0||Buffer.byteLength(JSON.stringify(verified.evidence))>18000)
   return {status:"uncertain" as const};
  const saved=await deps.db.rpc("reconcile_review_action_success",{...args,evidence:verified.evidence});
  if(saved.error)return {status:"uncertain" as const};
  z.object({proposalId:z.literal(scope.proposalId),status:z.literal("succeeded"),duplicate:z.boolean()}).strict().parse(saved.data);
  return {status:"succeeded" as const};
 }catch{return {status:"uncertain" as const};}
}
