/* The n8n data proxy: token auth (bad / expired / closed run / rate limit), the read path through
   the worker's own reader with receipts on the run, every "couldn't ask" path answered honestly,
   the context shape, and actions that only ever record a proposal. Lib-level against MemoryStore
   + the schema-checked fake, then the three routes with their deps mocked. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { addMemory } from "@/lib/brain/memory";
import { MemoryStore } from "@/lib/runtime/store/memory";
import type { RunRecord } from "@/lib/runtime/store/interface";
import { FixtureCredentialProvider, NoCredentialsProvider } from "@/worker/credentials";
import { fail as readerFail } from "@/worker/readers/types";
import { issueDataToken, RateLimiter, scopesForRoutine } from "../dataToken";
import { authenticate, contextForToken, parseAction, parseReadQuery, proposeAction, readForToken, type ProxyDeps } from "../proxy";

const ACCT = "00000000-0000-4000-8000-00000000acc1";
const NOW = new Date("2026-09-03T07:00:00.000Z");
const SECRET = "s3cret";

const depsMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/n8n/routeDeps", () => ({ proxyDeps: () => depsMock.current }));

import { GET as readsGET } from "@/app/api/n8n/reads/route";
import { GET as contextGET } from "@/app/api/n8n/context/route";
import { POST as actionsPOST } from "@/app/api/n8n/actions/route";

let store: MemoryStore;
let deps: ProxyDeps;
let ids = 0;

function run(over: Partial<RunRecord> = {}): RunRecord {
  return { id: "run-1", accountId: ACCT, routineId: "D01-W03", version: 1, mode: "dry_run", status: "running", startedAt: NOW.toISOString(), ...over };
}
function token(over: Partial<{ accountId: string; runId: string; routineId: string; scopes: string[] }> = {}, now = NOW) {
  return issueDataToken(SECRET, { accountId: ACCT, runId: "run-1", routineId: "D01-W03", scopes: scopesForRoutine("D01-W03"), ...over }, { now: () => now }).token;
}
const req = (url: string, tok: string | null, init: RequestInit = {}) => new Request(`http://unc.test${url}`, { ...init, headers: { ...(init.headers as Record<string, string>), ...(tok ? { authorization: `Bearer ${tok}` } : {}) } });

beforeEach(async () => {
  store = new MemoryStore();
  await store.createRun(run());
  ids = 0;
  deps = { store, secret: SECRET, credentials: new FixtureCredentialProvider(), credentialsKind: "fixture", db: null, now: () => NOW, idGen: () => `id-${++ids}`, limiter: new RateLimiter(60, 60_000, () => NOW), playbooks: null };
  depsMock.current = deps;
});
afterEach(() => vi.restoreAllMocks());

describe("authenticate", () => {
  it("503 without a secret, 401 without / with a bad or expired token, 404 for another account's run, 409 once the run is closed, 429 over the limit", async () => {
    expect(await authenticate({ ...deps, secret: "" }, req("/x", token()))).toMatchObject({ ok: false, status: 503 });
    expect(await authenticate(deps, req("/x", null))).toMatchObject({ ok: false, status: 401, error: expect.stringContaining("Bearer") });
    expect(await authenticate(deps, req("/x", "unc_dt.bad.mac"))).toMatchObject({ ok: false, status: 401, error: "data token mismatch" });
    expect(await authenticate(deps, req("/x", token({}, new Date(NOW.getTime() - 16 * 60_000))))).toMatchObject({ ok: false, status: 401, error: "data token expired" });
    expect(await authenticate(deps, req("/x", token({ accountId: "someone-else" })))).toMatchObject({ ok: false, status: 404 });
    expect(await authenticate(deps, req("/x", token({ runId: "missing" })))).toMatchObject({ ok: false, status: 404 });
    await store.updateRun("run-1", { status: "done" });
    expect(await authenticate(deps, req("/x", token()))).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("no longer valid") });
    // a test token needs no run
    expect(await authenticate(deps, req("/x", token({ runId: "test:abc" })))).toMatchObject({ ok: true, run: null });
    // rate limit is per token
    const tight = { ...deps, limiter: new RateLimiter(2, 60_000, () => NOW) };
    const t = token({ runId: "test:rl" });
    expect((await authenticate(tight, req("/x", t))).ok).toBe(true);
    expect((await authenticate(tight, req("/x", t))).ok).toBe(true);
    expect(await authenticate(tight, req("/x", t))).toMatchObject({ ok: false, status: 429 });
  });
});

describe("reads", () => {
  it("parses the query (fields / filter as JSON) and rejects bad shapes", () => {
    const ok = parseReadQuery(new URLSearchParams({ platform: "shopify", resource: "products", window: "28d", limit: "20", fields: '["title","tags"]', filter: '{"status":"active"}' }));
    expect(ok).toMatchObject({ ok: true, query: { platform: "shopify", resource: "products", window: "28d", limit: 20, fields: ["title", "tags"], filter: { status: "active" } } });
    expect(parseReadQuery(new URLSearchParams({ platform: "nope", resource: "x" }))).toMatchObject({ ok: false });
    expect(parseReadQuery(new URLSearchParams({ platform: "shopify", resource: "Bad Name" }))).toMatchObject({ ok: false });
    expect(parseReadQuery(new URLSearchParams({ platform: "shopify", resource: "orders", window: "yesterday" }))).toMatchObject({ ok: false });
    expect(parseReadQuery(new URLSearchParams({ platform: "shopify", resource: "orders", fields: "title" }))).toMatchObject({ ok: false, error: expect.stringContaining("JSON") });
    expect(parseReadQuery(new URLSearchParams({ platform: "shopify", resource: "orders", limit: "9999" }))).toMatchObject({ ok: true, query: { limit: 500 } });
  });

  it("runs the worker's reader with the account's credential and writes a `read` receipt on the run marked via n8n", async () => {
    const auth = await authenticate(deps, req("/x", token()));
    if (!auth.ok) throw new Error("auth failed");
    const out = await readForToken(deps, auth, { platform: "shopify", resource: "products", limit: 5 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.count).toBe(out.rows.length);
    expect(out.provenance).toMatchObject({ platform: "shopify", resource: "products", via: "n8n", source: "fixture", receiptId: "id-1" });
    const receipts = await store.listReceipts(ACCT, { runId: "run-1" });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ kind: "read", platform: "shopify", description: expect.stringContaining("via n8n"), payload: { via: "n8n", provenance: "fixture", query: { resource: "products", limit: 5 } } });
  });

  it("scope: a founder-content token cannot read Meta insights (403), and platform / resource pairs are exact", async () => {
    const auth = await authenticate(deps, req("/x", token({ routineId: "D01-W01", scopes: scopesForRoutine("D01-W01") })));
    if (!auth.ok) throw new Error("auth failed");
    expect(await readForToken(deps, auth, { platform: "meta_ads", resource: "insights" })).toMatchObject({ ok: false, code: "forbidden", status: 403 });
    expect((await readForToken(deps, auth, { platform: "shopify", resource: "products" })).ok).toBe(true);
    // an exact platform:resource scope does not widen to the platform's other resources
    const exact = await authenticate(deps, req("/x", token({ runId: "test:exact", scopes: ["shopify:products"] })));
    if (!exact.ok) throw new Error("auth failed");
    expect(await readForToken(deps, exact, { platform: "shopify", resource: "orders" })).toMatchObject({ ok: false, code: "forbidden" });
    expect((await readForToken(deps, exact, { platform: "shopify", resource: "products" })).ok).toBe(true);
  });

  it("couldn't ask, honestly: not connected · secret store unavailable · platform error — each with a receipt on the run", async () => {
    const auth = await authenticate(deps, req("/x", token()));
    if (!auth.ok) throw new Error("auth failed");
    const none = { ...deps, credentials: new NoCredentialsProvider(), credentialsKind: "connectors" as const };
    expect(await readForToken(none, auth, { platform: "shopify", resource: "products" })).toMatchObject({ ok: false, code: "not_connected", reason: "shopify is not connected for this account", status: 200 });
    const noStore = { ...deps, credentials: new NoCredentialsProvider(), credentialsKind: "none" as const };
    expect(await readForToken(noStore, auth, { platform: "shopify", resource: "products" })).toMatchObject({ ok: false, code: "secret_store_unavailable", reason: expect.stringContaining("CONNECTOR_SECRET_KEY") });
    const broken = { ...deps, readers: { shopify: async () => readerFail("HTTP 500 from the shop") } };
    expect(await readForToken(broken, auth, { platform: "shopify", resource: "products" })).toMatchObject({ ok: false, code: "platform_error", reason: "HTTP 500 from the shop" });
    const receipts = await store.listReceipts(ACCT, { runId: "run-1" });
    expect(receipts).toHaveLength(3);
    for (const r of receipts) expect(r).toMatchObject({ kind: "notification", platform: "shopify", description: expect.stringContaining("couldn’t ask"), payload: { via: "n8n", provenance: "unavailable" } });
  });

  it("a test token reads (fixtures here) but writes no receipt — there is no run", async () => {
    const auth = await authenticate(deps, req("/x", token({ runId: "test:1" })));
    if (!auth.ok) throw new Error("auth failed");
    const out = await readForToken(deps, auth, { platform: "shopify", resource: "products" });
    expect(out).toMatchObject({ ok: true, provenance: { receiptId: null } });
    expect(await store.listReceipts(ACCT)).toHaveLength(0);
  });
});

describe("context", () => {
  it("carries the skill card, the profile, memories recalled for the routine's purpose, goal, plan, prior artifacts and ≤ 3 playbooks", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: ACCT, name: "Example Co" }]);
    db.seed("business_profiles", [{ account_id: ACCT, scan_status: "done", profile: { name: "Example Co", oneLiner: "Marine collagen from Auckland", products: ["Collagen 300g"], voice: { tone: "plain" } } }]);
    db.seed("goals", [{ account_id: ACCT, category: "revenue", tier: "governing", title: "NZ$40k/month by March", baseline: 21000, deadline: "2027-03-01" }]);
    db.seed("plans", [{ account_id: ACCT, title: "Brand-led organic", phases: [{ title: "Content", channel: "Content" }] }]);
    await addMemory(db, { accountId: ACCT, kind: "constraint", text: "Never discounts below 15%.", source: "chat", importance: 5 }, { embed: null, now: () => NOW });
    await store.putArtifact({ id: "art-1", accountId: ACCT, runId: "run-0", routineId: "D01-W01", kind: "post_set", title: "3 founder posts", body: "Earlier posts.", items: [], meta: {}, evidence: [], status: "approved", createdAt: "2026-09-01T00:00:00.000Z" });
    const withDb: ProxyDeps = { ...deps, db, playbooks: async () => [{ id: "pb-1", domain: "content", title: "Founder posts that travel", body: "x".repeat(1000), tags: ["content"], score: 1, via: "keyword" }, { id: "pb-2", domain: "content", title: "Two", body: "b", tags: [], score: 0.9, via: "keyword" }, { id: "pb-3", domain: "content", title: "Three", body: "c", tags: [], score: 0.8, via: "keyword" }, { id: "pb-4", domain: "content", title: "Four", body: "d", tags: [], score: 0.7, via: "keyword" }] };
    const auth = await authenticate(withDb, req("/x", token()));
    if (!auth.ok) throw new Error("auth failed");
    const out = await contextForToken(withDb, auth);
    expect(out).toMatchObject({ ok: true, routine: { id: "D01-W03", name: "Customer-question mining", kind: "question_list", maxItems: 10, builtIn: true }, account: { id: ACCT, currency: "NZD", today: "2026-09-03" } });
    expect(out.business).toMatchObject({ name: "Example Co", products: ["Collagen 300g"] });
    expect(String(out.businessSummary)).toContain("Marine collagen from Auckland");
    expect(out.memories).toEqual(["[constraint] Never discounts below 15%."]);
    expect(out.goal).toMatchObject({ title: "NZ$40k/month by March", baseline: 21000, deadline: "2027-03-01" });
    expect(out.plan).toEqual([{ title: "Content", channel: "Content" }]);
    expect(out.priorArtifacts).toMatchObject([{ id: "art-1", title: "3 founder posts", status: "approved" }]);
    const pbs = out.playbooks as { id: string; body: string }[];
    expect(pbs.map((p) => p.id)).toEqual(["pb-1", "pb-2", "pb-3"]);
    expect(pbs[0].body).toHaveLength(700);
    expect(String((out.routine as { craft: string }).craft)).toContain("CRAFT");
    expect(out.scopes).toEqual(scopesForRoutine("D01-W03"));
  });

  it("an unknown routine gets a stub card; no database → run context only", async () => {
    const auth = await authenticate(deps, req("/x", token({ routineId: "D02-W04", runId: "test:2" })));
    if (!auth.ok) throw new Error("auth failed");
    const out = await contextForToken(deps, auth);
    expect(out.routine).toMatchObject({ id: "D02-W04", name: "Ad fatigue watch", kind: "generic", builtIn: false });
    expect(out.memories).toEqual([]);
    expect(out.business).toBeNull();
    expect(out.run).toMatchObject({ status: "test" });
  });
});

describe("actions (wave-2 shape, record only)", () => {
  it("validates the body", () => {
    expect(parseAction(null)).toMatchObject({ ok: false });
    expect(parseAction({ platform: "meta_ads", action: "Update Budget" })).toMatchObject({ ok: false });
    expect(parseAction({ platform: "nope", action: "update_adset_budget" })).toMatchObject({ ok: false });
    expect(parseAction({ platform: "meta_ads", action: "update_adset_budget", params: [] })).toMatchObject({ ok: false });
    expect(parseAction({ platform: "meta_ads", action: "update_adset_budget", params: { increase: 20 }, why: "ROAS 3.1", title: "Scale prospecting" })).toMatchObject({ ok: true, action: { platform: "meta_ads", action: "update_adset_budget", params: { increase: 20 }, why: "ROAS 3.1" } });
  });

  it("records a pending approval + a draft receipt on the run and never executes", async () => {
    const auth = await authenticate(deps, req("/x", token()));
    if (!auth.ok) throw new Error("auth failed");
    const out = await proposeAction(deps, auth, { platform: "meta_ads", action: "update_adset_budget", params: { adsetId: "as-1", increase: 20 }, why: "ROAS 3.1 over 7d" });
    expect(out).toMatchObject({ queued: true, approvalId: "id-1", receiptId: "id-2", executed: false, executes: "wave_2" });
    const approvals = await store.listApprovals(ACCT, "pending");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ runId: "run-1", routineId: "D01-W03", title: "Proposed by your n8n workflow: update_adset_budget on meta_ads", reasoning: "ROAS 3.1 over 7d", status: "pending" });
    expect(approvals[0].detail).toContain("Nothing was executed");
    const receipts = await store.listReceipts(ACCT, { runId: "run-1" });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ kind: "draft", platform: "meta_ads", approvalId: "id-1", description: expect.stringContaining("Proposed (not executed)"), payload: { via: "n8n", proposal: true, executed: false, executes: "wave_2", mutation: { action: "update_adset_budget", params: { adsetId: "as-1", increase: 20 } } } });
    expect(receipts.some((r) => r.kind === "mutation")).toBe(false);
    expect((await store.getRun("run-1"))!.status).toBe("running");
  });

  it("a test token gets the shape back but nothing is stored", async () => {
    const auth = await authenticate(deps, req("/x", token({ runId: "test:9" })));
    if (!auth.ok) throw new Error("auth failed");
    expect(await proposeAction(deps, auth, { platform: "klaviyo", action: "send_campaign", params: {} })).toMatchObject({ queued: false, executed: false });
    expect(await store.listApprovals(ACCT)).toHaveLength(0);
  });
});

describe("the routes", () => {
  it("GET /api/n8n/reads: 401 without a token, 400 on a bad query, 200 with rows", async () => {
    expect((await readsGET(req("/api/n8n/reads?platform=shopify&resource=products", null))).status).toBe(401);
    expect((await readsGET(req("/api/n8n/reads?platform=shopify", token()))).status).toBe(400);
    const res = await readsGET(req("/api/n8n/reads?platform=shopify&resource=products&limit=3", token()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, provenance: { via: "n8n" } });
    expect(body.count).toBe(body.rows.length);
    const forbidden = await readsGET(req("/api/n8n/reads?platform=meta_ads&resource=insights", token()));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("GET /api/n8n/context and POST /api/n8n/actions", async () => {
    const ctx = await contextGET(req("/api/n8n/context", token()));
    expect(ctx.status).toBe(200);
    expect(await ctx.json()).toMatchObject({ ok: true, routine: { id: "D01-W03" } });
    expect((await actionsPOST(req("/api/n8n/actions", token(), { method: "POST", body: "{" }))).status).toBe(400);
    expect((await actionsPOST(req("/api/n8n/actions", token(), { method: "POST", body: JSON.stringify({ platform: "meta_ads" }) }))).status).toBe(400);
    const res = await actionsPOST(req("/api/n8n/actions", token(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "meta_ads", action: "pause_ad", params: { adId: "1" } }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ queued: true, executed: false, executes: "wave_2" });
    expect(await store.listApprovals(ACCT, "pending")).toHaveLength(1);
  });
});
