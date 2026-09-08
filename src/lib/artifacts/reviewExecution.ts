import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {DbClient} from "../db/types";

const ticketSchema=z.object({
  proposalId:z.uuid(),token:z.uuid(),accountId:z.uuid(),contextGeneration:z.number().int().nonnegative(),
  outputId:z.uuid(),revision:z.number().int().nonnegative(),
  action:z.enum(["prepare_provider_draft","send","publish","change_ads"]),
  targetId:z.string().min(1).max(200),payload:z.record(z.string(),z.unknown()),
  idempotencyKey:z.string(),expiresAt:z.iso.datetime({offset:true}),
}).strict();
export type ReviewExecutionTicket=z.infer<typeof ticketSchema>;
type Scope={accountId:string;contextGeneration:number;proposalId:string};
export type ReviewExecutionDependencies={
  db:DbClient;
  /** Trusted adapter configuration, NOT request JSON or a model-selected destination. */
  binding:{accountId:string;action:ReviewExecutionTicket["action"];targetId:string};
  /** Must check release flags, paused state, current context, connector identity,
   * per-agent policy and action-specific guardrails. Called again before dispatch. */
  authorize:(scope:Scope,ticket?:ReviewExecutionTicket)=>Promise<void>;
  /** Validate exact payload/schema and immutable assets against this adapter. No writes. */
  validate:(ticket:ReviewExecutionTicket)=>Promise<void>;
  /** Exactly one attempt, no hidden HTTP retries. Use ticket.idempotencyKey where supported. */
  execute:(ticket:ReviewExecutionTicket)=>Promise<unknown>;
  /** Independent provider readback; false/throw means uncertain, never assumed success. */
  verify:(ticket:ReviewExecutionTicket,response:unknown)=>Promise<{confirmed:boolean;receipt:Record<string,unknown>}>;
};

/** Deliberately not exposed by an HTTP route or scheduled worker until a concrete
 * adapter and isolated destination pass their own live release gates. */
export async function runReviewAction(scope:Scope,deps:ReviewExecutionDependencies){
  z.uuid().parse(scope.accountId);z.uuid().parse(scope.proposalId);
  z.number().int().nonnegative().parse(scope.contextGeneration);
  if(deps.binding.accountId!==scope.accountId)throw new Error("Execution binding mismatch");
  await deps.authorize(scope);
  const token=randomUUID();
  const args={acct:scope.accountId,generation:scope.contextGeneration,proposal:scope.proposalId,token};
  const claim=await deps.db.rpc("claim_review_action",args);
  if(claim.error)throw new Error("Execution claim not confirmed; reconcile before retry");
  if(!claim.data)return {status:"not_claimed" as const};
  let started=false;
  let outcome:"succeeded"|"failed"|"uncertain"="failed";
  let evidence:Record<string,unknown>={reason:"preflight_refused"};
  try{
    const ticket=ticketSchema.parse(claim.data);
    if(ticket.proposalId!==scope.proposalId||ticket.token!==token||ticket.accountId!==scope.accountId||
      ticket.contextGeneration!==scope.contextGeneration||ticket.action!==deps.binding.action||
      ticket.targetId!==deps.binding.targetId||ticket.idempotencyKey!==`review-action:${scope.proposalId}`||
      Date.parse(ticket.expiresAt)<=Date.now())throw new Error("Ticket mismatch");
    await deps.validate(ticket);
    await deps.authorize(scope,ticket);
    if(Date.parse(ticket.expiresAt)<=Date.now())throw new Error("Ticket expired");
    started=true;
    const response=await deps.execute(ticket);
    const verified=z.object({confirmed:z.boolean(),receipt:z.record(z.string(),z.unknown())}).strict().parse(await deps.verify(ticket,response));
    evidence=verified.receipt;
    if(Buffer.byteLength(JSON.stringify(evidence))>18000)throw new Error("Receipt too large");
    outcome=verified.confirmed?"succeeded":"uncertain";
  }catch{
    outcome=started?"uncertain":"failed";
    evidence={reason:started?"provider_outcome_unconfirmed":"preflight_refused"};
  }
  try{
    const saved=await deps.db.rpc("record_review_action_result",{...args,outcome,evidence});
    if(saved.error) return {status:"uncertain" as const};
    z.object({proposalId:z.literal(scope.proposalId),status:z.literal(outcome),duplicate:z.boolean()}).strict().parse(saved.data);
    return {status:outcome};
  }catch{return {status:"uncertain" as const};}
}
