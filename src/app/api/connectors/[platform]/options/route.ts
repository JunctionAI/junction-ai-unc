/* GET /api/connectors/<platform>/options — the founder's account choices after connecting.

   →  { platform, externalRef, options: [{ id, label }], listed }
      options are listed only while external_ref is null (or with ?refresh=1); once chosen
      the answer is the current ref with an empty list — no platform call.
   or { fallback: true, reason }        DB / secret store / developer token not switched on
   or 401 | 403 | 404 | 409 | 502 { error }   409 = the token needs a reconnect

   Session-bound through the same HandlerDeps as start/callback (src/lib/connectors/handlers.ts).
   Platforms: ga4 (Admin API accountSummaries), google_ads (listAccessibleCustomers with the
   developer token), meta_ads (/me/adaccounts). Anything else → 404. */

import { handleOptions } from "@/lib/connectors/handlers";
import { handlerDeps } from "@/lib/connectors/server";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const deps = await handlerDeps(req);
  const result = await handleOptions(deps, platform, { refresh });
  return Response.json(result.body, { status: result.status });
}

export const GET = withErrorCapture("api/connectors/[platform]/options", handleGET);
