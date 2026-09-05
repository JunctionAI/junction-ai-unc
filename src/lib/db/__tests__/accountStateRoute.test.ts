import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountInitialState } from "../../platform/state";
import { stateSaveRows } from "../stateSave";
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/session", () => ({
  requireAccountSession: async () => session.current,
  requireAccountOwnerSession: async () => {
    const current = session.current as { role?: string } | Response;
    return current instanceof Response ? current : current?.role !== "owner" ? Response.json({ error: "owner only" }, { status: 403 }) : current;
  },
}));
import { GET, PUT } from "@/app/api/account/state/route";

const ACCT = "00000000-0000-4000-8000-000000000001";
const ID = "00000000-0000-4000-8000-000000000002";
const rpc = vi.fn();
const body = () => ({ accountId: ACCT, revision: 5, saveId: ID, rows: stateSaveRows(ACCT, accountInitialState()) });
const put = (value: unknown, headers: Record<string, string> = {}) => PUT(new Request("https://unc.test/api/account/state", {
  method: "PUT", headers: { "content-type": "application/json", "x-unc-account-save": "1", ...headers }, body: JSON.stringify(value),
}));
beforeEach(() => {
  rpc.mockReset();
  session.current = { accountId: ACCT, userId: "session-owner", role: "owner", service: { rpc } };
});

describe("account state API", () => {
  it("pins actor and account to the verified session and returns no-store", async () => {
    rpc.mockResolvedValue({ data: { ok: true, revision: 6, replayed: false }, error: null });
    const response = await put({ ...body(), userId: "spoofed-owner" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rpc).toHaveBeenCalledWith("save_account_state_atomic", expect.objectContaining({ p_user_id: "session-owner", p_account_id: ACCT, p_expected_revision: 5, p_save_id: ID }));
    expect(await response.json()).toEqual({ ok: true, accountId: ACCT, revision: 6, replayed: false });
  });
  it("rejects other accounts, runtime sections, malformed IDs and cross-origin requests before SQL", async () => {
    expect((await put({ ...body(), accountId: "other" })).status).toBe(403);
    const runtime = body();
    expect((await put({ ...runtime, rows: { ...runtime.rows, connectors: [{ status: "connected" }] } })).status).toBe(400);
    expect((await put({ ...body(), saveId: "nope" })).status).toBe(400);
    expect((await put({ ...body(), revision: -1 })).status).toBe(400);
    expect((await put(body(), { origin: "https://attacker.invalid" })).status).toBe(403);
    expect((await put(body(), { "content-type": "text/plain" })).status).toBe(415);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("retains session and owner denial", async () => {
    session.current = Response.json({ error: "sign in" }, { status: 401 });
    expect((await put(body())).status).toBe(401);
    expect((await GET()).status).toBe(401);
    session.current = { accountId: ACCT, userId: "member", role: "member", service: { rpc } };
    expect((await put(body())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("turns stale/reused save conflicts into 409 without retries", async () => {
    for (const code of ["state_conflict", "save_id_conflict"]) {
      rpc.mockResolvedValueOnce({ data: { ok: false, code }, error: null });
      expect((await put(body())).status).toBe(409);
    }
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("does not expose database error text or pretend a failed save succeeded", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "private database detail" } });
    const response = await put(body());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private database detail");
  });
  it("loads one coherent row snapshot and revision, with honest defaults", async () => {
    rpc.mockResolvedValue({ data: { account: { id: ACCT, name: "AVGAR", currency: "NZD" }, goals: [], resourceProfile: null,
      teamMembers: [], businessProfile: null, routineStates: [], connectors: [], chatMessages: [], stateMeta: null }, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("load_account_state_snapshot", { p_account_id: ACCT });
    const result = await response.json();
    expect(result).toMatchObject({ accountId: ACCT, role: "owner", name: "AVGAR", revision: 0, state: { goalTitle: "", marginPct: null, messages: [] } });
  });
  it("fails closed on unavailable or mismatched snapshots", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    expect((await GET()).status).toBe(503);
    rpc.mockResolvedValueOnce({ data: { account: { id: "other" } }, error: null });
    expect((await GET()).status).toBe(404);
  });
});
