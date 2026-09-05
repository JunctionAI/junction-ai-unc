import { requireAccountOwnerSession } from "@/lib/db/session";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { assertRuntimeContext } from "@/lib/db/runtimeContext";
import { unwrap } from "@/lib/db/types";
import { getStore } from "@/lib/runtime/store";
import { dispatchDeps } from "@/lib/commands/deps";
import { dispatchMessage } from "@/lib/commands/dispatch";
import { commandId, DbCommandQueue, digest } from "@/lib/commands/queue";
import { workflowFingerprint } from "@/lib/commands/releaseScope";
import { commandsEnabled } from "@/lib/commands/types";
import { readKeywordConfiguration } from "@/lib/n8n/keywordConfiguration";
import { keywordRequestBody } from "@/lib/n8n/keywordRequestClient";
import type { N8nWorkflow } from "@/lib/runtime/types";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
const failure=()=>json({error:"Couldn’t confirm this request. Check its original status before starting another."},503);
async function handle(req:Request,submit:boolean) {
  try {
    const session=await requireAccountOwnerSession();
    if(session instanceof Response){session.headers.set("cache-control","private, no-store");return session.status===200?failure():session;}
    const ctx=await captureArtifactContext(session.service,session.accountId,req);
    if(ctx instanceof Response){ctx.headers.set("cache-control","private, no-store");return ctx;}
    if(req.headers.get("x-unc-actor-id")!==session.userId)return json({error:"Signed-in account owner changed. Refresh."},409);
    const params=new URL(req.url).searchParams;
    const body=submit?keywordRequestBody.safeParse(await req.json().catch(()=>null)):null;
    const requestId=submit&&body?.success?body.data.requestId:params.get("requestId");
    if(submit&&(!body?.success||[...params].length)||!submit&&([...params].length!==1||params.getAll("requestId").length!==1)||
      !requestId||!keywordRequestBody.shape.requestId.safeParse(requestId).success)return json({error:"Invalid keyword request."},400);
    const actor={...ctx,userId:session.userId,channel:"app" as const,requestId};
    const identity={...ctx,actorId:session.userId,requestId,routineId:"D03-W01"};
    const queue=new DbCommandQueue(session.service),id=commandId(actor);
    const inspect=async()=>{
      const c=await queue.get(ctx.accountId,id);
      await assertRuntimeContext(session.service,ctx,{allowPaused:true});
      if(!c)return null;
      if(c.actor.userId!==session.userId||c.actor.channel!=="app"||c.actor.requestId!==requestId||c.contextGeneration!==ctx.contextGeneration||
        c.routineId!=="D03-W01"||c.requestHash!==digest("/run D03-W01"))throw Error("Request identity mismatch");
      const permit=await unwrap<{status:string}|null>("keyword.request.permit",session.service.from("n8n_shadow_permits").select("status").eq("account_id",ctx.accountId).eq("run_id",c.id).maybeSingle());
      await assertRuntimeContext(session.service,ctx,{allowPaused:true});
      return {...identity,phase:"record",command:{id:c.id,status:c.status,runId:c.runId},reply:c.reply,
        canStartNew:["done","blocked","failed"].includes(c.status)&&(!permit||["verified","refused"].includes(permit.status))};
    };
    const prior=await inspect();if(prior)return json(prior); // Recovery remains readable while paused/disabled.
    if(!submit)return json({...identity,phase:"not_found",command:null,canStartNew:false,reply:"No saved command is visible yet. This does not prove a previous submission never arrived. Check again or ask Junction to reconcile it; do not resend."});
    const refuse=(reply:string)=>json({...identity,phase:"refused",command:null,canStartNew:true,reply});
    if(!commandsEnabled())return refuse("Keyword requests are not enabled yet. Nothing was queued or started.");
    const result=await session.service.rpc("keyword_customer_configuration",{input:{...ctx,actorId:session.userId,operation:"read"}});
    if(result.error)throw Error("Configuration unavailable");
    const current=readKeywordConfiguration(result.data,{...ctx,actorId:session.userId});
    if(!body?.success)throw Error("Missing submission");
    if(current.view.version!==body.data.version||current.view.stateUpdatedAt!==body.data.stateUpdatedAt||current.view.market!==body.data.market)
      return refuse("The saved market or routine settings changed. Refresh before making a new request. Nothing was queued.");
    const chosen=current.candidates.find(c=>c.market===body.data.market);if(!chosen)return refuse("This market no longer has a verified setup. Nothing was queued.");
    if(current.view.paused||!current.view.enabled||!current.view.released)return refuse("This routine is paused, switched off or not released for this account. Nothing was queued.");
    const base=dispatchDeps(session.service,getStore(),ctx.accountId);
    const selectedWorkflow=(result.data as {workflow:N8nWorkflow}).workflow;
    const reply=await dispatchMessage({...base,selectionReleased:(a,s,w)=>digest(s)===digest(chosen.spec)&&workflowFingerprint(w)===workflowFingerprint(selectedWorkflow)&&base.selectionReleased(a,s,w)},actor,"/run D03-W01");
    if(!reply)throw Error("Unexpected dispatch result");
    if(!reply.commandId)return refuse(reply.reply);
    const saved=await inspect();if(!saved)throw Error("Saved request not visible");return json(saved);
  }catch{return failure();}
}
export const GET=(req:Request)=>handle(req,false);
export const POST=(req:Request)=>handle(req,true);
