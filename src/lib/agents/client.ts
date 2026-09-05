import { artifactHeaders } from "../artifacts/client";
import type { AgentRoutine, AgentsSnapshot } from "./types";
export type AgentContext = { accountId: string; contextGeneration: number };
export function isAgentSnapshot(value: unknown, ctx: AgentContext): value is AgentsSnapshot {
  const b = value as Partial<AgentsSnapshot> | null;
  return !!b && b.accountId===ctx.accountId && b.contextGeneration===ctx.contextGeneration &&
    (b.role==="owner"||b.role==="member") && typeof b.paused==="boolean" && Array.isArray(b.routines);
}
export async function readAgents(ctx: AgentContext, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<AgentsSnapshot> {
  const res=await fetcher("/api/agents",{cache:"no-store",headers:artifactHeaders(ctx.accountId,ctx.contextGeneration),signal});
  const b: unknown = await res.json();
  if (!res.ok || !isAgentSnapshot(b,ctx)) throw new Error("Couldn’t verify this account’s saved routines. Refresh before continuing.");
  return b;
}
export async function saveAgentPreference(ctx: AgentContext, routine: AgentRoutine, enabled: boolean, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const res=await fetcher("/api/agents",{method:"POST",signal,headers:{"content-type":"application/json",...artifactHeaders(ctx.accountId,ctx.contextGeneration)},
    body:JSON.stringify({routineId:routine.routineId,enabled,stateUpdatedAt:routine.stateUpdatedAt,version:routine.version})});
  const b=await res.json(); const s=b.saved;
  if (!res.ok || !s || s.accountId!==ctx.accountId || s.contextGeneration!==ctx.contextGeneration || s.routineId!==routine.routineId || s.enabled!==enabled || !Number.isSafeInteger(s.version) || !s.stateUpdatedAt || !Number.isFinite(Date.parse(s.stateUpdatedAt)))
    throw new Error("Save not confirmed. Refresh to check the saved switch; don’t automatically retry.");
  return s as AgentContext & Pick<AgentRoutine,"routineId"|"enabled"|"version"|"stateUpdatedAt">;
}
