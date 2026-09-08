import { describe, expect, it, vi } from "vitest";
import type { DbClient, Row } from "../../db/types";
import { callbackToken, controlView, dispatchGrokChange, readGrokChange, receiveGrokAck, type GrokChange, type GrokAck } from "../grokControl";

const now = Date.parse("2026-09-08T07:10:00Z");
const secret = "test-only-signing-secret-012345678901234567890";
const change: GrokChange = { changeId: "00000000-0000-4000-8000-000000000001", accountId: "00000000-0000-4000-8000-000000000002",
  routineId: "D02-W01", contextGeneration: 1, workerId: "test-worker", stateUpdatedAt: "2026-09-08T07:00:00Z",
  enabled: true, schedule: { time: "00:15", timezone: "Pacific/Auckland" }, expiresAt: "2026-09-08T07:30:00Z" };
const ack: GrokAck = { changeId: change.changeId, workerId: change.workerId, status: "applied", enabled: true, schedule: change.schedule, blocker: null };
const config = { webhookUrl: "https://api2.cursor.sh/test-only", webhookKey: "test-only-webhook-key",
  callbackOrigin: "https://junction.example", signingSecret: secret };
function fixture() {
  const rows: Record<string, Row[]> = { receipts: [], accounts: [{ id: change.accountId, context_generation: 1, automation_paused: false }],
    routine_states: [{ account_id: change.accountId, routine_id: change.routineId, enabled: true, updated_at: change.stateUpdatedAt }] };
  const db = { from(table: string) {
    return { insert: async (r: Row) => {
      if (rows[table].some(x => x.id === r.id)) return { data: null, error: { code: "23505" } };
      rows[table].push(r); return { data: null, error: null };
    }, select: () => { const filters: [string, unknown][] = []; const q = {
      eq(k: string, v: unknown) { filters.push([k,v]); return q; },
      async maybeSingle() { return { error: null, data: rows[table].find(r => filters.every(([k,v]) => r[k] === v)) ?? null }; },
    }; return q; } };
  } } as unknown as DbClient;
  const fetcher = vi.fn(async () => Response.json({ success: true }));
  const send = (c = change, conf = config) => dispatchGrokChange(db, c, conf, fetcher as typeof fetch, now);
  const receive = (body: unknown = ack, token = callbackToken(change, secret), at = now) => receiveGrokAck(
    new Request("https://junction.example/callback", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    change.changeId, { db: () => db, secret, enabled: true, now: () => at });
  return { db, rows, fetcher, send, receive };
}
describe("Grok control transport — simulated persistence and network", () => {
  it("saves the request before sending and never records secrets", async () => {
    const f = fixture();
    f.fetcher.mockImplementation(async () => { expect(f.rows.receipts).toHaveLength(1); return Response.json({ success: true }); });
    expect(await f.send()).toEqual({ status: "accepted" });
    const request = f.fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    const body = JSON.parse(request[1].body as string);
    expect(body.callback.authorization).toBe(`Bearer ${callbackToken(change, secret)}`);
    expect(body.callback.url).toContain(change.changeId);
    expect(JSON.stringify(f.rows)).not.toContain(secret);
    expect(JSON.stringify(f.rows)).not.toContain(config.webhookKey);
    expect(request[1].redirect).toBe("error");
  });
  it("does not confuse accepted with active", async () => {
    const f = fixture(); await f.send();
    expect(await readGrokChange(f.db, change.changeId, change.accountId, now)).toMatchObject({ status: "setting_up", evidence: "pending" });
  });
  it("persists an applied acknowledgement and reads confirmed status", async () => {
    const f = fixture(); await f.send(); expect((await f.receive()).status).toBe(201);
    expect(await readGrokChange(f.db, change.changeId, change.accountId, now)).toMatchObject({ status: "active", evidence: "agent_reported" });
  });
  it("one concurrent caller dispatches; the duplicate does not resend", async () => {
    const f = fixture(); const results = await Promise.all([f.send(), f.send()]);
    expect(results.map(x=>x.status).sort()).toEqual(["accepted", "already_requested"]);
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it("rejects conflicting reuse of a change ID", async () => {
    const f = fixture(); await f.send();
    await expect(f.send({ ...change, schedule: { ...change.schedule, time: "01:00" } })).rejects.toThrow("Conflicting");
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it("accepts identical callback retry but refuses conflicting results", async () => {
    const f = fixture(); await f.send(); await f.receive();
    expect(await (await f.receive()).json()).toEqual({ saved: true, duplicate: true });
    expect((await f.receive({ ...ack, status: "blocked", blocker: "connection_required" })).status).toBe(409);
    expect(f.rows.receipts).toHaveLength(2);
  });
  it.each(["workerId", "changeId", "enabled", "schedule"])("refuses mismatched %s", async field => {
    const f = fixture(); await f.send();
    const value = field === "workerId" ? "other-worker" : field === "changeId" ? change.accountId : field === "enabled" ? false : { time: "05:00", timezone: "UTC" };
    expect((await f.receive({ ...ack, [field]: value })).status).toBe(409);
    expect(f.rows.receipts).toHaveLength(1);
  });
  it("rejects wrong token and expired authorization", async () => {
    const f = fixture(); await f.send();
    expect((await f.receive(ack, "x".repeat(43))).status).toBe(401);
    expect((await f.receive(ack, undefined, Date.parse(change.expiresAt))).status).toBe(410);
  });
  it("binds authorization to account, desired state and worker", () => {
    for (const c of [{ ...change, accountId: change.changeId }, { ...change, workerId: "other" }, { ...change, enabled: false }])
      expect(callbackToken(c, secret)).not.toBe(callbackToken(change, secret));
  });
  it("refuses stale settings at both dispatch and callback", async () => {
    const f = fixture(); await f.send(); f.rows.routine_states[0].updated_at = "2026-09-08T07:01:00Z";
    expect((await f.receive()).status).toBe(409);
    expect(await readGrokChange(f.db, change.changeId, change.accountId, now)).toMatchObject({ status: "superseded" });
    await expect(f.send()).rejects.toThrow("Saved settings changed");
  });
  it("refuses changed context and paused enable", async () => {
    const f = fixture(); f.rows.accounts[0].context_generation = 2;
    await expect(f.send()).rejects.toThrow("Saved settings changed");
    f.rows.accounts[0].context_generation = 1; f.rows.accounts[0].automation_paused = true;
    await expect(f.send()).rejects.toThrow("Saved settings changed");
  });
  it("preserves sub-millisecond saved-state revisions", async () => {
    const f = fixture();
    const c = { ...change, stateUpdatedAt: "2026-09-08T07:00:00.000001Z" };
    f.rows.routine_states[0].updated_at = "2026-09-08T07:00:00.000002+00:00";
    await expect(f.send(c)).rejects.toThrow("Saved settings changed");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("permits pause requests while account automation is paused", async () => {
    const f = fixture(); f.rows.accounts[0].automation_paused = true; f.rows.routine_states[0].enabled = false;
    expect(await f.send({ ...change, enabled: false })).toEqual({ status: "accepted" });
  });
  it("does not expose another account's status", async () => {
    const f = fixture(); await f.send(); expect(await readGrokChange(f.db, change.changeId, change.changeId, now)).toBeNull();
  });
  it("blocks unapproved hosts and redirects", async () => {
    const f = fixture(); await expect(f.send(change, { ...config, webhookUrl: "https://example.com" })).rejects.toThrow("Invalid");
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.rows.receipts).toHaveLength(0);
  });
  it("preserves ambiguous delivery for reconciliation, never blind-retries", async () => {
    const f = fixture(); f.fetcher.mockRejectedValue(new Error("timeout"));
    expect(await f.send()).toEqual({ status: "needs_reconciliation" });
    expect(await f.send()).toEqual({ status: "already_requested" }); expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it("turns missing acknowledgements and blockers into a team-action status", async () => {
    const f = fixture(); await f.send();
    expect((await readGrokChange(f.db, change.changeId, change.accountId, Date.parse(change.expiresAt)))?.teamActionRequired).toBe(true);
    expect((await f.receive({ ...ack, enabled: false, status: "blocked", blocker: "connection_required" })).status).toBe(201);
    expect(await readGrokChange(f.db, change.changeId, change.accountId, now)).toMatchObject({ status: "needs_attention", message: "We’re finishing your connection setup." });
  });
  it("has clear stopping and off copy", () => {
    expect(controlView({ ...change, enabled: false }, null, now).status).toBe("stopping");
    expect(controlView({ ...change, enabled: false }, { ...ack, enabled: false }, now).status).toBe("off");
  });
});
