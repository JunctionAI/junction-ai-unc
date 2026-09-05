/* POST /api/unc/onboarding — "Agree the plan" → the onboarding answers become memories.

   Body: { answers: OnboardingAnswers }   (src/lib/brain/onboarding.ts; the client builds it from
                                          its state in src/components/platform/useOnboardingMemories.ts)
   →     { written, merged, failed }      source "onboarding", one source_ref per account, so a
                                          second agree merges instead of duplicating
   or    { fallback: true }               demo mode (no database) — nothing to remember into
   or    400 | 401 | 403 | 503 { error }

   Owner-only and session-bound; writes with the service role (embeddings + the ledger need it). */

import { afterOnboarding } from "@/lib/brain/hooks";
import { coerceOnboardingAnswers } from "@/lib/brain/onboarding";
import { requireAccountOwnerSession } from "@/lib/db/session";
import { withErrorCapture } from "@/lib/observability/errors";
import { captureMemoryContext, contextChangedResponse, contextStillCurrent } from "@/lib/db/contextGeneration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const session = await requireAccountOwnerSession();
  if (session instanceof Response) return session;
  const context = await captureMemoryContext(session.service, session.accountId, req);
  if (context instanceof Response) return context;

  let body: { answers?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const answers = coerceOnboardingAnswers(body.answers);
  if (!answers) return Response.json({ error: "answers.goalTitle is required" }, { status: 400 });

  const r = await afterOnboarding({ accountId: session.accountId, answers }, { db: context.db });
  if (!await contextStillCurrent(session.service, session.accountId, context.generation)) return contextChangedResponse();
  return Response.json(r ?? { written: 0, merged: 0, failed: 0 });
}

export const POST = withErrorCapture("api/unc/onboarding", handlePOST);
