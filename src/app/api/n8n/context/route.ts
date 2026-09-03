/* GET /api/n8n/context — the compact account context a workflow drafts from, the same material
   the built-in LlmProducer uses (docs/N8N-ROUTINES.md).

   Authorization: Bearer <run-scoped data token>
   →  200 { ok: true, routine: { id, name, kind, maxItems, purpose, minimum, craft, outputSpec, builtIn },
            account: { id, currency, today }, business, businessSummary, memories[], founderNotes,
            goal, plan, priorArtifacts[], playbooks[] (≤ 3), scopes[], run }
      401 / 404 / 409 / 429 / 503 as /api/n8n/reads */

import { withErrorCapture } from "@/lib/observability/errors";
import { authenticate, contextForToken } from "@/lib/n8n/proxy";
import { proxyDeps } from "@/lib/n8n/routeDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const deps = proxyDeps();
  const auth = await authenticate(deps, req);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  return Response.json(await contextForToken(deps, auth), { headers: { "cache-control": "no-store" } });
}

export const GET = withErrorCapture("api/n8n/context", handleGET);
