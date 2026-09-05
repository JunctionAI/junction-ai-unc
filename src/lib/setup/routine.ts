/** Guided setup selects one eligible routine. It never implies a run or a schedule. */
import { readAgents, saveAgentPreference } from "../agents/client";
import { routineBlock } from "../agents/types";
export interface TurnOnInput {
  routineId: string;
  accountId: string;
  contextGeneration?: number;
  account: { currency: string; budgetMonthly: number };
  fetch?: typeof fetch;
}
export type TurnOnResult =
  | { kind: "selected" }
  | { kind: "uncertain"; message: string }
  | { kind: "ran"; runId: string; status: string; summary: string; drafts: number }
  | { kind: "enabled_only"; error: string }
  | { kind: "fallback" }
  | { kind: "error"; message: string };

export async function turnOnRoutine(input: TurnOnInput): Promise<TurnOnResult> {
  if (!Number.isSafeInteger(input.contextGeneration)) return {kind:"error",message:"Account context is unavailable. Reload before selecting a routine."};
  const f=input.fetch ?? fetch;
  const ctx={accountId:input.accountId,contextGeneration:input.contextGeneration!};
  const c=new AbortController();const timer=setTimeout(()=>c.abort(),20_000);
  let posted=false;
  try {
    const data=await readAgents(ctx,f,c.signal);
    const block=routineBlock(data,input.routineId,"select");
    if(block)return {kind:"error",message:block};
    const row=data.routines.find(r=>r.routineId===input.routineId)!;
    if(row.enabled)return {kind:"selected"};
    posted=true;
    await saveAgentPreference(ctx,row,true,f,c.signal);
    return {kind:"selected"};
  } catch {
    return posted ? {kind:"uncertain",message:"The save response was not confirmed. Check Agents for the stored selection; no run or automatic retry was requested."}
      : {kind:"error",message:"Couldn’t verify eligibility. Refresh before trying again."};
  } finally {clearTimeout(timer);}
}
export function turnOnLine(r: TurnOnResult): string {
  switch(r.kind) {
    case "selected": return "Routine selected. No run started and no schedule was created. Open Agents to inspect or request work.";
    case "uncertain": return r.message;
    case "ran": return `Saved run ${r.runId}: ${r.status} — ${r.summary}. This is not schedule or delivery proof.`;
    case "enabled_only": return `Selected, but the run was not confirmed (${r.error}). Check saved work before retrying.`;
    case "fallback": return "Demo only — nothing is stored or running.";
    case "error": return `Couldn’t select this routine: ${r.message}`;
  }
}
