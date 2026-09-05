import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsIdentity } from "../session";
import type { DbClient } from "@/lib/db/types";
import { opsNext, opsStage, type OpsClient } from "../types";
let identity: OpsIdentity | Response;
const rpc = vi.fn();
vi.mock("../session", () => ({ requireOpsIdentity: async () => identity }));
import { GET } from "@/app/api/ops/route";
const A = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";
const snapshot = { checkedAt: "2026-09-05T11:00:00Z", clients: [], runs: [], selected: null, accountCount: 0, accountLimit: 100, historyLimit: 100 };
const request = (query = "") => new Request(`https://unc.test/api/ops${query}`, { headers: { "x-unc-account-id": "forged", "x-operator-id": "forged" } });
beforeEach(() => { rpc.mockReset(); identity = { userId: U, service: { rpc } as unknown as DbClient }; rpc.mockResolvedValue({ data: snapshot, error: null }); });
describe("operator route boundary", () => {
  it("uses only the validated server actor, never headers or account membership", async () => {
    const r = await GET(request()); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("read_ops_console", { p_user_id: U, p_account_id: null });
  });
  it("refuses unsigned or unavailable auth before database reads", async () => {
    for (const status of [401, 503]) { identity = new Response(null, { status }); const r = await GET(request()); expect(r.status).toBe(status); expect(r.headers.get("cache-control")).toContain("no-store"); }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects actor injection, duplicate selectors and malformed client IDs", async () => {
    for (const q of ["?userId=forged", "?accountId=bad", `?accountId=${A}&accountId=${A}`, `?accountId=${A}&role=admin`]) expect((await GET(request(q))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("forwards the exact selected scope and requires a matching detail", async () => {
    expect((await GET(request(`?accountId=${A}`))).status).toBe(503);
    rpc.mockResolvedValue({ data: { ...snapshot, selected: { accountId: A } }, error: null });
    expect((await GET(request(`?accountId=${A}`))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("read_ops_console", { p_user_id: U, p_account_id: A });
  });
  it("fails closed on missing/revoked scope without returning database details", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "secret database details" } });
    const r = await GET(request(`?accountId=${A}`)); expect(r.status).toBe(403); expect(await r.text()).not.toContain("secret");
  });
  it("database failure or malformed confirmation is not an empty/healthy success", async () => {
    for (const data of [null, {}, { ...snapshot, clients: null }, { ...snapshot, selected: { accountId: A } }]) { rpc.mockResolvedValue({ data, error: null }); expect((await GET(request())).status).toBe(503); }
    rpc.mockResolvedValue({ data: snapshot, error: { code: "XX000", message: "private" } });
    const r = await GET(request()); expect(r.status).toBe(503); expect(await r.text()).not.toContain("private");
    rpc.mockRejectedValue(new Error("raw connection failure")); expect((await GET(request())).status).toBe(503);
  });
});
describe("truthful operator setup stages", () => {
  const client = { memberCount: 1, connectorCount: 2, datedReadCount: 2, paused: false, enabledCount: 1, runCount: 1 } as OpsClient;
  it("never infers Live or complete acceptance from saved flags or runs", () => {
    expect(opsStage(client)).toBe("Review runtime"); expect(opsNext(client)).toContain("not readiness");
    expect(opsStage({ ...client, paused: true })).toBe("Paused");
    expect(opsStage({ ...client, datedReadCount: 0 })).toBe("Needs verification");
    expect(opsStage({ ...client, connectorCount: 0 })).toBe("Needs connections");
    expect(opsStage({ ...client, memberCount: 0 })).toBe("Needs identity");
  });
  it("owner reconciliation comes before new invites or connections", () => {
    expect(opsNext({ ...client, memberCount: 0 })).toContain("before assigning login");
    expect(opsNext({ ...client, connectorCount: 0 })).toContain("existing grants");
  });
});
