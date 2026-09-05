/* GET /api/approvals and POST /api/approvals/<id> with the session pointed at the
   schema-checked fake (accounts mode) and with nothing configured (demo mode). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { runRoutine } from "@/lib/runtime/engine";
import { StaticReader } from "@/lib/runtime/providers";
import { setStoreForTests } from "@/lib/runtime/store";
import type { Store } from "@/lib/runtime/store/interface";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { SupabaseStore } from "@/lib/runtime/store/supabase";
import { budgetMoveSpec, clock, input, SPEND_FIXTURE } from "@/lib/runtime/__tests__/helpers";
import { StaticAccountsSource } from "@/worker/accounts";
import { buildAdapters } from "@/worker/service";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
let serviceRole = true;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => serviceRole,
}));

import { GET as list } from "@/app/api/approvals/route";
import { POST as decide } from "@/app/api/approvals/[id]/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const OTHER = "00000000-0000-4000-8000-00000000acc2";

const post = (id: string, body: unknown) =>
  decide(new Request(`http://unc.test/api/approvals/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });

/** Frozen at beforeEach so the engine clock and FakeSupabase timestamps match. The API
    listing uses wall-clock `new Date()`, so this must stay close to now — a fixed 2026-09-02
    plus the spec's 24h gate made every pending row look expired the next day. */
let NOW: Date;

async function seedPaused(store: Store, accountId: string) {
  const clk = clock(NOW.toISOString());
  const adapters = { ...buildAdapters({ store, accounts: new StaticAccountsSource(), db: accountId === "demo" ? null : db, now: clk.now }), reader: new StaticReader(SPEND_FIXTURE, clk.now) };
  const r = await runRoutine(budgetMoveSpec(), input({ account: { accountId, currency: "NZD", budgetMonthly: 3000 }, triggeredBy: "manual" }), adapters, { mode: "live" });
  expect(r.status).toBe("waiting_approval");
  return r;
}

beforeEach(() => {
  setFakeEnv();
  serviceRole = true;
  NOW = new Date();
  db = new FakeSupabase();
  db.now = () => NOW.toISOString();
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [
    { id: ACCT, name: "Example Co", context_generation: 0, automation_paused: false },
    { id: OTHER, name: "Other Co", context_generation: 0, automation_paused: false },
  ]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  setStoreForTests(new SupabaseStore(db));
});
afterEach(() => {
  restoreEnv();
  setStoreForTests(undefined);
});

describe("GET /api/approvals", () => {
  it("demo mode (no database) → { fallback: true }", async () => {
    clearBillingEnv();
    expect(await (await list()).json()).toEqual({ fallback: true });
  });
  it("401 without a session; 503 without the service role; 403 without an account", async () => {
    user = null;
    expect((await list()).status).toBe(401);
    user = { id: USER };
    serviceRole = false;
    expect((await list()).status).toBe(503);
    serviceRole = true;
    // RLS would hide other people's memberships from this user; the fake has no RLS, so empty the table.
    user = { id: "00000000-0000-4000-8000-00000000u5e9" };
    db.tables.set("account_members", []);
    expect((await list()).status).toBe(403);
  });
  it("lists only the caller's pending approvals + recent receipts", async () => {
    const store = new SupabaseStore(db);
    const mine = await seedPaused(store, ACCT);
    await seedPaused(store, OTHER);
    const res = await list();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approvals.map((a: { id: string }) => a.id)).toEqual([mine.approval!.id]);
    expect(body.approvals[0]).toMatchObject({ routineId: "D02-W01", routineName: "Daily paid decisioning", status: "pending" });
    expect(body.receipts.every((r: { runId: string }) => r.runId === mine.runId)).toBe(true);
    expect(body.drafts).toEqual([]);
  });
});

describe("POST /api/approvals/<id>", () => {
  it("validates the body", async () => {
    expect((await post("x", "{nope")).status).toBe(400);
    expect((await post("x", { decision: "maybe" })).status).toBe(400);
  });
  it("accounts mode: session-bound — 401 without a session, 404 for another account's approval", async () => {
    const store = new SupabaseStore(db);
    const theirs = await seedPaused(store, OTHER);
    user = null;
    expect((await post(theirs.approval!.id, { decision: "held" })).status).toBe(401);
    user = { id: USER };
    expect((await post(theirs.approval!.id, { decision: "held" })).status).toBe(404);
    // untouched
    expect((await store.getApproval(theirs.approval!.id))!.status).toBe("pending");
  });
  it("accounts mode: members cannot approve or hold on the owner's behalf", async () => {
    const store = new SupabaseStore(db);
    const mine = await seedPaused(store, ACCT);
    db.rows("account_members")[0].role = "member";
    const res = await post(mine.approval!.id, { decision: "held" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect((await store.getApproval(mine.approval!.id))!.status).toBe("pending");
    expect(db.rows("taste_events")).toHaveLength(0);
  });
  it("accounts mode: Hold persists through the store, stamps decided_by = the caller, returns the receipts; second decision → 409", async () => {
    const store = new SupabaseStore(db);
    const mine = await seedPaused(store, ACCT);
    const res = await post(mine.approval!.id, { decision: "held" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approval).toMatchObject({ id: mine.approval!.id, status: "held" });
    expect(body.run).toMatchObject({ runId: mine.runId, status: "skipped" });
    expect(body.receipts.map((r: { kind: string }) => r.kind)).toEqual(["notification"]);
    const row = db.rows("approvals").find((r) => r.id === mine.approval!.id)!;
    expect(row).toMatchObject({ status: "held", decided_by: USER });
    expect(db.rows("taste_events").map((t) => t.action)).toEqual(["held"]);
    expect((await post(mine.approval!.id, { decision: "approved" })).status).toBe(409);
    expect((await post("00000000-0000-4000-8000-00000000dead", { decision: "approved" })).status).toBe(404);
  });
  it("demo mode: MemoryStore, unbound — Approve fails closed under the refusing executor", async () => {
    clearBillingEnv();
    serviceRole = false;
    const store = new MemoryStore();
    setStoreForTests(store);
    const paused = await seedPaused(store, "demo");
    const res = await post(paused.approval!.id, { decision: "approved" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approval.status).toBe("approved");
    expect(body.run.status).toBe("failed");
    expect(body.receipts.some((r: { kind: string }) => r.kind === "mutation")).toBe(false);
    expect((await store.listTasteEvents("demo")).map((t) => t.action)).toEqual(["approved"]);
  });
});
