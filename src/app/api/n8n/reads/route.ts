/* GET /api/n8n/reads?platform=&resource=&window=&limit=&fields=<json>&filter=<json>

   Authorization: Bearer <run-scoped data token>   (docs/N8N-ROUTINES.md "Seamless auth")

   →  200 { ok: true, rows, count, metrics, provenance: { platform, resource, window, fetchedAt, source, via: "n8n", receiptId } }
      200 { ok: false, code: "not_connected" | "secret_store_unavailable" | "platform_error", reason }   — "couldn't ask", honestly
      400 { error }  bad query · 401 bad / expired token · 403 out of scope · 404 no run for the token
      409 the run is closed · 429 rate limit · 503 no N8N_SIGNING_SECRET

   The sealed credential is resolved server-side (ConnectorCredentialProvider) and the SAME
   platform reader the worker uses answers; a `read` receipt lands on the run marked via n8n. */

import { withErrorCapture } from "@/lib/observability/errors";
import { authenticate, parseReadQuery, readForToken } from "@/lib/n8n/proxy";
import { proxyDeps } from "@/lib/n8n/routeDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const deps = proxyDeps();
  const auth = await authenticate(deps, req);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  const parsed = parseReadQuery(new URL(req.url).searchParams);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  const out = await readForToken(deps, auth, parsed.query);
  if (out.ok) return Response.json(out, { headers: { "cache-control": "no-store" } });
  return Response.json({ ok: false, code: out.code, reason: out.reason }, { status: out.status, headers: { "cache-control": "no-store" } });
}

export const GET = withErrorCapture("api/n8n/reads", handleGET);
