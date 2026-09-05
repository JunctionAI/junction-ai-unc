/* SERVER ONLY — imports next/headers through src/lib/db/server; never import from a client
   component. Shared request plumbing for the billing routes and the /app page. */

import { asDb, isDbConfigured } from "@/lib/db/client";
import { getServerSupabase, isServiceRoleConfigured } from "@/lib/db/server";
import { listMemberships } from "@/lib/db/accountState";
import { requireAccountOwnerSession, type AccountSession } from "@/lib/db/session";
import { toLocalePricing, type LocalePricing } from "@/lib/locale/countries";
import { resolveLocaleForRequest } from "@/lib/locale/server";
import { isBillingConfigured } from "./config";
import { getEntitlement, type Entitlement } from "./gate";
import { selectAccountMembership } from "../db/accountSelection";

/** What the /app page hands to <Platform>. `configured=false` ⇒ the client ignores billing
    entirely (demo), exactly as before Phase 6. */
export interface BillingProps {
  configured: boolean;
  entitlement: Entitlement;
  /** The visitor's resolved country price (src/lib/locale) — what the paywall displays. */
  pricing?: LocalePricing;
}

export const DEMO_BILLING: BillingProps = { configured: false, entitlement: { state: "demo" } };

/** Resolve the request's pricing locale for the /app page (header → cookie → ?country=). */
export async function pricingForRequest(override?: string): Promise<LocalePricing> {
  return toLocalePricing(await resolveLocaleForRequest(override));
}

/** Billing engages only with Stripe env AND a database (the row lives there). */
export function isBillingActive(): boolean {
  return isBillingConfigured() && isDbConfigured();
}

export async function getBillingForRequest(requestedAccountId?: unknown): Promise<BillingProps> {
  if (!isBillingActive()) return DEMO_BILLING;
  const supabase = await getServerSupabase();
  if (!supabase) return DEMO_BILLING;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { configured: true, entitlement: { state: "none" } }; // the proxy sends /app → /login first
  const db = asDb(supabase);
  const memberships = await listMemberships(db, user.id);
  const selection = selectAccountMembership(memberships, requestedAccountId);
  if (!selection.ok) return { configured: true, entitlement: { state: "none" } };
  return { configured: true, entitlement: await getEntitlement(db, selection.membership.accountId) };
}

/** `service` is the only writer of `subscriptions`. */
export type BillingSession = AccountSession;

const json = (body: unknown, status: number) => Response.json(body, { status });

/** Resolve the signed-in founder + their account for a billing route, or the Response to
    return instead: {fallback:true} when billing isn't active, 503 without the service role,
    401 without a session, or 403 when the identity has no invited account. Same resolution
    as every other session-bound route (src/lib/db/session.ts) with the billing gate in front. */
export async function requireBillingSession(request?: Request): Promise<BillingSession | Response> {
  if (!isBillingActive()) return json({ fallback: true }, 200);
  if (!isServiceRoleConfigured()) return json({ error: "billing storage is not configured" }, 503);
  return requireAccountOwnerSession(request);
}
