import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import type { AccountSession } from "../../db/session";
import { artifactHeaders } from "../../artifacts/client";
import { historyCursor, readWorkspaceHistory } from "../history";
let session: AccountSession | Response;
vi.mock("@/lib/db/session", () => ({ requireAccountSession: async () => session }));
import { GET } from "@/app/api/workspace/history/route";
const account = "00000000-0000-4000-8000-000000000001", actor = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-05T14:00:00Z"), at = "2026-09-04T12:00:00.123456+00:00";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const token = (patch = {}) => Buffer.from(JSON.stringify({ v: 1, accountId: account, generation: 1, asOf: now.toISOString(), at, kind: "run", id: id(1), ...patch })).toString("base64url");
let db: FakeSupabase;
const row = (n: number) => ({ kind: "run", id: id(n), occurred_at: at, record: {
  id: id(n), account_id: account, context_generation: 1, routine_id: "D03-W01", version: 2, mode: "dry_run", status: "done", started_at: at,
  snapshot: { secret: "private-internal-data" }, spec_hash: "private-hash" } });
const req = (query = "", headers = artifactHeaders(account, 1)) => new Request(`https://unc.test/api/workspace/history${query}`, { headers });
beforeEach(() => {
  db = new FakeSupabase(); db.seed("accounts", [{ id: account, context_generation: 1, automation_paused: true }]);
  db.seed("account_members", [{ account_id: account, user_id: actor, role: "owner" }]);
  db.rpcs.read_workspace_history = () => [];
  session = { accountId: account, userId: actor, role: "owner", email: null, db, service: db };
});
describe("history cursor and projection", () => {
  it("retains sub-millisecond timestamps rather than skipping tied records", () => {
    expect(historyCursor(token(), account, 1, now)?.at).toBe(at);
  });
  for (const patch of [{ accountId: actor }, { generation: 0 }, { kind: "secrets" }, { id: "bad" },
    { asOf: "2099-01-01T00:00:00Z" }, { at: "2026-09-06T00:00:00Z" }, { injected: true }])
    it(`rejects invalid cursor ${JSON.stringify(patch)}`, () => expect(() => historyCursor(token(patch), account, 1, now)).toThrow());
  it("rejects malformed and empty cursors", () => { for (const c of ["", "=", "a".repeat(1025)]) expect(() => historyCursor(c, account, 1, now)).toThrow(); });
  it("passes exact tenant, actor and boundary to SQL, using a 51st lookahead without exposing it", async () => {
    const call = vi.fn(() => Array.from({ length: 51 }, (_, n) => row(100 - n))); db.rpcs.read_workspace_history = call;
    const page = await readWorkspaceHistory(db, account, actor, 1, null, now);
    expect(page.entries).toHaveLength(50); expect(page.nextCursor).not.toBeNull();
    expect(historyCursor(page.nextCursor, account, 1, now)).toMatchObject({ id: id(51), at });
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ p_account: account, p_actor: actor, p_generation: 1, p_as_of: now.toISOString(), p_before_id: null }));
    expect(JSON.stringify(page)).not.toContain("private-");
    await readWorkspaceHistory(db, account, actor, 1, page.nextCursor, now);
    expect(call).toHaveBeenLastCalledWith(expect.objectContaining({ p_before_id: id(51), p_before_time: at, p_before_kind: "run" }));
  });
  it("exactly fifty rows is terminal, not a guessed next page", async () => {
    db.rpcs.read_workspace_history = () => Array.from({ length: 50 }, (_, n) => row(n));
    expect((await readWorkspaceHistory(db, account, actor, 1, null, now)).nextCursor).toBeNull();
  });
  it("foreign and stale output fail closed even if SQL is misconfigured", async () => {
    for (const patch of [{ account_id: actor }, { context_generation: 0 }]) {
      db.rpcs.read_workspace_history = () => [{ ...row(1), record: { ...row(1).record, ...patch } }];
      await expect(readWorkspaceHistory(db, account, actor, 1, null, now)).rejects.toThrow();
    }
  });
});
describe("history route authority", () => {
  it("paused members can read without any write or provider work", async () => {
    db.rows("account_members")[0].role = "member";
    const response = await GET(req()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accountId: account, contextGeneration: 1, entries: [], nextCursor: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("denies anonymous, wrong account and stale generation with no-store", async () => {
    for (const headers of [{}, artifactHeaders(actor, 1), artifactHeaders(account, 0)]) {
      const response = await GET(req("", headers)); expect(response.status).toBe(409); expect(response.headers.get("cache-control")).toContain("no-store");
    }
    session = new Response(null, { status: 401 }); const response = await GET(req()); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects unknown/duplicate parameters instead of interpreting an account override", async () => {
    for (const query of ["?accountId=other", "?cursor=a&cursor=b", "?cursor="]) expect((await GET(req(query))).status).toBe(400);
  });
  it("rechecks membership and context after database work", async () => {
    db.rpcs.read_workspace_history = () => { db.rows("account_members").splice(0); return []; };
    expect((await GET(req())).status).toBe(403);
    db.rpcs.read_workspace_history = () => { db.rows("accounts")[0].context_generation = 2; return []; };
    db.seed("account_members", [{ account_id: account, user_id: actor, role: "owner" }]);
    expect((await GET(req())).status).toBe(409);
  });
  it("database failure is unavailable, never empty history or leaked error", async () => {
    db.rpcs.read_workspace_history = () => { throw Error("private SQL credential text"); };
    const response = await GET(req()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private SQL");
  });
});
