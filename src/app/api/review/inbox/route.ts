import {requireAccountSession} from '@/lib/db/session';
import {captureArtifactContext,artifactFailure} from '@/lib/artifacts/context';
import {reviewReleasedFor} from '@/lib/artifacts/reviewRelease';
import {readReviewInbox,reviewInboxCursor} from '@/lib/artifacts/reviewInbox';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){
 const headers={'cache-control':'private, no-store'};
 try{
  const session=await requireAccountSession(request);
  if(session instanceof Response)return session.status===200?Response.json({error:'Account unavailable'},{status:503,headers}):session;
  if(!reviewReleasedFor(session.accountId))return Response.json({available:false},{headers});
  const identity=await captureArtifactContext(session.service,session.accountId,request);if(identity instanceof Response)return identity;
  const params=new URL(request.url).searchParams;let cursor=null;
  if(params.has('beforeAt')||params.has('beforeId')){
   const parsed=reviewInboxCursor.safeParse({createdAt:params.get('beforeAt'),id:params.get('beforeId')});
   if(!parsed.success||params.getAll('beforeAt').length!==1||params.getAll('beforeId').length!==1)return Response.json({error:'Invalid cursor'},{status:400,headers});cursor=parsed.data;
  }
  const data=await readReviewInbox({...identity,userId:session.userId,db:session.service},cursor);
  return Response.json({available:true,...data},{headers});
 }catch(error){return artifactFailure(error);}
}
