/* GET/POST /api/settings/models with the session pointed at the schema-checked fake
   (accounts mode) and with nothing configured (demo mode). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { clearLlmEnv, restoreLlmEnv } from "./env";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
let serviceRole = true;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({
  getServerSupabase: async () => sessionClient(),
  getServiceSupabase: () => db,
  isServiceRoleConfigured: () => serviceRole,
}));

import { GET, POST } from "@/app/api/settings/models/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const USER = "00000000-0000-4000-8000-00000000u5e1";
const post = (body: unknown) => POST(new Request("http://unc.test/api/settings/models", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  setFakeEnv();
  clearLlmEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" });
  serviceRole = true;
  db = new FakeSupabase();
  db.now = () => "2026-09-02T09:00:00.000Z";
  db.userId = USER;
  user = { id: USER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
});
afterEach(() => {
  restoreEnv();
  restoreLlmEnv();
});

describe("GET /api/settings/models", () => {
  it("returns the founder's prefs, what each task resolves to, the catalogue and which providers are connected", async () => {
    db.seed("account_model_prefs", [{ account_id: ACCT, task: "chat", model_id: "gpt-5-mini", updated_at: "2026-09-01T00:00:00.000Z" }]);
    const out = await (await GET()).json();
    expect(out.prefs).toEqual({ chat: "gpt-5-mini" });
    expect(out.resolved.chat).toMatchObject({ id: "gpt-5-mini", provider: "openai", source: "account" });
    expect(out.resolved.business_scan).toMatchObject({ id: "claude-haiku-4-5", source: "default" });
    expect(out.configured).toEqual({ anthropic: true, openai: true, gemini: false, openrouter: false, custom: false });
    expect(out.catalogue.map((e: { id: string }) => e.id)).toContain("claude-sonnet-5");
  });
  it("is session-bound: another account's prefs are never read; no session → 401", async () => {
    db.seed("account_model_prefs", [{ account_id: "00000000-0000-4000-8000-00000000acc2", task: "chat", model_id: "gpt-5", updated_at: "2026-09-01T00:00:00.000Z" }]);
    expect((await (await GET()).json()).prefs).toEqual({});
    user = null;
    expect((await GET()).status).toBe(401);
  });
  it("demo mode (no database) → { fallback: true }", async () => {
    clearBillingEnv();
    expect(await (await GET()).json()).toEqual({ fallback: true });
  });
});

describe("POST /api/settings/models", () => {
  it("writes the choice (schema-checked row), null clears it, and the response re-resolves", async () => {
    let out = await (await post({ task: "self_review", modelId: "claude-opus-5" })).json();
    expect(out).toMatchObject({ ok: true, prefs: { self_review: "claude-opus-5" } });
    expect(out.resolved.self_review).toMatchObject({ id: "claude-opus-5", source: "account" });
    expect(db.rows("account_model_prefs")).toMatchObject([{ account_id: ACCT, task: "self_review", model_id: "claude-opus-5", updated_at: expect.stringMatching(/^2026-/) }]);
    expect(db.lastCall("account_model_prefs", "upsert").onConflict).toBe("account_id,task");

    out = await (await post({ task: "self_review", modelId: null })).json();
    expect(out.prefs).toEqual({});
    expect(db.rows("account_model_prefs")).toEqual([]);
    expect(out.resolved.self_review).toMatchObject({ id: "claude-sonnet-5", source: "default" });
  });
  it("rejects unknown tasks and model ids, bad JSON; 401 without a session", async () => {
    expect((await post({ task: "poetry", modelId: "gpt-5" })).status).toBe(400);
    expect((await post({ task: "chat", modelId: "gpt-99" })).status).toBe(400);
    expect((await post({ task: "chat", modelId: "openrouter:deepseek/deepseek-chat" })).status).toBe(400);
    expect((await post({ task: "chat", modelId: 42 })).status).toBe(400);
    expect((await post("{")).status).toBe(400);
    expect(db.rows("account_model_prefs")).toEqual([]);
    user = null;
    expect((await post({ task: "chat", modelId: "gpt-5" })).status).toBe(401);
  });

  it("is owner-only", async () => {
    db.rows("account_members")[0].role = "member";
    const res = await post({ task: "chat", modelId: "gpt-5-mini" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect(db.rows("account_model_prefs")).toEqual([]);
  });
});
