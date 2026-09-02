/* SERVER ONLY (imports next/headers through ../db/server).

   optionalAccountContext(): for routes that are NOT session-bound (chat, scan, narrative
   run during onboarding, before an account may exist). When a signed-in founder with an
   account is calling, returns { accountId, db } so the router can honour their model
   setting and attribute the ledger row; otherwise null and the call proceeds exactly as
   in demo mode. Never throws. */

import { listMemberships } from "../db/accountState";
import { asDb, isDbConfigured } from "../db/client";
import { getServerSupabase, getServiceSupabase, isServiceRoleConfigured } from "../db/server";
import type { DbClient } from "../db/types";

export async function optionalAccountContext(): Promise<{ accountId: string; db: DbClient } | null> {
  try {
    if (!isDbConfigured() || !isServiceRoleConfigured()) return null;
    const supabase = await getServerSupabase();
    if (!supabase) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const memberships = await listMemberships(asDb(supabase));
    if (!memberships.length) return null;
    return { accountId: memberships[0].accountId, db: asDb(getServiceSupabase()) };
  } catch {
    return null;
  }
}
