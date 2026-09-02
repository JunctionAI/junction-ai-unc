/* The webhook route end-to-end without a Stripe account: the payload is signed locally with
   the SDK's own generateTestHeaderString against a fake secret, constructEvent verifies it
   for real (pure HMAC, no network), and the row writes land in the schema-checked fake. */

import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, FAKE_ENV, restoreEnv, setFakeEnv } from "./env";

let db: FakeSupabase;
let serviceRole = true;
vi.mock("@/lib/db/server", () => ({
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => serviceRole,
  getServerSupabase: async () => null,
}));

import { POST } from "@/app/api/billing/webhook/route";

const NOW_S = Math.floor(Date.parse("2026-09-02T09:00:00.000Z") / 1000);
const ACCT = "00000000-0000-4000-8000-00000000acc1";

let eventN = 0;
function subscription(over: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: "trialing",
    trial_end: NOW_S + 14 * 86400,
    cancel_at_period_end: false,
    metadata: { account_id: ACCT },
    items: { object: "list", data: [{ id: "si_1", object: "subscription_item", current_period_end: NOW_S + 14 * 86400 }] },
    ...over,
  };
}
function event(type: string, object: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return { id: `evt_${++eventN}`, object: "event", type, created: NOW_S, api_version: "2026-01-01", livemode: false, data: { object }, ...over };
}
function post(body: unknown, opts: { secret?: string; header?: string | null; timestamp?: number } = {}) {
  const payload = JSON.stringify(body);
  const header = opts.header === undefined ? Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? FAKE_ENV.STRIPE_WEBHOOK_SECRET, timestamp: opts.timestamp }) : opts.header;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header !== null) headers["stripe-signature"] = header;
  return POST(new Request("https://unc.example.test/api/billing/webhook", { method: "POST", body: payload, headers }));
}
const subRow = () => db.rows("subscriptions").find((r) => r.account_id === ACCT);

beforeEach(() => {
  setFakeEnv();
  serviceRole = true;
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.seed("accounts", [{ id: ACCT }]);
});
afterEach(() => restoreEnv());

describe("signature verification", () => {
  it("accepts a payload signed with the webhook secret", async () => {
    const res = await post(event("customer.subscription.created", subscription()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true, action: "upserted", accountId: ACCT, status: "trialing" });
  });
  it("400 on a payload signed with the wrong secret", async () => {
    const res = await post(event("customer.subscription.created", subscription()), { secret: "whsec_someone_else" });
    expect(res.status).toBe(400);
    expect(db.rows("subscriptions")).toEqual([]);
    expect(db.rows("billing_events")).toEqual([]);
  });
  it("400 on a tampered body, a garbage header, a missing header, and a stale timestamp", async () => {
    const payload = JSON.stringify(event("customer.subscription.created", subscription()));
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: FAKE_ENV.STRIPE_WEBHOOK_SECRET });
    const tampered = await POST(new Request("https://x/api/billing/webhook", { method: "POST", body: payload.replace("trialing", "active"), headers: { "stripe-signature": header } }));
    expect(tampered.status).toBe(400);
    expect((await post(event("customer.subscription.created", subscription()), { header: "t=1,v1=deadbeef" })).status).toBe(400);
    expect((await post(event("customer.subscription.created", subscription()), { header: null })).status).toBe(400);
    expect((await post(event("customer.subscription.created", subscription()), { timestamp: NOW_S - 10 * 365 * 86400 })).status).toBe(400);
    expect(db.rows("subscriptions")).toEqual([]);
  });
  it("503 when billing isn't configured (nothing should be pointed at us) — the signature is never checked", async () => {
    clearBillingEnv();
    const res = await post(event("customer.subscription.created", subscription()));
    expect(res.status).toBe(503);
  });
  it("503 when the service role is missing, after a good signature (Stripe retries later)", async () => {
    serviceRole = false;
    expect((await post(event("customer.subscription.created", subscription()))).status).toBe(503);
    expect(db.rows("subscriptions")).toEqual([]);
  });
});

describe("event → subscriptions row", () => {
  it("customer.subscription.created (trialing) upserts the full row on account_id", async () => {
    await post(event("customer.subscription.created", subscription()));
    expect(subRow()).toMatchObject({
      account_id: ACCT,
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      status: "trialing",
      trial_ends_at: "2026-09-16T09:00:00.000Z",
      current_period_end: "2026-09-16T09:00:00.000Z",
      cancel_at_period_end: false,
      last_event_at: "2026-09-02T09:00:00.000Z",
    });
    const call = db.lastCall("subscriptions", "upsert");
    expect(call.onConflict).toBe("account_id");
  });
  it("customer.subscription.updated moves trialing → active and carries cancel_at_period_end", async () => {
    await post(event("customer.subscription.created", subscription()));
    await post(event("customer.subscription.updated", subscription({ status: "active", trial_end: null, cancel_at_period_end: true, items: { object: "list", data: [{ current_period_end: NOW_S + 30 * 86400 }] } }), { created: NOW_S + 60 }));
    expect(subRow()).toMatchObject({ status: "active", trial_ends_at: null, cancel_at_period_end: true, current_period_end: new Date((NOW_S + 30 * 86400) * 1000).toISOString() });
    expect(db.rows("subscriptions")).toHaveLength(1);
  });
  it("customer.subscription.deleted → canceled", async () => {
    await post(event("customer.subscription.created", subscription()));
    await post(event("customer.subscription.deleted", subscription({ status: "canceled" }), { created: NOW_S + 120 }));
    expect(subRow()).toMatchObject({ status: "canceled" });
  });
  it("unpaid → past_due, paused → canceled, incomplete_expired → incomplete (the 0004 enum)", async () => {
    await post(event("customer.subscription.updated", subscription({ status: "unpaid" })));
    expect(subRow()).toMatchObject({ status: "past_due" });
    await post(event("customer.subscription.updated", subscription({ status: "paused" }), { created: NOW_S + 1 }));
    expect(subRow()).toMatchObject({ status: "canceled" });
    await post(event("customer.subscription.updated", subscription({ status: "incomplete_expired" }), { created: NOW_S + 2 }));
    expect(subRow()).toMatchObject({ status: "incomplete" });
  });
  it("checkout.session.completed pins customer + subscription ids (status incomplete until the subscription event lands)", async () => {
    const res = await post(event("checkout.session.completed", { id: "cs_1", object: "checkout.session", mode: "subscription", client_reference_id: ACCT, customer: "cus_1", subscription: "sub_1", metadata: { account_id: ACCT } }));
    expect(await res.json()).toMatchObject({ handled: true, status: "incomplete" });
    expect(subRow()).toMatchObject({ stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", status: "incomplete" });
    // …and does not regress a status the subscription event already set
    await post(event("customer.subscription.created", subscription(), { created: NOW_S + 1 }));
    await post(event("checkout.session.completed", { id: "cs_1", object: "checkout.session", client_reference_id: ACCT, customer: "cus_1", subscription: "sub_1" }, { created: NOW_S + 2 }));
    expect(subRow()).toMatchObject({ status: "trialing" });
  });
  it("invoice.payment_failed → past_due, resolved by customer id (the 0004 index)", async () => {
    await post(event("customer.subscription.updated", subscription({ status: "active", trial_end: null })));
    const res = await post(event("invoice.payment_failed", { id: "in_1", object: "invoice", customer: "cus_1", parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } } }, { created: NOW_S + 5 }));
    expect(await res.json()).toMatchObject({ handled: true, status: "past_due", accountId: ACCT });
    expect(subRow()).toMatchObject({ status: "past_due", last_event_at: new Date((NOW_S + 5) * 1000).toISOString() });
  });
  it("invoice.payment_failed for a customer we don't know is acknowledged and ignored", async () => {
    const res = await post(event("invoice.payment_failed", { id: "in_9", object: "invoice", customer: "cus_unknown" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: false, reason: "unknown_account" });
  });
  it("resolves the account by customer id when the subscription carries no metadata", async () => {
    await post(event("checkout.session.completed", { id: "cs_1", object: "checkout.session", client_reference_id: ACCT, customer: "cus_1", subscription: "sub_1" }));
    await post(event("customer.subscription.created", subscription({ metadata: {} }), { created: NOW_S + 1 }));
    expect(subRow()).toMatchObject({ status: "trialing" });
  });
  it("a subscription for an account we can't resolve is acknowledged (200) and not written", async () => {
    const res = await post(event("customer.subscription.created", subscription({ metadata: {}, customer: "cus_nobody" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: false, reason: "unknown_account" });
    expect(db.rows("subscriptions")).toEqual([]);
  });
  it("an event type we don't subscribe to is 200 + unhandled_type, and not recorded", async () => {
    const res = await post(event("customer.created", { id: "cus_1", object: "customer" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: false, reason: "unhandled_type" });
    expect(db.rows("billing_events")).toEqual([]);
  });
});

describe("idempotency + ordering", () => {
  it("the same event id delivered twice applies once (billing_events primary key)", async () => {
    const ev = event("customer.subscription.created", subscription());
    expect(await (await post(ev)).json()).toMatchObject({ handled: true });
    const again = await post(ev);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ handled: false, reason: "duplicate" });
    expect(db.callsFor("subscriptions", "upsert")).toHaveLength(1);
    expect(db.rows("billing_events")).toEqual([expect.objectContaining({ id: ev.id, type: "customer.subscription.created" })]);
  });
  it("an older event arriving after a newer one is skipped as stale (no regression to trialing)", async () => {
    await post(event("customer.subscription.updated", subscription({ status: "active", trial_end: null }), { created: NOW_S + 100 }));
    const late = await post(event("customer.subscription.created", subscription(), { created: NOW_S }));
    expect(await late.json()).toMatchObject({ handled: false, reason: "stale" });
    expect(subRow()).toMatchObject({ status: "active" });
  });
  it("a database failure answers 500 so Stripe retries", async () => {
    db.rpcs.boom = () => null;
    const broken = db.from.bind(db);
    db.from = ((table: string) => {
      if (table === "billing_events") throw new Error("connection reset");
      return broken(table);
    }) as typeof db.from;
    const res = await post(event("customer.subscription.created", subscription()));
    expect(res.status).toBe(500);
  });
});
