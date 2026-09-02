/* GET /api/setup/progress — the five spine steps with real states (src/lib/setup/progress.ts).

   →  SetupProgress          { channel, agreedAt, steps[5], done, allDone, nextAction, platforms,
                               recommended, routines, running, counts, connectLater, dismissed }
   or { fallback: true }     demo mode (no database) — the demo Home never shows the card
   or 401 | 403 | 503 { error }

   Session-bound: always the caller's own account, read through the founder's own client
   (RLS) — every table here has a member read policy. */

import { requireAccountSession } from "@/lib/db/session";
import { setupProgress } from "@/lib/setup/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    return Response.json(await setupProgress(session.db, session.accountId));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "setup progress failed" }, { status: 500 });
  }
}
