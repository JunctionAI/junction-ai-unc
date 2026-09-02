/* Auth proxy (Next 16 name for middleware — src/proxy.ts replaces src/middleware.ts).

   Landing (/): pins a `?country=XX` override into the unc_country cookie so the pricing
   locale sticks for the session (src/lib/locale/resolve.ts). No Supabase call on that path.

   Auth — no-op unless Supabase is configured. When it is:
     - refreshes the session cookies on every matched request (@supabase/ssr pattern);
     - /app/*  without a session → /login
     - /login  with a session    → /app
   Reads process.env only; nothing secret is involved (anon key + the user's own cookies). */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicSupabaseEnv } from "@/lib/db/client";
import { COUNTRY_COOKIE, COUNTRY_COOKIE_MAX_AGE, COUNTRY_QUERY, normalizeCountry } from "@/lib/locale/resolve";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    const res = NextResponse.next();
    const pin = normalizeCountry(request.nextUrl.searchParams.get(COUNTRY_QUERY));
    if (pin) res.cookies.set(COUNTRY_COOKIE, pin, { path: "/", maxAge: COUNTRY_COOKIE_MAX_AGE, sameSite: "lax" });
    return res;
  }

  const env = publicSupabaseEnv();
  if (!env) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates against Supabase Auth (never trust the cookie alone).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && path.startsWith("/app")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/", "/app/:path*", "/login"],
};
