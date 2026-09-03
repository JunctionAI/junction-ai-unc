/* POST /api/routines/resume — decide a run that is waiting at its gate.

   Body: { runId: string, decision: "approved" | "held", decidedBy?: string }
   →     { run: { runId, routineId, version, mode, status, summary, receipts[], approval } }
   or    400 { error } | 404 { error } (run/approval not found)
         | 409 { error } (run is not waiting_approval / approval already decided)

   Same code path as the worker (src/worker/service.ts resumeApproval). Only
   LIVE runs pause at a gate; dry runs record the gate as a "Would ask" draft
   receipt and finish. With LIVE_MODE_ENABLED = false no run created by this
   app pauses, so today this route answers 404/409 for anything it is handed.
   The approval UI uses POST /api/approvals/<id> (approval-keyed, session-bound,
   same resume path); this run-keyed route stays for the worker CLI / tooling.
   Even then, "approved" on a mutating routine fails closed: the shipped
   executor refuses every mutation.

   DB configured → session-bound: the run must belong to the caller's account
   (else 404) and decided_by is the caller. Demo mode → MemoryStore, unbound. */

import { isDbConfigured } from "@/lib/db/client";
import { requireAccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { resumeApproval, type ServiceDeps } from "@/worker/service";
import { defaultAccountsSource } from "@/worker/wiring";
import { summariseRun } from "../shared";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): ServiceDeps {
  return { store: getStore(), accounts: defaultAccountsSource() };
}

async function handlePOST(req: Request) {
  let body: { runId?: unknown; decision?: unknown; decidedBy?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const runId = typeof body.runId === "string" ? body.runId.trim().slice(0, 128) : "";
  if (!runId) return Response.json({ error: "runId is required" }, { status: 400 });
  if (body.decision !== "approved" && body.decision !== "held") return Response.json({ error: 'decision must be "approved" or "held"' }, { status: 400 });
  let decidedBy = typeof body.decidedBy === "string" ? body.decidedBy.slice(0, 128) : undefined;
  if (isDbConfigured()) {
    const session = await requireAccountSession();
    if (session instanceof Response) return session;
    decidedBy = session.userId;
    const run = await getStore().getRun(runId);
    if (!run || run.accountId !== session.accountId) return Response.json({ error: `run ${runId} not found` }, { status: 404 });
  }

  try {
    const result = await resumeApproval(deps(), { runId, decision: body.decision, decidedBy });
    return Response.json({ run: summariseRun(result) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "resume failed";
    if (/not found/.test(message)) return Response.json({ error: message }, { status: 404 });
    if (/not waiting_approval|already|no resumable snapshot/.test(message)) return Response.json({ error: message }, { status: 409 });
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = withErrorCapture("api/routines/resume", handlePOST);
