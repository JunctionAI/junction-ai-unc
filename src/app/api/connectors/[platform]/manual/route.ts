/* POST /api/connectors/<platform>/manual — connect with a pasted key (owner only).

   Body: { token: string,                       the key (sealed; never echoed)
           external_ref?: string,               meta_ads: act_…; ga4: property id; google_ads: customer id
           extra?: { shop?: string,             shopify: your-store.myshopify.com
                     refresh_token?: string,    (reserved)
                     expires_at?: string } }    meta_ads: when the token expires, if known
   →     { ok: true, platform, externalRef, label, reading }   tested with one read, sealed, receipt written;
                                                               reading=true means the first 90-day read is running
   or    400 { error, code? }   the platform's own refusal ("Shopify said: …"), or a malformed body
         401 | 403 { error }    sign in / not a member / not the owner (code owner_only)
         404 { error }          no token path for this platform
         503 { error, code }    secret store or account storage not configured

   Same HandlerDeps as the OAuth routes (src/lib/connectors/handlers.ts); the read-now hook is
   wired in src/lib/connectors/server.ts. */

import { handleManualConnect } from "@/lib/connectors/manual";
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
  const result = await handleManualConnect(deps, platform, body);
  return Response.json(result.body, { status: result.status });
}

export const POST = withErrorCapture("api/connectors/[platform]/manual", handlePOST);
