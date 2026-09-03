/* GET /api/connectors/state — the Connectors grid's real state in accounts mode.

   →  { role, connectors: [{ platform, name, status, externalRef, lastSyncAt, lastSyncResult,
                             lastReadMetrics, oauthConfigured, tokenPath }] }
   or { fallback: true, reason }   accounts not switched on (demo mode: the grid keeps demo cards)
   or 401 | 403 { error }

   Session-bound through the same HandlerDeps as the connect routes. Polled by the card after a
   connect until lastSyncResult is set ("Reading…" → "Read ✓ · N metrics" / "Couldn't read"). */

import { handlerDeps } from "@/lib/connectors/server";
import { handleConnectorsState } from "@/lib/connectors/state";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const deps = await handlerDeps(req);
  const result = await handleConnectorsState(deps);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}

export const GET = withErrorCapture("api/connectors/state", handleGET);
