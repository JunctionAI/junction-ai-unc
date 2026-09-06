import { z } from "zod";
import { requireAccountOwnerSession } from "@/lib/db/session";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { getStore } from "@/lib/runtime/store";
import { CATALOG_SPEC_BY_ID } from "@/lib/runtime/catalog-specs";
import { effectiveSpec } from "@/lib/runtime/versioning";
import { commandSelectionReleased, workflowFingerprint } from "@/lib/commands/releaseScope";
import { digest, DbCommandQueue } from "@/lib/commands/queue";
import { commandChannelBinding } from "@/lib/commands/binding";
import { commandOwner } from "@/lib/commands/deps";
import { keywordCommandMarket } from "@/lib/n8n/keywordCommand";
import type { CommandActor } from "@/lib/commands/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"private, no-store"}});
const bodySchema=z.object({ routineId:z.literal("D03-W01"), revision:z.number().int().nonnegative().nullable(), enabled:z.boolean(),
  timezone:z.string().min(1).max(100), hour:z.number().int().min(0).max(23), minute:z.number().int().min(0).max(59),
  weekday:z.number().int().min(0).max(6).nullable(), deliveryCommandId:z.uuid().nullable() }).strict();
const columns="id,revision,routine_id,enabled,timezone,hour,minute,weekday,on_date,channel,starts_at,updated_at";

async function handle(req:Request,write:boolean) {
 const session=await requireAccountOwnerSession(req);if(session instanceof Response)return session;
 const identity=await captureArtifactContext(session.service,session.accountId,req);if(identity instanceof Response)return identity;
 if(!write){
   const q=new URL(req.url).searchParams;if(q.get("routineId")!=="D03-W01")return reply({error:"Unsupported scheduled routine"},400);
   const r=await session.service.from("routine_schedules").select(columns).eq("account_id",identity.accountId)
     .eq("context_generation",identity.contextGeneration).eq("routine_id","D03-W01").maybeSingle();
   if(r.error)throw Error("Schedule read unavailable");
   const destination=await session.service.from("routine_commands").select("id").eq("account_id",identity.accountId)
     .eq("context_generation",identity.contextGeneration).eq("user_id",session.userId).eq("routine_id","D03-W01")
     .eq("channel","slack").eq("status","done").order("created_at",{ascending:false}).limit(1);
   if(destination.error)throw Error("Destination unavailable");
   const rows=z.array(z.object({id:z.uuid()})).parse(destination.data);
   return reply({...identity,schedule:r.data,deliveryCommandId:rows[0]?.id??null});
 }
 const parsed=bodySchema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return reply({error:"Invalid saved schedule"},400);
 const b=parsed.data;
 try{new Intl.DateTimeFormat("en",{timeZone:b.timezone});}catch{return reply({error:"Choose a valid timezone"},400);}
 const previous=await session.service.from("routine_schedules").select("id,revision").eq("account_id",identity.accountId)
   .eq("context_generation",identity.contextGeneration).eq("routine_id",b.routineId).maybeSingle();
 if(previous.error)throw Error("Schedule state unavailable");
 const prior=previous.data===null?null:z.object({id:z.uuid(),revision:z.number().int().nonnegative()}).parse(previous.data);
 if((prior?.revision??null)!==b.revision)return reply({error:"Schedule changed. Refresh before saving."},409);
 // Turning off never requires the provider or its release scope to be healthy.
 if(!b.enabled && prior){
   const r=await session.service.from("routine_schedules").update({enabled:false}).eq("id",prior.id)
     .eq("revision",b.revision!).select(columns).maybeSingle();
   if(r.error||!r.data)return reply({error:"Could not confirm the schedule stopped. Refresh."},409);
   return reply({...identity,schedule:r.data});
 }
 if(process.env.UNC_ROUTINE_SCHEDULES_ENABLED!=="true")return reply({error:"Scheduled routines have not been released yet."},409);
 let actor:CommandActor={...identity,userId:session.userId,channel:"app",requestId:"schedule-setup"};
 if(b.deliveryCommandId){
   const source=await new DbCommandQueue(session.service).get(identity.accountId,b.deliveryCommandId);
   if(!source||source.actor.userId!==session.userId||source.contextGeneration!==identity.contextGeneration||source.actor.channel!=="slack"
      ||source.routineId!==b.routineId||!await commandOwner(session.service,{...source.actor,requestId:"schedule-setup"}))return reply({error:"Verified Slack destination required"},409);
   actor={...source.actor,requestId:"schedule-setup"};
 }
 const store=getStore(),state=await store.getRoutineState(identity.accountId,b.routineId);
 if(!state?.enabled)return reply({error:"Enable the routine before saving a schedule."},409);
 const spec=effectiveSpec(state,CATALOG_SPEC_BY_ID[b.routineId]),workflow=await store.findN8nWorkflow(identity.accountId,b.routineId);
 if(!keywordCommandMarket(actor,spec,workflow)||!commandSelectionReleased(actor,spec,workflow))return reply({error:"This routine's reviewed execution path is not released."},409);
 const row={account_id:identity.accountId,context_generation:identity.contextGeneration,user_id:session.userId,routine_id:b.routineId,
   version:spec.version,spec_hash:digest(spec),workflow_hash:workflowFingerprint(workflow),enabled:b.enabled,timezone:b.timezone,
   hour:b.hour,minute:b.minute,weekday:b.weekday,on_date:null,channel:actor.channel,channel_binding:commandChannelBinding(actor)};
 const mutation=prior?session.service.from("routine_schedules").update(row).eq("id",prior.id).eq("revision",b.revision!)
   :session.service.from("routine_schedules").insert(row);
 const result=await mutation.select(columns).maybeSingle();
 if(result.error||!result.data)return reply({error:"Schedule save not confirmed. Refresh before retrying."},409);
 return reply({...identity,schedule:result.data});
}
export async function GET(req:Request){try{return await handle(req,false);}catch{return reply({error:"Schedule unavailable"},503);}}
export async function POST(req:Request){try{return await handle(req,true);}catch{return reply({error:"Schedule save not confirmed. Refresh before retrying."},503);}}
