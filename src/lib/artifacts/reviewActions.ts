import {z} from "zod";
import type {ReviewIdentity} from "./reviewApi";
export const reviewActionDecision=z.object({operation:z.literal("decide_action"),proposalId:z.uuid(),revision:z.number().int().nonnegative(),decision:z.enum(["approved","held"])}).strict();
export const reviewActionsSchema=z.object({
 output:z.object({id:z.uuid(),account_id:z.uuid(),context_generation:z.number().int().nonnegative(),revision:z.number().int().nonnegative()}),
 canDecide:z.boolean(),actions:z.array(z.object({id:z.uuid(),revision:z.number().int().nonnegative(),
 action:z.enum(["prepare_provider_draft","send","publish","change_ads"]),targetId:z.string().min(1).max(200),description:z.string().min(1).max(4000),
 expiresAt:z.string(),status:z.enum(["pending","approved","held"]),effectiveStatus:z.enum(["pending","approved","held","expired","superseded"])})).max(50),
});
export class ReviewActionError extends Error {constructor(readonly status:number){super(status===409?"This action changed or expired. Refresh before deciding.":status===403?"Only the account owner can decide this action.":"Action request was not confirmed.");}}
function rpcError(code?:string):never{throw new ReviewActionError(code==="42501"?403:code==="40001"?409:503);}
export async function readReviewActions(identity:ReviewIdentity,outputId:string){
 const result=await identity.db.rpc("read_review_actions",{acct:identity.accountId,generation:identity.contextGeneration,actor:identity.userId,output:outputId});
 if(result.error)rpcError(result.error.code);if(result.data===null)return null;
 const value=reviewActionsSchema.parse(result.data);
 if(value.output.id!==outputId||value.output.account_id!==identity.accountId||value.output.context_generation!==identity.contextGeneration)throw new ReviewActionError(503);
 if(value.actions.some(a=>a.revision>value.output.revision||(a.revision!==value.output.revision&&a.effectiveStatus!=="superseded")))throw new ReviewActionError(503);
 return value;
}
export async function decideReviewAction(identity:ReviewIdentity,outputId:string,input:unknown){
 const decision=reviewActionDecision.parse(input);
 const result=await identity.db.rpc("decide_review_action",{acct:identity.accountId,generation:identity.contextGeneration,actor:identity.userId,
  output:outputId,expected_revision:decision.revision,proposal:decision.proposalId,decision:decision.decision});
 if(result.error)rpcError(result.error.code);
 return z.object({proposalId:z.literal(decision.proposalId),revision:z.literal(decision.revision),status:z.literal(decision.decision),duplicate:z.boolean(),executed:z.literal(false)}).strict().parse(result.data);
}
