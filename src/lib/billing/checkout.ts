/* Checkout + Portal session builders — pure functions over the Stripe SDK surface they use,
   so the unit tests hand in a fake `stripe` and assert the exact params. */

import type Stripe from "stripe";
import type { DbClient } from "@/lib/db/types";
import { unwrap } from "@/lib/db/types";
import { billingUrls, TRIAL_DAYS, type BillingEnv } from "./config";
import { type SubscriptionRow } from "./gate";
import { recordCustomer } from "./sync";

/** The slice of the SDK these builders touch (structural, so tests can fake it). */
export interface StripeSlice {
  customers: { create(params: Stripe.CustomerCreateParams): Promise<{ id: string }> };
  checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }> } };
  billingPortal: { sessions: { create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } };
}

async function existingCustomerId(db: DbClient, accountId: string): Promise<string | null> {
  const row = await unwrap<Pick<SubscriptionRow, "stripe_customer_id"> | null>("subscriptions.select", db.from("subscriptions").select("stripe_customer_id").eq("account_id", accountId).maybeSingle());
  return row?.stripe_customer_id ?? null;
}

/** Find or create the account's Stripe customer; the id is pinned on the row (service role). */
export async function ensureCustomer(stripe: StripeSlice, service: DbClient, opts: { accountId: string; email: string | null; userId: string }): Promise<string> {
  const existing = await existingCustomerId(service, opts.accountId);
  if (existing) return existing;
  const customer = await stripe.customers.create({ email: opts.email ?? undefined, metadata: { account_id: opts.accountId, user_id: opts.userId } });
  await recordCustomer(service, opts.accountId, customer.id);
  return customer.id;
}

export interface CheckoutOpts {
  accountId: string;
  customerId: string;
  /** Per-country price (src/lib/billing/config.ts priceIdFor). Defaults to env.priceId. */
  priceId?: string;
  /** Resolved locale, recorded on the subscription's metadata for reconciliation. */
  locale?: { country: string; currency: string };
}

export function checkoutParams(env: BillingEnv, opts: CheckoutOpts): Stripe.Checkout.SessionCreateParams {
  const urls = billingUrls(env, opts.accountId);
  const localeMeta: Record<string, string> = opts.locale ? { country: opts.locale.country, currency: opts.locale.currency } : {};
  return {
    mode: "subscription",
    customer: opts.customerId,
    client_reference_id: opts.accountId,
    line_items: [{ price: opts.priceId || env.priceId, quantity: 1 }],
    // Card required to start the trial; cancel any time (the Portal handles it).
    payment_method_collection: "always",
    subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { account_id: opts.accountId, ...localeMeta } },
    metadata: { account_id: opts.accountId, ...localeMeta },
    allow_promotion_codes: true,
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    success_url: urls.success,
    cancel_url: urls.cancel,
  };
}

export async function createCheckoutSession(stripe: StripeSlice, service: DbClient, env: BillingEnv, opts: { accountId: string; email: string | null; userId: string; priceId?: string; locale?: CheckoutOpts["locale"] }): Promise<{ url: string }> {
  const customerId = await ensureCustomer(stripe, service, opts);
  const session = await stripe.checkout.sessions.create(checkoutParams(env, { accountId: opts.accountId, customerId, priceId: opts.priceId, locale: opts.locale }));
  if (!session.url) throw new Error("Stripe returned a Checkout Session without a url");
  return { url: session.url };
}

export async function createPortalSession(stripe: StripeSlice, service: DbClient, env: BillingEnv, accountId: string): Promise<{ url: string } | { error: "no_customer" }> {
  const customerId = await existingCustomerId(service, accountId);
  if (!customerId) return { error: "no_customer" };
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: billingUrls(env, accountId).portalReturn });
  return { url: session.url };
}
