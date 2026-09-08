import { reviewApi, type ReviewIdentity } from "@/lib/artifacts/reviewApi";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { requireAccountSession } from "@/lib/db/session";
import { reviewReleasedFor } from "@/lib/artifacts/reviewRelease";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function bind(request:Request):Promise<ReviewIdentity|Response>{
  const session=await requireAccountSession(request);
  if(session instanceof Response)return session.status===200?Response.json({error:"Account storage unavailable"},{status:503}):session;
  if(!reviewReleasedFor(session.accountId))return Response.json({error:"Review is not released for this account"},{status:403});
  const identity=await captureArtifactContext(session.service,session.accountId,request);
  if(identity instanceof Response)return identity;
  return {...identity,userId:session.userId,db:session.service};
}
async function handler(request:Request,context:{params:Promise<{outputId:string}>}){
  return reviewApi(request,(await context.params).outputId,{enabled:process.env.JUNCTION_REVIEW_ENABLED==="true",bind});
}
export const GET=handler;
export const POST=handler;
