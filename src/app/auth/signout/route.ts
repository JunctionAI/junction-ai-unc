/* POST /auth/signout — clears the session cookies and returns to /login.
   POST only (a GET link could be triggered cross-site). Demo mode: nothing to clear → /app. */

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db/client";
import { getServerSupabase } from "@/lib/db/server";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  if (!isDbConfigured()) return NextResponse.redirect(new URL("/app", origin), { status: 303 });
  const supabase = await getServerSupabase();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", origin), { status: 303 });
}
