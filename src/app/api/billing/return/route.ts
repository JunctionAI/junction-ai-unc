/* GET /api/billing/return?session_id=cs_… — where Checkout sends the founder on success.
   Retrieves the session (must belong to this account), mirrors the subscription into the
   row right away, then redirects to /app — so the paywall lifts even when the webhook is a
   few seconds behind. Any problem just redirects to /app; the webhook is the source of truth. */

import type Stripe from "stripe";
import { billingEnv, getStripe } from "@/lib/billing/config";
import { requireBillingSession } from "@/lib/billing/server";
import { applySubscription } from "@/lib/billing/sync";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";

async function handleGET(req: Request) {
  const url = new URL(req.url);
  const env = billingEnv();
  const home = new URL("/app", env?.appUrl || url.origin);
  if (!env) return Response.redirect(home, 303);
  const session = await requireBillingSession();
  if (session instanceof Response) return Response.redirect(home, 303);
  const sessionId = url.searchParams.get("session_id") || "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return Response.redirect(home, 303);
  try {
    const checkout = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    const sub = checkout.subscription as Stripe.Subscription | string | null;
    if (checkout.client_reference_id === session.accountId && sub && typeof sub !== "string") {
      await applySubscription(session.service, session.accountId, sub, null);
      home.searchParams.set("billing", "welcome");
    }
  } catch (e) {
    console.error("[billing] return:", e instanceof Error ? e.message : "error");
  }
  return Response.redirect(home, 303);
}

export const GET = withErrorCapture("api/billing/return", handleGET);
