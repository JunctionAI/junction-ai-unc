import type { RoutineStateView, RoutinesStateListing } from "../runtime/routinesState";
export type ExternalRoutineSettings = { revision:number; schedule:{time:string;timezone:string};
  status:string; message:string; teamActionRequired:boolean };
export type AgentRoutine = RoutineStateView & { stateUpdatedAt: string | null; selectionBlock: string | null;
  external?: ExternalRoutineSettings };
export type AgentsSnapshot = Omit<RoutinesStateListing,"routines"> & {
  accountId:string; contextGeneration:number; actorId:string; fetchedAt:string; role:"owner"|"member"; paused:boolean; routines:AgentRoutine[];
};

/** Requirements check only; never proof of provider execution or scheduled delivery. */
export function routineBlock(data: Partial<AgentsSnapshot> | null, routineId: string, action: "select" | "run" = "run"): string | null {
  if (!data || !["owner","member"].includes(data.role ?? "") || typeof data.paused !== "boolean") return "Account eligibility has not been verified. Refresh before continuing.";
  if (data.role !== "owner") return "Only the account owner can change or run routines.";
  if (data.paused) return "Automation is paused for setup verification.";
  const r = data.routines?.find(r=>r.routineId===routineId);
  if (!r) return "Routine eligibility is unavailable.";
  if(action==="run"&&r.external)return "This routine runs through your connected agent. Use its messaging channel; the legacy run button is unavailable.";
  if (r.selectionBlock) return r.selectionBlock;
  if (action === "run" && !r.enabled) return "Select this routine in Agents before requesting a run.";
  return null;
}
