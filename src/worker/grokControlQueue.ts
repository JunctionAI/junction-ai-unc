import { z } from "zod";
import type { DbClient } from "../lib/db/types";
import { changeSchema, currentChange, dispatchQueuedGrokChange } from "../lib/agents/grokControl";

type Env=Record<string,string|undefined>;
const registrationSchema=z.array(z.object({accountId:z.uuid(),contextGeneration:z.number().int().nonnegative(),
  workerId:z.string().min(1).max(120),routineIds:z.array(changeSchema.shape.routineId).min(1).max(40),
  webhookUrl:z.url(),webhookKeyEnv:z.string().regex(/^JUNCTION_GROK_WEBHOOK_[A-Z0-9_]+$/),
  callbackOrigin:z.url()}).strict()).min(1).max(10);

/** Deterministic routing only. At most one transport attempt per tick; no LLM calls.
 * Configuration contains env names, not webhook secrets. Existing persisted claims
 * are never resent, even when no acknowledgement was received. */
export async function runGrokControlQueueTick(db:DbClient,deps:{env?:Env;fetcher?:typeof fetch;now?:()=>number}={}) {
  const env=deps.env??process.env,now=deps.now??Date.now;
  if(env.JUNCTION_GROK_QUEUE_ENABLED!=="true"||env.JUNCTION_GROK_SETTINGS_ENABLED!=="true"||
    env.JUNCTION_GROK_CONTROL_ENABLED!=="true")return {status:"disabled" as const};
  let raw:unknown;try{raw=JSON.parse(env.JUNCTION_GROK_QUEUE_REGISTRATIONS??"");}catch{return {status:"misconfigured" as const};}
  const parsed=registrationSchema.safeParse(raw),secret=env.JUNCTION_GROK_CONTROL_SECRET??"";
  const allowed=new Set((env.JUNCTION_GROK_SETTINGS_ACCOUNT_IDS??"").split(",").map(s=>s.trim()));
  if(!parsed.success||secret.length<32||parsed.data.some(r=>!allowed.has(r.accountId)||!env[r.webhookKeyEnv]))return {status:"misconfigured" as const};
  const scopes=parsed.data.flatMap(r=>r.routineIds.map(id=>`${r.accountId}:${id}`));
  if(scopes.length>40||new Set(scopes).size!==scopes.length)return {status:"misconfigured" as const};
  // Check every registration before sending anything, not after a partial batch.
  for(const r of parsed.data){const target=new URL(r.webhookUrl),origin=new URL(r.callbackOrigin);
    if(target.protocol!=="https:"||target.hostname!=="api2.cursor.sh"||target.username||target.password||target.hash||
      origin.protocol!=="https:"||origin.pathname!=="/"||origin.search||origin.hash||origin.username||origin.password)
      return {status:"misconfigured" as const};
  }
  let skipped=0;
  for(const r of parsed.data){
   for(const routineId of r.routineIds){
    const result=await db.from("grok_settings_outbox").select("id,account_id,context_generation,change")
      .eq("account_id",r.accountId).eq("context_generation",r.contextGeneration).eq("routine_id",routineId)
      .order("revision",{ascending:false}).limit(1);
    if(result.error)throw new Error("Grok queue storage unavailable");
    for(const row of (result.data??[]) as {id:string;change:unknown}[]){
      const checked=changeSchema.safeParse(row.change);
      if(!checked.success)throw new Error("Grok queue payload invalid");
      const change=checked.data;
      if(change.changeId!==row.id||change.accountId!==r.accountId||change.contextGeneration!==r.contextGeneration||
        change.workerId!==r.workerId||!r.routineIds.includes(change.routineId))throw new Error("Grok queue binding mismatch");
      if(Date.parse(change.expiresAt)<=now()){skipped++;continue;}
      const prior=await db.from("grok_control_records").select("id").eq("id",row.id).maybeSingle();
      if(prior.error)throw new Error("Grok queue claim unavailable");
      if(prior.data||!await currentChange(db,change)){skipped++;continue;}
      const outcome=await dispatchQueuedGrokChange(db,r.accountId,row.id,{webhookUrl:r.webhookUrl,
        webhookKey:env[r.webhookKeyEnv]!,callbackOrigin:r.callbackOrigin,signingSecret:secret},deps.fetcher??fetch,now());
      return {status:"attempted" as const,accountId:r.accountId,changeId:row.id,outcome:outcome.status};
    }
   }
  }
  return {status:"idle" as const,skipped};
}
