/* POST /api/billing/webhook — Stripe events. Raw body + `stripe-signature` header verified
   with stripe.webhooks.constructEvent against STRIPE_WEBHOOK_SECRET (400 on any mismatch).
   Verified events go to handleStripeEvent (src/lib/billing/sync.ts) under the service role;
   every handled/ignored outcome answers 200 so Stripe stops retrying, a database failure
   answers 500 so it retries. Unconfigured → 503 (nothing should be pointed at us yet). */

import { asDb } from "@/lib/db/client";
import { getServiceSupabase, isServiceRoleConfigured } from "@/lib/db/server";
import { billingEnv, getStripe } from "@/lib/billing/config";
import { handleStripeEvent } from "@/lib/billing/sync";
import type Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const env = billingEnv();
  if (!env) return Response.json({ error: "billing is not configured" }, { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing stripe-signature" }, { status: 400 });
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, env.webhookSecret);
  } catch {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  if (!isServiceRoleConfigured()) return Response.json({ error: "billing storage is not configured" }, { status: 503 });
  try {
    const outcome = await handleStripeEvent(asDb(getServiceSupabase()), event);
    return Response.json({ received: true, ...outcome });
  } catch (e) {
    console.error("[billing] webhook:", event.type, e instanceof Error ? e.message : "error");
    return Response.json({ error: "could not record event" }, { status: 500 });
  }
}
