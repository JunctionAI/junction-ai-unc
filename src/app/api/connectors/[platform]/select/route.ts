/* POST /api/connectors/<platform>/select — store which account Unc should read.

   Body: { externalRef: string }      one of the ids GET …/options listed (validated for shape)
   →     { ok: true, externalRef }     connectors.external_ref set, status connected, receipt written
   or    { fallback: true, reason }    accounts not switched on
   or    400 | 401 | 403 | 404 { error }

   Same gates as …/options. No platform call is made here. */

import { handleSelect } from "@/lib/connectors/handlers";
import { handlerDeps } from "@/lib/connectors/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const deps = await handlerDeps(req);
  const result = await handleSelect(deps, platform, body);
  return Response.json(result.body, { status: result.status });
}
