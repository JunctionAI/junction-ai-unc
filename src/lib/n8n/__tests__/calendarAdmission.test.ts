import { describe, it, expect, vi } from "vitest";
import { FakeSupabase } from "../../db/__tests__/fakeSupabase";
import { calendarScope, DbCalendarShadowAdmission, calendarReservation, calendarStartClaim } from "../calendarAdmission";
import { runCalendarShadow } from "../../../worker/runCalendarShadow";
import { calendarShadowSpec } from "../calendarShadowSpec";
import { stableHash } from "../../runtime/context";
import type { RunRecord } from "../../runtime/store/interface";
import { adapters } from "../../runtime/__tests__/helpers";
import { account, ctx, contract, env, start, now } from "./calendarFixture";
const routeMock = vi.hoisted(() => ({ deps: {} as unknown }));
vi.mock("../routeDeps", () => ({ proxyDeps: () => routeMock.deps }));
import { GET, POST } from "@/app/api/n8n/calendar-shadow-authority/route";

const scope = { accountId: account.accountId, contextGeneration: account.contextGeneration, runId: ctx.runId };
const permit = "00000000-0000-4000-8000-000000000009";
const approval = { authorizedBy: permit, approvalReference: "owner:test", idempotencyKey: "unique:test", contextGeneration: scope.contextGeneration,
  maxDispatches: 1 as const, expiresAt: "2026-09-06T12:05:00.000Z" };
const identity = { ...scope, contract, registrationId: permit, receiverUrl: env.N8N_CALENDAR_SHADOW_RECEIVER_URL,
  requestDigest: "a".repeat(64), tokenDigest: "b".repeat(64), specHash: "original" };
function run(): RunRecord {
  const spec = calendarShadowSpec(contract, 2);
  return { id: scope.runId, accountId: scope.accountId, contextGeneration: scope.contextGeneration, routineId: "D05-W07", version: 2,
    mode: "dry_run", status: "running", startedAt: start, specHash: stableHash(spec), snapshot: {
      spec, ctx: structuredClone(ctx), awaiting: "calendar_start", nextNodeIndex: 0, startProtocol: "calendar_claim_v1" } };
}
describe("calendar database adapter boundaries", () => {
  it.each([{ accountId: "bad" }, { runId: "bad" }, { contextGeneration: -1 }, { contextGeneration: 0.5 }])("refuses invalid scope %j", patch => {
    expect(() => calendarScope({ ...scope, ...patch })).toThrow();
  });
  it("captures scope and includes it in every transition; no keyword RPCs", async () => {
    const db = new FakeSupabase(), captured = { ...scope }, ledger = new DbCalendarShadowAdmission(db, captured);
    captured.accountId = permit;
    const calls: Record<string, unknown>[] = [];
    db.rpcs.transition_calendar_shadow = ({ input }) => { const row = input as Record<string, unknown>; calls.push(row); return row.operation === "dispatch" ? permit : true; };
    expect(await ledger.claim(identity)).toBe(permit); expect(await ledger.authorize(identity)).toBe(true);
    await ledger.finish(permit, "uncertain", "123");
    expect(calls).toHaveLength(3);for (const call of calls) expect(call).toMatchObject(scope);
    expect(calls[2]).toMatchObject({ permitId: permit, operation: "finish", executionId: "123", result: null });
    await expect(ledger.claim({ ...identity, accountId: permit })).rejects.toThrow("scope");
    expect(calls).toHaveLength(3);
  });
  it.each([false, null, { invalid: true }])("does not treat %j as a successful checkpoint or outcome", async returned => {
    const db = new FakeSupabase();db.rpcs.transition_calendar_shadow = () => returned;
    const ledger = new DbCalendarShadowAdmission(db, scope);
    await expect(ledger.finish(permit, "uncertain")).rejects.toThrow("uncertain");
    await expect(ledger.claim(identity)).rejects.toThrow("unavailable");
  });
  it("captures owner approval and refuses duplicate issuance rather than resuming", async () => {
    const db = new FakeSupabase(), mutable = { ...approval }, reserve = calendarReservation(db, mutable, now);
    mutable.maxDispatches = 2 as 1;
    db.rpcs.issue_calendar_shadow_run = ({ input }) => {
      expect((input as { approval: unknown }).approval).toEqual(approval);
      return { created: false, runId: ctx.runId, permitId: permit };
    };
    await expect(reserve(run())).rejects.toThrow("already issued");
  });
  it.each(["2026-09-06T11:59:59Z", "2026-09-07T12:00:00Z", "invalid"])("rejects invalid expiry %s before RPC", async expiresAt => {
    const db = new FakeSupabase(), issue = vi.fn();db.rpcs.issue_calendar_shadow_run = issue;
    await expect(calendarReservation(db, { ...approval, expiresAt }, now)(run())).rejects.toThrow("allowance");expect(issue).not.toHaveBeenCalled();
  });
  it("start compares the original run and rejects a changed spec fingerprint locally", async () => {
    const db = new FakeSupabase(), startRpc = vi.fn(() => true);db.rpcs.transition_calendar_shadow = startRpc;
    const original = run();expect(await calendarStartClaim(db)(original)).toBe(true);
    expect(startRpc).toHaveBeenCalledWith({ input: { ...scope, operation: "start", run: original } });
    original.specHash = "changed";await expect(calendarStartClaim(db)(original)).rejects.toThrow("specification");expect(startRpc).toHaveBeenCalledTimes(1);
  });
});
describe("explicit calendar selection and route", () => {
  function fixture() {
    const db = new FakeSupabase(), f = adapters();
    db.seed("accounts", [{ id: scope.accountId, context_generation: scope.contextGeneration, automation_paused: false }]);
    db.seed("n8n_calendar_bindings", [{ id: contract.client.bindingId, account_id: scope.accountId, context_generation: scope.contextGeneration, revoked_at: null, spec_template: calendarShadowSpec(contract, 2) }]);
    const issue = vi.fn();db.rpcs.issue_calendar_shadow_run = issue;
    const input = { ...scope, bindingId: contract.client.bindingId, approval };
    return { db, issue, input, deps: { db, account, env: { ...env }, adapters: f.adapters, now } };
  }
  it.each(["no_binding", "revoked", "foreign", "paused", "missing_reader", "same_receiver_token", "changed_template"])("refuses %s before allowance/provider work", async fault => {
    const f = fixture();
    if (fault === "no_binding") f.input.bindingId = permit;
    if (fault === "revoked") f.db.rows("n8n_calendar_bindings")[0].revoked_at = start;
    if (fault === "foreign") f.input.accountId = permit;
    if (fault === "paused") f.db.rows("accounts")[0].automation_paused = true;
    if (fault === "missing_reader") f.deps.env.N8N_EXECUTION_READER_ENABLED = "false";
    if (fault === "same_receiver_token") f.deps.env.N8N_CALENDAR_SHADOW_RECEIVER_TOKEN = f.deps.env.N8N_SHADOW_RECEIVER_TOKEN;
    if (fault === "changed_template") (f.db.rows("n8n_calendar_bindings")[0].spec_template as { name: string }).name = "unreviewed";
    await expect(runCalendarShadow(f.input, f.deps)).rejects.toThrow();expect(f.issue).not.toHaveBeenCalled();
  });
  it("new route rejects GET and missing bearer without cacheable authority", async () => {
    routeMock.deps = { secret: "synthetic-signing-key" };
    const get = await GET();expect(get.status).toBe(405);expect(get.headers.get("allow")).toBe("POST");
    const post = await POST(new Request("https://example.com/api/n8n/calendar-shadow-authority", { method: "POST" }));
    expect(post.status).toBe(401);expect(post.headers.get("cache-control")).toBe("no-store");
  });
});
