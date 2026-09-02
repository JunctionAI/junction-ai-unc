/* SERVER ONLY — constructs the Stripe SDK; never import from a client component
   (components take the plan constants from ./plan and the entitlement as a prop).

   Billing — environment gate + lazy Stripe client. Same discipline as src/lib/db/client.ts:
   the app reads process.env only (never .env files), nothing is logged, and with the vars
   absent the product runs exactly as before (isBillingConfigured() → false → every account
   is "demo": everything open, no paywall, no Stripe call anywhere).

     STRIPE_SECRET_KEY       sk_live_… / sk_test_…   server-only
     STRIPE_WEBHOOK_SECRET   whsec_…                 server-only; signs every webhook POST
     STRIPE_PRICE_ID         price_…                 the $100 USD / month recurring price
     NEXT_PUBLIC_APP_URL     https://<domain>        success/cancel/return URLs for Checkout + Portal

   SUPABASE_SERVICE_ROLE_KEY is also needed at runtime (subscriptions rows are written by the
   service role only — see 0004_billing.sql); the routes report 503 without it rather than
   silently doing nothing. docs/BILLING-FIRST-BOOT.md has the full sequence. */

import Stripe from "stripe";

export * from "./plan";

export interface BillingEnv {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  appUrl: string;
}

const read = (name: string) => (process.env[name] || "").trim();

export function billingEnv(): BillingEnv | null {
  const secretKey = read("STRIPE_SECRET_KEY");
  const webhookSecret = read("STRIPE_WEBHOOK_SECRET");
  const priceId = read("STRIPE_PRICE_ID");
  // Literal reference: NEXT_PUBLIC_* is inlined at build time only when spelled out.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  if (!secretKey || !webhookSecret || !priceId || !appUrl) return null;
  return { secretKey, webhookSecret, priceId, appUrl };
}

/** True iff all four billing vars are present and non-blank. The paywall, the sidebar plan
    line and every /api/billing route key off this. */
export function isBillingConfigured(): boolean {
  return billingEnv() !== null;
}

let stripeClient: Stripe | null = null;
let stripeClientKey = "";

/** Lazily constructed Stripe SDK (singleton per key). Constructing it makes no network call;
    only resource methods do. Throws when billing isn't configured — check first. */
export function getStripe(): Stripe {
  const env = billingEnv();
  if (!env) throw new Error("Billing is not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_ID / NEXT_PUBLIC_APP_URL)");
  if (!stripeClient || stripeClientKey !== env.secretKey) {
    stripeClient = new Stripe(env.secretKey, { maxNetworkRetries: 1, appInfo: { name: "junction-unc" } });
    stripeClientKey = env.secretKey;
  }
  return stripeClient;
}

/** Where Stripe sends the founder back to. */
export function billingUrls(env: BillingEnv) {
  return {
    success: `${env.appUrl}/api/billing/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel: `${env.appUrl}/app?billing=cancelled`,
    portalReturn: `${env.appUrl}/app`,
  };
}
