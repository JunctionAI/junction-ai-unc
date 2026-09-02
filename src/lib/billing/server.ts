/* SERVER ONLY — imports next/headers through src/lib/db/server; never import from a client
   component. Shared request plumbing for the billing routes and the /app page. */

import { asDb, isDbConfigured } from "@/lib/db/client";
import { getServerSupabase, getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";
import { createAccount, listMemberships } from "@/lib/db/accountState";
import type { DbClient } from "@/lib/db/types";
import { isBillingConfigured } from "./config";
import { getEntitlement, type Entitlement } from "./gate";

/** What the /app page hands to <Platform>. `configured=false` ⇒ the client ignores billing
    entirely (demo), exactly as before Phase 6. */
export interface BillingProps {
  configured: boolean;
  entitlement: Entitlement;
}

export const DEMO_BILLING: BillingProps = { configured: false, entitlement: { state: "demo" } };

/** Billing engages only with Stripe env AND a database (the row lives there). */
export function isBillingActive(): boolean {
  return isBillingConfigured() && isDbConfigured();
}

export async function getBillingForRequest(): Promise<BillingProps> {
  if (!isBillingActive()) return DEMO_BILLING;
  const supabase = await getServerSupabase();
  if (!supabase) return DEMO_BILLING;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { configured: true, entitlement: { state: "none" } }; // the proxy sends /app → /login first
  const db = asDb(supabase);
  const memberships = await listMemberships(db);
  if (!memberships.length) return { configured: true, entitlement: { state: "none" } };
  return { configured: true, entitlement: await getEntitlement(db, memberships[0].accountId) };
}

export interface BillingSession {
  userId: string;
  email: string | null;
  accountId: string;
  /** The founder's own client (RLS). */
  db: DbClient;
  /** Service-role client — the only writer of `subscriptions`. */
  service: DbClient;
}

const json = (body: unknown, status: number) => Response.json(body, { status });

/** Resolve the signed-in founder + their account for a billing route, or the Response to
    return instead: {fallback:true} when billing isn't active, 503 without the service role,
    401 without a session. Creates the account when the user has none yet (first sign-in
    raced the client-side bootstrap). */
export async function requireBillingSession(): Promise<BillingSession | Response> {
  if (!isBillingActive()) return json({ fallback: true }, 200);
  if (!isServiceRoleConfigured()) return json({ error: "billing storage is not configured" }, 503);
  const supabase = await getServerSupabase();
  if (!supabase) return json({ fallback: true }, 200);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "sign in first" }, 401);
  const db = asDb(supabase);
  const memberships = await listMemberships(db);
  const accountId = memberships.length ? memberships[0].accountId : await createAccount(db);
  return { userId: user.id, email: user.email ?? null, accountId, db, service: asDb(getServiceSupabase()) };
}
