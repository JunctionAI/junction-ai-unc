import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/runtime/store/memory";
import { setStoreForTests } from "@/lib/runtime/store";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { artifactHeaders } from "@/lib/artifacts/client";
import { readWorkspace } from "../read";
import type { AccountSession } from "@/lib/db/session";
import type { Artifact } from "@/lib/runtime/types";
import type { RunRecord } from "@/lib/runtime/store/interface";

let session: AccountSession | Response;
vi.mock("@/lib/db/session", () => ({ requireAccountSession: async () => session }));
import { GET } from "@/app/api/workspace/route";
const ACCT = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-05T10:00:00Z");
let store: MemoryStore;
let db: FakeSupabase;
const run = (id: string, patch: Partial<RunRecord> = {}): RunRecord => ({ id, accountId: ACCT, contextGeneration: 1, routineId: "D03-W01", version: 1, mode: "dry_run", status: "done", startedAt: "2026-09-05T09:00:00Z", finishedAt: "2026-09-05T09:01:00Z", ...patch });
const draft = (id: string, runId = "r1", patch: Partial<Artifact> = {}): Artifact => ({ id, runId, accountId: ACCT, routineId: "D03-W01", revision: 0, title: "Golf keyword research", kind: "keyword_list", body: "Research, not a claimed winner", items: [], evidence: [], meta: {}, status: "draft", createdAt: "2026-09-05T09:01:00Z", ...patch });
const request = (headers = artifactHeaders(ACCT, 1)) => new Request("https://unc.test/api/workspace", { headers });
beforeEach(() => {
  store = new MemoryStore(); db = new FakeSupabase(); setStoreForTests(store);
  db.seed("accounts", [{ id: ACCT, name: "Fixture", context_generation: 1, automation_paused: false }]);
  db.seed("account_members", [{ account_id: ACCT, user_id: USER, role: "owner" }]);
  session = { accountId: ACCT, userId: USER, email: null, role: "owner", db, service: db };
});
afterEach(() => { vi.restoreAllMocks(); setStoreForTests(undefined); });

describe("saved-work projection", () => {
  it("uses only the exact tenant/generation and counts completed timestamps, not starts", async () => {
    await store.createRun(run("r1")); await store.putArtifact(draft("a1"));
    await store.createRun(run("old", { contextGeneration: 0 })); await store.putArtifact(draft("old-a", "old"));
    await store.createRun(run("foreign", { accountId: "another-account" })); await store.putArtifact(draft("foreign-a", "foreign", { accountId: "another-account" }));
    await store.createRun(run("pending", { status: "waiting_input", finishedAt: undefined }));
    await store.createRun(run("old-finish", { finishedAt: "2026-09-01T09:00:00Z" }));
    await store.putRoutineState({ accountId: ACCT, routineId: "D03-W01", enabled: true, version: 1, draftSpec: null, liveSpec: null, updatedAt: now.toISOString() });
    const data = await readWorkspace(store, ACCT, 1, now);
    expect(data.artifacts.map(a => a.id)).toEqual(["a1"]);
    expect(data.runs.map(r => r.id)).not.toContain("old");
    expect(data.counts).toEqual({ needsReview: 1, completed24h: 1, needsAttention: 1, routinesOn: 1 });
    expect(data.artifacts[0]).toMatchObject({ accountId: ACCT, contextGeneration: 1, revision: 0 });
  });
  it("does not expose run snapshots or internal execution inputs", async () => {
    await store.createRun(run("r1", { snapshot: { secret: "private-internal-input" } as unknown as RunRecord["snapshot"] }));
    expect(JSON.stringify(await readWorkspace(store, ACCT, 1, now))).not.toContain("private-internal-input");
  });
  it("shows limits explicitly instead of claiming complete history", async () => {
    for (let i = 0; i < 101; i++) await store.createRun(run(`r${i}`));
    const data = await readWorkspace(store, ACCT, 1, now);
    expect(data.runs).toHaveLength(100); expect(data.truncated.runs).toBe(true);
  });
  it("a failed source rejects the projection, never substitutes empty data", async () => {
    vi.spyOn(store, "listReceipts").mockRejectedValue(new Error("database unavailable"));
    await expect(readWorkspace(store, ACCT, 1, now)).rejects.toThrow("database unavailable");
  });
});

describe("workspace read boundary", () => {
  it("refuses unauthenticated, missing, other-account and stale-context requests", async () => {
    for (const h of [{}, artifactHeaders("another-account", 1), artifactHeaders(ACCT, 0)]) expect((await GET(request(h))).status).toBe(409);
    session = new Response(null, { status: 401 }); expect((await GET(request())).status).toBe(401);
  });
  it("lets a paused owner or member read but never advertises review authority", async () => {
    db.rows("accounts")[0].automation_paused = true;
    expect(await (await GET(request())).json()).toMatchObject({ accountId: ACCT, contextGeneration: 1, paused: true, canReview: false });
    db.rows("accounts")[0].automation_paused = false; db.rows("account_members")[0].role = "member";
    expect(await (await GET(request())).json()).toMatchObject({ paused: false, canReview: false });
  });
  it("current owner read is no-store and does not start work", async () => {
    const response = await GET(request());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ canReview: true, runs: [], artifacts: [], receipts: [] });
    expect(await store.listRuns(ACCT)).toEqual([]);
  });
  it("refuses a context reset or membership revocation during the read", async () => {
    vi.spyOn(store, "listReceipts").mockImplementation(async () => { db.rows("accounts")[0].context_generation = 2; return []; });
    expect((await GET(request())).status).toBe(409);
    db.rows("accounts")[0].context_generation = 1;
    vi.spyOn(store, "listReceipts").mockImplementation(async () => { db.rows("account_members").splice(0); return []; });
    expect((await GET(request())).status).toBe(403);
  });
  it("source failure returns an unavailable response without raw database details", async () => {
    vi.spyOn(store, "listRuns").mockRejectedValue(new Error("private internal details"));
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private internal details");
  });
});
