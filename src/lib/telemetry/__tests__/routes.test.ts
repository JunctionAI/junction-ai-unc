/* GET/POST /api/unc/self-review and GET /api/telemetry/home with the session pointed at the
   schema-checked fake (accounts mode) and with nothing configured (demo mode). */

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

import { GET as getReview, POST as postReview } from "@/app/api/unc/self-review/route";
import { GET as getHome } from "@/app/api/telemetry/home/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const RUN = "00000000-0000-4000-8000-00000000f001";

beforeEach(() => {
  vi.useFakeTimers({toFake:["Date"]});
  vi.setSystemTime(new Date("2026-09-02T09:00:00.000Z"));
  setFakeEnv();
  clearLlmEnv(); // no provider keys → the deterministic review (the dev shell may carry real keys)
  serviceRole = true;
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  db.seed("routine_states", [{ account_id: ACCT, routine_id: "D01-W01", enabled: true, version: 1 }]);
  db.seed("routine_runs", [{ id: RUN, account_id: ACCT, routine_id: "D01-W01", version: 1, mode: "dry_run", status: "done", started_at: "2026-09-01T07:00:00.000Z", finished_at: "2026-09-01T07:01:00.000Z" }]);
  db.seed("receipts", [{ account_id: ACCT, run_id: RUN, kind: "draft", description: "Would ask: 3 founder posts", created_at: "2026-09-01T07:00:30.000Z" }]);
  db.seed("connectors", [{ account_id: ACCT, platform: "shopify", status: "connected" }]);
  db.seed("goals", [{ account_id: ACCT, category: "revenue", tier: "governing", title: "NZ$40k MRR", baseline: 28400 }]);
  db.seed("benchmarks", [{ metric_key: "repeat_purchase_pct", segment: "all", p50: 15, p75: 19, n: 6, computed_at: "2026-09-01T00:00:00.000Z" }]);
  setStoreForTests(new SupabaseStore(db));
});
afterEach(() => {
  vi.useRealTimers();
  restoreEnv();
  restoreLlmEnv();
  setProviderFactoryForTests(undefined);
  setLlmDbForTests(undefined);
  setStoreForTests(undefined);
});

describe("demo mode + auth", () => {
  it("no database → { fallback: true } on every route", async () => {
    clearBillingEnv();
    expect(await (await getReview(new Request("https://unc.test/api/unc/self-review", { method: "GET" }))).json()).toEqual({ fallback: true });
    expect(await (await postReview(new Request("https://unc.test/api/unc/self-review", { method: "POST" }))).json()).toEqual({ fallback: true });
    expect(await (await getHome(new Request("https://unc.test/api/telemetry/home", { method: "GET" }))).json()).toEqual({ fallback: true });
  });
  it("401 without a session, 503 without the service role", async () => {
    user = null;
    expect((await getReview(new Request("https://unc.test/api/unc/self-review", { method: "GET" }))).status).toBe(401);
    expect((await getHome(new Request("https://unc.test/api/telemetry/home", { method: "GET" }))).status).toBe(401);
    user = { id: USER };
    serviceRole = false;
    expect((await postReview(new Request("https://unc.test/api/unc/self-review", { method: "POST" }))).status).toBe(503);
  });
});

describe("GET /api/telemetry/home", () => {
  it("returns the three bar inputs (published benchmark + own), the account's segment and measured hours", async () => {
    const res = await getHome(new Request("https://unc.test/api/telemetry/home", { method: "GET" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.review).toBeNull();
    expect(body.segment).toBe("revenue_band:300k-2m"); // 28,400 × 12 = 340,800 → most specific segment
    expect(body.bar.map((b: { metricKey: string }) => b.metricKey)).toEqual(["content_drafts_per_week", "repeat_purchase_pct", "lead_response_hours"]);
    expect(body.bar[1].benchmark).toMatchObject({ p50: 15, p75: 19, n: 6, segment: "all" }); // falls back to "all"
    expect(body.bar[1].own).toBeNull();
    expect(body.automation).toEqual({ hoursSavedWk: 1.5, runsThisWeek: 1, routinesOn: 1 }); // D01-W01 = 1.5 h × 1 completed run
  });
});

describe("self-review", () => {
  it("lets members read but blocks generation before a review or model usage is written", async () => {
    db.rows("account_members")[0].role = "member";
    expect((await getReview(new Request("https://unc.test/api/unc/self-review", { method: "GET" }))).status).toBe(200);
    const res = await postReview(new Request("https://unc.test/api/unc/self-review", { method: "POST" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect(db.rows("self_reviews")).toHaveLength(0);
    expect(db.rows("llm_usage")).toHaveLength(0);
  });

  it("GET is null before any review; POST generates this week's review (deterministic without a key) and GET returns it", async () => {
    expect(await (await getReview(new Request("https://unc.test/api/unc/self-review", { method: "GET" }))).json()).toEqual({ review: null });
    const posted = await (await postReview(new Request("https://unc.test/api/unc/self-review", { method: "POST" }))).json();
    expect(posted.author).toBe("deterministic");
    expect(posted.review).toMatchObject({ weekStart: "2026-08-31", author: "deterministic" });
    expect(posted.review.worked).toBe("I completed 1 run and handed over 1 draft. No KPI contract has a measured actual yet.");
    expect(posted.review.ask).toBe("Is there one routine you want me to run more, or less, next week?");
    expect(db.rows("self_reviews")).toHaveLength(1);
    // idempotent per week
    await postReview(new Request("https://unc.test/api/unc/self-review", { method: "POST" }));
    expect(db.rows("self_reviews")).toHaveLength(1);
    const got = await (await getReview(new Request("https://unc.test/api/unc/self-review", { method: "GET" }))).json();
    expect(got.review.weekStart).toBe("2026-08-31");
    expect((await (await getHome(new Request("https://unc.test/api/telemetry/home", { method: "GET" }))).json()).review.weekStart).toBe("2026-08-31");
  });
  it("with a provider configured, the self_review task writes the review through the router (fake provider), honours the account's model pick and ledgers the call", async () => {
    clearLlmEnv({ ANTHROPIC_API_KEY: "fake", OPENAI_API_KEY: "fake" });
    db.seed("account_model_prefs", [{ account_id: ACCT, task: "self_review", model_id: "gpt-5", updated_at: "2026-09-01T00:00:00.000Z" }]);
    const seen: { provider: string; model: string; maxTokens: number; effort?: string }[] = [];
    const fake = (id: LlmProvider["id"]): LlmProvider => ({
      id,
      async complete(req) {
        seen.push({ provider: id, model: req.model, maxTokens: req.maxTokens, effort: req.effort });
        return { text: JSON.stringify({ worked: "I completed 1 run and handed over 1 draft.", changing: "Nothing yet.", ask: "Shall I keep going?", changes: [] }), stopReason: "end", usage: { input: 900, output: 120 }, provider: id, model: req.model, latencyMs: 42 };
      },
    });
    setProviderFactoryForTests((id) => fake(id));
    const posted = await (await postReview(new Request("https://unc.test/api/unc/self-review", { method: "POST" }))).json();
    expect(posted.author).toBe("sonnet");
    expect(posted.review.worked).toBe("I completed 1 run and handed over 1 draft.");
    expect(seen.filter((c: { maxTokens?: number }) => c.maxTokens === 4000)).toEqual([{ provider: "openai", model: "gpt-5", maxTokens: 4000, effort: "low" }]);
    // The self-review route also fires the Client Brain extraction hook (task memory_extract) — count only this task.
    const reviewCalls = db.rows("llm_usage").filter((r) => r.task === "self_review");
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0]).toMatchObject({ account_id: ACCT, task: "self_review", provider: "openai", model: "gpt-5", input_tokens: 900, output_tokens: 120, est_cost_usd: 0.002325, latency_ms: 42, stop_reason: "end" });
  });
  it("is session-bound: another user's account is never read", async () => {
    db.seed("self_reviews", [{ account_id: "00000000-0000-4000-8000-00000000acc2", week_start: "2026-08-31", body: "not yours", changes: [], evidence: {} }]);
    expect(await (await getReview(new Request("https://unc.test/api/unc/self-review", { method: "GET" }))).json()).toEqual({ review: null });
  });
});
