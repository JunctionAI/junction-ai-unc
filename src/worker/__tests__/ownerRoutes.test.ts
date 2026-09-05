/* Service-role routine triggers are owner commands in account mode. Members can use the
   read surfaces, but cannot create runs or resume a run that is waiting for founder input. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { setStoreForTests } from "@/lib/runtime/store";
import { SupabaseStore } from "@/lib/runtime/store/supabase";

const worker = vi.hoisted(() => ({ triggerRun: vi.fn(), resumeWithInput: vi.fn() }));
vi.mock("@/worker/service", () => ({
  triggerRun: worker.triggerRun,
  resumeWithInput: worker.resumeWithInput,
  WorkerError: class WorkerError extends Error {},
}));

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
const sessionClient = () => ({
  auth: { getUser: async () => ({ data: { user }, error: null }) },
  from: (table: string) => db.from(table),
  rpc: (fn: string, args?: Record<string, unknown>) => db.rpc(fn, args),
});

vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => true,
}));

import { POST as run } from "@/app/api/routines/run/route";
import { POST as resumeInput } from "@/app/api/routines/resume-input/route";

const ACCOUNT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const post = (path: string, body: unknown) => new Request(`http://unc.test${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-unc-account-id": ACCOUNT, "x-unc-context-generation": "0" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  setFakeEnv();
  db = new FakeSupabase();
  db.userId = USER;
  user = { id: USER, email: "member@example.test" };
  db.seed("accounts", [{ id: ACCOUNT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCOUNT, user_id: USER, role: "member" }]);
  setStoreForTests(new SupabaseStore(db));
  worker.triggerRun.mockReset();
  worker.resumeWithInput.mockReset();
});

afterEach(() => {
  restoreEnv();
  setStoreForTests(undefined);
});

describe("owner-only routine commands", () => {
  it("blocks a member before a manual run can produce or persist anything", async () => {
    const res = await run(post("/api/routines/run", { accountId: ACCOUNT, routineId: "D01-W01" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect(worker.triggerRun).not.toHaveBeenCalled();
    expect(db.rows("routine_runs")).toHaveLength(0);
    expect(db.rows("receipts")).toHaveLength(0);
    expect(db.rows("artifacts")).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
  });

  it("blocks a member before input can resume or mutate a run", async () => {
    const res = await resumeInput(post("/api/routines/resume-input", { runId: "run-waiting-input", answers: { about_the_business: "physio" } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect(worker.resumeWithInput).not.toHaveBeenCalled();
    expect(db.rows("routine_runs")).toHaveLength(0);
    expect(db.rows("receipts")).toHaveLength(0);
    expect(db.rows("artifacts")).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
  });
});
