/* Every browser-triggered paid model route shares requireModelAccountContext. A member
   denial must return before request parsing, network reads, memory writes, or model calls. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  resolveModel: vi.fn(),
  account: vi.fn(),
}));

vi.mock("@/lib/llm/router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/router")>()),
  complete: mocks.complete,
  resolveModel: mocks.resolveModel,
}));
vi.mock("@/lib/llm/accountContext", () => ({ requireModelAccountContext: mocks.account }));

import { POST as chat } from "@/app/api/unc/chat/route";
import { POST as narrative } from "@/app/api/unc/narrative/route";
import { POST as scan } from "@/app/api/unc/scan/route";

const post = (path: string) => new Request(`http://unc.test${path}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});

beforeEach(() => {
  mocks.complete.mockReset();
  mocks.resolveModel.mockReset().mockReturnValue({ id: "configured" });
  mocks.account.mockReset().mockResolvedValue(Response.json({ error: "only the account owner can do that", code: "owner_only" }, { status: 403 }));
});

describe("browser model-call owner boundary", () => {
  it.each([
    ["chat", chat, "/api/unc/chat"],
    ["narrative", narrative, "/api/unc/narrative"],
    ["scan", scan, "/api/unc/scan"],
  ])("blocks a member before %s can invoke a model", async (_name, route, path) => {
    const res = await route(post(path));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_only" });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
