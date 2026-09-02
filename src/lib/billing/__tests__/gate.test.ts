import { beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { entitlementFromRow, getEntitlement, isOpen, stripeStatusToRow, trialDaysLeft, type SubscriptionRow } from "../gate";

const NOW = new Date("2026-09-02T09:00:00.000Z");
const row = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
  account_id: "acct-1",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  status: "none",
  trial_ends_at: null,
  current_period_end: null,
  cancel_at_period_end: false,
  ...over,
});

describe("entitlementFromRow — the state machine", () => {
  it("no row → none (paywall)", () => {
    expect(entitlementFromRow(null, NOW)).toEqual({ state: "none" });
    expect(isOpen({ state: "none" })).toBe(false);
  });
  it("'none' and 'incomplete' rows → none (checkout never finished)", () => {
    expect(entitlementFromRow(row({ status: "none" }), NOW).state).toBe("none");
    expect(entitlementFromRow(row({ status: "incomplete" }), NOW).state).toBe("none");
  });
  it("trialing → trialing with whole days left, period end = trial end", () => {
    const e = entitlementFromRow(row({ status: "trialing", trial_ends_at: "2026-09-16T09:00:00.000Z" }), NOW);
    expect(e).toEqual({ state: "trialing", trialDaysLeft: 14, periodEnd: "2026-09-16T09:00:00.000Z", cancelAtPeriodEnd: false });
    expect(isOpen(e)).toBe(true);
  });
  it("active → active (open), carrying period end + cancel flag", () => {
    const e = entitlementFromRow(row({ status: "active", current_period_end: "2026-10-02T09:00:00.000Z", cancel_at_period_end: true }), NOW);
    expect(e).toEqual({ state: "active", periodEnd: "2026-10-02T09:00:00.000Z", cancelAtPeriodEnd: true });
    expect(isOpen(e)).toBe(true);
  });
  it("past_due → past_due (still open, banner)", () => {
    const e = entitlementFromRow(row({ status: "past_due", current_period_end: "2026-10-02T09:00:00.000Z" }), NOW);
    expect(e.state).toBe("past_due");
    expect(isOpen(e)).toBe(true);
  });
  it("canceled → canceled (paywall)", () => {
    const e = entitlementFromRow(row({ status: "canceled" }), NOW);
    expect(e).toEqual({ state: "canceled" });
    expect(isOpen(e)).toBe(false);
  });
  it("demo is open", () => {
    expect(isOpen({ state: "demo" })).toBe(true);
  });
});

describe("trial math (fixed now = 2026-09-02T09:00Z)", () => {
  it("counts whole days up (ceil) so the last partial day still reads 1", () => {
    expect(trialDaysLeft("2026-09-16T09:00:00.000Z", NOW)).toBe(14);
    expect(trialDaysLeft("2026-09-16T08:59:59.000Z", NOW)).toBe(14);
    expect(trialDaysLeft("2026-09-03T09:00:00.000Z", NOW)).toBe(1);
    expect(trialDaysLeft("2026-09-02T10:00:00.000Z", NOW)).toBe(1);
  });
  it("floors at 0 once the trial end has passed (state stays trialing until Stripe says otherwise)", () => {
    expect(trialDaysLeft("2026-09-02T09:00:00.000Z", NOW)).toBe(0);
    expect(trialDaysLeft("2026-08-01T00:00:00.000Z", NOW)).toBe(0);
    expect(entitlementFromRow(row({ status: "trialing", trial_ends_at: "2026-08-01T00:00:00.000Z" }), NOW)).toMatchObject({ state: "trialing", trialDaysLeft: 0 });
  });
  it("tolerates a missing or unparseable trial end", () => {
    expect(trialDaysLeft(null, NOW)).toBe(0);
    expect(trialDaysLeft("not a date", NOW)).toBe(0);
  });
});

describe("stripeStatusToRow — Stripe vocabulary collapsed to the 0004 enum", () => {
  it("maps every Stripe status", () => {
    expect(stripeStatusToRow("trialing")).toBe("trialing");
    expect(stripeStatusToRow("active")).toBe("active");
    expect(stripeStatusToRow("past_due")).toBe("past_due");
    expect(stripeStatusToRow("unpaid")).toBe("past_due");
    expect(stripeStatusToRow("canceled")).toBe("canceled");
    expect(stripeStatusToRow("paused")).toBe("canceled");
    expect(stripeStatusToRow("incomplete")).toBe("incomplete");
    expect(stripeStatusToRow("incomplete_expired")).toBe("incomplete");
    expect(stripeStatusToRow("something_new")).toBe("none");
  });
});

describe("getEntitlement — reads the row through the schema-checked fake (0004)", () => {
  let db: FakeSupabase;
  beforeEach(() => {
    db = new FakeSupabase();
    db.seed("accounts", [{ id: "acct-1" }, { id: "acct-2" }]);
  });
  it("missing row → none, and the query is scoped to the account", async () => {
    expect(await getEntitlement(db, "acct-1", NOW)).toEqual({ state: "none" });
    const call = db.lastCall("subscriptions", "select");
    expect(call.filters).toEqual([{ kind: "eq", column: "account_id", value: "acct-1" }]);
    expect(call.single).toBe("maybeSingle");
  });
  it("reads the account's own row only", async () => {
    db.seed("subscriptions", [
      { account_id: "acct-1", status: "trialing", trial_ends_at: "2026-09-10T09:00:00.000Z", stripe_customer_id: "cus_1" },
      { account_id: "acct-2", status: "canceled", stripe_customer_id: "cus_2" },
    ]);
    expect(await getEntitlement(db, "acct-1", NOW)).toMatchObject({ state: "trialing", trialDaysLeft: 8 });
    expect(await getEntitlement(db, "acct-2", NOW)).toEqual({ state: "canceled" });
  });
  it("the migration only admits the six statuses", () => {
    expect(() => db.seed("subscriptions", [{ account_id: "acct-1", status: "unpaid" }])).toThrow(/violates check/);
  });
});
