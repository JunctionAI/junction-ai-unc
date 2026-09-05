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
import { GET as getRoutineState, POST as postRoutineState } from "@/app/api/routines/state/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const headers={"content-type":"application/json","x-unc-account-id":ACCT,"x-unc-context-generation":"0"};
const post=(path:string,body:unknown)=>{
  if(path==="/api/setup/enable" && body && typeof body==="object"){
    const b=body as {routineId:string};const r=db.rows("routine_states").find(r=>r.routine_id===b.routineId);
    body={enabled:true,version:r?.version??1,stateUpdatedAt:r?.updated_at??null,...b};
  }
  return new Request(`http://unc.test${path}`,{method:"POST",headers,body:typeof body==="string"?body:JSON.stringify(body)});
};

beforeEach(() => {
  setFakeEnv();
  serviceRole = true;
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Example Co", automation_paused: false }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  db.seed("resource_profiles", [{ account_id: ACCT, budget_monthly: 3600, hours_weekly: 6, skills: ["Writing"], postures: ["brand_led"], breadth: "focused", known_platforms: ["Instagram"] }]);
  db.seed("plans", [{ account_id: ACCT, title: "Brand-led organic", phases: [], created_at: "2026-09-01T00:00:00.000Z" }]);
  setStoreForTests(new SupabaseStore(db));
  // Route-wiring fixture only; actual SQL boundary was separately canaried.
  const rpc=db.rpc.bind(db);
  vi.spyOn(db,"rpc").mockImplementation(async(name,args)=>{
    if(name!=="set_agent_switch")return rpc(name,args);
    const row={account_id:args!.p_account,routine_id:args!.p_routine,enabled:args!.p_enabled,version:args!.p_expected_version,updated_at:"2026-09-05T12:00:00.000Z"};
    await db.from("routine_states").upsert(row,{onConflict:"account_id,routine_id"});
    return {data:{accountId:row.account_id,contextGeneration:args!.p_generation,routineId:row.routine_id,enabled:row.enabled,version:row.version,stateUpdatedAt:row.updated_at},error:null};
  });
});
afterEach(() => {
  restoreEnv();
  setStoreForTests(undefined);
});

describe("demo mode + auth", () => {
  it("no database → { fallback: true } on every route", async () => {
    clearBillingEnv();
    expect(await (await getProgress(new Request("https://unc.test/api/setup/progress", { method: "GET" }))).json()).toEqual({ fallback: true });
    expect(await (await postAgree(post("/api/setup/agree", {}))).json()).toEqual({ fallback: true });
    expect((await postEnable(post("/api/setup/enable", { routineId: "D01-W01" }))).status).toBe(503);
  });
  it("401 without a session, 503 without the service role", async () => {
    user = null;
    expect((await getProgress(new Request("https://unc.test/api/setup/progress", { method: "GET" }))).status).toBe(401);
    expect((await postAgree(post("/api/setup/agree", {}))).status).toBe(401);
    user = { id: USER };
    serviceRole = false;
    expect((await getProgress(new Request("https://unc.test/api/setup/progress", { method: "GET" }))).status).toBe(503);
  });
});

describe("the spine through the routes", () => {
  it("a cleared plan cannot be agreed or enabled from a held account or stale browser", async () => {
    db.rows("accounts")[0].automation_paused = true;
    expect((await postAgree(post("/api/setup/agree", {}))).status).toBe(503);
    expect((await postEnable(post("/api/setup/enable", { routineId: "D01-W01" }))).status).toBe(409);
    expect(db.rows("plans")[0].agreed_at).toBeFalsy();
    expect(db.rows("routine_states")).toHaveLength(0);
    db.rows("accounts")[0].automation_paused = false;
    db.rows("accounts")[0].context_generation = 1;
    expect((await postAgree(post("/api/setup/agree", {}))).status).toBe(409);
    const req = post("/api/setup/agree", {});
    req.headers.set("x-unc-context-generation", "1");
    expect((await postAgree(req)).status).toBe(200);
  });
  it("progress → agree → enable moves the steps, idempotently", async () => {
    let p = await (await getProgress(new Request("https://unc.test/api/setup/progress", { method: "GET" }))).json();
    expect(p.done).toBe(0);
    expect(p.channel).toBe("Content");

    const a1 = await (await postAgree(post("/api/setup/agree", {}))).json();
    expect(a1).toMatchObject({ created: false, accountName: "Example Co" });
    expect(a1.agreedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const a2 = await (await postAgree(post("/api/setup/agree", {}))).json();
    expect(a2.agreedAt).toBe(a1.agreedAt);
    expect(db.rows("plans")).toHaveLength(1);

    const e1 = await postEnable(post("/api/setup/enable", { routineId: "D01-W01" }));
    expect(e1.status).toBe(200);
    expect(await e1.json()).toMatchObject({saved:{accountId:ACCT,contextGeneration:0,routineId:"D01-W01",enabled:true,version:1}});
    const e2 = await postEnable(post("/api/setup/enable", { routineId: "D01-W01" }));
    expect((await e2.json()).saved.enabled).toBe(true);
    expect(db.rows("routine_states")).toHaveLength(1);

    p = await (await getProgress(new Request("https://unc.test/api/setup/progress", { method: "GET" }))).json();
    expect(p.done).toBe(1); // routine on but no run yet
    expect(p.steps[2].status).toBe("Founder content engine is on — the first dry run hasn't landed yet.");
    expect(p.nextAction).toEqual({ step: "connect", label: "Connect Instagram", anchor: "view:connectors" });
  });

  it("enable validates the routine id", async () => {
    expect((await postEnable(post("/api/setup/enable", "{nope"))).status).toBe(400);
    expect((await postEnable(post("/api/setup/enable", { routineId: "nope" }))).status).toBe(400);
    expect((await postEnable(post("/api/setup/enable", { routineId: "D05-W08" }))).status).toBe(400);
  });

  it("members may read routine state but cannot enable or toggle routines", async () => {
    db.rows("account_members")[0].role = "member";
    expect((await getRoutineState(new Request("http://unc.test/api/routines/state",{headers}))).status).toBe(200);
    expect((await postAgree(post("/api/setup/agree", {}))).status).toBe(403);
    expect((await postEnable(post("/api/setup/enable", { routineId: "D01-W01" }))).status).toBe(403);
    const toggle = new Request("http://unc.test/api/routines/state", {
      method: "POST",
      headers,
      body: JSON.stringify({ routineId: "D01-W01", enabled: true,version:1,stateUpdatedAt:null }),
    });
    expect((await postRoutineState(toggle)).status).toBe(403);
    expect(db.rows("routine_states")).toHaveLength(0);
  });
});
