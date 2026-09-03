/* POST /api/skills/n8n/test — call a webhook the way the engine would, with fixture material.

   Body: { routineId, webhookUrl }
   →     { ok: true, kind: "artifact", artifact: { kind, title, body, items }, ms }
       | { ok: true, kind: "needs", needs, ms } | { ok: true, kind: "accepted", note, ms }
       | { ok: false, error, ms }                                  (a bad reply is a 200 with ok:false — it is the answer)
   or    400 · 401 / 403 / 503 { error }. Owner (or admin) only.

   The payload is signed exactly like a run's and carries a test data token (runId "test:…"),
   so the workflow can call /api/n8n/reads and /context during the test. */

import { requireAccountSession } from "@/lib/db/session";
import { isAccountOwner, isAdminEmail, testWorkflow, webhookUrlProblem } from "@/lib/n8n/registry";
import { withErrorCapture } from "@/lib/observability/errors";
import { ROUTINE_ID_RE } from "@/lib/runtime/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function handlePOST(req: Request) {
  const session = await requireAccountSession();
  if (session instanceof Response) return session;
  const owner = await isAccountOwner(session.db, session.accountId, session.userId);
  if (!owner && !isAdminEmail(session.email)) return json({ error: "only the account owner can test a workflow", code: "owner_only" }, 403);
  let body: { routineId?: unknown; webhookUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const routineId = typeof body.routineId === "string" ? body.routineId.trim() : "";
  if (!ROUTINE_ID_RE.test(routineId)) return json({ error: "routineId must look like D0x-W0y" }, 400);
  const problem = webhookUrlProblem(body.webhookUrl);
  if (problem) return json({ error: problem }, 400);
  return json(await testWorkflow({ accountId: session.accountId, routineId, webhookUrl: (body.webhookUrl as string).trim() }, { env: process.env }));
}

export const POST = withErrorCapture("api/skills/n8n/test", handlePOST);
