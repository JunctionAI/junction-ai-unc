import { describe, expect, it, vi } from "vitest";
import { recordEmailAnswer } from "../connect";

describe("email tool memory acknowledgement", () => {
  it("sends the captured generation", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ memory: {} }));
    expect(await recordEmailAnswer("klaviyo", { fetch: request, contextGeneration: 4 })).toBe(true);
    expect(request.mock.calls[0][1].headers["x-unc-context-generation"]).toBe("4");
  });
  it("recognizes an explicit duplicate but not a context conflict", async () => {
    for (const code of ["already_exists", "context_changed", undefined]) {
      const request = vi.fn().mockResolvedValue(Response.json({ code }, { status: 409 }));
      expect(await recordEmailAnswer("none", { fetch: request })).toBe(code === "already_exists");
    }
  });
});
