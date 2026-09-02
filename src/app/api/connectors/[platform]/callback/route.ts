/* GET /api/connectors/<platform>/callback — the platform sends the founder back here.

   Always a redirect: /app?connected=<platform> on success, /app?connect_error=<platform> on
   any failure (state, HMAC, exchange, storage) — never a stack trace, never a token.
   Register this exact URL with every platform: https://<APP_URL>/api/connectors/<platform>/callback */

import { NextResponse } from "next/server";
import { handleCallback } from "@/lib/connectors/handlers";
import { handlerDeps } from "@/lib/connectors/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const origin = new URL(req.url).origin;
  try {
    const deps = await handlerDeps(req);
    const { redirect } = await handleCallback(deps, platform, req.url);
    return NextResponse.redirect(new URL(redirect, origin));
  } catch {
    return NextResponse.redirect(new URL(`/app?connect_error=${encodeURIComponent(platform)}`, origin));
  }
}
