import type {DbClient} from "../lib/db/types";
import {assertRuntimeContext} from "../lib/db/runtimeContext";
import {complete} from "../lib/llm/router";
import {runReviewRevision} from "../lib/artifacts/reviewRevision";
import {textRevisionProducer} from "../lib/artifacts/reviewTextRevision";
import {reviewReleasedFor} from "../lib/artifacts/reviewRelease";

/** Operator entry only until the review queue/scheduling owner is released.
 * Uses existing account spend admission and usage logging; never a global unmetered call. */
export async function runTextReviewJob(db:DbClient,context:{accountId:string;contextGeneration:number},jobId:string){
  if(!reviewReleasedFor(context.accountId))throw new Error("Review worker is not released for this account");
  return runReviewRevision(context,jobId,{
    db,checkContext:expected=>assertRuntimeContext(db,expected),
    produce:textRevisionProducer(request=>complete("routine_produce",request,{accountId:context.accountId,db})),
  });
}
