import { requireAccountOwnerSession } from "@/lib/db/session";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { assertRuntimeContext } from "@/lib/db/runtimeContext";
import { getStore } from "@/lib/runtime/store";
import { ManualRequestError, manualResult, readManual } from "@/lib/runtime/manual";
import { summariseRun } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
/** Read only: even a prepared or stalled request never starts work through GET. */
export async function GET(req:Request) {
  try {
    const session=await requireAccountOwnerSession();
    if(session instanceof Response){session.headers.set("cache-control","private, no-store");return session;}
    const ctx=await captureArtifactContext(session.service,session.accountId,req);
    if(ctx instanceof Response){ctx.headers.set("cache-control","private, no-store");return ctx;}
    const id=new URL(req.url).searchParams.get("requestId")??"";
    const record=await readManual(session.service,{...ctx,userId:session.userId},id);
    if(!record)return json({error:"Request not found in this business context."},404);
    const run=await manualResult(getStore(),record);
    await assertRuntimeContext(session.service,ctx,{allowPaused:true});
    return json({...ctx,requestId:id,purpose:record.operation.purpose,phase:record.operation.phase,run:summariseRun(run)});
  } catch(err) {
    return json({error:err instanceof ManualRequestError?err.message:"Could not verify the original run. No new execution was sent."},err instanceof ManualRequestError?err.status:503);
  }
}
