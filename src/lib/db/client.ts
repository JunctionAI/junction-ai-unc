/* Supabase — environment gate + browser client.

   Env-gated like the Unc API routes: the app reads process.env only (never .env files) and
   keeps working exactly as today (client-side demo state) when nothing is configured.

     NEXT_PUBLIC_SUPABASE_URL        project URL          (public; inlined into the client bundle)
     NEXT_PUBLIC_SUPABASE_ANON_KEY   anon / publishable key (public; RLS is the security boundary)
     SUPABASE_SERVICE_ROLE_KEY       server-only, for the runtime worker — see server.ts

   Server clients (cookie session, service role) live in server.ts because they import
   next/headers, which must never reach a client bundle. */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbClient } from "./types";

/* NEXT_PUBLIC_* values are substituted at build time only when referenced literally,
   so these two expressions must stay exactly as written (no dynamic key access). */
export function publicSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** True when both public env vars are present. Everything account-related keys off this. */
export function isDbConfigured(): boolean {
  return publicSupabaseEnv() !== null;
}

/** Narrow the real client to the structural slice the app is written against. */
export function asDb(client: SupabaseClient): DbClient {
  return client as unknown as DbClient;
}

let browserClient: SupabaseClient | null = null;

/** Browser client (singleton). Throws when the DB isn't configured — call isDbConfigured() first. */
export function getBrowserSupabase(): SupabaseClient {
  const env = publicSupabaseEnv();
  if (!env) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  if (!browserClient) browserClient = createBrowserClient(env.url, env.anonKey);
  return browserClient;
}
