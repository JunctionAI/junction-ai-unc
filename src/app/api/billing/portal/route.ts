/* POST /api/billing/portal — Stripe Customer Portal (cancel, update card, invoices) → { url }.
   Same gate as checkout; 409 when the account has no Stripe customer yet. */

import { billingEnv, getStripe } from "@/lib/billing/config";
import { createPortalSession } from "@/lib/billing/checkout";
import { requireBillingSession } from "@/lib/billing/server";
import { withErrorCapture } from "@/lib/observability/errors";

export const runtime = "nodejs";

async function handlePOST(req: Request) {
  const env = billingEnv();
  if (!env) return Response.json({ fallback: true });
  const session = await requireBillingSession(req);
  if (session instanceof Response) return session;
  try {
    const res = await createPortalSession(getStripe(), session.service, env, session.accountId);
    if ("error" in res) return Response.json({ error: "no subscription to manage yet" }, { status: 409 });
    return Response.json({ url: res.url });
  } catch (e) {
    console.error("[billing] portal:", e instanceof Error ? e.message : "error");
    return Response.json({ error: "could not open the billing portal" }, { status: 502 });
  }
}

export const POST = withErrorCapture("api/billing/portal", handlePOST);
