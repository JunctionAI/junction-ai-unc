import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { billingEnv, billingUrls, getStripe, isBillingConfigured, PLAN_COPY, PLAN_PRICE_USD, TRIAL_DAYS } from "../config";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "./env";

beforeEach(() => clearBillingEnv());
afterEach(() => restoreEnv());

describe("isBillingConfigured — the env gate", () => {
  it("is off with nothing set (demo: everything open, no Stripe anywhere)", () => {
    expect(isBillingConfigured()).toBe(false);
    expect(billingEnv()).toBeNull();
  });
  it("needs all four vars, non-blank", () => {
    setFakeEnv({ STRIPE_WEBHOOK_SECRET: undefined });
    expect(isBillingConfigured()).toBe(false);
    setFakeEnv({ STRIPE_PRICE_ID: "   " });
    expect(isBillingConfigured()).toBe(false);
    setFakeEnv({ NEXT_PUBLIC_APP_URL: undefined });
    expect(isBillingConfigured()).toBe(false);
    setFakeEnv({ STRIPE_SECRET_KEY: undefined });
    expect(isBillingConfigured()).toBe(false);
    setFakeEnv();
    expect(isBillingConfigured()).toBe(true);
  });
  it("trims a trailing slash off the app URL and builds the redirect URLs from it", () => {
    setFakeEnv({ NEXT_PUBLIC_APP_URL: "https://unc.example.test/" });
    const env = billingEnv()!;
    expect(env.appUrl).toBe("https://unc.example.test");
    expect(billingUrls(env)).toEqual({
      success: "https://unc.example.test/api/billing/return?session_id={CHECKOUT_SESSION_ID}",
      cancel: "https://unc.example.test/app?billing=cancelled",
      portalReturn: "https://unc.example.test/app",
    });
  });
});

describe("getStripe — lazy, server-only SDK", () => {
  it("throws when unconfigured (never constructs a client without a key)", () => {
    expect(() => getStripe()).toThrow(/not configured/);
  });
  it("constructs once per key and makes no network call doing so", () => {
    setFakeEnv();
    const a = getStripe();
    const b = getStripe();
    expect(a).toBe(b);
    expect(typeof a.webhooks.constructEvent).toBe("function");
    setFakeEnv({ STRIPE_SECRET_KEY: "sk_test_unit_fake_other_0000000000" });
    expect(getStripe()).not.toBe(a);
  });
});

describe("plan constants — match the landing page", () => {
  it("is $100 USD / month with a 14-day trial, copy verbatim", () => {
    expect(PLAN_PRICE_USD).toBe(100);
    expect(TRIAL_DAYS).toBe(14);
    expect(PLAN_COPY.price).toBe("$100");
    expect(PLAN_COPY.priceSuffix).toBe("USD / month");
    expect(PLAN_COPY.trialBadge).toBe("14-day free trial");
    expect(PLAN_COPY.cta).toBe("Start your free trial");
    expect(PLAN_COPY.cancel).toBe("Cancel any time");
    expect(PLAN_COPY.checklist).toEqual([
      "Unc, working on your goal 24/7",
      "All 37 routines, customised to you",
      "Human experts behind him, always",
      "Nothing runs without your okay — everything receipted",
    ]);
  });
});
