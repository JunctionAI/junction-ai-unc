import {asDb} from '@/lib/db/client';
import {getServiceSupabase} from '@/lib/db/server';
import {assertRuntimeContext} from '@/lib/db/runtimeContext';
import {readReviewIntakeGrant,receiveReviewOutput} from '@/lib/artifacts/reviewIntake';
import {reviewReleasedFor} from '@/lib/artifacts/reviewRelease';
import {reviewStorage} from '@/lib/artifacts/reviewStorage';
import {registerReviewOutput} from '@/lib/artifacts/reviewProducer';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{grantId:string}>}){
 // Lazy binding keeps disabled/unauthorized requests from initializing storage.
 const client=()=>getServiceSupabase();const db=()=>asDb(client());
 return receiveReviewOutput(request,(await context.params).grantId,{
  enabled:process.env.JUNCTION_REVIEW_INTAKE_ENABLED==='true',secret:process.env.JUNCTION_REVIEW_INTAKE_SECRET??'',
  resolve:id=>readReviewIntakeGrant(db(),id),released:reviewReleasedFor,
  // Pausing execution does not discard finished, already-authorized draft work.
  checkContext:g=>assertRuntimeContext(db(),{accountId:g.output.ref.accountId,contextGeneration:g.contextGeneration},{allowPaused:true}),
  storage:{isPrivate:()=>reviewStorage(client()).isPrivate(),read:(path,max)=>reviewStorage(client()).read(path,max)},
  register:(g,content)=>registerReviewOutput(db(),{accountId:g.output.ref.accountId,contextGeneration:g.contextGeneration},{output:g.output,sourceRunId:g.sourceRunId,content}),
 });
}
