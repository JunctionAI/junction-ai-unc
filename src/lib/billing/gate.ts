/* Entitlement — what the account is allowed to see, derived from its `subscriptions` row.
   Pure functions + one read; no Stripe here. Takes the DbClient slice so the unit tests drive
   it with the schema-checked fake (src/lib/db/__tests__/fakeSupabase.ts).

   State machine (row.status → entitlement.state):
     no row / 'none' / 'incomplete'  → 'none'       paywall (start the trial)
     'trialing'                      → 'trialing'   open; sidebar "Trial · N days left"
     'active'                        → 'active'     open; sidebar "Plan · active · manage"
     'past_due'                      → 'past_due'   open + amber banner "Update card"
     'canceled'                      → 'canceled'   paywall (start again)
   and, before any of that, 'demo' when billing isn't configured — everything open, which is
   what the beta runs on. trialDaysLeft = ceil((trial_ends_at − now) / 1 day), floored at 0;
   a trial whose end has passed stays 'trialing' until Stripe's status event moves it
   (the row is Stripe's view, never a local guess). */

import type Stripe from "stripe";
import { unwrap, type DbClient } from "@/lib/db/types";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "none";
export type EntitlementState = "demo" | SubscriptionStatus;

export interface SubscriptionRow {
  account_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  last_event_at?: string | null;
  updated_at?: string;
}

export interface Entitlement {
  state: EntitlementState;
  /** Whole days left in the trial (0 when it has lapsed). Only for 'trialing'. */
  trialDaysLeft?: number;
  /** ISO — when the current paid period (or trial) ends. */
  periodEnd?: string;
  /** The founder asked to cancel; access continues until periodEnd. */
  cancelAtPeriodEnd?: boolean;
}

export const SUBSCRIPTION_COLUMNS = "account_id, stripe_customer_id, stripe_subscription_id, status, trial_ends_at, current_period_end, cancel_at_period_end, last_event_at";

/** The gate is open (control centre renders) for these states. */
export const OPEN_STATES: ReadonlySet<EntitlementState> = new Set(["demo", "trialing", "active", "past_due"]);
export function isOpen(e: Entitlement): boolean {
  return OPEN_STATES.has(e.state);
}

const DAY_MS = 86_400_000;

export function trialDaysLeft(trialEndsAt: string | null, now: Date): number {
  if (!trialEndsAt) return 0;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}

export function entitlementFromRow(row: SubscriptionRow | null, now: Date = new Date()): Entitlement {
  if (!row) return { state: "none" };
  switch (row.status) {
    case "trialing":
      return { state: "trialing", trialDaysLeft: trialDaysLeft(row.trial_ends_at, now), periodEnd: row.trial_ends_at ?? row.current_period_end ?? undefined, cancelAtPeriodEnd: !!row.cancel_at_period_end };
    case "active":
      return { state: "active", periodEnd: row.current_period_end ?? undefined, cancelAtPeriodEnd: !!row.cancel_at_period_end };
    case "past_due":
      return { state: "past_due", periodEnd: row.current_period_end ?? undefined, cancelAtPeriodEnd: !!row.cancel_at_period_end };
    case "canceled":
      return { state: "canceled" };
    case "incomplete":
    case "none":
    default:
      return { state: "none" };
  }
}

/** Read the account's row (RLS: members only) and derive the entitlement. Never throws on a
    missing row — that is simply 'none'. */
export async function getEntitlement(db: DbClient, accountId: string, now: Date = new Date()): Promise<Entitlement> {
  const row = await unwrap<SubscriptionRow | null>("subscriptions.select", db.from("subscriptions").select(SUBSCRIPTION_COLUMNS).eq("account_id", accountId).maybeSingle());
  return entitlementFromRow(row, now);
}

/** Collapse Stripe's status vocabulary to the row enum (documented in 0004_billing.sql). */
export function stripeStatusToRow(status: Stripe.Subscription.Status | string): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "paused":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    default:
      return "none";
  }
}
