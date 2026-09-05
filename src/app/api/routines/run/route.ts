/* POST /api/routines/run — dry-run a routine now.

   Body: { accountId: string, routineId: "D0x-W0y",
           vars?: object,
           account?: { currency, budgetMonthly, approver? }   // fallback when the
                                                              // worker's accounts
                                                              // source doesn't know
                                                              // accountId
           mode?: "dry_run" }                                 // "live" → 403
   →     { run: { runId, routineId, version, mode, status, summary, receipts[], approval? } }
   or    400 { error } | 403 { error } (live mode) | 404 { error } (unknown account/routine)

   Runs through src/worker/service.ts — the same adapters and checks as the
   always-on loop. Store = src/lib/runtime/store getStore(): SupabaseStore when
   the database is configured (runs persist), MemoryStore otherwise (runs do
   not survive a restart). Accounts + credentials come from src/worker/wiring.ts.

   DB configured → owner-only and session-bound: the run is always for the caller's own
   account (the body's accountId is ignored); no session → 401. Demo mode → unbound. */

import { isDbConfigured } from "@/lib/db/client";

import { getStore } from "@/lib/runtime/store";
import { ROUTINE_ID_RE } from "@/lib/runtime/validate";
import { triggerRun, WorkerError, type ServiceDeps } from "@/worker/service";
import { defaultAccountsSource } from "@/worker/wiring";
import { summariseRun, workerErrorStatus } from "../shared";
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
  let body: { accountId?: unknown; routineId?: unknown; vars?: unknown; account?: unknown; mode?: unknown; version?:unknown;stateUpdatedAt?:unknown;requestId?:unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body!=="object" || Array.isArray(body)) return Response.json({error:"invalid body"},{status:400});

  const accountId = typeof body.accountId === "string" ? body.accountId.trim().slice(0, 128) : "";
  let captured: AgentContext | undefined;
  if (isDbConfigured()) {
    const access=await agentSnapshot(req);if(access instanceof Response)return access;
    if(access.data.role!=="owner")return Response.json({error:"Only the account owner can run routines.",code:"owner_only"},{status:403});
    if(accountId!==access.data.accountId)return Response.json({error:"Account changed. Reload before running."},{status:409});
    const block=routineBlock(access.data,String(body.routineId));
    if(block)return Response.json({error:block},{status:access.data.role!=="owner"?403:409});
    const row=access.data.routines.find(r=>r.routineId===body.routineId)!;
    if(body.version!==row.version || body.stateUpdatedAt!==row.stateUpdatedAt)return Response.json({error:"Routine changed. Refresh before running."},{status:409});
    if(body.vars!==undefined || body.account!==undefined)return Response.json({error:"Account inputs are loaded by the server."},{status:400});
    captured={accountId:access.data.accountId,contextGeneration:access.data.contextGeneration};
    if(body.mode!==undefined && body.mode!=="dry_run")return Response.json({error:"Only dry_run is available."},{status:403});
    try {
      const identity={...captured,userId:access.session.userId};
      const snapshot=await readEditor(access.session.service,identity,row.routineId);
      const manual=await executeManual(access.session.service,identity,String(body.requestId??""),"run",
        {accountId,routineId:row.routineId,version:body.version,stateUpdatedAt:body.stateUpdatedAt},snapshot,deps());
      return Response.json({...captured,requestId:manual.requestId,phase:manual.phase,run:summariseRun(manual.result)},
        {status:manual.result.status==="running"?202:200});
    } catch(err) {
      return Response.json({error:err instanceof ManualRequestError?err.message:"Run outcome not confirmed. Check the original request before retrying.",requestId:body.requestId},
        {status:err instanceof ManualRequestError?err.status:503});
    }
  }
  const routineId = typeof body.routineId === "string" ? body.routineId.trim() : "";
  if (!accountId) return Response.json({ error: "accountId is required" }, { status: 400 });
  if (!ROUTINE_ID_RE.test(routineId)) return Response.json({ error: "routineId must look like D0x-W0y" }, { status: 400 });
  if (body.mode !== undefined && body.mode !== "dry_run" && body.mode !== "live") return Response.json({ error: "mode must be dry_run" }, { status: 400 });
  const vars = body.vars && typeof body.vars === "object" && !Array.isArray(body.vars) ? (body.vars as Record<string, unknown>) : undefined;

  let accountFallback: { currency: string; budgetMonthly: number; approver?: string } | undefined;
  if (body.account && typeof body.account === "object") {
    const a = body.account as { currency?: unknown; budgetMonthly?: unknown; approver?: unknown };
    if (typeof a.currency !== "string" || typeof a.budgetMonthly !== "number" || !Number.isFinite(a.budgetMonthly) || a.budgetMonthly < 0) {
      return Response.json({ error: "account needs { currency: string, budgetMonthly: number >= 0 }" }, { status: 400 });
    }
    accountFallback = { currency: a.currency.slice(0, 8), budgetMonthly: a.budgetMonthly, ...(typeof a.approver === "string" ? { approver: a.approver.slice(0, 80) } : {}) };
  }

  try {
    const executionDeps=deps();
    if(captured){
      const source=executionDeps.accounts, ctx=captured;
      executionDeps.accounts={listAccounts:()=>source.listAccounts(),getAccount:async id=>{
        const acct=await source.getAccount(id);
        if(!acct || acct.account.accountId!==ctx.accountId || acct.account.contextGeneration!==ctx.contextGeneration)throw new WorkerError("invalid_request","Account context changed before execution. Reload to inspect it.");
        return acct;
      }};
    }
    const result = await triggerRun(executionDeps, { accountId, routineId, mode: body.mode as "dry_run" | "live" | undefined, triggeredBy: "manual", vars, accountFallback });
    return Response.json({ ...captured, run: summariseRun(result) },{headers:{"cache-control":"private, no-store"}});
  } catch (err) {
    if (err instanceof WorkerError) return Response.json({ error: err.message, code: err.code }, { status: workerErrorStatus(err) });
    const message = err instanceof Error ? err.message : "run failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = withErrorCapture("api/routines/run", async (req:Request)=>{const response=await handlePOST(req);response.headers.set("cache-control","private, no-store");return response;});
