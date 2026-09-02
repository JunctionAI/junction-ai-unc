/* POST /api/setup/agree — "Agree the plan →" for real: sets plans.agreed_at (spine step 1).

   →  { agreedAt, created }   idempotent — an already-agreed plan returns its original stamp
   or { fallback: true }      demo mode (no database)
   or 401 | 403 | 503 { error }

   Session-bound; written through the founder's own client (plans has a member_all policy). */

import { requireAccountSession } from "@/lib/db/session";
import { agreePlan } from "@/lib/setup/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  try {
    return Response.json(await agreePlan(session.db, session.accountId));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "agree failed" }, { status: 500 });
  }
}
