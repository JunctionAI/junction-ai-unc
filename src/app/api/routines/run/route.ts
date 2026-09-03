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

   DB configured → session-bound: the run is always for the caller's own account
   (the body's accountId is ignored); no session → 401. Demo mode → unbound. */

import { isDbConfigured } from "@/lib/db/client";
import { requireAccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { ROUTINE_ID_RE } from "@/lib/runtime/validate";
import { triggerRun, WorkerError, type ServiceDeps } from "@/worker/service";
import { defaultAccountsSource } from "@/worker/wiring";
import { summariseRun, workerErrorStatus } from "../shared";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): ServiceDeps {
  return { store: getStore(), accounts: defaultAccountsSource() };
}

async function handlePOST(req: Request) {
  let body: { accountId?: unknown; routineId?: unknown; vars?: unknown; account?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let accountId = typeof body.accountId === "string" ? body.accountId.trim().slice(0, 128) : "";
  if (isDbConfigured()) {
    const session = await requireAccountSession();
    if (session instanceof Response) return session;
    accountId = session.accountId;
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
    const result = await triggerRun(deps(), { accountId, routineId, mode: body.mode as "dry_run" | "live" | undefined, triggeredBy: "manual", vars, accountFallback });
    return Response.json({ run: summariseRun(result) });
  } catch (err) {
    if (err instanceof WorkerError) return Response.json({ error: err.message, code: err.code }, { status: workerErrorStatus(err) });
    const message = err instanceof Error ? err.message : "run failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = withErrorCapture("api/routines/run", handlePOST);
