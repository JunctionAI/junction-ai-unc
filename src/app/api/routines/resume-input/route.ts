/* POST /api/routines/resume-input — answer what a run asked for and let it draft again.

   Body: { runId: string, answers: { [key]: string } }   keys = the `input` names in the run's needs
   →     { run: { runId, status, summary, receipts[], artifact?, needs? } }
   or    400 { error } | 404 (unknown run / not this account's) | 409 (run is not waiting_input)

   Same service the worker uses (src/worker/service.ts resumeWithInput → engine
   resumeRunWithInput): the owner's answers land in ctx.inputs and the produce step re-runs. */

import { isDbConfigured } from "@/lib/db/client";

import { getStore } from "@/lib/runtime/store";
import { resumeWithInput, type ServiceDeps } from "@/worker/service";
import { defaultAccountsSource } from "@/worker/wiring";
import { summariseRun } from "../shared";
import { withErrorCapture } from "@/lib/observability/errors";
import { agentSnapshot } from "@/lib/agents/server";
import { routineBlock } from "@/lib/agents/types";
import type { AgentContext } from "@/lib/agents/client";
import { executeManual, ManualRequestError } from "@/lib/runtime/manual";
import { readEditor } from "@/lib/runtime/presets/editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): ServiceDeps {
  return { store: getStore(), accounts: defaultAccountsSource() };
}

async function handlePOST(req: Request) {
  let body: { runId?: unknown; answers?: unknown; requestId?:unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if(!body || typeof body!=="object" || Array.isArray(body))return Response.json({error:"invalid body"},{status:400});
  const runId = typeof body.runId === "string" ? body.runId.trim().slice(0, 128) : "";
  if (!runId) return Response.json({ error: "runId is required" }, { status: 400 });
  if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) return Response.json({ error: "answers must be an object of strings" }, { status: 400 });
  let captured:AgentContext|undefined;
  if (isDbConfigured()) {
    const access=await agentSnapshot(req);if(access instanceof Response)return access;
    if(access.data.role!=="owner")return Response.json({error:"Only the account owner can run routines.",code:"owner_only"},{status:403});
    const run = await getStore().getRun(runId);
    if (!run || run.accountId !== access.data.accountId || run.contextGeneration!==access.data.contextGeneration) return Response.json({ error: "Run not found in this business context." }, { status: 404 });
    const block=routineBlock(access.data,run.routineId);
    if(block)return Response.json({error:block},{status:access.data.role!=="owner"?403:409});
    captured={accountId:access.data.accountId,contextGeneration:access.data.contextGeneration};
    try {
      const identity={...captured,userId:access.session.userId};
      const snapshot=await readEditor(access.session.service,identity,run.routineId);
      const manual=await executeManual(access.session.service,identity,String(body.requestId??""),"input",
        {routineId:run.routineId,runId,answers:body.answers},snapshot,deps());
      return Response.json({...captured,requestId:manual.requestId,phase:manual.phase,run:summariseRun(manual.result)},
        {status:manual.result.status==="running"?202:200});
    } catch(err) {
      return Response.json({error:err instanceof ManualRequestError?err.message:"Resume outcome not confirmed. Check the original request before retrying.",requestId:body.requestId},
        {status:err instanceof ManualRequestError?err.status:503});
    }
  }
  try {
    const result = await resumeWithInput(deps(), { runId, answers: body.answers as Record<string, unknown> });
    return Response.json({ ...captured, run: summariseRun(result) },{headers:{"cache-control":"private, no-store"}});
  } catch (err) {
    const message = err instanceof Error ? err.message : "resume failed";
    if (/not found/.test(message)) return Response.json({ error: message }, { status: 404 });
    if (/not waiting_input|no resumable snapshot/.test(message)) return Response.json({ error: message }, { status: 409 });
    if (/answers are empty/.test(message)) return Response.json({ error: message }, { status: 400 });
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = withErrorCapture("api/routines/resume-input", async (req:Request)=>{const response=await handlePOST(req);response.headers.set("cache-control","private, no-store");return response;});
