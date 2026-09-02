/* POST /api/connectors/<platform>/disconnect — forget a connection.

   →  { ok: true, status: "disconnected" }         secret deleted, row disconnected, receipt written
   or { fallback: true, reason }                    accounts / DB not switched on (demo mode)
   or 401 | 403 | 404 { error }

   Session-bound through the same HandlerDeps as start/callback; the platform-side revoke is
   the founder's (each platform's connected-apps page) — noted in the receipt. */

import { handleDisconnect } from "@/lib/connectors/handlers";
import { handlerDeps } from "@/lib/connectors/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const deps = await handlerDeps(req);
  const result = await handleDisconnect(deps, platform);
  return Response.json(result.body, { status: result.status });
}
