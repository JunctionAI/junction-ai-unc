/* SERVER ONLY — imports next/headers; never import from a client component. */
/* Supabase — server-side clients (App Router).

   getServerSupabase(): per-request client whose session comes from the auth cookies
     (@supabase/ssr). Always create a fresh one per request; never cache across requests.
     setAll is best-effort: Server Components can't write cookies, the proxy (src/proxy.ts)
     is what refreshes the session cookies for them.

   getServiceSupabase(): service-role client for trusted server work (the runtime worker,
     later). Bypasses RLS — never expose it to a route that acts on behalf of a browser
     without checking the session first. Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
     (the anon key is a browser concern and is not required here). */

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

/** URL + service-role key. The anon key is a browser concern — the worker (and every
    service-role client) only needs the project URL and SUPABASE_SERVICE_ROLE_KEY. */
export function serviceRoleEnv(): { url: string; serviceKey: string } | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

export function isServiceRoleConfigured(): boolean {
  return serviceRoleEnv() !== null;
}

export function getServiceSupabase(): SupabaseClient {
  const env = serviceRoleEnv();
  if (!env) throw new Error("Supabase service role is not configured (SUPABASE_SERVICE_ROLE_KEY)");
  return createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
