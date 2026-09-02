/* POST /api/billing/checkout — start the 14-day trial ($100 USD/month after; card required).

   Env-gated: { fallback: true } when billing isn't configured (demo/beta). Otherwise needs a
   signed-in founder; finds-or-creates their Stripe customer, creates a subscription-mode
   Checkout Session and returns { url } for the browser to follow. Keys never reach the
   client and are never logged. */

import { billingEnv, getStripe } from "@/lib/billing/config";
import { createCheckoutSession } from "@/lib/billing/checkout";
import { requireBillingSession } from "@/lib/billing/server";

export const runtime = "nodejs";

export async function POST() {
  const env = billingEnv();
  if (!env) return Response.json({ fallback: true });
  const session = await requireBillingSession();
  if (session instanceof Response) return session;
  try {
    const { url } = await createCheckoutSession(getStripe(), session.service, env, { accountId: session.accountId, email: session.email, userId: session.userId });
    return Response.json({ url });
  } catch (e) {
    console.error("[billing] checkout:", e instanceof Error ? e.message : "error");
    return Response.json({ error: "could not start checkout" }, { status: 502 });
  }
}
