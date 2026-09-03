/* POST /api/routines/resume-input — answer what a run asked for and let it draft again.

   Body: { runId: string, answers: { [key]: string } }   keys = the `input` names in the run's needs
   →     { run: { runId, status, summary, receipts[], artifact?, needs? } }
   or    400 { error } | 404 (unknown run / not this account's) | 409 (run is not waiting_input)

   Same service the worker uses (src/worker/service.ts resumeWithInput → engine
   resumeRunWithInput): the answers land in ctx.inputs and the produce step re-runs. */

import { isDbConfigured } from "@/lib/db/client";
import { requireAccountSession } from "@/lib/db/session";
import { getStore } from "@/lib/runtime/store";
import { resumeWithInput, type ServiceDeps } from "@/worker/service";
import { defaultAccountsSource } from "@/worker/wiring";
import { summariseRun } from "../shared";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deps(): ServiceDeps {
  return { store: getStore(), accounts: defaultAccountsSource() };
}

async function handlePOST(req: Request) {
  let body: { runId?: unknown; answers?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const runId = typeof body.runId === "string" ? body.runId.trim().slice(0, 128) : "";
  if (!runId) return Response.json({ error: "runId is required" }, { status: 400 });
  if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) return Response.json({ error: "answers must be an object of strings" }, { status: 400 });
  if (isDbConfigured()) {
    const session = await requireAccountSession();
    if (session instanceof Response) return session;
    const run = await getStore().getRun(runId);
    if (!run || run.accountId !== session.accountId) return Response.json({ error: `run ${runId} not found` }, { status: 404 });
  }
  try {
    const result = await resumeWithInput(deps(), { runId, answers: body.answers as Record<string, unknown> });
    return Response.json({ run: summariseRun(result) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "resume failed";
    if (/not found/.test(message)) return Response.json({ error: message }, { status: 404 });
    if (/not waiting_input|no resumable snapshot/.test(message)) return Response.json({ error: message }, { status: 409 });
    if (/answers are empty/.test(message)) return Response.json({ error: message }, { status: 400 });
    return Response.json({ error: message }, { status: 500 });
  }
}

export const POST = withErrorCapture("api/routines/resume-input", handlePOST);
