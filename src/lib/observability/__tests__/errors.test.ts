/* Error capture (redaction, the app_errors row, the client-safe 500) and the health report. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/db/__tests__/fakeSupabase";
import { captureError, CLIENT_ERROR_LINE, describeError, setErrorDbForTests, withErrorCapture } from "../errors";
import { healthReport } from "../health";

const dbMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/worker/wiring", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/worker/wiring")>()), serviceDb: () => dbMock.current }));
import { GET as healthGET } from "@/app/api/health/route";

const NOW = new Date("2026-09-03T07:00:00.000Z");
let db: FakeSupabase;
let lines: string[];
const log = (l: string) => lines.push(l);

beforeEach(() => {
  db = new FakeSupabase();
  db.now = () => NOW.toISOString();
  lines = [];
  setErrorDbForTests(() => db);
  dbMock.current = db;
});
afterEach(() => {
  setErrorDbForTests(undefined);
  vi.unstubAllEnvs();
});

describe("describeError / captureError", () => {
  it("redacts token-shaped values and key-shaped fields; truncates the stack; keeps the account", () => {
    const err = new Error("Shopify said 401 for shpat_0123456789abcdef with Bearer sk-ant-abcdefghijklmnop");
    const row = describeError("api/x", err, { accountId: "acct-1", apiKey: "secret-value", shop: "acme.myshopify.com", nested: { authorization: "Bearer zzz" } }, NOW);
    expect(row.scope).toBe("api/x");
    expect(row.message).not.toContain("sk-ant-");
    expect(row.message).toContain("Shopify said 401");
    expect(row.accountId).toBe("acct-1");
    expect(row.context).toEqual({ apiKey: "[redacted]", shop: "acme.myshopify.com", nested: { authorization: "[redacted]" } });
    expect(row.stack!.length).toBeLessThanOrEqual(4000);
    expect(row.createdAt).toBe(NOW.toISOString());
    expect(describeError("s", "plain string")).toMatchObject({ message: "plain string", stack: null, accountId: null });
    expect(describeError("s", undefined)).toMatchObject({ message: "unknown error" });
  });

  it("writes one app_errors row (schema-checked) and one console line; a failed write never throws", async () => {
    db.seed("accounts", [{ id: "00000000-0000-4000-8000-00000000acc1" }]);
    const row = await captureError("worker.tick", new Error("boom"), { accountId: "00000000-0000-4000-8000-00000000acc1", routineId: "D01-W01" }, { log, now: () => NOW });
    expect(row.message).toBe("boom");
    expect(db.rows("app_errors")).toMatchObject([{ scope: "worker.tick", message: "boom", account_id: "00000000-0000-4000-8000-00000000acc1", context: { routineId: "D01-W01" }, created_at: NOW.toISOString() }]);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "error.captured", scope: "worker.tick", message: "boom" });
    const broken = { from: () => { throw new Error("db down"); }, rpc: () => { throw new Error("db down"); } } as unknown as FakeSupabase;
    await expect(captureError("x", new Error("y"), {}, { db: broken, log })).resolves.toMatchObject({ message: "y" });
    expect(lines.some((l) => l.includes("error.write_failed"))).toBe(true);
    // db: null → console only
    lines = [];
    await captureError("x", new Error("z"), {}, { db: null, log });
    expect(lines).toHaveLength(1);
    expect(db.rows("app_errors")).toHaveLength(1);
  });
});

describe("withErrorCapture", () => {
  it("passes a good response through; on a throw captures (method + path, never the query) and answers a plain 500", async () => {
    const ok = withErrorCapture("api/ok", async () => Response.json({ fine: true }), { log });
    expect(await (await ok()).json()).toEqual({ fine: true });
    const bad = withErrorCapture("api/bad", async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
      const { id } = await ctx.params;
      throw new Error(`token shpat_abcdefabcdef leaked for ${id}`);
    }, { log, now: () => NOW });
    const res = await bad(new Request("http://unc.test/api/bad/7?apiKey=SECRET", { method: "POST" }), { params: Promise.resolve({ id: "7" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: CLIENT_ERROR_LINE });
    expect(JSON.stringify(body)).not.toMatch(/shpat_|leaked|stack/);
    expect(db.rows("app_errors")).toMatchObject([{ scope: "api/bad", context: { method: "POST", path: "/api/bad/7" } }]);
    expect(db.rows("app_errors")[0].message).not.toContain("shpat_");
    expect(JSON.stringify(db.rows("app_errors")[0].context)).not.toContain("SECRET");
  });
});

describe("healthReport + GET /api/health", () => {
  it("no database: ok, no worker line", async () => {
    const r = await healthReport({ db: null, env: {}, version: "0.1.0", now: () => NOW });
    expect(r).toMatchObject({ ok: true, build: { sha: null, version: "0.1.0" }, db: { configured: false, ok: true, ms: null }, worker: null, time: NOW.toISOString() });
  });

  it("database reachable + a fresh worker heartbeat; stale heartbeat reads as not fresh; sha from VERCEL_GIT_COMMIT_SHA", async () => {
    db.seed("accounts", [{ id: "00000000-0000-4000-8000-00000000acc1" }]);
    db.seed("worker_heartbeats", [{ worker: "unc", pid: 12, started_at: "2026-09-03T06:00:00.000Z", last_tick_at: "2026-09-03T06:59:20.000Z", ticks: 60, runs_started: 3, stopping: false, last_error: null }]);
    const r = await healthReport({ db, env: { VERCEL_GIT_COMMIT_SHA: "abcdef1234567890" }, version: "0.1.0", now: () => NOW });
    expect(r.ok).toBe(true);
    expect(r.build.sha).toBe("abcdef123456");
    expect(r.db).toMatchObject({ configured: true, ok: true });
    expect(r.worker).toMatchObject({ lastSeenAt: "2026-09-03T06:59:20.000Z", ageSec: 40, fresh: true, ticks: 60, stopping: false });
    const stale = await healthReport({ db, env: {}, version: "0.1.0", now: () => new Date(NOW.getTime() + 10 * 60_000) });
    expect(stale.worker).toMatchObject({ ageSec: 640, fresh: false });
    // the route: 200 with the same shape, no-store
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "feedfacefeedface");
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true, build: { sha: "feedfacefeed" }, db: { ok: true }, worker: { ticks: 60 } });
  });

  it("uses a validated UNC_BUILD_SHA when deployment metadata is unavailable", async () => {
    const fallback = await healthReport({ db: null, env: { UNC_BUILD_SHA: "2B903868A066DD6DCE1F7D6B7792F217134F243F" }, version: "0.1.0", now: () => NOW });
    expect(fallback.build.sha).toBe("2b903868a066");
    const preferred = await healthReport({ db: null, env: { VERCEL_GIT_COMMIT_SHA: "abcdef1234567890", UNC_BUILD_SHA: "2b903868a066dd6dce1f7d6b7792f217134f243f" }, version: "0.1.0", now: () => NOW });
    expect(preferred.build.sha).toBe("abcdef123456");
    const invalid = await healthReport({ db: null, env: { VERCEL_GIT_COMMIT_SHA: "not-a-sha", UNC_BUILD_SHA: "also-not-a-sha" }, version: "0.1.0", now: () => NOW });
    expect(invalid.build.sha).toBeNull();
  });

  it("database configured but unreachable → ok:false / 503", async () => {
    const broken = { from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { message: "connection refused" } }) }) }), rpc: async () => ({ data: null, error: null }) } as unknown as FakeSupabase;
    const r = await healthReport({ db: broken, env: {}, version: "0.1.0", now: () => NOW });
    expect(r).toMatchObject({ ok: false, db: { configured: true, ok: false, error: "connection refused" } });
    dbMock.current = broken;
    expect((await healthGET()).status).toBe(503);
  });
});
