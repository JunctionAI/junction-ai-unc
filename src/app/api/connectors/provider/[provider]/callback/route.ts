/* GET /api/connectors/provider/<provider>/callback?platform=<platform>&state=<state>

   PROTOTYPE (env-gated: CONNECTOR_AUTH_PROVIDER). Where a hosted auth provider (Composio,
   Nango) sends the founder back after its connect UI — or where the app itself can call to
   "check now" with the same state when the provider's UI cannot redirect. Always a redirect:
   /app?connected=<platform> or /app?connect_error=<platform>; never a stack trace, never a
   token (no token passes through here at all — the provider keeps it).

   Register with the provider: https://<APP_URL>/api/connectors/provider/<provider>/callback */

import { NextResponse } from "next/server";
import { callbackViaProvider } from "@/lib/connectors/providers/connect";
import { handlerDeps } from "@/lib/connectors/server";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const origin = new URL(req.url).origin;
  const platform = new URL(req.url).searchParams.get("platform") || "provider";
  try {
    const deps = await handlerDeps(req);
    const { redirect } = await callbackViaProvider(deps, provider, req.url);
    return NextResponse.redirect(new URL(redirect, origin));
  } catch {
    return NextResponse.redirect(new URL(`/app?connect_error=${encodeURIComponent(platform)}`, origin));
  }
}

export const GET = withErrorCapture("api/connectors/provider/[provider]/callback", handleGET);
