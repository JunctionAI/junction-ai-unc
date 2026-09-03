/* POST /api/connectors/<platform>/start — begin the Connect flow.

   Body: { shop?: string }          (Shopify only: your-store.myshopify.com)
   →     { url }                    send the browser here
   or    { fallback: true, reason } platform / secret store / accounts not switched on yet
   or    400 | 401 | 403 | 404 { error }

   Env-gated end to end (src/lib/connectors/handlers.ts): with nothing configured the answer is
   always a fallback, so demo mode is unchanged. No secret value is ever in the response. */

import { handleStart } from "@/lib/connectors/handlers";
import { handlerDeps } from "@/lib/connectors/server";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const deps = await handlerDeps(req);
  const result = await handleStart(deps, platform, body);
  return Response.json(result.body, { status: result.status });
}

export const POST = withErrorCapture("api/connectors/[platform]/start", handlePOST);
