/* SERVER ONLY — imports next/headers; never import from a client component. */
/* Supabase — server-side clients (App Router).

   getServerSupabase(): per-request client whose session comes from the auth cookies
     (@supabase/ssr). Always create a fresh one per request; never cache across requests.
     setAll is best-effort: Server Components can't write cookies, the proxy (src/proxy.ts)
     is what refreshes the session cookies for them.

   getServiceSupabase(): service-role client for trusted server work (the runtime worker,
     later). Bypasses RLS — never expose it to a route that acts on behalf of a browser
     without checking the session first. Key comes from SUPABASE_SERVICE_ROLE_KEY only. */

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicSupabaseEnv } from "./client";

export async function getServerSupabase(): Promise<SupabaseClient | null> {
  const env = publicSupabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

export function isServiceRoleConfigured(): boolean {
  return !!publicSupabaseEnv() && !!(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

export function getServiceSupabase(): SupabaseClient {
  const env = publicSupabaseEnv();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!env || !key) throw new Error("Supabase service role is not configured (SUPABASE_SERVICE_ROLE_KEY)");
  return createClient(env.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
