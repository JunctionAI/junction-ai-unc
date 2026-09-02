/* Stripe → `subscriptions` row. The only writer of billing state; runs under the service-role
   client (0004 grants members read only). Called from the webhook route (signed events) and
   the checkout return route (the founder just came back from Stripe — same upsert, so the
   paywall lifts even if the webhook is seconds behind).

   Idempotency, two layers:
     1. billing_events: the event id is inserted before anything else; a duplicate delivery
        (23505) is acknowledged as `ignored:duplicate` and applies nothing.
     2. subscriptions is upserted on account_id and carries `last_event_at` = the event's
        `created`; an event older than what already wrote the row is skipped (Stripe does not
        guarantee ordering). Each event carries the whole subscription object, so applying the
        newest one is always a full, correct state.

   Account resolution: subscription.metadata.account_id (set by checkout via
   subscription_data.metadata) → checkout session client_reference_id → existing row by
   stripe_customer_id (the 0004 index). No match → `ignored:unknown_account`. */

import type Stripe from "stripe";
import { unwrap, type DbClient } from "@/lib/db/types";
import { stripeStatusToRow, type SubscriptionRow, type SubscriptionStatus } from "./gate";

export type SyncOutcome =
  | { handled: true; action: "upserted"; accountId: string; status: SubscriptionStatus }
  | { handled: false; reason: "duplicate" | "unknown_account" | "stale" | "unhandled_type" | "no_subscription" };

const iso = (unixSeconds: number | null | undefined): string | null => (typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null);
const idOf = (ref: string | { id: string } | null | undefined): string | null => (typeof ref === "string" ? ref : ref?.id ?? null);

/** The row projection of a Stripe subscription. current_period_end moved to the items in
    2025 API versions; fall back to the legacy top-level field for older pins. */
export function rowFromSubscription(accountId: string, sub: Stripe.Subscription): Omit<SubscriptionRow, "last_event_at" | "updated_at"> {
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  const itemEnd = sub.items?.data?.[0]?.current_period_end;
  return {
    account_id: accountId,
    stripe_customer_id: idOf(sub.customer),
    stripe_subscription_id: sub.id,
    status: stripeStatusToRow(sub.status),
    trial_ends_at: iso(sub.trial_end),
    current_period_end: iso(typeof itemEnd === "number" ? itemEnd : legacy),
    cancel_at_period_end: !!sub.cancel_at_period_end,
  };
}

async function findAccountByCustomer(db: DbClient, customerId: string | null): Promise<SubscriptionRow | null> {
  if (!customerId) return null;
  return unwrap<SubscriptionRow | null>(
    "subscriptions.select",
    db.from("subscriptions").select("account_id, status, last_event_at, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end").eq("stripe_customer_id", customerId).limit(1).maybeSingle(),
  );
}

async function currentRow(db: DbClient, accountId: string): Promise<SubscriptionRow | null> {
  return unwrap<SubscriptionRow | null>(
    "subscriptions.select",
    db.from("subscriptions").select("account_id, status, last_event_at, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end").eq("account_id", accountId).maybeSingle(),
  );
}

function isStale(existing: SubscriptionRow | null, eventAt: string | null): boolean {
  if (!existing?.last_event_at || !eventAt) return false;
  return Date.parse(eventAt) < Date.parse(existing.last_event_at);
}

/** Upsert the account's row from a Stripe subscription (skips when a newer event already wrote it). */
export async function applySubscription(db: DbClient, accountId: string, sub: Stripe.Subscription, eventAt: string | null, now: Date = new Date()): Promise<SyncOutcome> {
  const existing = await currentRow(db, accountId);
  if (isStale(existing, eventAt)) return { handled: false, reason: "stale" };
  const row = rowFromSubscription(accountId, sub);
  await unwrap("subscriptions.upsert", db.from("subscriptions").upsert({ ...row, last_event_at: eventAt ?? now.toISOString(), updated_at: now.toISOString() }, { onConflict: "account_id" }));
  return { handled: true, action: "upserted", accountId, status: row.status };
}

/** Record the customer for an account before checkout (status stays whatever it was; a fresh
    account gets a 'none' row). Lets a second checkout attempt reuse the same customer. */
export async function recordCustomer(db: DbClient, accountId: string, customerId: string, now: Date = new Date()): Promise<void> {
  const existing = await currentRow(db, accountId);
  await unwrap(
    "subscriptions.upsert",
    db.from("subscriptions").upsert({ account_id: accountId, stripe_customer_id: customerId, status: existing?.status ?? "none", updated_at: now.toISOString() }, { onConflict: "account_id" }),
  );
}

/** Insert the event id; false when it was already applied. */
export async function claimEvent(db: DbClient, event: Pick<Stripe.Event, "id" | "type">): Promise<boolean> {
  const { error } = await db.from("billing_events").insert({ id: event.id, type: event.type });
  if (!error) return true;
  if (error.code === "23505" || /duplicate key/i.test(error.message)) return false;
  throw new Error(`billing_events.insert: ${error.message}`);
}

export const HANDLED_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed"] as const;

function accountFromSubscription(sub: Stripe.Subscription): string | null {
  const m = sub.metadata?.account_id;
  return typeof m === "string" && m ? m : null;
}

/** Apply one verified Stripe event. Always resolves (the route answers 200 for every outcome
    except a bad signature); throws only on a database failure so Stripe retries. */
export async function handleStripeEvent(db: DbClient, event: Stripe.Event, now: Date = new Date()): Promise<SyncOutcome> {
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return { handled: false, reason: "unhandled_type" };
  if (!(await claimEvent(db, event))) return { handled: false, reason: "duplicate" };
  const eventAt = iso(event.created);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      let accountId = accountFromSubscription(sub);
      if (!accountId) accountId = (await findAccountByCustomer(db, idOf(sub.customer)))?.account_id ?? null;
      if (!accountId) return { handled: false, reason: "unknown_account" };
      return applySubscription(db, accountId, sub, eventAt, now);
    }
    case "checkout.session.completed": {
      // The subscription events carry the status; here we only pin customer + subscription ids
      // to the account (client_reference_id) so a later lookup by customer resolves.
      const session = event.data.object;
      const accountId = session.client_reference_id || (typeof session.metadata?.account_id === "string" ? session.metadata.account_id : null);
      if (!accountId) return { handled: false, reason: "unknown_account" };
      const subscriptionId = idOf(session.subscription as string | { id: string } | null);
      if (!subscriptionId) return { handled: false, reason: "no_subscription" };
      const existing = await currentRow(db, accountId);
      if (isStale(existing, eventAt)) return { handled: false, reason: "stale" };
      const status: SubscriptionStatus = existing?.status && existing.status !== "none" ? existing.status : "incomplete";
      await unwrap(
        "subscriptions.upsert",
        db.from("subscriptions").upsert(
          { account_id: accountId, stripe_customer_id: idOf(session.customer as string | { id: string } | null), stripe_subscription_id: subscriptionId, status, last_event_at: eventAt, updated_at: now.toISOString() },
          { onConflict: "account_id" },
        ),
      );
      return { handled: true, action: "upserted", accountId, status };
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customerId = idOf(invoice.customer as string | { id: string } | null);
      const subId = idOf((invoice.parent?.subscription_details?.subscription ?? null) as string | { id: string } | null);
      const row = await findAccountByCustomer(db, customerId);
      if (!row) return { handled: false, reason: "unknown_account" };
      if (subId && row.stripe_subscription_id && row.stripe_subscription_id !== subId) return { handled: false, reason: "unknown_account" };
      if (isStale(row, eventAt)) return { handled: false, reason: "stale" };
      await unwrap("subscriptions.update", db.from("subscriptions").update({ status: "past_due", last_event_at: eventAt, updated_at: now.toISOString() }).eq("account_id", row.account_id));
      return { handled: true, action: "upserted", accountId: row.account_id, status: "past_due" };
    }
    default:
      return { handled: false, reason: "unhandled_type" };
  }
}
