import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/lib/db/types";
import type { OpsIdentity } from "../session";
import { CATALOG_SPEC_BY_ID } from "@/lib/runtime/catalog-specs";
import { isSafeOpsDraftPreview, OpsDraftPreviewError } from "../draftPreview";

const U = "00000000-0000-4000-8000-000000000001";
const A = "00000000-0000-4000-8000-000000000002";
const R = "00000000-0000-4000-8000-000000000003";
const rpc = vi.fn();
const execute = vi.fn();
let identity: OpsIdentity | Response;
vi.mock("../session", () => ({ requireOpsIdentity: async () => identity }));
vi.mock("../draftPreview", async (original) => {
  const actual = await original<typeof import("../draftPreview")>();
  return { ...actual, executeOpsDraftPreview: (...args: unknown[]) => execute(...args) };
});
vi.mock("@/lib/runtime/store", () => ({ getStore: () => ({ kind: "store" }) }));
vi.mock("@/worker/wiring", () => ({ defaultAccountsSource: () => ({ kind: "accounts" }) }));
import { POST } from "@/app/api/ops/draft-preview/route";

const body = { accountId: A, contextGeneration: 2, requestId: R, routineId: "D05-W08", inputs: {
  newsletter_mode: "visual_drop", newsletter_brief: "A verified founder brief.", about_the_business: "A verified business.",
} };
const request = (value: unknown) => new Request("https://unc.test/api/ops/draft-preview", {
  method: "POST", headers: { "content-type": "application/json", "x-operator-id": "forged" }, body: JSON.stringify(value),
});

beforeEach(() => {
  rpc.mockReset(); execute.mockReset();
  identity = { userId: U, service: { rpc } as unknown as DbClient };
  execute.mockResolvedValue({ runId: R, routineId: "D05-W08", version: 1, mode: "dry_run", status: "done", summary: "Draft ready", receipts: [] });
});

describe("operator draft preview", () => {
  it("admits only a manual built-in draft contract", () => {
    expect(isSafeOpsDraftPreview(CATALOG_SPEC_BY_ID["D05-W08"])).toBe(true);
    expect(isSafeOpsDraftPreview(CATALOG_SPEC_BY_ID["D05-W07"])).toBe(false);
    expect(isSafeOpsDraftPreview(CATALOG_SPEC_BY_ID["D02-W01"])).toBe(false);
  });
  it("uses the server actor and exact request identity, never the forged header", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(execute).toHaveBeenCalledWith(identity instanceof Response ? null : identity.service, U, body,
      expect.objectContaining({ db: identity instanceof Response ? null : identity.service }));
  });
  it("returns 202 for an original run that is still executing", async () => {
    execute.mockResolvedValue({ runId: R, routineId: "D05-W08", version: 1, mode: "dry_run", status: "running", summary: "Still running", receipts: [] });
    expect((await POST(request(body))).status).toBe(202);
  });
  it("refuses malformed, oversized and unsigned requests before execution", async () => {
    expect((await POST(request({ ...body, unexpected: true }))).status).toBe(400);
    expect((await POST(request({ ...body, inputs: { ...body.inputs, Bad: "x" } }))).status).toBe(400);
    expect((await POST(new Request("https://unc.test/api/ops/draft-preview", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status).toBe(400);
    identity = new Response(null, { status: 401 });
    expect((await POST(request(body))).status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  it("requires same-origin JSON with no query controls", async () => {
    expect((await POST(new Request("https://unc.test/api/ops/draft-preview", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.test" }, body: JSON.stringify(body) }))).status).toBe(403);
    expect((await POST(new Request("https://unc.test/api/ops/draft-preview", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) }))).status).toBe(415);
    expect((await POST(new Request("https://unc.test/api/ops/draft-preview?live=true", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it("maps authorization failures without returning private details", async () => {
    execute.mockRejectedValue(new OpsDraftPreviewError("Separate, unexpired operator draft-preview access is required for this client.", 403));
    const response = await POST(request(body));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("database");
  });
});
