import type { RoutineStateView, RoutinesStateListing } from "../runtime/routinesState";
export type AgentRoutine = RoutineStateView & { stateUpdatedAt: string | null; selectionBlock: string | null };
export type AgentsSnapshot = Omit<RoutinesStateListing,"routines"> & {
  accountId:string; contextGeneration:number; fetchedAt:string; role:"owner"|"member"; paused:boolean; routines:AgentRoutine[];
};
