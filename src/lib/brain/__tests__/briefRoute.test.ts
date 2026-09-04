/* GET/POST /api/unc/brief with the session pointed at the schema-checked fake (accounts mode)
   and with nothing configured (demo mode). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { setStoreForTests } from "@/lib/runtime/store";
import { SupabaseStore } from "@/lib/runtime/store/supabase";
import { clearLlmEnv, restoreLlmEnv } from "@/lib/llm/__tests__/env";
import { setLlmDbForTests, setProviderFactoryForTests } from "@/lib/llm/router";
import type { LlmProvider } from "@/lib/llm/types";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
let serviceRole = true;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => serviceRole,
}));

import { GET, POST } from "@/app/api/unc/brief/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const RUN = "00000000-0000-4000-8000-00000000f001";
const AP = "00000000-0000-4000-8000-00000000a001";
const post = (body: unknown = {}) => POST(new Request("http://unc.test/api/unc/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  setFakeEnv();
  clearLlmEnv();
  serviceRole = true;
  db = new FakeSupabase();
  db.now = () => "2026-09-02T18:31:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  db.seed("account_profiles", [{ account_id: ACCT, cadence: { timezone: "Pacific/Auckland" } }]);
  db.seed("routine_runs", [{ id: RUN, account_id: ACCT, routine_id: "D02-W01", version: 1, mode: "dry_run", status: "done", started_at: "2026-09-02T15:00:00.000Z", finished_at: "2026-09-02T15:01:00.000Z" }]);
  db.seed("receipts", [{ account_id: ACCT, run_id: RUN, kind: "draft", description: "Would ask Tom: Move NZD 20/day to Prospecting NZ", created_at: "2026-09-02T15:00:30.000Z" }]);
  db.seed("approvals", [{ id: AP, account_id: ACCT, run_id: RUN, routine_id: "D02-W01", title: "Move NZD 20/day to Prospecting NZ", status: "pending", expires_at: "2026-09-04T15:00:00.000Z", created_at: "2026-09-02T15:00:00.000Z" }]);
  setStoreForTests(new SupabaseStore(db));
});
afterEach(() => {
  restoreEnv();
  restoreLlmEnv();
  setProviderFactoryForTests(undefined);
  setLlmDbForTests(undefined);
  setStoreForTests(undefined);
});

describe("demo mode + auth", () => {
  it("no database → { fallback: true }; 401 without a session; 503 without the service role", async () => {
    clearBillingEnv();
    expect(await (await GET()).json()).toEqual({ fallback: true });
    expect(await (await post()).json()).toEqual({ fallback: true });
    restoreEnv();
    setFakeEnv();
    user = null;
    expect((await GET()).status).toBe(401);
    user = { id: USER };
    serviceRole = false;
    expect((await post()).status).toBe(503);
  });
});

describe("the brief", () => {
  it("lets members read but blocks generation before any brief or model usage is written", async () => {
    db.rows("account_members")[0].role = "member";
    expect((await GET()).status).toBe(200);
    const res = await post({ force: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect(db.rows("daily_briefs")).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
  });

  it("GET is null before any brief (with the account-local day); POST writes today's (deterministic without a key); GET returns it; idempotent; force rewrites", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T18:31:00.000Z"), toFake: ["Date"] });
    try {
      expect(await (await GET()).json()).toEqual({ brief: null, day: "2026-09-03" });
      const posted = await (await post()).json();
      expect(posted.author).toBe("deterministic");
      expect(posted.existed).toBe(false);
      expect(posted.brief).toMatchObject({ accountId: ACCT, day: "2026-09-03" });
      expect(posted.brief.body).toBe("Overnight I completed 1 run and wrote 1 draft; 1 decision is waiting on you.");
      expect(posted.brief.items.map((i: { kind: string; ref: string }) => [i.kind, i.ref])).toEqual([
        ["needs_you", AP],
        ["happened", expect.any(String)],
      ]);
      expect(db.rows("daily_briefs")).toHaveLength(1);
      const again = await (await post()).json();
      expect(again.existed).toBe(true);
      expect(db.rows("daily_briefs")).toHaveLength(1);
      const forced = await (await post({ force: true })).json();
      expect(forced.existed).toBe(false);
      expect(db.rows("daily_briefs")).toHaveLength(1);
      expect((await (await GET()).json()).brief.day).toBe("2026-09-03");
    } finally {
      vi.useRealTimers();
    }
  });

  it("with a provider configured, the daily_brief task writes through the router (fake provider) and ledgers the call", async () => {
    clearLlmEnv({ ANTHROPIC_API_KEY: "fake" });
    const seen: { provider: string; model: string; maxTokens: number; effort?: string }[] = [];
    const fake = (id: LlmProvider["id"]): LlmProvider => ({
      id,
      async complete(req) {
        seen.push({ provider: id, model: req.model, maxTokens: req.maxTokens, effort: req.effort });
        return { text: JSON.stringify({ body: "One dry run overnight; the NZD 20/day move is waiting on you.", items: [{ kind: "needs_you", text: "The NZD 20/day move to Prospecting NZ.", ref: AP }] }), stopReason: "end", usage: { input: 700, output: 90 }, provider: id, model: req.model, latencyMs: 40 };
      },
    });
    setProviderFactoryForTests((id) => fake(id));
    const posted = await (await post()).json();
    expect(posted.author).toBe("model");
    expect(posted.brief.body).toBe("One dry run overnight; the NZD 20/day move is waiting on you.");
    expect(seen).toEqual([{ provider: "anthropic", model: "claude-sonnet-5", maxTokens: 4000, effort: "low" }]);
    expect(db.rows("llm_usage")[0]).toMatchObject({ account_id: ACCT, task: "daily_brief", provider: "anthropic" });
  });

  it("is session-bound: another account's brief is never read", async () => {
    db.seed("daily_briefs", [{ account_id: "00000000-0000-4000-8000-00000000acc2", day: "2026-09-03", body: "not yours", items: [] }]);
    expect((await (await GET()).json()).brief).toBeNull();
  });
});
