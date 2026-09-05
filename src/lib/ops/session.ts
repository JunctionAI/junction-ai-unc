/* Server only. Operator authority is independent of beta membership and never uses user_metadata. */
import { asDb, isDbConfigured } from "@/lib/db/client";
import { getServerSupabase, getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";
import type { DbClient } from "@/lib/db/types";
export type OpsIdentity = { userId: string; service: DbClient };
export async function requireOpsIdentity(): Promise<OpsIdentity | Response> {
  if (!isDbConfigured() || !isServiceRoleConfigured()) return Response.json({ error: "Operator storage is unavailable." }, { status: 503 });
  const auth = await getServerSupabase();
  if (!auth) return Response.json({ error: "Operator storage is unavailable." }, { status: 503 });
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user || !user.email_confirmed_at || user.is_anonymous) return Response.json({ error: "Sign in with your verified operator account." }, { status: 401 });
  return { userId: user.id, service: asDb(getServiceSupabase()) };
}
