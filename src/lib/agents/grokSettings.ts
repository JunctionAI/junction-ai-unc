import { z } from "zod";
import type { DbClient } from "../db/types";
import { changeSchema, readGrokChange } from "./grokControl";
import type { ExternalRoutineSettings } from "./types";

export function grokSettingsReleased(accountId:string) {
  return process.env.JUNCTION_GROK_SETTINGS_ENABLED === "true" &&
    (process.env.JUNCTION_GROK_SETTINGS_ACCOUNT_IDS ?? "").split(",").map(x=>x.trim()).includes(accountId);
}
export const externalSettingInput = z.object({ changeId:z.uuid(), revision:z.number().int().nonnegative(),
  schedule:changeSchema.shape.schedule }).strict();
type Binding={routine_id:string;context_generation:number;enabled:boolean;revision:number;updated_at:string;schedule_time:string;timezone:string};
export async function readExternalSettings(db:DbClient,accountId:string,generation:number) {
  const result=await db.from("grok_routine_settings").select("routine_id,context_generation,enabled,revision,updated_at,schedule_time,timezone").eq("account_id",accountId);
  if(result.error)throw new Error("External settings unavailable");
  return Promise.all(((result.data??[]) as Binding[]).map(async binding=>{
    if(binding.context_generation!==generation)throw new Error("External binding context changed");
    let view={status:"off",message:"Agent is off. No schedule has been requested.",teamActionRequired:false};
    if(binding.revision>0){
      const queued=await db.from("grok_settings_outbox").select("id,change").eq("account_id",accountId)
        .eq("routine_id",binding.routine_id).eq("context_generation",generation).eq("revision",binding.revision).maybeSingle();
      if(queued.error||!queued.data)throw new Error("Queued settings unavailable");
      const row=queued.data as {id:string;change:unknown};const change=changeSchema.parse(row.change);
      if(change.accountId!==accountId||change.routineId!==binding.routine_id||change.changeId!==row.id)throw new Error("Queued settings mismatch");
      const applied=await readGrokChange(db,row.id,accountId);
      view=applied??{status:Date.parse(change.expiresAt)<=Date.now()?"needs_attention":"queued",
        message:Date.parse(change.expiresAt)<=Date.now()?"Setup expired before confirmation. Our team needs to check it.":"Settings saved. Waiting for your agent to receive them.",
        teamActionRequired:Date.parse(change.expiresAt)<=Date.now()};
    }
    return {routineId:binding.routine_id,enabled:binding.enabled,stateUpdatedAt:binding.updated_at,
      external:{revision:binding.revision,schedule:{time:binding.schedule_time.slice(0,5),timezone:binding.timezone},...view} satisfies ExternalRoutineSettings};
  }));
}
