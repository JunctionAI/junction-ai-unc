/* GET /api/connectors/shopify/install/resume — second half of the App Store install for a
   merchant who had to sign in first. /auth/callback?next=<this> lands here with the session
   in cookies and the shop in the signed unc_shopify_install cookie (set by ../route.ts).
   Reads + clears the cookie, makes sure an account exists, starts the OAuth flow. */

import { handleShopifyInstallResume, INSTALL_COOKIE } from "@/lib/connectors/install";
import { ensureMerchantAccount, installErrorResponse, installResponse } from "@/lib/connectors/installServer";
import { handlerDeps } from "@/lib/connectors/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  try {
    const deps = await handlerDeps(req);
    await ensureMerchantAccount(deps);
    return installResponse(await handleShopifyInstallResume(deps, cookieValue(req, INSTALL_COOKIE)), origin);
  } catch {
    return installErrorResponse(origin);
  }
}
