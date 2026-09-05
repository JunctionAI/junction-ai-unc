/* POST /api/setup/agree — "Agree the plan →" for real: sets plans.agreed_at (spine step 1).

   →  { agreedAt, created }   idempotent — an already-agreed plan returns its original stamp
   or { fallback: true }      demo mode (no database)
   or 401 | 403 | 503 { error }

   Owner-bound; written through the server after a verified owner check. */

import { requireAccountOwnerSession } from "@/lib/db/session";
import { agreePlan } from "@/lib/setup/progress";
import { withErrorCapture } from "@/lib/observability/errors";
import { captureMemoryContext } from "@/lib/db/contextGeneration";
import { automationPauseResponse } from "@/lib/db/automationPause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const session = await requireAccountOwnerSession(req);
  if (session instanceof Response) return session;
  const context = await captureMemoryContext(session.service, session.accountId, req);
  if (context instanceof Response) return context;
  const paused = await automationPauseResponse(session.service, session.accountId);
  if (paused) return paused;
  try {
    return Response.json(await agreePlan(session.service, session.accountId));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "agree failed" }, { status: 500 });
  }
}

export const POST = withErrorCapture("api/setup/agree", handlePOST);
