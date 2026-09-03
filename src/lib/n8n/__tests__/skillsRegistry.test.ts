/* The skills registry: source resolution, register / patch semantics, the test call, and the
   API's owner / admin gating with the session pointed at the schema-checked fake. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { clearBillingEnv, restoreEnv, setFakeEnv } from "@/lib/billing/__tests__/env";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { setStoreForTests } from "@/lib/runtime/store";
import { verify } from "@/lib/artifacts/signing";
import { verifyDataToken } from "../dataToken";
import { isAdminEmail, patchWorkflow, registerWorkflow, skillRows, skillSourceFor, testWorkflow, webhookUrlProblem } from "../registry";

let db: FakeSupabase;
let user: { id: string; email?: string } | null = null;
const sessionClient = () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: (t: string) => db.from(t), rpc: (f: string, a?: Record<string, unknown>) => db.rpc(f, a) });
vi.mock("@/lib/db/server", () => ({ getServerSupabase: async () => sessionClient(), getServiceSupabase: () => db, isServiceRoleConfigured: () => true }));

import { GET, PATCH, POST } from "@/app/api/skills/n8n/route";
import { POST as testPOST } from "@/app/api/skills/n8n/test/route";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const OWNER = "00000000-0000-4000-8000-00000000u5e1";
const MEMBER = "00000000-0000-4000-8000-00000000u5e2";
const HOOK = "https://n8n.example/webhook/founder";
let store: MemoryStore;
let ids = 0;
const idGen = () => `wf-${++ids}`;
const jreq = (method: string, body: unknown) => new Request("http://unc.test/api/skills/n8n", { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  setFakeEnv();
  process.env.N8N_SIGNING_SECRET = "s3cret";
  process.env.UNC_ADMIN_EMAILS = "tom@getjunction.ai, ops@getjunction.ai";
  db = new FakeSupabase();
  db.now = () => "2026-09-03T07:00:00.000Z";
  db.userId = OWNER;
  user = { id: OWNER, email: "founder@example.test" };
  db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
  db.seed("account_members", [
    { account_id: ACCT, user_id: OWNER, role: "owner" },
    { account_id: ACCT, user_id: MEMBER, role: "member" },
  ]);
  store = new MemoryStore();
  setStoreForTests(store);
  ids = 0;
});
afterEach(() => {
  restoreEnv();
  delete process.env.N8N_SIGNING_SECRET;
  delete process.env.UNC_ADMIN_EMAILS;
  setStoreForTests(undefined);
  vi.unstubAllGlobals();
});

describe("registry (lib)", () => {
  it("source: own active row → global active row → built-in → none; rows for all 35", async () => {
    const rows = [
      { id: "g", accountId: null, routineId: "D01-W01", webhookUrl: "https://g.test", active: true },
      { id: "o", accountId: ACCT, routineId: "D01-W01", webhookUrl: "https://o.test", active: false },
      { id: "q", accountId: ACCT, routineId: "D01-W03", webhookUrl: "https://q.test", active: true },
    ];
    expect(skillSourceFor(rows, ACCT, "D01-W01")).toBe("n8n"); // paused own row → the global one serves
    expect(skillSourceFor(rows, ACCT, "D01-W03")).toBe("n8n");
    expect(skillSourceFor(rows, ACCT, "D01-W05")).toBe("builtin");
    expect(skillSourceFor(rows, ACCT, "D02-W04")).toBe("builtin");
    const all = skillRows(rows, ACCT);
    expect(all).toHaveLength(35);
    expect(all.find((r) => r.routineId === "D01-W01")).toMatchObject({ source: "n8n", builtIn: true, produces: true, workflow: { id: "g", global: true }, workflows: [{ id: "g" }, { id: "o" }] });
    expect(all.find((r) => r.routineId === "D02-W04")).toMatchObject({ source: "builtin", builtIn: true, produces: false, workflow: null, workflows: [] });
    expect(isAdminEmail("Tom@getjunction.ai", { UNC_ADMIN_EMAILS: "tom@getjunction.ai" })).toBe(true);
    expect(isAdminEmail("founder@example.test", { UNC_ADMIN_EMAILS: "tom@getjunction.ai" })).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });

  it("webhook URLs: https only (http for localhost), no credentials, no junk", () => {
    expect(webhookUrlProblem(HOOK)).toBeNull();
    expect(webhookUrlProblem("http://localhost:5678/webhook/x")).toBeNull();
    expect(webhookUrlProblem("http://n8n.example/webhook/x")).toMatch(/https/);
    expect(webhookUrlProblem("http://n8n.example/webhook/x", { N8N_ALLOW_HTTP: "1" })).toBeNull();
    expect(webhookUrlProblem("https://user:pw@n8n.example/x")).toMatch(/credentials/);
    expect(webhookUrlProblem("not a url")).toMatch(/absolute/);
    expect(webhookUrlProblem("")).toMatch(/required/);
  });

  it("register keeps one row per (scope, routine) and re-activates; patch respects ownership and admin", async () => {
    const a = await registerWorkflow(store, { accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK }, idGen);
    expect(a).toMatchObject({ id: "wf-1", accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK, active: true });
    await patchWorkflow(store, { id: "wf-1", active: false }, { accountId: ACCT, admin: false });
    const b = await registerWorkflow(store, { accountId: ACCT, routineId: "D01-W01", webhookUrl: `${HOOK}-v2` }, idGen);
    expect(b).toMatchObject({ id: "wf-1", webhookUrl: `${HOOK}-v2`, active: true });
    const g = await registerWorkflow(store, { accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK, global: true }, idGen);
    expect(g).toMatchObject({ id: "wf-2", accountId: null });
    expect((await store.listN8nWorkflows(ACCT)).map((w) => w.id).sort()).toEqual(["wf-1", "wf-2"]);
    expect(await patchWorkflow(store, { id: "wf-2", active: false }, { accountId: ACCT, admin: false })).toMatchObject({ ok: false, status: 403 });
    expect(await patchWorkflow(store, { id: "wf-2", active: false }, { accountId: ACCT, admin: true })).toMatchObject({ ok: true, workflow: { active: false } });
    expect(await patchWorkflow(store, { id: "wf-1", active: false }, { accountId: "someone-else", admin: false })).toMatchObject({ ok: false, status: 404 });
    await expect(registerWorkflow(store, { accountId: ACCT, routineId: "D09-W09", webhookUrl: HOOK }, idGen)).rejects.toThrow(/catalog/);
  });

  it("testWorkflow: a signed payload with fixture reads and a test data token; the four outcomes", async () => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const stub = (status: number, body?: unknown) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body ?? ""), headers: init?.headers as Record<string, string> });
        return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
    const env = { N8N_SIGNING_SECRET: "s3cret", APP_URL: "https://unc.test" };
    const NOW = new Date("2026-09-03T07:00:00.000Z");
    const art = await testWorkflow({ accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK }, { env, fetch: stub(200, { artifact: { kind: "post_set", title: "From n8n", body: "Three posts the workflow wrote from fixture material.", items: [{ title: "a", body: "b" }] } }), now: () => NOW });
    expect(art).toMatchObject({ ok: true, kind: "artifact", artifact: { kind: "post_set", title: "From n8n", items: 1 } });
    expect(calls[0].url).toBe(HOOK);
    expect(verify("s3cret", calls[0].body, calls[0].headers["x-unc-timestamp"], calls[0].headers["x-unc-signature"], { now: () => NOW })).toEqual({ ok: true });
    const payload = JSON.parse(calls[0].body);
    expect(payload.runId).toMatch(/^test:/);
    expect(payload.dataBaseUrl).toBe("https://unc.test");
    expect(payload.data.endpoints.reads).toBe("/api/n8n/reads");
    expect(verifyDataToken("s3cret", payload.dataToken, { now: () => NOW })).toMatchObject({ ok: true, claims: { accountId: ACCT, routineId: "D01-W01", runId: payload.runId } });
    expect(payload.reads.questions).toMatchObject({ provenance: "fixture" });
    expect(await testWorkflow({ accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK }, { env, fetch: stub(200, { needs: [{ input: "brand_notes", why: "x" }] }) })).toMatchObject({ ok: true, kind: "needs", needs: [{ input: "brand_notes" }] });
    expect(await testWorkflow({ accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK }, { env, fetch: stub(202) })).toMatchObject({ ok: true, kind: "accepted" });
    expect(await testWorkflow({ accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK }, { env, fetch: stub(500) })).toMatchObject({ ok: false, error: "n8n webhook answered 500" });
    expect(await testWorkflow({ accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK }, { env: {}, fetch: stub(200) })).toMatchObject({ ok: false, error: expect.stringContaining("N8N_SIGNING_SECRET") });
  });
});

describe("/api/skills/n8n", () => {
  it("GET: the 35 rows, who the caller is, the secret flag, the budget; demo mode → fallback; no session → 401", async () => {
    await store.putN8nWorkflow({ id: "wf-x", accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK, active: true });
    const out = await (await GET()).json();
    expect(out.routines).toHaveLength(35);
    expect(out.routines.find((r: { routineId: string }) => r.routineId === "D01-W01")).toMatchObject({ source: "n8n", workflow: { id: "wf-x" } });
    expect(out).toMatchObject({ owner: true, admin: false, secretConfigured: true, dataBaseUrl: "https://unc.example.test", budget: { spentUsd: 0, capUsd: 15, ok: true } });
    expect(out.accounts).toBeUndefined();
    user = null;
    expect((await GET()).status).toBe(401);
    clearBillingEnv();
    expect(await (await GET()).json()).toEqual({ fallback: true });
  });

  it("POST / PATCH: owner registers and pauses; a member is refused; global needs an admin; bad bodies are 400", async () => {
    expect((await POST(jreq("POST", "{"))).status).toBe(400);
    expect((await POST(jreq("POST", { routineId: "nope", webhookUrl: HOOK }))).status).toBe(400);
    expect((await POST(jreq("POST", { routineId: "D01-W01", webhookUrl: "http://n8n.example/x" }))).status).toBe(400);
    const created = await POST(jreq("POST", { routineId: "D01-W01", webhookUrl: HOOK }));
    expect(created.status).toBe(200);
    const { workflow } = await created.json();
    expect(workflow).toMatchObject({ accountId: ACCT, routineId: "D01-W01", webhookUrl: HOOK, active: true });
    expect((await store.findN8nWorkflow(ACCT, "D01-W01"))!.id).toBe(workflow.id);
    // global: owner is not admin
    const g = await POST(jreq("POST", { routineId: "D01-W03", webhookUrl: HOOK, global: true }));
    expect(g.status).toBe(403);
    expect(await g.json()).toMatchObject({ code: "admin_only" });
    // pause
    const paused = await PATCH(jreq("PATCH", { id: workflow.id, active: false }));
    expect(paused.status).toBe(200);
    expect((await paused.json()).workflow.active).toBe(false);
    expect(await store.findN8nWorkflow(ACCT, "D01-W01")).toBeNull();
    expect((await PATCH(jreq("PATCH", { id: workflow.id, active: "yes" }))).status).toBe(400);
    expect((await PATCH(jreq("PATCH", { id: "missing", active: true }))).status).toBe(404);
    // a member
    db.userId = MEMBER;
    user = { id: MEMBER, email: "member@example.test" };
    expect((await POST(jreq("POST", { routineId: "D01-W01", webhookUrl: HOOK }))).status).toBe(403);
    expect((await PATCH(jreq("PATCH", { id: workflow.id, active: true }))).status).toBe(403);
    expect((await (await GET()).json()).owner).toBe(false);
  });

  it("an admin registers a global workflow, pauses it, and sees every account's spend", async () => {
    user = { id: OWNER, email: "tom@getjunction.ai" };
    const g = await POST(jreq("POST", { routineId: "D01-W03", webhookUrl: HOOK, global: true }));
    expect(g.status).toBe(200);
    const { workflow } = await g.json();
    expect(workflow).toMatchObject({ accountId: null, routineId: "D01-W03", active: true });
    expect((await store.findN8nWorkflow("any-account", "D01-W03"))!.id).toBe(workflow.id);
    expect((await PATCH(jreq("PATCH", { id: workflow.id, active: false }))).status).toBe(200);
    db.seed("llm_usage", [{ account_id: ACCT, task: "chat", provider: "anthropic", model: "m", input_tokens: 1, output_tokens: 1, est_cost_usd: 2.5, latency_ms: 1, stop_reason: "end", created_at: "2026-09-02T00:00:00.000Z" }]);
    const out = await (await GET()).json();
    expect(out.admin).toBe(true);
    expect(out.accounts).toEqual([{ accountId: ACCT, name: "Example Co", spentUsd: 2.5, capUsd: 15, capSource: "default", ok: true }]);
    expect(out.budget).toMatchObject({ spentUsd: 2.5 });
  });

  it("POST /api/skills/n8n/test: owner only, validated, answers what the webhook answered", async () => {
    vi.stubGlobal("fetch", (async () => new Response(JSON.stringify({ artifact: { kind: "post_set", title: "Hi", body: "A post set drafted by the workflow under test.", items: [{ title: "a", body: "b" }] } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch);
    const treq = (body: unknown) => new Request("http://unc.test/api/skills/n8n/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await testPOST(treq({ routineId: "D01-W01" }))).status).toBe(400);
    const res = await testPOST(treq({ routineId: "D01-W01", webhookUrl: HOOK }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, kind: "artifact", artifact: { title: "Hi", items: 1 } });
    db.userId = MEMBER;
    user = { id: MEMBER, email: "member@example.test" };
    expect((await testPOST(treq({ routineId: "D01-W01", webhookUrl: HOOK }))).status).toBe(403);
  });
});
