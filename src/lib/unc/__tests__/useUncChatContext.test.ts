import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState, type PlatformState, type Setter } from "../../platform/state";

// A bounded hook harness, not a browser/render acceptance test. State is mutable
// here only to emulate a new canonical generation arriving while fetch is pending.
vi.mock("react", () => ({ useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useEffect: (fn: () => unknown) => { fn(); } }));
vi.mock("../accountFacts", () => ({ useAccountFacts: () => ({ mode: "account", accountId: "a", facts: null }), refreshAccountFacts: vi.fn(), stripDemoSeed: (value: unknown) => value }));
vi.mock("../context", () => ({ buildUncContext: () => ({}) }));
import { useUncChat } from "../useUncChat";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function Harness() {
  const state = structuredClone({ ...initialState, contextGeneration: 1, messages: [], obThread: [] }) as PlatformState;
  const set: Setter = next => Object.assign(state, typeof next === "function" ? next(state) : next);
  return { state, send: useUncChat(state, set) };
}

describe("chat command polling captures business context", () => {
  it("sends the original generation on both chat and status requests", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ reply: "queued", commandId: "c" })).mockResolvedValueOnce(Response.json({ reply: "finished", status: "done" }));
    vi.stubGlobal("fetch", fetcher);
    const h = Harness();
    h.send({ surface: "corner", text: "run it", canned: "" });
    await vi.advanceTimersByTimeAsync(3100);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].headers["x-unc-context-generation"]).toBe("1");
    expect(fetcher.mock.calls[1][1].headers["x-unc-context-generation"]).toBe("1");
    expect(fetcher.mock.calls[0][1].headers["x-unc-account-id"]).toBe("a");
    expect(fetcher.mock.calls[1][1].headers["x-unc-account-id"]).toBe("a");
    expect(h.state.messages.at(-1)?.text).toBe("finished");
  });
  it("drops a late status after the same account changes generation", async () => {
    vi.useFakeTimers();
    let finish!: (r: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ reply: "queued", commandId: "c" })).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const h = Harness();
    h.send({ surface: "corner", text: "run it", canned: "" });
    await vi.advanceTimersByTimeAsync(3100);
    h.state.contextGeneration = 2;
    h.state.messages = [{ from: "j", text: "new context" }];
    finish(Response.json({ reply: "old completion", status: "done" }));
    await vi.advanceTimersByTimeAsync(1);
    expect(h.state.messages).toEqual([{ from: "j", text: "new context" }]);
  });
  it("does not replace a newer context's typing bubble with an old response", async () => {
    vi.useFakeTimers();
    let finish!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const h = Harness();
    h.send({ surface: "corner", text: "hello", canned: "" });
    h.state.contextGeneration = 2;
    h.state.messages = [{ from: "j", text: "", typing: true }];
    finish(Response.json({ reply: "old reply" }));
    await vi.advanceTimersByTimeAsync(1);
    expect(h.state.messages).toEqual([{ from: "j", text: "", typing: true }]);
  });
});
