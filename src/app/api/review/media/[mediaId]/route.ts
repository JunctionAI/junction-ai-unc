import { reviewMedia, boundedReviewBlob, REVIEW_BUCKET } from "@/lib/artifacts/reviewMedia";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { requireAccountSession } from "@/lib/db/session";
import { getServiceSupabase } from "@/lib/db/server";
import { reviewReleasedFor } from "@/lib/artifacts/reviewRelease";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{mediaId:string}>}) {
  return reviewMedia(request,(await context.params).mediaId,{
    enabled:process.env.JUNCTION_REVIEW_ENABLED==="true",
    async bind(scoped){
      const session=await requireAccountSession(scoped);
      if(session instanceof Response)return session;
      if(!reviewReleasedFor(session.accountId))return new Response(null,{status:403});
      const identity=await captureArtifactContext(session.service,session.accountId,scoped);
      if(identity instanceof Response)return identity;
      return {...identity,userId:session.userId,db:session.service};
    },
    async download(path,maxBytes){
      const {data,error}=await getServiceSupabase().storage.from(REVIEW_BUCKET).download(path,{}, {signal:AbortSignal.timeout(15000),cache:"no-store"}).asStream();
      return error||!data?null:boundedReviewBlob(data,maxBytes);
    },
  });
}
