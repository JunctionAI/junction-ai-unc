/** Real reply/concision orchestration; mocked data and model boundaries, no provider I/O. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeContextError } from "../../runtime/contextFence";
import type { DbClient } from "../../db/types";

const mock = vi.hoisted(() => ({ complete: vi.fn(), recall: vi.fn(), learn: vi.fn() }));
vi.mock("../../llm/router", () => ({ complete: mock.complete, resolveModel: () => ({ id: "fixture-model" }) }));
vi.mock("../../brain/hooks", () => ({ afterChatReply: mock.learn }));
vi.mock("../../brain/profile", () => ({ getProfile: async () => null, renderProfileForPrompt: () => "" }));
vi.mock("../../brain/retrieve", () => ({ recallForContext: async () => ({ lines: [] }) }));
vi.mock("../../metrics/catalog", () => ({ getMetrics: async () => [], renderCertifiedMetrics: () => "" }));
vi.mock("../prompt", async original => ({ ...await original<typeof import("../prompt")>(), recallPlaybookNotes: mock.recall }));

import { respondAsUnc } from "../respond";

const result = (text = "your draft is ready.") => ({ text, stopReason: "end", usage: { input: 10, output: 5 }, provider: "fixture", model: "fixture", latencyMs: 1 });
const long = "First sentence. Second sentence. Third sentence. Fourth sentence.";
const input = { history: [{ role: "user" as const, content: "what next?" }], context: {}, surface: "corner" as const,
  account: { accountId: "captured-account", db: {} as DbClient } };
function setup() {
  let failure: RuntimeContextError | null = null;
  const guard = vi.fn(async () => { if (failure) throw failure; });
  return { guard, invalidate: () => { failure = new RuntimeContextError("context_changed", "changed"); } };
}
beforeEach(() => {
  mock.complete.mockReset().mockResolvedValue(result());
  mock.recall.mockReset().mockResolvedValue(null);
  mock.learn.mockReset().mockResolvedValue(undefined);
});

describe("reply pipeline preserves captured-identity failures", () => {
  it("does not recall or model after an initial denial", async () => {
    const h = setup(); h.invalidate();
    await expect(respondAsUnc({ ...input, guard: h.guard })).rejects.toMatchObject({ code: "context_changed" });
    expect(mock.recall).not.toHaveBeenCalled();
    expect(mock.complete).not.toHaveBeenCalled();
    expect(mock.learn).not.toHaveBeenCalled();
  });
  it("rejects a context change during evidence gathering before model work", async () => {
    const h = setup(); mock.recall.mockImplementationOnce(async () => { h.invalidate(); return null; });
    await expect(respondAsUnc({ ...input, guard: h.guard })).rejects.toMatchObject({ code: "context_changed" });
    expect(mock.complete).not.toHaveBeenCalled();
    expect(mock.learn).not.toHaveBeenCalled();
  });
  it.each(["success", "error"])("does not return a reply/fallback or learn after a %s across reset", async mode => {
    const h = setup();
    mock.complete.mockImplementationOnce(async () => {
      h.invalidate();
      if (mode === "error") throw new Error("provider unavailable");
      return result();
    });
    await expect(respondAsUnc({ ...input, guard: h.guard })).rejects.toMatchObject({ code: "context_changed" });
    expect(mock.complete).toHaveBeenCalledTimes(1);
    expect(mock.learn).not.toHaveBeenCalled();
  });
  it("does not revive the first answer after a transient pre-reask identity failure", async () => {
    mock.complete.mockResolvedValueOnce(result(long));
    let calls = 0;
    const guard = vi.fn(async () => { if (++calls === 4) throw new RuntimeContextError("context_unavailable", "unavailable"); });
    await expect(respondAsUnc({ ...input, guard })).rejects.toMatchObject({ code: "context_unavailable" });
    expect(mock.complete).toHaveBeenCalledTimes(1);
    expect(mock.learn).not.toHaveBeenCalled();
  });
  it("rejects a reset during the second model call without returning the first answer", async () => {
    const h = setup();
    mock.complete.mockResolvedValueOnce(result(long)).mockImplementationOnce(async () => { h.invalidate(); return result(); });
    await expect(respondAsUnc({ ...input, guard: h.guard })).rejects.toMatchObject({ code: "context_changed" });
    expect(mock.complete).toHaveBeenCalledTimes(2);
    expect(mock.learn).not.toHaveBeenCalled();
  });
  it("keeps the current successful reply and starts its existing learning hook", async () => {
    const h = setup();
    await expect(respondAsUnc({ ...input, guard: h.guard })).resolves.toEqual({ ok: true, reply: "your draft is ready." });
    expect(mock.learn).toHaveBeenCalledTimes(1);
  });
});
