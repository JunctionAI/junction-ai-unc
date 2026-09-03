import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { setStoreForTests } from "@/lib/runtime/store";

let db: FakeSupabase;
let user: { id: string; email?: string } | null;
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (table: string) => db.from(table), rpc: (fn: string, args?: Record<string, unknown>) => db.rpc(fn, args) }),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => true,
}));

import { POST } from "@/app/api/routines/resume/route";

const ACCOUNT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const request = () => new Request("http://unc.test/api/routines/resume", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: "run-pending", decision: "approved" }) });

beforeEach(() => {
  setFakeEnv();
  db = new FakeSupabase();
  user = { id: USER, email: "member@example.test" };
  db.seed("accounts", [{ id: ACCOUNT, name: "Example" }]);
  db.seed("account_members", [{ account_id: ACCOUNT, user_id: USER, role: "member" }]);
  setStoreForTests(new MemoryStore());
});

afterEach(() => {
  restoreEnv();
  setStoreForTests(undefined);
});

describe("POST /api/routines/resume authorization", () => {
  it("refuses a member before the run-keyed approval path can resume anything", async () => {
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "owner_only" });
  });
});
