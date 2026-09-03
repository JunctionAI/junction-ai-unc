/* GET /api/connectors/shopify/install?shop=&hmac=&timestamp=&host= — the App Store's way in.

   Shopify sends the merchant to application_url (the landing page) with this query; the
   landing forwards it here (src/lib/connectors/installForward.ts). Verifies the HMAC + a
   fresh timestamp, then either parks the shop in a signed 10-minute cookie and sends the
   merchant to sign in (magic link → …/install/resume), or — with a session — starts the same
   OAuth flow the Connectors card uses and redirects to Shopify's authorize URL.
   Failures the merchant can't act on land on /app?connect_error=shopify, never a stack trace. */

import { handleShopifyInstall } from "@/lib/connectors/install";
import { ensureMerchantAccount, installErrorResponse, installResponse } from "@/lib/connectors/installServer";
import { handlerDeps } from "@/lib/connectors/server";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const origin = new URL(req.url).origin;
  try {
    const deps = await handlerDeps(req);
    await ensureMerchantAccount(deps);
    return installResponse(await handleShopifyInstall(deps, req.url), origin);
  } catch {
    return installErrorResponse(origin);
  }
}

export const GET = withErrorCapture("api/connectors/shopify/install", handleGET);
