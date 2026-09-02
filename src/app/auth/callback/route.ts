/* GET /auth/callback?code=…&next=/app — completes the magic-link (PKCE) sign-in by
   exchanging the code for a session; the session lands in cookies via @supabase/ssr.
   Without Supabase configured there is nothing to exchange → /app (demo mode). */

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db/client";
import { safeNext } from "@/lib/db/redirects";
import { getServerSupabase } from "@/lib/db/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  if (!isDbConfigured()) return NextResponse.redirect(new URL("/app", url.origin));

  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=link", url.origin));

  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.redirect(new URL("/app", url.origin));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));
  return NextResponse.redirect(new URL(next, url.origin));
}
