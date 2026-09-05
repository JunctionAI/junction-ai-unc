import { requireAccountOwnerSession } from "@/lib/db/session";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { assertRuntimeContext } from "@/lib/db/runtimeContext";
import { getStore } from "@/lib/runtime/store";
import { ManualRequestError, manualResult, readManual, cancelManual, type ManualPurpose } from "@/lib/runtime/manual";
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
    const run=record.run===null?null:summariseRun(await manualResult(getStore(),record));
    await assertRuntimeContext(session.service,ctx,{allowPaused:true});
    return json({...ctx,requestId:id,routineId:record.operation.routine_id,purpose:record.operation.purpose,phase:record.operation.phase,run});
  } catch(err) {
    return json({error:err instanceof ManualRequestError?err.message:"Could not verify the original run. No new execution was sent."},err instanceof ManualRequestError?err.status:503);
  }
}

/** A confirmed tombstone fences late original POSTs. This never executes work. */
export async function POST(req:Request) {
  try {
    const session=await requireAccountOwnerSession();
    if(session instanceof Response){session.headers.set("cache-control","private, no-store");return session;}
    const ctx=await captureArtifactContext(session.service,session.accountId,req);
    if(ctx instanceof Response){ctx.headers.set("cache-control","private, no-store");return ctx;}
    const raw=await req.text();
    if(raw.length>2048)return json({error:"Request too large."},413);
    let body:Record<string,unknown>;
    try{body=JSON.parse(raw);}catch{return json({error:"Invalid JSON."},400);}
    if(!body || typeof body!=="object" || Array.isArray(body) || body.action!=="cancel" || typeof body.requestId!=="string" ||
      typeof body.routineId!=="string" || !["run","validate","input"].includes(String(body.purpose)))return json({error:"Invalid cancellation identity."},400);
    const record=await cancelManual(session.service,{...ctx,userId:session.userId},body.requestId,body.routineId,body.purpose as ManualPurpose);
    await assertRuntimeContext(session.service,ctx,{allowPaused:true});
    return json({...ctx,requestId:body.requestId,routineId:record.operation.routine_id,purpose:record.operation.purpose,phase:"cancelled",run:null});
  } catch(err) {
    return json({error:err instanceof ManualRequestError?err.message:"Cancellation not confirmed. Check the original request; do not start another."},err instanceof ManualRequestError?err.status:503);
  }
}
