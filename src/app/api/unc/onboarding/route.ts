/* POST /api/unc/onboarding — "Agree the plan" → the onboarding answers become memories.

   Body: { answers: OnboardingAnswers }   (src/lib/brain/onboarding.ts; the client builds it from
                                          its state in src/components/platform/useOnboardingMemories.ts)
   →     { written, merged, failed }      source "onboarding", one source_ref per account, so a
                                          second agree merges instead of duplicating
   or    { fallback: true }               demo mode (no database) — nothing to remember into
   or    400 | 401 | 403 | 503 { error }

   Session-bound; writes with the service role (embeddings + the ledger need it). */

import { afterOnboarding } from "@/lib/brain/hooks";
import { coerceOnboardingAnswers } from "@/lib/brain/onboarding";
import { requireAccountSession } from "@/lib/db/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;

  let body: { answers?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const answers = coerceOnboardingAnswers(body.answers);
  if (!answers) return Response.json({ error: "answers.goalTitle is required" }, { status: 400 });

  const r = await afterOnboarding({ accountId: session.accountId, answers }, { db: session.service });
  return Response.json(r ?? { written: 0, merged: 0, failed: 0 });
}
