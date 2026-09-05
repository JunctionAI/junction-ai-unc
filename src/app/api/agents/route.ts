import { requireAccountSession } from "@/lib/db/session";
import { captureArtifactContext } from "@/lib/artifacts/context";
import { assertRuntimeContext } from "@/lib/db/runtimeContext";
import { unwrap } from "@/lib/db/types";
import { getStore } from "@/lib/runtime/store";
import { routinesStateForAccount } from "@/lib/runtime/routinesState";
import { AGENT_JOBS } from "@/lib/agents/catalog";
import type { AgentsSnapshot } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status=200) => Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
const failure = () => json({error:"Couldn’t verify the saved agent settings. Refresh before trying again."},503);
const noStore = (response: Response) => { response.headers.set("cache-control","private, no-store"); return response; };
async function snapshot(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session.status===200 ? failure() : noStore(session);
  const ctx = await captureArtifactContext(session.service,session.accountId,req);
  if (ctx instanceof Response) return noStore(ctx);
  const [listing,states,member,account] = await Promise.all([
    routinesStateForAccount({store:getStore(),db:session.service},session.accountId,{contextGeneration:ctx.contextGeneration}),
    unwrap<{routine_id:string; updated_at:string; enabled:boolean; version:number}[]>("agents.states",session.service.from("routine_states").select("routine_id,updated_at,enabled,version").eq("account_id",session.accountId)),
    unwrap<{role:"owner"|"member"}|null>("agents.member",session.service.from("account_members").select("role").eq("account_id",session.accountId).eq("user_id",session.userId).maybeSingle()),
    unwrap<{automation_paused:boolean}>("agents.pause",session.service.from("accounts").select("automation_paused").eq("id",session.accountId).single()),
  ]);
  if (!member) return json({error:"Account access changed. Sign in again."},403);
  await assertRuntimeContext(session.service,ctx,{allowPaused:true});
  const byId = new Map(states.map(s=>[s.routine_id,s]));
  const data: AgentsSnapshot = {...listing,...ctx,fetchedAt:new Date().toISOString(),role:member.role,paused:account.automation_paused,
    routines:listing.routines.map(r=>{const s=byId.get(r.routineId);return {...r,enabled:s?.enabled??false,version:s?.version??1,stateUpdatedAt:s?.updated_at??null,
      selectionBlock:r.routineId==="D03-W01" ? "Keyword pilot requires operator-authorized registration and independent execution verification." : r.skillSource==="none" ? "No drafting implementation is registered." : !r.canEnable ? r.availabilityCopy : null};})};
  return {session,data};
}
export async function GET(req: Request) {
  try { const result=await snapshot(req); return result instanceof Response ? result : json(result.data); }
  catch { return failure(); }
}
export async function POST(req: Request) {
  try {
    const b=await req.json().catch(()=>null);
    if (!b || typeof b!=="object" || Array.isArray(b) || Object.keys(b).some(k=>!["routineId","enabled","stateUpdatedAt","version"].includes(k)) ||
      typeof b.enabled!=="boolean" || !Number.isSafeInteger(b.version) || b.version<1 ||
      !(b.stateUpdatedAt===null || typeof b.stateUpdatedAt==="string" && Number.isFinite(Date.parse(b.stateUpdatedAt))) ||
      !AGENT_JOBS.some(j=>j.routineId && j.routineId===b.routineId)) return json({error:"Invalid agent setting."},400);
    const result=await snapshot(req); if (result instanceof Response) return result;
    const {session,data}=result; if (data.role!=="owner") return json({error:"Only the account owner can change routines."},403);
    const r=data.routines.find(r=>r.routineId===b.routineId);
    if (!r) return json({error:"Routine unavailable."},404);
    if (b.enabled && (data.paused || r.selectionBlock)) return json({error:data.paused ? "Automation is paused for setup verification." : r.selectionBlock},409);
    const {data:saved,error}=await session.service.rpc("set_agent_switch",{p_account:data.accountId,p_actor:session.userId,p_generation:data.contextGeneration,
      p_routine:b.routineId,p_enabled:b.enabled,p_expected_updated_at:b.stateUpdatedAt,p_expected_version:b.version});
    if (error) return json({error:"Settings or account access changed. Refresh to check the saved switch."},error.code==="42501" ? 403 : error.code==="40001" ? 409 : 503);
    const confirmed = saved as {accountId?:string; contextGeneration?:number; routineId?:string; enabled?:boolean; version?:number; stateUpdatedAt?:string}|null;
    if (!confirmed || confirmed.accountId!==data.accountId || confirmed.contextGeneration!==data.contextGeneration || confirmed.routineId!==b.routineId || confirmed.enabled!==b.enabled || !Number.isSafeInteger(confirmed.version) || !confirmed.stateUpdatedAt || !Number.isFinite(Date.parse(confirmed.stateUpdatedAt))) return failure();
    return json({saved}); // Never invokes a run, provider, schedule or notification.
  } catch { return failure(); }
}
