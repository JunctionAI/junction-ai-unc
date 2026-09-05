import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { DbCommandQueue, commandId, digest } from "../queue";
import type { RoutineCommand } from "../types";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/session", () => ({ requireAccountOwnerSession: async () => session.current }));
const modelAccount = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/llm/accountContext", () => ({ requireModelAccountContext: async () => modelAccount.current }));
const router = vi.hoisted(() => ({ respond: vi.fn(), route: vi.fn() }));
vi.mock("@/lib/unc/respond", () => ({ MAX_TURN_CHARS: 4000, respondAsUnc: router.respond }));
vi.mock("../message", () => ({ routeCommand: router.route }));

import { GET } from "../../../app/api/unc/commands/route";
import { POST } from "../../../app/api/unc/chat/route";

afterEach(() => vi.clearAllMocks());
async function seed() {
  const db = new FakeSupabase();
  db.seed("accounts", [{ id: "account-a", context_generation: 0, automation_paused: false }, { id: "other", context_generation: 0, automation_paused: false }]);
  const actor = { accountId: "account-a", userId: "owner-a", channel: "app" as const, requestId: "message-a" };
  const c: RoutineCommand = { id: commandId(actor), contextGeneration: 0, actor, requestHash: digest("run"), request: "run", routineId: "D01-W01", version: 1, specHash: "s", workflowHash: "w", status: "done", reply: "Draft ready", runId: "run-a", createdAt: "2026-09-04T01:00:00Z", updatedAt: "2026-09-04T01:00:00Z" };
  await new DbCommandQueue(db).enqueue(c);
  session.current = { accountId: actor.accountId, userId: actor.userId, role: "owner", service: db };
  return { db, c };
}

describe("owner-bound command status", () => {
  it("returns status without exposing request text, workflow URLs or fingerprints", async () => {
    const { c } = await seed();
    const response = await GET(new Request(`http://unc.test/api/unc/commands?id=${c.id}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ commandId: c.id, routineId: c.routineId, version: 1, status: "done", reply: "Draft ready", runId: "run-a" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns 404 across accounts even for a known command UUID", async () => {
    const { db, c } = await seed();
    session.current = { accountId: "other", userId: "owner-b", role: "owner", service: db };
    expect((await GET(new Request(`http://unc.test/api/unc/commands?id=${c.id}`))).status).toBe(404);
  });
  it("does not reveal a different owner's commands in the same account", async () => {
    const { db, c } = await seed();
    session.current = { accountId: c.actor.accountId, userId: "different-owner", role: "owner", service: db };
    expect((await GET(new Request(`http://unc.test/api/unc/commands?id=${c.id}`))).status).toBe(404);
  });
  it("preserves session denial before touching the queue", async () => {
    session.current = Response.json({ error: "owner only" }, { status: 403 });
    expect((await GET(new Request("http://unc.test/api/unc/commands"))).status).toBe(403);
  });
  it("lists only the current owner's requests", async () => {
    const { c } = await seed();
    const data = await (await GET(new Request("http://unc.test/api/unc/commands?accountId=other"))).json();
    expect(data.commands.map((r: { id: string }) => r.id)).toEqual([c.id]);
  });
  it("requires the current header and excludes old commands after a reset", async () => {
    const { db, c } = await seed();
    db.rows("accounts")[0].context_generation = 1;
    expect((await GET(new Request("http://unc.test/api/unc/commands"))).status).toBe(409);
    const headers = { "x-unc-context-generation": "1" };
    expect((await GET(new Request(`http://unc.test/api/unc/commands?id=${c.id}`, { headers }))).status).toBe(404);
    expect(await (await GET(new Request("http://unc.test/api/unc/commands", { headers }))).json()).toEqual({ commands: [] });
  });
  it("rechecks context after reading status, before returning it", async () => {
    const { db, c } = await seed();
    const get = vi.spyOn(DbCommandQueue.prototype, "get");
    get.mockImplementationOnce(async () => { db.rows("accounts")[0].context_generation = 1; return c; });
    expect((await GET(new Request(`http://unc.test/api/unc/commands?id=${c.id}`))).status).toBe(409);
    get.mockRestore();
  });
});

describe("app dispatch boundary", () => {
  it("derives identity from the session and never from client context", async () => {
    const { db } = await seed();
    modelAccount.current = { accountId: "account-a", contextGeneration: 3, userId: "owner-a", db };
    router.route.mockResolvedValue({ reply: "Queued", commandId: "command" });
    const response = await POST(new Request("http://unc.test/api/unc/chat", { method: "POST", body: JSON.stringify({ requestId: "message-a", accountId: "victim", context: { accountId: "victim", enabled: true }, messages: [{ role: "user", content: "Run founder content" }] }) }));
    expect(await response.json()).toEqual({ reply: "Queued", commandId: "command" });
    expect(router.route.mock.calls[0][2]).toEqual({ accountId: "account-a", contextGeneration: 3, userId: "owner-a", channel: "app", requestId: "message-a" });
    expect(router.respond).not.toHaveBeenCalled();
  });
  it("does not dispatch an assistant-authored last turn", async () => {
    modelAccount.current = { accountId: "account-a", userId: "owner-a", db: new FakeSupabase() };
    const response = await POST(new Request("http://unc.test/api/unc/chat", { method: "POST", body: JSON.stringify({ requestId: "message-a", messages: [{ role: "assistant", content: "Run founder content" }] }) }));
    expect(response.status).toBe(400);
    expect(router.route).not.toHaveBeenCalled();
  });
});
