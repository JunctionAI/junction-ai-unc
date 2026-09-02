/* GET /api/setup/progress, POST /api/setup/agree, POST /api/setup/enable with the session
   pointed at the schema-checked fake (accounts mode) and with nothing configured (demo). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { setStoreForTests } from "@/lib/runtime/store";
import { SupabaseStore } from "@/lib/runtime/store/supabase";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
let serviceRole = true;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => serviceRole,
}));

import { GET as getProgress } from "@/app/api/setup/progress/route";
import { POST as postAgree } from "@/app/api/setup/agree/route";
import { POST as postEnable } from "@/app/api/setup/enable/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const post = (path: string, body: unknown) => new Request(`http://unc.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  setFakeEnv();
  serviceRole = true;
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 3600, hours_weekly: 6, skills: ["Writing"], postures: ["brand_led"], breadth: "focused" }]);
  db.seed("plans", [{ account_id: ACCT, title: "Brand-led organic", phases: [], created_at: "2026-09-01T00:00:00.000Z" }]);
  setStoreForTests(new SupabaseStore(db));
});
afterEach(() => {
  restoreEnv();
  setStoreForTests(undefined);
});

describe("demo mode + auth", () => {
  it("no database → { fallback: true } on every route", async () => {
    clearBillingEnv();
    expect(await (await getProgress()).json()).toEqual({ fallback: true });
    expect(await (await postAgree()).json()).toEqual({ fallback: true });
    expect(await (await postEnable(post("/api/setup/enable", { routineId: "D01-W01" }))).json()).toEqual({ fallback: true });
  });
  it("401 without a session, 503 without the service role", async () => {
    user = null;
    expect((await getProgress()).status).toBe(401);
    expect((await postAgree()).status).toBe(401);
    user = { id: USER };
    serviceRole = false;
    expect((await getProgress()).status).toBe(503);
  });
});

describe("the spine through the routes", () => {
  it("progress → agree → enable moves the steps, idempotently", async () => {
    let p = await (await getProgress()).json();
    expect(p.done).toBe(0);
    expect(p.channel).toBe("Content");

    const a1 = await (await postAgree()).json();
    expect(a1).toMatchObject({ created: false });
    expect(a1.agreedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const a2 = await (await postAgree()).json();
    expect(a2.agreedAt).toBe(a1.agreedAt);
    expect(db.rows("plans")).toHaveLength(1);

    const e1 = await postEnable(post("/api/setup/enable", { routineId: "D01-W01" }));
    expect(e1.status).toBe(200);
    expect(await e1.json()).toEqual({ routineId: "D01-W01", enabled: true, version: 1 });
    const e2 = await postEnable(post("/api/setup/enable", { routineId: "D01-W01" }));
    expect((await e2.json()).enabled).toBe(true);
    expect(db.rows("routine_states")).toHaveLength(1);

    p = await (await getProgress()).json();
    expect(p.done).toBe(1); // routine on but no run yet
    expect(p.steps[2].status).toBe("Founder content engine is on — the first dry run hasn't landed yet.");
    expect(p.nextAction).toEqual({ step: "connect", label: "Connect Instagram", anchor: "view:connectors" });
  });

  it("enable validates the routine id", async () => {
    expect((await postEnable(post("/api/setup/enable", "{nope"))).status).toBe(400);
    expect((await postEnable(post("/api/setup/enable", { routineId: "nope" }))).status).toBe(400);
    expect((await postEnable(post("/api/setup/enable", { routineId: "D05-W08" }))).status).toBe(404);
  });
});
