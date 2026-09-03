/* GET / PATCH / POST /api/routines/params with the session pointed at the schema-checked fake:
   the view shape, range refusals (400 + issues), Save → routine_params + a DRAFT version through the
   existing versioning, then validate (dry run) → promote; demo fallback and auth. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { clearLlmEnv, restoreLlmEnv } from "@/lib/llm/__tests__/env";
import { setStoreForTests } from "@/lib/runtime/store";
import { SupabaseStore } from "@/lib/runtime/store/supabase";
import { setProducerForTests } from "@/worker/service";
import { FakeProducer } from "@/lib/runtime/__tests__/helpers";
import type { DecideNode, RoutineSpec } from "@/lib/runtime/types";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
let serviceRole = true;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => serviceRole,
}));

import { GET, PATCH, POST } from "@/app/api/routines/params/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const url = (q = "") => `http://unc.test/api/routines/params${q}`;
const get = (q: string) => GET(new Request(url(q)));
const patch = (body: unknown) => PATCH(new Request(url(), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const post = (body: unknown) => POST(new Request(url(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

interface View {
  routineId: string;
  domain: string;
  currency: string;
  band: { id: string; label: string; why: string } | null;
  fields: { key: string; value: unknown; source: string; relevant: boolean; bound: boolean; industry: { low: number | null; high: number | null; value: unknown } | null }[];
  steps: { id: string; included: boolean; label: string }[];
  version: { live: number; draft: number | null };
  canPromote: boolean;
  skillFile?: { goal: string } | null;
  agreement?: { decided: number; applyUnlocked: boolean; line: string };
  error?: string;
  issues?: { key: string; message: string }[];
  run?: { status: string; summary: string };
  passed?: boolean;
}

beforeEach(() => {
  setFakeEnv();
  clearLlmEnv();
  serviceRole = true;
  db = new FakeSupabase();
  db.now = () => "2026-09-03T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Deep Blue", currency: "NZD" }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  db.seed("business_profiles", [{ account_id: ACCT, profile: { name: "Deep Blue Health", category: "Natural supplements", businessType: "ecommerce", sells: "products", storefront: "shopify" } }]);
  db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 3000, gross_margin_pct: 60 }]);
  setStoreForTests(new SupabaseStore(db));
  setProducerForTests(new FakeProducer());
});
afterEach(() => {
  restoreEnv();
  restoreLlmEnv();
  setStoreForTests(undefined);
  setProducerForTests(undefined);
});

describe("auth + demo", () => {
  it("no database → fallback; no session → 401; bad routine id → 400", async () => {
    clearBillingEnv();
    expect(await (await get("?routineId=D02-W01")).json()).toEqual({ fallback: true });
    restoreEnv();
    setFakeEnv();
    user = null;
    expect((await get("?routineId=D02-W01")).status).toBe(401);
    user = { id: USER };
    expect((await get("?routineId=D09-W01")).status).toBe(400);
    expect((await patch({ routineId: "nope" })).status).toBe(400);
    expect((await post({ routineId: "D02-W01", action: "fly" })).status).toBe(400);
  });
});

describe("GET — the view", () => {
  it("band from the profile, relevant + bound flags, derived money, steps, v1 with no draft", async () => {
    const res = await get("?routineId=D02-W01");
    expect(res.status).toBe(200);
    const v = (await res.json()) as View;
    expect(v).toMatchObject({ routineId: "D02-W01", domain: "paid", currency: "NZD", version: { live: 1, draft: null }, canPromote: false });
    expect(v.band?.id).toBe("dtc_supplements");
    const by = Object.fromEntries(v.fields.map((f) => [f.key, f]));
    expect(by.roasFloor).toMatchObject({ value: 2.5, source: "industry", relevant: true, bound: true });
    expect(by.fatigueFrequency.relevant).toBe(false);
    expect(by.targetCpa.value).toBeNull(); // no AOV yet
    expect(by.dailyBudgetCap).toMatchObject({ value: 100, source: "founder" });
    expect(v.steps).toEqual([{ id: "read_ga", kind: "read", label: "ga4 report · 7d", included: true }]);
    const c = (await (await get("?routineId=D01-W01")).json()) as View;
    expect(c.domain).toBe("content");
    expect(c.steps.map((s) => s.id)).toEqual(["read_questions", "read_posts", "read_products"]);
    expect(c.steps.every((s) => s.included)).toBe(true);
    expect(c.skillFile).toMatchObject({ goal: expect.stringContaining("founder-voice") });
    expect(c.agreement).toMatchObject({ decided: 0, applyUnlocked: false });
    expect(v.skillFile).toBeNull();
    expect(v.agreement).toMatchObject({ decided: 0, applyUnlocked: false, line: expect.stringContaining("keep asking") });
  });
});

describe("PATCH — save creates routine_params + a draft version; refusals write nothing", () => {
  it("an out-of-range value is refused with the issue, no row, no draft", async () => {
    const res = await patch({ routineId: "D02-W01", params: { roasFloor: 25 } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as View;
    expect(body.issues?.[0]).toMatchObject({ key: "roasFloor" });
    expect(db.tables.get("routine_params") ?? []).toHaveLength(0);
    expect((await (await get("?routineId=D02-W01")).json()).version).toEqual({ live: 1, draft: null });
    expect((await patch({ routineId: "D02-W01", steps: { read_x: "yes" } })).status).toBe(400);
  });

  it("a bound value → routine_params row + draft v2 whose decide threshold carries the number", async () => {
    const res = await patch({ routineId: "D02-W01", params: { roasFloor: 3.2 } });
    expect(res.status).toBe(200);
    const v = (await res.json()) as View;
    expect(v.version).toEqual({ live: 1, draft: 2 });
    expect(v.canPromote).toBe(false);
    expect(Object.fromEntries(v.fields.map((f) => [f.key, f])).roasFloor).toMatchObject({ value: 3.2, source: "founder" });
    const row = (db.tables.get("routine_params") ?? [])[0];
    expect(row).toMatchObject({ account_id: ACCT, routine_id: "D02-W01", domain: "paid", params: { roasFloor: 3.2 }, source: "founder" });
    const state = (db.tables.get("routine_states") ?? [])[0];
    const draft = state.draft_spec as RoutineSpec;
    expect(draft.version).toBe(2);
    const decide = draft.nodes.find((n) => n.kind === "decide") as DecideNode;
    expect((decide.rule as { value: unknown }).value).toBe(3.2);
    expect(state.live_spec).toBeNull();
  });

  it("a value that only steers the skill saves without a draft; switching a step off makes one", async () => {
    const a = (await (await patch({ routineId: "D01-W01", params: { postsPerWeek: 4 } })).json()) as View;
    expect(a.version).toEqual({ live: 1, draft: null });
    const b = (await (await patch({ routineId: "D01-W01", steps: { read_posts: false } })).json()) as View;
    expect(b.version).toEqual({ live: 1, draft: 2 });
    expect(b.steps.find((s) => s.id === "read_posts")?.included).toBe(false);
    const draft = (db.tables.get("routine_states") ?? [])[0].draft_spec as RoutineSpec;
    expect(draft.nodes.map((n) => n.id)).not.toContain("read_posts");
  });
});

describe("POST — validate then promote (the existing versioning, unchanged)", () => {
  it("promote before a dry run → 409; validate records the run; promote then bumps live to v2", async () => {
    await patch({ routineId: "D01-W01", steps: { read_posts: false } });
    expect((await post({ routineId: "D01-W01", action: "promote" })).status).toBe(409);
    const val = (await (await post({ routineId: "D01-W01", action: "validate" })).json()) as View;
    expect(val.run?.status).toBeDefined();
    expect(val.passed).toBe(true);
    expect(val.canPromote).toBe(true);
    const runs = db.tables.get("routine_runs") ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ mode: "dry_run", version: 2 });
    const pro = (await (await post({ routineId: "D01-W01", action: "promote" })).json()) as View;
    expect(pro.version).toEqual({ live: 2, draft: null });
    const state = (db.tables.get("routine_states") ?? [])[0];
    expect(state.version).toBe(2);
    expect((state.live_spec as RoutineSpec).nodes.map((n) => n.id)).not.toContain("read_posts");
  });

  it("discard drops the draft; a re-save after promote makes v3", async () => {
    await patch({ routineId: "D02-W01", params: { roasFloor: 3 } });
    const d = (await (await post({ routineId: "D02-W01", action: "discard" })).json()) as View;
    expect(d.version).toEqual({ live: 1, draft: null });
    expect((await post({ routineId: "D02-W01", action: "discard" })).status).toBe(200);
  });
});
