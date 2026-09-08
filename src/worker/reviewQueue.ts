import {z} from 'zod';
import type {DbClient} from '../lib/db/types';
import {checkBudget} from '../lib/llm/budget';
import {reviewReleasedFor} from '../lib/artifacts/reviewRelease';
import {runTextReviewJob} from './runReviewRevision';

type Env=Record<string,string|undefined>;
type Dependencies={env?:Env;run?:typeof runTextReviewJob;budget?:typeof checkBudget};
/** At most one paid revision per tick. No polling model calls and no automatic retry
 * of failed/uncertain jobs. SQL claim protects overlapping workers/operator calls. */
export async function runReviewQueueTick(db:DbClient,deps:Dependencies={}){
 const env=deps.env??process.env;
 if(env.JUNCTION_REVIEW_TEXT_QUEUE_ENABLED!=='true')return {status:'disabled' as const};
 const accounts=[...new Set((env.JUNCTION_REVIEW_ACCOUNT_IDS??'').split(',').map(a=>a.trim()))];
 if(accounts.length>10||accounts.some(a=>!reviewReleasedFor(a,env)))return {status:'disabled' as const};
 for(const accountId of accounts){
  const result=await db.rpc('pending_review_text_job',{acct:accountId});
  if(result.error)throw new Error('Review queue unavailable');
  const candidates=z.array(z.object({id:z.uuid(),account_id:z.literal(accountId),context_generation:z.number().int().nonnegative()})).max(1).parse(result.data);
  if(!candidates.length)continue;
  const candidate=candidates[0];
  const budget=await (deps.budget??checkBudget)(db,accountId);
  if(!budget.ok)continue;
  const outcome=await (deps.run??runTextReviewJob)(db,{accountId,contextGeneration:candidate.context_generation},candidate.id);
  return {status:'processed' as const,accountId,jobId:candidate.id,outcome};
 }
 return {status:'idle' as const};
}
