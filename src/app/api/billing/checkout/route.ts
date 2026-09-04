/* POST /api/billing/checkout — start the 14-day trial (the visitor's country price after —
   US$100 / month by default; card required).

   Env-gated: { fallback: true } when billing isn't configured (demo/beta). Otherwise needs a
   signed-in founder; finds-or-creates their Stripe customer, creates a subscription-mode
   Checkout Session and returns { url } for the browser to follow. Keys never reach the
   client and are never logged. */

import { billingEnv, getStripe, priceIdFor } from "@/lib/billing/config";
import { createCheckoutSession } from "@/lib/billing/checkout";
import { requireBillingSession } from "@/lib/billing/server";
import { resolveLocaleFromRequest } from "@/lib/locale/resolve";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";

async function handlePOST(request: Request) {
  const env = billingEnv();
  if (!env) return Response.json({ fallback: true });
  const session = await requireBillingSession();
  if (session instanceof Response) return session;
  // Country price: STRIPE_PRICE_ID_<CUR> for the visitor's locale, else the base price.
  const locale = resolveLocaleFromRequest(request);
  try {
    const { url } = await createCheckoutSession(getStripe(), session.service, env, {
      accountId: session.accountId,
      email: session.email,
      userId: session.userId,
      priceId: priceIdFor(env, locale),
      locale: { country: locale.country, currency: locale.currency },
    });
    return Response.json({ url });
  } catch (e) {
    console.error("[billing] checkout:", e instanceof Error ? e.message : "error");
    return Response.json({ error: "could not start checkout" }, { status: 502 });
  }
}

export const POST = withErrorCapture("api/billing/checkout", handlePOST);
