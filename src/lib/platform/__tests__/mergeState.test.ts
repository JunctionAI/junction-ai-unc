import { describe, expect, it } from "vitest";
import { mergeState } from "../mergeState";

describe("platform state patch identity", () => {
  it("keeps empty synchronization patches referentially stable", () => {
    const state = { planAgreedAt: "2026-09-02", messages: [] };
    expect(mergeState(state, {})).toBe(state);
    expect(mergeState(state, { planAgreedAt: state.planAgreedAt })).toBe(state);
  });
  it("applies real edits without mutating the previous snapshot", () => {
    const state = { planAgreedAt: null as string | null, messages: ["old"] };
    const messages = [...state.messages, "new"];
    const next = mergeState(state, { messages });
    expect(next).not.toBe(state);
    expect(next.messages).toBe(messages);
    expect(state.messages).toEqual(["old"]);
  });
});
