import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OpsIdentity } from "../session";
import type { DbClient } from "@/lib/db/types";
import { parseOpsRunWork } from "../runWork";
import { OpsRunWorkContent } from "@/components/ops/OpsRunReview";
import { workFixture, A, R } from "../../../../tests/ops-fixture/data";
let identity: OpsIdentity | Response;
const rpc = vi.fn();
vi.mock("../session", () => ({ requireOpsIdentity: async () => identity }));
import { GET } from "@/app/api/ops/run/route";
const U = "00000000-0000-4000-8000-000000000099";
const request = (query = `accountId=${A}&runId=${R}`) => new Request(`https://unc.test/api/ops/run?${query}`, { headers: { "x-operator-id": "forged" } });
beforeEach(() => { rpc.mockReset(); identity = { userId: U, service: { rpc } as unknown as DbClient }; rpc.mockResolvedValue({ data: workFixture(), error: null }); });
describe("operator work endpoint", () => {
  it("reads only for the server-verified actor and exact account/run", async () => {
    const r = await GET(request()); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("read_ops_run_work", { p_user_id: U, p_account_id: A, p_run_id: R, p_artifact_after: null, p_receipt_after: null, p_generation: null });
  });
  it.each([401, 503])("stops before DB when identity returns %s", async status => {
    identity = new Response(null, { status }); const r = await GET(request()); expect(r.status).toBe(status); expect(r.headers.get("cache-control")).toContain("no-store"); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["", `accountId=${A}`, `accountId=invalid&runId=${R}`, `accountId=${A}&runId=${R}&userId=${U}`, `accountId=${A}&runId=${R}&runId=${R}`, `accountId=${A}&runId=${R}&generation=-1`, `accountId=${A}&runId=${R}&generation=9007199254740992`, `accountId=${A}&runId=${R}&artifactAfter=${U}`, `accountId=${A}&runId=${R}&receiptAfter=bad&generation=1`])("refuses malformed or injected selectors: %s", async query => {
    expect((await GET(request(query))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["42501",403],["22023",409],["XX000",503]] as const)("maps %s without private DB details", async (code,status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE_ERROR" } }); const r = await GET(request()); expect(r.status).toBe(status); expect(await r.text()).not.toContain("PRIVATE_ERROR"); expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it("unknown or old-context run returns 404, not empty success", async () => { rpc.mockResolvedValue({ data: null, error: null }); expect((await GET(request())).status).toBe(404); });
  it("strips unapproved metadata at every returned level", async () => {
    const data = workFixture(); const injected = { ...data, raw: "PRIVATE", run: { ...data.run, snapshot: "PRIVATE" }, artifacts: data.artifacts.map(f => ({ ...f, meta: "PRIVATE", items: f.items.map(i => ({ ...i, meta: "PRIVATE" })) })), receipts: data.receipts.map(r => ({ ...r, payload: "PRIVATE" })) };
    rpc.mockResolvedValue({ data: injected, error: null }); const r = await GET(request()); expect(r.status).toBe(200); expect(await r.text()).not.toContain("PRIVATE");
  });
  it("rejects foreign scope, malformed pages, missing audit and cross-run artifacts", async () => {
    const data = workFixture();
    for (const value of [{}, { ...data, accountId: U }, { ...data, run: { ...data.run, id: U } }, { ...data, auditId: null }, { ...data, artifacts: data.artifacts.map(f => ({ ...f, runId: U })) }, { ...data, artifactAfter: U }, { ...data, artifacts: [...data.artifacts, ...data.artifacts] }, { ...data, artifacts: [], receipts: [], hasMore: true }]) {
      rpc.mockResolvedValue({ data: value, error: null }); expect((await GET(request())).status).toBe(503);
    }
  });
  it("binds followup pages to the same context", async () => {
    const query = `accountId=${A}&runId=${R}&artifactAfter=${U}&generation=1`;
    expect((await GET(request(query))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("read_ops_run_work", expect.objectContaining({ p_artifact_after: U, p_generation: 1 }));
    rpc.mockResolvedValue({ data: { ...workFixture(), contextGeneration: 2 }, error: null }); expect((await GET(request(query))).status).toBe(503);
  });
  it("unexpected transport failure is a safe unavailable result", async () => { rpc.mockRejectedValue(new Error("SECRET")); const r = await GET(request()); expect(r.status).toBe(503); expect(await r.text()).not.toContain("SECRET"); });
});
describe("read-only work renderer", () => {
  it("renders actual bodies, empty saved edits, receipts, IDs, and source refs as inert text", () => {
    const data = workFixture(); data.artifacts[0].body = '<script>alert("x")</script>'; data.artifacts[0].editedBody = "";
    data.artifacts[0].evidence = [{ source: "test", ref: "javascript:alert(1)" }];
    const html = renderToStaticMarkup(createElement(OpsRunWorkContent, { data }));
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).toContain("Empty saved edit"); expect(html).not.toContain("href="); expect(html).not.toContain("<button"); expect(html).toContain(data.receipts[0].id); expect(html).toContain("not a fresh provider check");
  });
  it("missing output is explicitly distinguished from successful execution", () => { const data = { ...workFixture(), artifacts: [], receipts: [] }; const html = renderToStaticMarkup(createElement(OpsRunWorkContent, { data })); expect(html).toContain("does not prove useful output"); expect(parseOpsRunWork(data, A, R)).not.toBeNull(); });
});
