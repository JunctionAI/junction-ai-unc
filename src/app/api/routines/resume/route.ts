/* POST /api/routines/resume — decide a run that is waiting at its gate.

   Body: { runId: string, decision: "approved" | "held", decidedBy?: string }
   →     { run: { runId, routineId, version, mode, status, summary, receipts[], approval } }
   or    400 { error } | 404 { error } (run/approval not found)
         | 409 { error } (run is not waiting_approval / approval already decided)

   Same code path as the worker (src/worker/service.ts resumeApproval). Only
   LIVE runs pause at a gate; dry runs record the gate as a "Would ask" draft
   receipt and finish. With LIVE_MODE_ENABLED = false no run created by this
   app pauses, so today this route answers 404/409 for anything it is handed —
   it exists so the approval UI is wired to the right place for Wave 2. Even
   then, "approved" on a mutating routine fails closed: the shipped executor
   refuses every mutation. Store = MemoryStore (nothing survives a restart). */

import { getStore } from "@/lib/runtime/store";
import { StaticAccountsSource } from "@/worker/accounts";
import { resumeApproval, type ServiceDeps } from "@/worker/service";
import { summariseRun } from "../shared";

export const runtime = "nodejs";

function deps(): ServiceDeps {
  return { store: getStore(), accounts: new StaticAccountsSource() };
}

export async function POST(req: Request) {
  let body: { runId?: unknown; decision?: unknown; decidedBy?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const runId = typeof body.runId === "string" ? body.runId.trim().slice(0, 128) : "";
  if (!runId) return Response.json({ error: "runId is required" }, { status: 400 });
  if (body.decision !== "approved" && body.decision !== "held") return Response.json({ error: 'decision must be "approved" or "held"' }, { status: 400 });
  const decidedBy = typeof body.decidedBy === "string" ? body.decidedBy.slice(0, 128) : undefined;

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
