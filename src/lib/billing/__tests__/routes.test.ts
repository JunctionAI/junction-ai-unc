/* checkout / portal / return routes with the Stripe SDK faked (recorded calls, no network)
   and the session + service clients pointed at the schema-checked fake. */

import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "./env";
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
let serviceRole = true;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => serviceRole,
}));

const stripeCalls: { method: string; params: unknown }[] = [];
let retrieved: Record<string, unknown> | null = null;
const fakeStripe = {
  customers: { create: async (params: unknown) => (stripeCalls.push({ method: "customers.create", params }), { id: "cus_new" }) },
  checkout: {
    sessions: {
      create: async (params: unknown) => (stripeCalls.push({ method: "checkout.sessions.create", params }), { id: "cs_1", url: "https://checkout.stripe.test/c/cs_1" }),
      retrieve: async (id: string, params: unknown) => (stripeCalls.push({ method: "checkout.sessions.retrieve", params: { id, ...(params as object) } }), retrieved),
    },
  },
  billingPortal: { sessions: { create: async (params: unknown) => (stripeCalls.push({ method: "billingPortal.sessions.create", params }), { url: "https://billing.stripe.test/p/1" }) } },
};
vi.mock("@/lib/billing/config", async (importOriginal) => ({ ...(await importOriginal<typeof import("../config")>()), getStripe: () => fakeStripe as unknown as Stripe }));

import { POST as checkoutRoute } from "@/app/api/billing/checkout/route";
import { POST as portal } from "@/app/api/billing/portal/route";
import { GET as ret } from "@/app/api/billing/return/route";
import { checkoutParams } from "../checkout";
import { FAKE_ENV } from "./env";
import { getBillingForRequest } from "../server";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const checkout = () => checkoutRoute(new Request("https://unc.example.test/api/billing/checkout"));

beforeEach(() => {
  setFakeEnv();
  serviceRole = true;
  stripeCalls.length = 0;
  retrieved = null;
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
});
afterEach(() => restoreEnv());

describe("POST /api/billing/checkout", () => {
  it("page entitlement uses the selected client's subscription and never another client's paid plan", async () => {
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    db.insertRow("accounts", { id: other, name: "Other client" });
    db.insertRow("account_members", { account_id: other, user_id: USER, role: "member" });
    db.insertRow("subscriptions", { account_id: ACCT, status: "active" });
    db.insertRow("subscriptions", { account_id: other, status: "canceled" });
    expect((await getBillingForRequest(ACCT)).entitlement.state).toBe("active");
    expect((await getBillingForRequest(other)).entitlement.state).toBe("canceled");
    expect((await getBillingForRequest()).entitlement.state).toBe("none");
    expect((await getBillingForRequest("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).entitlement.state).toBe("none");
    expect(stripeCalls).toEqual([]);
  });
  it("returns { fallback: true } when billing isn't configured — Stripe is never touched", async () => {
    clearBillingEnv();
    const res = await checkout();
    expect(await res.json()).toEqual({ fallback: true });
    expect(stripeCalls).toEqual([]);
  });
  it("falls back when Stripe is set but the database isn't (nowhere to keep the row)", async () => {
    setFakeEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined });
    expect(await (await checkout()).json()).toEqual({ fallback: true });
  });
  it("401 without a session", async () => {
    user = null;
    expect((await checkout()).status).toBe(401);
    expect(stripeCalls).toEqual([]);
  });
  it("503 without the service role (the row can't be written)", async () => {
    serviceRole = false;
    expect((await checkout()).status).toBe(503);
  });
  it("403 for a member — billing changes are account-owner only", async () => {
    // RLS lets account members see peer membership rows. A peer owner must never make the
    // caller look like an owner: session resolution filters to this exact user id.
    db.rows("account_members")[0].user_id = "owner-peer";
    db.insertRow("account_members", { account_id: ACCT, user_id: USER, role: "member" });
    const res = await checkout();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect(stripeCalls).toEqual([]);
  });
  it("creates the customer, pins it on the row, and builds a 14-day-trial subscription session with card required", async () => {
    const res = await checkout();
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/c/cs_1" });
    expect(stripeCalls.map((c) => c.method)).toEqual(["customers.create", "checkout.sessions.create"]);
    expect(stripeCalls[0].params).toEqual({ email: "founder@example.test", metadata: { account_id: ACCT, user_id: USER } });
    expect(stripeCalls[1].params).toMatchObject({
      mode: "subscription",
      customer: "cus_new",
      client_reference_id: ACCT,
      line_items: [{ price: FAKE_ENV.STRIPE_PRICE_ID, quantity: 1 }],
      payment_method_collection: "always",
      subscription_data: { trial_period_days: 14, metadata: { account_id: ACCT } },
      automatic_tax: { enabled: true },
      success_url: `https://unc.example.test/api/billing/return?session_id={CHECKOUT_SESSION_ID}&account=${ACCT}`,
      cancel_url: `https://unc.example.test/app?billing=cancelled&account=${ACCT}`,
    });
    expect(db.rows("subscriptions")).toEqual([expect.objectContaining({ account_id: ACCT, stripe_customer_id: "cus_new", status: "none" })]);
  });
  it("reuses the customer on a second attempt and never downgrades an existing status", async () => {
    db.seed("subscriptions", [{ account_id: ACCT, stripe_customer_id: "cus_existing", status: "canceled" }]);
    await checkout();
    expect(stripeCalls.map((c) => c.method)).toEqual(["checkout.sessions.create"]);
    expect(stripeCalls[0].params).toMatchObject({ customer: "cus_existing" });
    expect(db.rows("subscriptions")).toEqual([expect.objectContaining({ stripe_customer_id: "cus_existing", status: "canceled" })]);
  });
  it("refuses checkout when the signed-in identity has no invited account", async () => {
    db.tables.set("account_members", []);
    const res = await checkout();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "invite_required" });
    expect(db.rows("account_members")).toHaveLength(0);
    expect(stripeCalls).toHaveLength(0);
  });
  it("502 (no details) when Stripe fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeStripe.checkout.sessions.create = async () => {
      throw new Error("Invalid API Key provided: sk_test_***");
    };
    const res = await checkout();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/sk_test/);
    spy.mockRestore();
    fakeStripe.checkout.sessions.create = async (params: unknown) => (stripeCalls.push({ method: "checkout.sessions.create", params }), { id: "cs_1", url: "https://checkout.stripe.test/c/cs_1" });
  });
  it("checkoutParams is the whole contract (also asserted directly)", () => {
    const p = checkoutParams({ secretKey: "sk", webhookSecret: "wh", priceId: "price_x", appUrl: "https://a.test" }, { accountId: "acct", customerId: "cus" });
    expect(p.subscription_data?.trial_period_days).toBe(14);
    expect(p.payment_method_collection).toBe("always");
    expect(p.mode).toBe("subscription");
  });
});

describe("POST /api/billing/portal", () => {
  it("fallback when unconfigured; 401 without a session", async () => {
    clearBillingEnv();
    expect(await (await portal(new Request("https://unc.example.test/api/billing/portal", { method: "POST" }))).json()).toEqual({ fallback: true });
    setFakeEnv();
    user = null;
    expect((await portal(new Request("https://unc.example.test/api/billing/portal", { method: "POST" }))).status).toBe(401);
  });
  it("409 when the account has no Stripe customer yet", async () => {
    expect((await portal(new Request("https://unc.example.test/api/billing/portal", { method: "POST" }))).status).toBe(409);
    expect(stripeCalls).toEqual([]);
  });
  it("403 for a member before a portal session is created", async () => {
    db.rows("account_members")[0].role = "member";
    db.seed("subscriptions", [{ account_id: ACCT, stripe_customer_id: "cus_existing", status: "active" }]);
    expect((await portal(new Request("https://unc.example.test/api/billing/portal", { method: "POST" }))).status).toBe(403);
    expect(stripeCalls).toEqual([]);
  });
  it("opens a portal session for the account's customer, returning to /app", async () => {
    db.seed("subscriptions", [{ account_id: ACCT, stripe_customer_id: "cus_existing", status: "active" }]);
    const res = await portal(new Request("https://unc.example.test/api/billing/portal", { method: "POST" }));
    expect(await res.json()).toEqual({ url: "https://billing.stripe.test/p/1" });
    expect(stripeCalls).toEqual([{ method: "billingPortal.sessions.create", params: { customer: "cus_existing", return_url: `https://unc.example.test/app?account=${ACCT}` } }]);
  });
});

describe("GET /api/billing/return", () => {
  it("resolves the original client's query selection, but never treats it as proof of checkout ownership", async () => {
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    db.seed("accounts", [{ id: other, name: "Second client" }]);
    db.seed("account_members", [{ account_id: other, user_id: USER, role: "owner" }]);
    retrieved = { id: "cs_1", client_reference_id: ACCT, subscription: { id: "sub_foreign", status: "active", customer: "cus_foreign", items: { data: [] } } };
    const response = await ret(new Request(`https://unc.example.test/api/billing/return?session_id=cs_1&account=${other}`));
    expect(response.headers.get("location")).toBe(`https://unc.example.test/app?account=${other}`);
    expect(db.rows("subscriptions")).toEqual([]);
    stripeCalls.length = 0;
    await ret(new Request(`https://unc.example.test/api/billing/return?session_id=cs_1&account=${ACCT}&account=${other}`));
    expect(stripeCalls).toEqual([]);
  });
  const req = (sid: string | null) => new Request(`https://unc.example.test/api/billing/return${sid === null ? "" : `?session_id=${sid}`}`);
  it("mirrors the subscription immediately and lands on /app?billing=welcome", async () => {
    retrieved = {
      id: "cs_1",
      client_reference_id: ACCT,
      subscription: { id: "sub_1", object: "subscription", customer: "cus_new", status: "trialing", trial_end: 1789203600, cancel_at_period_end: false, metadata: { account_id: ACCT }, items: { data: [{ current_period_end: 1789203600 }] } },
    };
    const res = await ret(req("cs_1"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://unc.example.test/app?account=${ACCT}&billing=welcome`);
    expect(stripeCalls[0]).toEqual({ method: "checkout.sessions.retrieve", params: { id: "cs_1", expand: ["subscription"] } });
    expect(db.rows("subscriptions")).toEqual([expect.objectContaining({ account_id: ACCT, stripe_subscription_id: "sub_1", status: "trialing" })]);
  });
  it("refuses a session that belongs to another account (plain redirect, nothing written)", async () => {
    retrieved = { id: "cs_1", client_reference_id: "someone-else", subscription: { id: "sub_9", status: "trialing", customer: "cus_9", items: { data: [] } } };
    const res = await ret(req("cs_1"));
    expect(res.headers.get("location")).toBe(`https://unc.example.test/app?account=${ACCT}`);
    expect(db.rows("subscriptions")).toEqual([]);
  });
  it("ignores a malformed session id and never calls Stripe", async () => {
    expect((await ret(req("../../evil"))).headers.get("location")).toBe(`https://unc.example.test/app?account=${ACCT}`);
    expect((await ret(req(null))).headers.get("location")).toBe(`https://unc.example.test/app?account=${ACCT}`);
    expect(stripeCalls).toEqual([]);
  });
  it("just goes home when unconfigured or signed out", async () => {
    user = null;
    expect((await ret(req("cs_1"))).headers.get("location")).toBe("https://unc.example.test/app");
    clearBillingEnv();
    expect((await ret(req("cs_1"))).headers.get("location")).toBe("https://unc.example.test/app");
  });
});
