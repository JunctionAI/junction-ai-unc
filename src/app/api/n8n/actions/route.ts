/* POST /api/n8n/actions — a workflow proposes a mutation (wave-2 shape, gated).

   Authorization: Bearer <run-scoped data token>
   Body: { platform, action, params?, target?, title?, why? }
   →  200 { queued: true, approvalId, receiptId, executed: false, executes: "wave_2", note }
      200 { queued: false, executed: false, reason }        (a test run — nothing to attach to)
      400 { error } · 401 / 404 / 409 / 429 / 503 as /api/n8n/reads

   TODAY IT ONLY RECORDS: a pending approval + a draft receipt on the run, for the founder to
   approve or hold. Nothing is executed — LIVE_MODE_ENABLED stays false and no executor is
   called from here. Execution of approved proposals comes with wave 2 (docs/N8N-ROUTINES.md). */

import { withErrorCapture } from "@/lib/observability/errors";
import { authenticate, parseAction, proposeAction } from "@/lib/n8n/proxy";
import { proxyDeps } from "@/lib/n8n/routeDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const deps = proxyDeps();
  const auth = await authenticate(deps, req);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = parseAction(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  return Response.json(await proposeAction(deps, auth, parsed.action), { headers: { "cache-control": "no-store" } });
}

export const POST = withErrorCapture("api/n8n/actions", handlePOST);
