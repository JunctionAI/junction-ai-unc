import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../runtime/store/memory";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { stableHash } from "../../runtime/context";
import type { RunRecord } from "../../runtime/store/interface";
import type { RoutineSpec, N8nWorkflow } from "../../runtime/types";
import { NoCredentialsProvider } from "../../../worker/credentials";
import { issueDataToken, RateLimiter, scopesForSpec } from "../dataToken";
import { keywordShadowSpec } from "../keywordShadowSpec";
import type { ProxyDeps } from "../proxy";
import { AVGAR_PILOT_ACCOUNT, AVGAR_SEO_WORKFLOW, KEYWORD_SHADOW_CONTRACT, type KeywordShadowContract } from "../shadowContract";

const mocked = vi.hoisted(() => ({ deps: null as unknown }));
vi.mock("@/lib/n8n/routeDeps", () => ({ proxyDeps: () => mocked.deps }));
import { GET } from "@/app/api/n8n/shadow-authority/route";
import { syntheticAdmission } from "./admissionFixture";

// Synthetic fixtures only. No real accounts, providers or deployed secrets are accessed.
const NOW = new Date("2026-09-04T08:00:00.000Z");
const SECRET = "synthetic-signing-key";
const URL_PIN = "https://receiver.example.com/webhook/keyword";
const CONTRACT: KeywordShadowContract = {
  contract: KEYWORD_SHADOW_CONTRACT, accountId: AVGAR_PILOT_ACCOUNT,
  workflowId: AVGAR_SEO_WORKFLOW, workflowVersion: "synthetic-tested-revision",
  routineId: "D03-W01", routineKey: "keyword_opportunity",
  client: { id: "avgar", primaryDomain: "example.com", seedKeyword: "synthetic keyword", locationCode: 2840, languageCode: "en" },
};
let store: MemoryStore;
let deps: ProxyDeps;
let spec: RoutineSpec;
let run: RunRecord;
let registration: N8nWorkflow;

async function saveSpec() {
  await store.putRoutineState({ accountId: run.accountId, routineId: run.routineId, enabled: false,
    version: 1, liveSpec: null, draftSpec: spec, updatedAt: NOW.toISOString() });
}
function request(over: Partial<{ accountId: string; runId: string; routineId: string; scopes: string[] }> = {}, issuedAt = NOW) {
  const { token } = issueDataToken(SECRET, { accountId: run.accountId, runId: run.id, routineId: run.routineId, scopes: scopesForSpec(spec), ...over }, { now: () => issuedAt });
  return new Request("https://unc.example.com/api/n8n/shadow-authority?seedKeyword=attacker", { headers: { authorization: `Bearer ${token}` } });
}
async function expectDenied(req: Request, status: number) {
  const response = await GET(req);
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Authorization");
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(body).not.toHaveProperty("shadow");
}

beforeEach(async () => {
  store = new MemoryStore();
  spec = keywordShadowSpec(structuredClone(CONTRACT), 2);
  run = { id: "synthetic-run", accountId: CONTRACT.accountId, routineId: CONTRACT.routineId,
    version: 2, mode: "dry_run", status: "running", startedAt: NOW.toISOString(), specHash: stableHash(spec) };
  await store.createRun(run);
  await saveSpec();
  registration = { id: "synthetic-registration", accountId: CONTRACT.accountId, routineId: CONTRACT.routineId,
    active: true, webhookUrl: URL_PIN };
  await store.putN8nWorkflow(registration);
  deps = { store, secret: SECRET, credentials: new NoCredentialsProvider(), credentialsKind: "none", db: null,
    shadowAdmission: syntheticAdmission(),
    now: () => NOW, limiter: new RateLimiter(60, 60_000, () => NOW), playbooks: null };
  mocked.deps = deps;
  vi.stubEnv("N8N_SHADOW_RECEIVER_URL", URL_PIN);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("keyword shadow receiver authority", () => {
  it("does not turn read-only authority into an implicit provider permit", async () => {
    deps.shadowAdmission = undefined;
    await expectDenied(request(), 503);
  });
  it("returns a single allowance and denies replay without changing the response contract", async () => {
    let unused = true;
    const authorize = vi.fn(async () => { const allowed = unused; unused = false; return allowed; });
    deps.shadowAdmission = { ...syntheticAdmission(), authorize };
    expect((await GET(request())).status).toBe(200);
    await expectDenied(request(), 409);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize.mock.calls[0]).toEqual([expect.objectContaining({ runId: run.id, registrationId: registration.id,
      contract: CONTRACT, specHash: run.specHash, contextGeneration: 0, tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    expect(JSON.stringify(authorize.mock.calls)).not.toContain('unc_dt.');
  });
  it("refuses an uncertain admission response rather than exposing provider authority", async () => {
    deps.shadowAdmission = { ...syntheticAdmission(), authorize: async () => { throw new Error('private store error'); } };
    await expectDenied(request(), 503);
  });
  it("rechecks captured context after registration lookup before disclosing authority", async () => {
    const db = new FakeSupabase();
    db.seed("accounts", [{ id: run.accountId, context_generation: 0, automation_paused: false }]);
    deps.db = db;
    vi.spyOn(store, "findN8nWorkflow").mockImplementation(async () => {
      db.rows("accounts")[0].context_generation = 1;
      return registration;
    });
    await expectDenied(request(), 409);
  });
  it("returns only canonical run settings without reads, writes or account context", async () => {
    const credentials = vi.spyOn(deps.credentials, "get");
    const fetch = vi.fn();
    deps.fetch = fetch;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, shadow: CONTRACT,
      run: { id: run.id, accountId: run.accountId, routineId: run.routineId, mode: "dry_run", status: "running", startedAt: NOW.toISOString() },
      authorizedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
      revisionEvidence: "expected_only", executedAction: "none" });
    expect(credentials).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(await store.listReceipts(run.accountId, { runId: run.id })).toEqual([]);
    expect(await store.listArtifacts(run.accountId, { runId: run.id })).toEqual([]);
    expect(await store.getRun(run.id)).toEqual(run);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not project arbitrary fields from the stored contract or client", async () => {
    const node = spec.nodes.find(n => n.kind === "n8n");
    if (node?.kind !== "n8n" || !node.shadowContract) throw new Error("fixture");
    Object.assign(node.shadowContract, { secret: "do-not-return" });
    Object.assign(node.shadowContract.client, { secret: "do-not-return" });
    await saveSpec();
    await store.updateRun(run.id, { specHash: stableHash(spec) });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).shadow).toEqual(CONTRACT);
  });

  it("rejects missing, forged and expired tokens", async () => {
    await expectDenied(new Request("https://unc.example.com/api/n8n/shadow-authority"), 401);
    await expectDenied(new Request("https://unc.example.com/api/n8n/shadow-authority", { headers: { authorization: "Bearer unc_dt.invalid.invalid" } }), 401);
    await expectDenied(request({}, new Date(NOW.getTime() - 16 * 60_000)), 401);
  });
  it.each([{ accountId: "other-tenant" }, { routineId: "D02-W01" }, { runId: "missing" }])("rejects identity mismatch %j", async over => {
    await expectDenied(request(over), 404);
  });
  it("rejects widened connector scopes", async () => {
    await expectDenied(request({ scopes: [...scopesForSpec(spec), "meta_ads:campaigns"] }), 403);
  });
  it.each(["done", "failed", "waiting_approval", "waiting_input", "skipped"] as const)("rejects %s runs", async status => {
    await store.updateRun(run.id, { status });
    await expectDenied(request(), 409);
  });
  it("rejects live runs", async () => {
    await store.updateRun(run.id, { mode: "live" });
    await expectDenied(request(), 403);
  });
  it.each([undefined, "not-the-current-hash"])("rejects missing or different spec fingerprints (%s)", async specHash => {
    await store.updateRun(run.id, { specHash });
    await expectDenied(request(), 409);
  });
  it("rejects in-place draft edits even when its version is unchanged", async () => {
    spec.name = "changed in place";
    await saveSpec();
    await expectDenied(request(), 409);
  });
  it("rejects scheduled shadow specs", async () => {
    const node = spec.nodes.find(n => n.kind === "trigger");
    if (node?.kind !== "trigger") throw new Error("fixture");
    node.cadence = "0 9 * * *";
    await saveSpec();
    await store.updateRun(run.id, { specHash: stableHash(spec) });
    await expectDenied(request(), 403);
  });
  it.each([undefined, null, "other-tenant"])("rejects absent or non-pilot registrations (%s)", async accountId => {
    await store.putN8nWorkflow({ ...registration, active: false });
    if (accountId !== undefined) await store.putN8nWorkflow({ ...registration, accountId });
    await expectDenied(request(), 403);
  });
  it.each(["", "http://receiver.example.com/webhook/keyword", "https://different.example.com/hook"])("rejects missing or changed receiver pins (%s)", async pin => {
    vi.stubEnv("N8N_SHADOW_RECEIVER_URL", pin);
    await expectDenied(request(), 503);
  });
  it.each(["invalid", "2026-09-04T07:00:00Z", "2026-09-04T09:00:00Z"])("rejects invalid or stale run timing (%s)", async startedAt => {
    await store.updateRun(run.id, { startedAt });
    await expectDenied(request(), 409);
  });
  it("retains shared token rate limiting", async () => {
    deps.limiter = new RateLimiter(1, 60_000, () => NOW);
    expect((await GET(request())).status).toBe(200);
    await expectDenied(request(), 429);
  });
  it("fails closed without a signing key", async () => {
    deps.secret = undefined;
    await expectDenied(request(), 503);
  });
});
